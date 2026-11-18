// Serveur local des fonctions Netlify (netlify/functions/*.mts), sans Netlify CLI ni compte.
//
//   pnpm api            puis, dans un autre terminal :  pnpm dev   (ou pnpm preview)
//
// Vite redirige /api vers ce serveur (voir vite.config.ts). Les fonctions sont chargées telles quelles par Vite
// (TypeScript compris) et appelées comme sur Netlify : requête web standard en entrée, réponse en sortie ; une
// fonction d'arrière-plan reçoit un 202 immédiat et s'exécute ensuite. Le stockage est en mémoire (DCB_STORE=memory) :
// les jobs disparaissent à l'arrêt du serveur. La clé OpenRouter, si elle est définie, est lue dans web/.env.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createVite } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.API_PORT ?? 8787);
process.env.DCB_STORE = "memory";

// Fichier .env minimal (CLE=valeur), jamais versionné ; les variables déjà définies ont priorité.
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const vite = await createVite({
  root, appType: "custom", logLevel: "warn", configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
});

const routes = [];
for (const file of readdirSync(join(root, "netlify/functions")).filter((f) => /\.m?ts$/.test(f))) {
  const mod = await vite.ssrLoadModule(`/netlify/functions/${file}`);
  const path = mod.config?.path;
  if (!path) continue;
  const keys = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
  routes.push({ file, pattern, keys, handler: mod.default, background: Boolean(mod.config.background), method: mod.config.method });
}

const server = createHttp(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const route = routes.find((r) => r.pattern.test(url.pathname) && (!r.method || r.method === req.method));
    if (!route) { res.writeHead(404, { "Content-Type": "application/json" }).end('{"erreur":"route inconnue"}'); return; }
    const match = route.pattern.exec(url.pathname);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
    const context = { ip: req.socket.remoteAddress ?? "local", params, geo: {}, site: {}, waitUntil: () => undefined };
    if (route.background) {
      res.writeHead(202, { "Content-Length": "0" }).end();
      Promise.resolve(route.handler(request, context)).catch((e) => console.error(`[${route.file}]`, e));
      return;
    }
    const out = await route.handler(request, context);
    res.writeHead(out.status, Object.fromEntries(out.headers)).end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"erreur":"erreur interne"}');
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`API locale prête : http://127.0.0.1:${port}/api/status (${routes.length} fonctions, stockage en mémoire, IA ${process.env.OPENROUTER_API_KEY ? "activée" : "désactivée"})`);
});

// Vérification de rendu de l'application construite (dist/) : erreurs console, rendu des vues,
// captures d'écran (ordinateur, mobile, mode sombre). Usage : node scripts/check.mjs
// Navigateur : variable CHROME_PATH, sinon Chrome ou Edge aux emplacements Windows/Linux/macOS usuels.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { preview } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../outputs/screens");
mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("Aucun navigateur trouvé : définir CHROME_PATH.");
  process.exit(2);
}

const server = await preview({ root: resolve(here, ".."), preview: { port: 4173, strictPort: true }, logLevel: "error" });
const base = "http://localhost:4173/";

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-first-run", "--hide-scrollbars"],
});

const pages = [
  { name: "comprendre", hash: "#/comprendre", vp: [1440, 900] },
  { name: "explorer_prevision", hash: "#/explorer?couche=prediction&echelle=prov", vp: [1440, 900], map: true },
  { name: "explorer_fiche", hash: "#/explorer?couche=tap&annee=2024-2025&echelle=prov&sel=BF6402", vp: [1440, 900], map: true },
  { name: "explorer_comparaison", hash: "#/explorer?couche=deperdition_obs&annee=2024-2025&echelle=prov&sel=BF5901&cmp=BF1300", vp: [1440, 900], map: true },
  { name: "explorer_bivarie_regions", hash: "#/explorer?couche=bivarie&echelle=reg", vp: [1440, 900], map: true },
  { name: "explorer_avant_apres", hash: "#/explorer?couche=baisse_ecoles_pic&annee=2024-2025&echelle=prov&ref=2017-2018&osm=1", vp: [1440, 900], map: true },
  { name: "anticiper", hash: "#/anticiper", vp: [1440, 900], full: true },
  { name: "methode", hash: "#/methode", vp: [1440, 900], full: true },
  { name: "mobile_explorer", hash: "#/explorer?couche=prediction&echelle=prov&sel=BF6403", vp: [390, 844], map: true, mobile: true },
  { name: "mobile_comprendre", hash: "#/comprendre", vp: [390, 844], mobile: true, full: true },
  { name: "sombre_explorer", hash: "#/explorer?couche=indice&echelle=prov&sel=BF6001", vp: [1440, 900], map: true, dark: true },
];

const problems = [];
for (const p of pages) {
  const page = await browser.newPage();
  await page.setViewport({ width: p.vp[0], height: p.vp[1], deviceScaleFactor: p.mobile ? 2 : 1, isMobile: Boolean(p.mobile) });
  await page.evaluateOnNewDocument((dark) => localStorage.setItem("theme", dark ? "dark" : "light"), Boolean(p.dark));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`[${p.name}] console.${m.type()} : ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${p.name}] exception : ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`[${p.name}] requête échouée : ${r.url()}`));
  await page.goto(base + p.hash, { waitUntil: "networkidle0" });
  if (p.map) {
    try {
      await page.waitForSelector(".maplibregl-canvas", { timeout: 20000 });
      await page.waitForFunction(() => document.querySelectorAll(".map-label").length > 0, { timeout: 20000 });
    } catch {
      problems.push(`[${p.name}] la carte ne s'est pas affichée`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  } else {
    await new Promise((r) => setTimeout(r, 600));
  }
  await page.screenshot({ path: join(outDir, `${p.name}.png`), fullPage: Boolean(p.full) });
  const text = await page.evaluate(() => document.body.innerText.length);
  if (text < 200) problems.push(`[${p.name}] contenu presque vide (${text} caractères)`);
  await page.close();
}

// Exports : image de la carte, CSV du classement, fiche province imprimée en PDF.
{
  const dl = join(outDir, "exports");
  mkdirSync(dl, { recursive: true });
  for (const f of readdirSync(dl)) rmSync(join(dl, f));
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => problems.push(`[exports] exception : ${e.message}`));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
  await page.goto(`${base}#/explorer?couche=prediction&echelle=prov&sel=BF6402`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelectorAll(".map-label").length > 0, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const clickText = (txt) =>
    page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), txt);
  await clickText("Image de la carte");
  await clickText("Exporter en CSV");
  await new Promise((r) => setTimeout(r, 2500));
  const files = readdirSync(dl);
  if (!files.some((f) => f.endsWith(".png"))) problems.push("[exports] image PNG non produite");
  if (!files.some((f) => f.endsWith(".csv"))) problems.push("[exports] CSV non produit");
  await page.evaluate(() => document.body.classList.add("print-sheet"));
  await page.emulateMediaType("print");
  await page.pdf({ path: join(dl, "fiche_seno.pdf"), format: "A4", printBackground: true });
  console.log(`Exports : ${readdirSync(dl).join(", ")}`);
  await page.close();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));

console.log(`${pages.length} vues vérifiées, captures dans ${outDir}`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("Aucune erreur console.");

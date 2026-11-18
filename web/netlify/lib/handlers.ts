/** Logique des fonctions Netlify, indépendante de la plateforme (testable avec un magasin en mémoire). */
import { buildFacts, checkNumbers, SYSTEM_PROMPT, templateReport, userPrompt } from "../../engine/report";
import type { NumberCheck } from "../../engine/report";
import { runEngine } from "../../engine/run";
import type { EngineBaseline, EngineModel, Issue, ScenarioResult, ValidationContext } from "../../engine/types";
import { MAX_BYTES, nextYear, validateUpload } from "../../engine/validate";
import type { KV } from "./kv";
import { chatWithFallback, DEFAULT_MODELS, LlmError } from "./llm";
import { consume, dayKey, ipHash, limitsFrom } from "./quota";

export const JOB_ID = /^(\d{8})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEEP_DAYS = 2;
const LLM_BUSY_MS = 3 * 60_000;

export interface Deps {
  jobs: KV;
  quota: KV;
  reports: KV;
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  now: () => Date;
  base: EngineBaseline;
  model: EngineModel;
  ip: string;
  origin?: string;
}

export type JobStatus = "en_attente" | "calcul" | "termine" | "erreur" | "refuse";

export interface Report {
  statut: "gabarit" | "en_cours" | "termine" | "erreur";
  source: "gabarit" | "llm";
  texte: string;
  modele?: string;
  verification?: NumberCheck;
  message?: string;
  genere_le: string;
}

export interface Job {
  id: string;
  statut: JobStatus;
  etape: string;
  cree_le: string;
  maj_le: string;
  message?: string;
  erreurs?: Issue[];
  avertissements?: Issue[];
  resultat?: ScenarioResult;
  rapport?: Report;
}

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export function validationContext(base: EngineBaseline): ValidationContext {
  const fallback: ValidationContext["fallback"] = {};
  for (const r of base.rows) {
    if (r.annee_scolaire !== base.derniere_annee) continue;
    fallback[r.code] = { part_rurale: r.part_rurale, part_prive: r.part_prive, pauvrete: r.pauvrete };
  }
  return { codes: Object.keys(base.unites), lastYear: base.derniere_annee, fallback };
}

function idDateOk(id: string, now: Date): boolean {
  const m = JOB_ID.exec(id);
  if (!m) return false;
  const d = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8));
  return Math.abs(d - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) <= KEEP_DAYS * 86_400_000;
}

async function save(deps: Deps, job: Job, patch: Partial<Job>): Promise<Job> {
  const next = { ...job, ...patch, maj_le: deps.now().toISOString() };
  await deps.jobs.set(job.id, next);
  return next;
}

/** Supprime les jobs plus anciens que KEEP_DAYS jours (l'identifiant commence par sa date). */
async function purge(deps: Deps): Promise<void> {
  const limit = dayKey(new Date(deps.now().getTime() - KEEP_DAYS * 86_400_000));
  for (const key of (await deps.jobs.list()).filter((k) => k.slice(0, 8) < limit).slice(0, 50)) await deps.jobs.delete(key);
}

// ---------------------------------------------------------------------------- état du service

export function handleStatus(deps: Deps): Response {
  const model = (deps.env("OPENROUTER_MODEL") ?? DEFAULT_MODELS[0]).trim();
  return json({
    ok: true,
    moteur: { version: deps.model.version, modele: deps.model.modele, donnees: deps.base.genere_le },
    annees: { derniere: deps.base.derniere_annee, nouvelle: nextYear(deps.base.derniere_annee) },
    llm: { actif: Boolean(deps.env("OPENROUTER_API_KEY")), modele: model },
    limites: { ...limitsFrom(deps.env), taille_max_ko: MAX_BYTES / 1000 },
  });
}

// ---------------------------------------------------------------------------- calcul (arrière-plan)

/** Corps attendu : { id, csv }. Ne renvoie rien : le résultat est lu avec GET /api/jobs/:id. */
export async function handleCreateJob(req: Request, deps: Deps): Promise<void> {
  let id = "";
  try {
    const text = await req.text();
    if (text.length > MAX_BYTES + 2_000) return;
    const body = JSON.parse(text) as { id?: unknown; csv?: unknown };
    if (typeof body.id !== "string" || !idDateOk(body.id, deps.now())) return;
    id = body.id;
    if (await deps.jobs.get(id)) return;
    const stamp = deps.now().toISOString();
    let job: Job = { id, statut: "en_attente", etape: "Demande reçue", cree_le: stamp, maj_le: stamp };
    await deps.jobs.set(id, job);

    const q = await consume(deps.quota, `jobs/${dayKey(deps.now())}/${ipHash(deps.ip, deps.env("QUOTA_SALT"))}`, limitsFrom(deps.env).jobsParIp);
    if (!q.ok) {
      await save(deps, job, { statut: "refuse", etape: "Refusé", message: "Limite quotidienne de calculs atteinte pour cette connexion. Réessayez demain." });
      return;
    }
    await purge(deps);
    if (typeof body.csv !== "string") {
      await save(deps, job, { statut: "erreur", etape: "Fichier absent", message: "Aucun fichier reçu." });
      return;
    }
    job = await save(deps, job, { statut: "calcul", etape: "Validation du fichier" });
    const v = validateUpload(body.csv, validationContext(deps.base));
    if (!v.ok) {
      await save(deps, job, { statut: "erreur", etape: "Fichier refusé", message: "Le fichier contient des erreurs.", erreurs: v.issues.filter((i) => i.niveau === "erreur").slice(0, 40), avertissements: v.issues.filter((i) => i.niveau === "avertissement") });
      return;
    }
    job = await save(deps, job, { etape: "Calcul des variables, de l'indice et de la prévision" });
    const resultat = runEngine(v, deps.base, deps.model, { now: deps.now });
    const facts = buildFacts(resultat, deps.base);
    await save(deps, job, {
      statut: "termine", etape: "Terminé", resultat, avertissements: resultat.avertissements,
      rapport: { statut: "gabarit", source: "gabarit", texte: templateReport(facts), genere_le: deps.now().toISOString() },
    });
  } catch (e) {
    console.error("job en échec", id, (e as Error).message);
    if (id) {
      const cur = await deps.jobs.get<Job>(id).catch(() => null);
      if (cur) await save(deps, cur, { statut: "erreur", etape: "Erreur interne", message: "Le calcul a échoué. Vérifiez le fichier ou réessayez." }).catch(() => undefined);
    }
  }
}

export async function handleGetJob(id: string, url: URL, deps: Deps): Promise<Response> {
  if (!JOB_ID.test(id)) return json({ statut: "inconnu", message: "Identifiant invalide." }, 400);
  const job = await deps.jobs.get<Job>(id);
  if (!job) return json({ statut: "inconnu" }, 404);
  if (url.searchParams.get("partie") === "rapport") return json({ id: job.id, statut: job.statut, rapport: job.rapport ?? null });
  return json(job);
}

// ---------------------------------------------------------------------------- rapport (arrière-plan)

/** Corps attendu : { id }. Remplace le rapport de secours par un texte rédigé par le modèle de langage. */
export async function handleReport(req: Request, deps: Deps): Promise<void> {
  let id = "";
  try {
    const body = JSON.parse(await req.text()) as { id?: unknown };
    if (typeof body.id !== "string" || !JOB_ID.test(body.id)) return;
    id = body.id;
    const job = await deps.jobs.get<Job>(id);
    if (!job || job.statut !== "termine" || !job.resultat) return;
    const busy = job.rapport?.statut === "en_cours" && deps.now().getTime() - Date.parse(job.maj_le) < LLM_BUSY_MS;
    if (busy) return;
    const facts = buildFacts(job.resultat, deps.base);
    const fallback = job.rapport?.source === "gabarit" ? job.rapport : { statut: "gabarit" as const, source: "gabarit" as const, texte: templateReport(facts), genere_le: deps.now().toISOString() };
    const fail = (message: string) => save(deps, job, { rapport: { ...fallback, statut: "erreur", message } });

    const apiKey = deps.env("OPENROUTER_API_KEY");
    if (!apiKey) {
      await fail("Aucune clé de modèle de langage n'est configurée sur ce serveur : rapport de secours affiché.");
      return;
    }
    const cached = await deps.reports.get<Report>(job.resultat.empreinte);
    if (cached) {
      await save(deps, job, { rapport: { ...cached, message: "Rapport déjà rédigé pour ces mêmes données." } });
      return;
    }
    const lim = limitsFrom(deps.env);
    const day = dayKey(deps.now());
    const perIp = await consume(deps.quota, `rapports/${day}/${ipHash(deps.ip, deps.env("QUOTA_SALT"))}`, lim.rapportsParIp);
    const global = perIp.ok ? await consume(deps.quota, `rapports/${day}/global`, lim.rapportsGlobal) : { ok: false };
    if (!perIp.ok || !global.ok) {
      await fail("Limite quotidienne de rapports rédigés par IA atteinte : rapport de secours affiché.");
      return;
    }
    await save(deps, job, { rapport: { ...fallback, statut: "en_cours", message: "Rédaction en cours…" } });
    const models = [deps.env("OPENROUTER_MODEL"), deps.env("OPENROUTER_FALLBACK_MODEL")].filter((m): m is string => !!m?.trim()).map((m) => m.trim());
    try {
      const r = await chatWithFallback(models.length ? models : DEFAULT_MODELS, {
        apiKey, system: SYSTEM_PROMPT, user: userPrompt(facts), referer: deps.origin, fetchImpl: deps.fetch,
      });
      const verification = checkNumbers(r.texte, facts);
      const report: Report = {
        statut: "termine", source: "llm", texte: r.texte, modele: r.modele, verification, genere_le: deps.now().toISOString(),
        message: verification.ok ? undefined : `${verification.inconnus.length} nombre(s) du texte ne figurent pas dans les résultats : ${verification.inconnus.slice(0, 6).join(", ")}. Vérifiez-les avant de citer ce rapport.`,
      };
      await deps.reports.set(job.resultat.empreinte, report);
      await save(deps, job, { rapport: report });
    } catch (e) {
      const status = e instanceof LlmError ? e.status : null;
      console.error("rapport IA en échec", status ?? "", (e as Error).message);
      await fail(`Le modèle de langage n'a pas répondu (${(e as Error).message}) : rapport de secours affiché.`);
    }
  } catch (e) {
    console.error("rapport en échec", id, (e as Error).message);
  }
}

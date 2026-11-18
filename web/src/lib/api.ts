/** Client des fonctions Netlify : /api/status, /api/jobs, /api/report. */
import type { Job, Report } from "../../netlify/lib/handlers";

export type { Job, Report };

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

export interface ApiStatus {
  ok: boolean;
  moteur: { version: string; modele: string; donnees: string };
  annees: { derniere: string; nouvelle: string };
  llm: { actif: boolean; modele: string };
  limites: { jobsParIp: number; rapportsParIp: number; rapportsGlobal: number; taille_max_ko: number };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("annulé", "AbortError")); }, { once: true });
  });

export async function fetchStatus(signal?: AbortSignal): Promise<ApiStatus | null> {
  try {
    const r = await fetch(`${API_BASE}/status`, { signal, headers: { Accept: "application/json" } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    return (await r.json()) as ApiStatus;
  } catch {
    return null;
  }
}

/** Identifiant de job : la date (UTC) du jour puis un UUID. Le serveur n'accepte que des identifiants récents. */
export function newJobId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${day}-${crypto.randomUUID()}`;
}

export async function startJob(csv: string, id = newJobId()): Promise<string> {
  const r = await fetch(`${API_BASE}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, csv }) });
  if (r.status !== 202 && !r.ok) throw new Error(`Le service de calcul a refusé la demande (HTTP ${r.status}).`);
  return id;
}

export interface PollOptions {
  signal?: AbortSignal;
  onUpdate?: (job: Job) => void;
  intervalMs?: number;
  timeoutMs?: number;
}

/** Interroge le job jusqu'à un état final. Les premiers 404 sont normaux : la fonction d'arrière-plan démarre. */
export async function waitForJob(id: string, opts: PollOptions = {}): Promise<Job> {
  const started = Date.now();
  const every = opts.intervalMs ?? 1000;
  const limit = opts.timeoutMs ?? 90_000;
  for (;;) {
    const r = await fetch(`${API_BASE}/jobs/${id}`, { signal: opts.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    if (r.ok) {
      const job = (await r.json()) as Job;
      opts.onUpdate?.(job);
      if (job.statut === "termine" || job.statut === "erreur" || job.statut === "refuse") return job;
    } else if (r.status !== 404 || Date.now() - started > 15_000) {
      throw new Error(`Le suivi du calcul a échoué (HTTP ${r.status}).`);
    }
    if (Date.now() - started > limit) throw new Error("Le calcul met trop de temps : réessayez dans un instant.");
    await sleep(every, opts.signal);
  }
}

/** État d'un job (null s'il a expiré ou si le service est indisponible). */
export async function getJob(id: string, signal?: AbortSignal): Promise<Job | null> {
  try {
    const r = await fetch(`${API_BASE}/jobs/${id}`, { signal, cache: "no-store" });
    return r.ok ? ((await r.json()) as Job) : null;
  } catch {
    return null;
  }
}

/** Demande la rédaction du rapport par le modèle de langage puis attend la fin (ou le rapport de secours). */
export async function requestReport(id: string, opts: PollOptions = {}): Promise<Report | null> {
  const r = await fetch(`${API_BASE}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  if (r.status !== 202 && !r.ok) throw new Error(`Le service de rapport a refusé la demande (HTTP ${r.status}).`);
  const started = Date.now();
  for (;;) {
    await sleep(opts.intervalMs ?? 1500, opts.signal);
    const p = await fetch(`${API_BASE}/jobs/${id}?partie=rapport`, { signal: opts.signal, cache: "no-store" });
    if (p.ok) {
      const { rapport } = (await p.json()) as { rapport: Report | null };
      if (rapport && rapport.statut !== "en_cours" && (rapport.source === "llm" || rapport.statut === "erreur")) return rapport;
    }
    if (Date.now() - started > (opts.timeoutMs ?? 150_000)) throw new Error("La rédaction du rapport prend trop de temps.");
  }
}

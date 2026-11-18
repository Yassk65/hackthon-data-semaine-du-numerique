/** Limites d'usage : protègent la clé du modèle de langage et le stockage contre les abus. */
import { createHash } from "node:crypto";
import type { KV } from "./kv";

export interface Limits {
  jobsParIp: number;
  rapportsParIp: number;
  rapportsGlobal: number;
}

export function limitsFrom(env: (k: string) => string | undefined): Limits {
  const n = (k: string, d: number) => {
    const v = Number(env(k));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return { jobsParIp: n("LIMIT_JOBS_PER_IP_DAY", 40), rapportsParIp: n("LIMIT_REPORTS_PER_IP_DAY", 8), rapportsGlobal: n("LIMIT_REPORTS_GLOBAL_DAY", 150) };
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Empreinte de l'adresse IP : on ne stocke jamais l'adresse elle-même. */
export function ipHash(ip: string, salt = ""): string {
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 16);
}

/** Incrémente un compteur journalier si la limite n'est pas atteinte (approximatif : lecture puis écriture). */
export async function consume(kv: KV, key: string, max: number): Promise<{ ok: boolean; utilises: number }> {
  const used = (await kv.get<{ n: number }>(key))?.n ?? 0;
  if (used >= max) return { ok: false, utilises: used };
  await kv.set(key, { n: used + 1 });
  return { ok: true, utilises: used + 1 };
}

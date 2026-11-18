/** Version « mise à jour » du tableau de bord : les résultats du recalcul remplacent ceux de la référence
 * pour l'année déposée et l'horizon de prévision. La référence n'est jamais modifiée : on la retrouve en supprimant le scénario. */
import type { ScenarioResult } from "../../engine/types";
import type { Core, Series } from "../data/types";

const KEY = "dcb.scenario.v1";
const JOB_KEY = "dcb.job.v1";

export function loadStoredScenario(): ScenarioResult | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ScenarioResult;
    return s && typeof s.annee === "string" && s.provinces ? s : null;
  } catch {
    return null;
  }
}

export function loadStoredJobId(): string | null {
  try {
    return localStorage.getItem(JOB_KEY);
  } catch {
    return null;
  }
}

export function storeScenario(res: ScenarioResult, jobId: string | null = null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(res));
    if (jobId) localStorage.setItem(JOB_KEY, jobId);
  } catch {
    // Stockage plein ou interdit : le scénario reste actif jusqu'au rechargement de la page.
  }
}

export function clearScenario(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(JOB_KEY);
  } catch {
    // rien à faire
  }
}

const NOTE_QUALITE = "valeurs déposées par l'utilisateur : qualité non évaluée";

/** Prolonge une série d'une année si besoin puis écrit la valeur de l'année déposée. */
function put(series: Series | undefined, length: number, index: number, value: number | null | undefined): Series {
  const s = (series ?? []).slice(0, length);
  while (s.length < length) s.push(null);
  if (value !== undefined) s[index] = value;
  return s;
}

export function applyScenario(core: Core, res: ScenarioResult): Core {
  const next = structuredClone(core) as Core;
  const { meta, values, risk } = next;
  const isNew = res.type === "nouvelle_annee";

  // Calendrier : une nouvelle année déplace la dernière année observée et l'horizon de prévision.
  if (isNew) {
    if (!meta.annees.includes(res.cible)) meta.annees = [...meta.annees, res.cible];
    meta.derniere_annee = res.annee;
    meta.horizon = res.cible;
    if (!meta.annees_indice.includes(res.annee)) meta.annees_indice = [...meta.annees_indice, res.annee];
  }
  const n = meta.annees.length;
  const yi = meta.annees.indexOf(res.annee);

  // Valeurs : toutes les séries gardent la même longueur que le calendrier.
  const extend = (u: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(u)) if (Array.isArray(v)) u[k] = put(v as Series, n, -1, undefined);
  };
  extend(values.national);
  for (const u of Object.values(values.reg)) extend(u);
  for (const [code, r] of Object.entries(res.provinces)) {
    const u = values.prov[code];
    if (!u) continue;
    extend(u);
    for (const [key, v] of Object.entries(r.valeurs)) if (key in u) u[key] = put(u[key] as Series, n, yi, v);
    // Variables que le fichier ne porte pas : vides pour une nouvelle année, inchangées pour une correction.
    if (u.qualite_score) u.qualite_score = put(u.qualite_score as Series, n, yi, null);
    const motifs = (u.qualite_motifs as (string | null)[]).slice(0, n);
    while (motifs.length < n) motifs.push(null);
    motifs[yi] = NOTE_QUALITE;
    u.qualite_motifs = motifs;
  }
  if (isNew) {
    for (const u of Object.values(values.prov)) extend(u);
  }

  // Indice et prévision.
  for (const [code, r] of Object.entries(res.provinces)) {
    const unit = risk.prov[code] ?? (risk.prov[code] = { indice: {}, prediction: {} });
    unit.indice[res.annee] = r.indice as never;
    const prediction = { ...r.prediction };
    unit.prediction[res.cible] = prediction as never;
    if (isNew && unit.prediction[res.annee]) {
      // La prévision de référence pour l'année déposée est confrontée à la valeur observée.
      const obs = r.valeurs.deperdition_obs;
      unit.prediction[res.annee].observe = obs === null || obs === undefined ? null : Math.min(60, Math.max(0, Math.round(obs * 10) / 10));
    }
    risk.recommandations.prov[code] = r.reco;
  }
  for (const [reg, r] of Object.entries(res.regions)) {
    const unit = risk.reg[reg] ?? (risk.reg[reg] = { indice: {}, prediction: {} });
    unit.prediction[res.cible] = r.prediction as never;
    risk.recommandations.reg[reg] = { types: [], alerte: r.prediction.p_alerte >= 0.5, priorite: r.prediction.p_alerte >= 0.5 ? 2 : 3 };
  }

  meta.chiffres_cles = { ...meta.chiffres_cles, provinces_alerte: res.resume.n_alerte, seuil_alerte: res.moteur.alerte };
  return next;
}

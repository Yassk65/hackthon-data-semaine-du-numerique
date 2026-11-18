/** Orchestration du recalcul : fichier validé -> variables dérivées -> indice -> prévision -> comparaison. */
import { averageRanks, computeForecast, computeIndex, DEFAULT_DRAWS, DEFAULT_SEED, recommend, regionForecast } from "./scoring";
import type { ForecastRaw, IndexRaw } from "./scoring";
import { buildFrames } from "./features";
import type { Frame } from "./features";
import { nextYear } from "./validate";
import type {
  BacktestSummary, EngineBaseline, EngineModel, Issue, Mover, Num, PredictionRecord, ProvinceResult, ScenarioResult,
  UploadRow, ValidationResult,
} from "./types";

const isNum = (v: number): boolean => !Number.isNaN(v);
// toFixed arrondit d'après la valeur binaire exacte, comme round() de Python.
const rnd = (v: number, d: number): number | null => (isNum(v) ? Number(v.toFixed(d)) : null);
const rnd0 = (v: number, d: number): number => rnd(v, d) ?? 0;

export interface RunOptions {
  draws?: number;
  seed?: number;
  now?: () => Date;
}

/** Empreinte courte et stable (cyrb53) : sert de clé de cache pour le rapport. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export interface RawComputation {
  frames: Frame[];
  index: IndexRaw[];
  forecast: ForecastRaw[];
  regions: Record<string, ForecastRaw>;
}

/** Calcul en pleine précision (utilisé tel quel par les tests de conformité avec Python). */
export function computeRaw(rows: UploadRow[], year: string, base: EngineBaseline, model: EngineModel, opts: RunOptions = {}): RawComputation {
  const all = buildFrames(base.rows, rows, year);
  const frames = all.filter((f) => f.annee === year);
  const index = computeIndex(frames, base, opts.draws ?? DEFAULT_DRAWS, opts.seed ?? DEFAULT_SEED);
  const forecast = computeForecast(frames, model);
  return { frames, index, forecast, regions: regionForecast(frames, forecast, base) };
}

function predictionRecord(f: ForecastRaw, observe: Num = null): PredictionRecord {
  return {
    valeur: rnd0(f.prediction, 1), ic80: [rnd0(f.ic80[0], 1), rnd0(f.ic80[1], 1)], ic90: [rnd0(f.ic90[0], 1), rnd0(f.ic90[1], 1)],
    p_alerte: rnd0(f.p_alerte, 2), rang: f.rang, observe, persistance: rnd(f.persistance, 1), hors_echantillon: false, facteurs: f.facteurs,
  };
}

const VALUE_KEYS: Record<string, keyof Frame> = {
  deperdition_obs: "deperdition_prec", survie_cm2: "survie_cm2_prec", tap: "tap", tbs: "tbs", ips_tbs: "ips_tbs",
  ratio_eleves_maitre: "ratio_eleves_maitre", ratio_eleves_salle: "ratio_eleves_salle", pauvrete: "pauvrete",
  baisse_ecoles_pic: "baisse_ecoles_pic", var_ecoles_1an: "var_ecoles_1an", baisse_effectif_pic: "baisse_effectif_pic",
  redoublement: "redoublement_global_prec", part_rurale: "part_rurale", part_prive: "part_prive", effectif: "effectif",
  ecoles: "ecoles", maitres: "maitres", salles: "salles",
};

function spearman(a: number[], b: number[]): number | null {
  if (a.length < 5) return null;
  const ra = averageRanks(a), rb = averageRanks(b);
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length, mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let sab = 0, saa = 0, sbb = 0;
  ra.forEach((x, i) => { sab += (x - ma) * (rb[i] - mb); saa += (x - ma) ** 2; sbb += (rb[i] - mb) ** 2; });
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

export function runEngine(
  input: Pick<ValidationResult, "rows" | "annee" | "type" | "completees"> & { issues?: Issue[] },
  base: EngineBaseline,
  model: EngineModel,
  opts: RunOptions = {},
): ScenarioResult {
  if (!input.annee || !input.type) throw new Error("fichier non validé : année ou type manquant");
  const year = input.annee;
  const target = nextYear(year);
  const draws = opts.draws ?? DEFAULT_DRAWS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const { frames, index, forecast, regions } = computeRaw(input.rows, year, base, model, opts);
  const prevYear = base.annees[base.annees.indexOf(year) - 1] ?? base.derniere_annee;
  const refIndexYear = input.type === "correction" ? year : prevYear;

  const provinces: Record<string, ProvinceResult> = {};
  frames.forEach((f, i) => {
    const ix = index[i], fc = forecast[i];
    const ref = base.resultats[f.code];
    const refIdx = ref?.indice[refIndexYear];
    const refPred = input.type === "correction" ? ref?.prediction[target] : null;
    const prevu = input.type === "nouvelle_annee" ? ref?.prediction[year] : null;
    const manquants = model.features.filter((name) => {
      const v = (f as unknown as Record<string, number>)[name];
      return !isNum(v);
    });
    provinces[f.code] = {
      indice: {
        score: rnd(ix.indice, 1), classe: ix.classe, rang: ix.rang, rang_p05: ix.rang_p05, rang_p95: ix.rang_p95,
        proba_q5: rnd0(ix.proba_q5, 2), facteurs: ix.facteurs, dimension: ix.dimension,
        dims: Object.fromEntries(Object.entries(ix.dims).map(([k, v]) => [k, rnd(v, 1)])), acp: rnd(ix.acp, 1), entropie: rnd(ix.entropie, 1),
      },
      prediction: predictionRecord(fc),
      reco: recommend(ix, f, fc, base),
      valeurs: Object.fromEntries(Object.entries(VALUE_KEYS).map(([k, col]) => [k, rnd(f[col] as number, 3)])),
      reference: {
        indice: refIdx ? { annee: refIndexYear, score: refIdx.score ?? 0, rang: refIdx.rang, classe: refIdx.classe } : null,
        prediction: refPred ? { valeur: refPred.valeur, p_alerte: refPred.p_alerte, rang: refPred.rang } : null,
        prevu: prevu ? { valeur: prevu.valeur, p_alerte: prevu.p_alerte } : null,
      },
      manquants,
    };
  });

  // Vérification à chaud : la prévision de référence pour cette année face à la déperdition observée.
  let verification: BacktestSummary | null = null;
  if (input.type === "nouvelle_annee") {
    const pairs = frames.map((f) => {
      const p = base.resultats[f.code]?.prediction[year];
      const obs = isNum(f.deperdition_prec_cap) ? f.deperdition_prec_cap : NaN;
      return p && isNum(obs) ? { pred: p.valeur, proba: p.p_alerte, obs } : null;
    }).filter((x): x is { pred: number; proba: number; obs: number } => x !== null);
    if (pairs.length >= 5) {
      const alertes = { vrai_positif: 0, faux_positif: 0, faux_negatif: 0, vrai_negatif: 0 };
      for (const p of pairs) {
        const predicted = p.proba >= 0.5, actual = p.obs >= model.alerte;
        if (predicted && actual) alertes.vrai_positif++;
        else if (predicted) alertes.faux_positif++;
        else if (actual) alertes.faux_negatif++;
        else alertes.vrai_negatif++;
      }
      verification = {
        annee: year, n: pairs.length,
        mae: rnd0(pairs.reduce((s, p) => s + Math.abs(p.pred - p.obs), 0) / pairs.length, 2),
        biais: rnd0(pairs.reduce((s, p) => s + (p.pred - p.obs), 0) / pairs.length, 2),
        spearman: rnd(spearman(pairs.map((p) => p.pred), pairs.map((p) => p.obs)) ?? NaN, 2), alertes,
      };
    }
  }

  const list = Object.entries(provinces).map(([code, r]) => ({ code, nom: base.unites[code].nom, region: base.unites[code].reg_nom, r }));
  const movers = (sign: 1 | -1): Mover[] => list
    .filter((x) => x.r.reference.indice)
    .map((x) => ({ code: x.code, nom: x.nom, de: x.r.reference.indice!.rang, vers: x.r.indice.rang }))
    .filter((m) => sign * (m.de - m.vers) > 0)
    .sort((a, b) => sign * (b.de - b.vers) - sign * (a.de - a.vers))
    .slice(0, 5);
  const refPreds = list.map((x) => x.r.reference.prediction ?? x.r.reference.prevu).filter((p): p is { valeur: number; p_alerte: number } => !!p);
  const wsum = frames.reduce((s, f) => s + (isNum(f.effectif) ? f.effectif : 0), 0);
  const wmean = (vals: number[]) => frames.reduce((s, f, i) => s + vals[i] * (isNum(f.effectif) ? f.effectif : 0), 0) / (wsum || 1);
  const byRegion = new Map<string, number>();
  for (const x of list) if (x.r.prediction.p_alerte >= 0.5) byRegion.set(x.region, (byRegion.get(x.region) ?? 0) + 1);
  const resume = {
    n_provinces: list.length,
    n_alerte: list.filter((x) => x.r.prediction.p_alerte >= 0.5).length,
    n_alerte_reference: refPreds.length ? refPreds.filter((p) => p.p_alerte >= 0.5).length : null,
    prediction_moyenne: rnd0(wmean(forecast.map((f) => f.prediction)), 1),
    prediction_moyenne_reference: refPreds.length ? rnd0(refPreds.reduce((s, p) => s + p.valeur, 0) / refPreds.length, 1) : null,
    top: [...list].sort((a, b) => b.r.prediction.valeur - a.r.prediction.valeur).slice(0, 10).map((x) => ({
      code: x.code, nom: x.nom, region: x.region, valeur: x.r.prediction.valeur, p_alerte: x.r.prediction.p_alerte,
      classe: x.r.indice.classe, facteurs: x.r.prediction.facteurs })),
    hausses: movers(1),
    baisses: movers(-1),
    regions_alerte: [...byRegion.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([region, n]) => ({ region, n })),
  };

  const warnings: Issue[] = [...(input.issues ?? []).filter((i) => i.niveau === "avertissement")];
  const imputed = list.filter((x) => x.r.manquants.length > 0);
  if (imputed.length) {
    warnings.push({ niveau: "avertissement", message: `${imputed.length} province(s) avec des variables manquantes remplacées par la médiane d'entraînement : ${imputed.slice(0, 6).map((x) => x.nom).join(", ")}${imputed.length > 6 ? "…" : ""}.` });
  }
  const canonical = JSON.stringify({ y: year, r: [...input.rows].sort((a, b) => (a.code < b.code ? -1 : 1)).map((r) => [r.code, r.values]) });

  return {
    version: base.version, genere_le: (opts.now?.() ?? new Date()).toISOString(), annee: year, cible: target, type: input.type,
    moteur: { version: model.version, modele: model.modele, alerte: model.alerte, tirages: draws, graine: seed },
    provinces,
    regions: Object.fromEntries(Object.entries(regions).map(([c, f]) => [c, { prediction: predictionRecord(f) }])),
    verification, resume, completees: input.completees, avertissements: warnings, empreinte: fingerprint(canonical),
  };
}

/** Indice composite, prévision et pistes d'action : portage fidèle de pipeline/risk_index.py,
 * pipeline/model.py (predict_frame) et pipeline/export.py (recommendations). */
import type { Frame } from "./features";
import { featureVector } from "./features";
import type { EngineBaseline, EngineModel, LinearParams } from "./types";

const NAN = Number.NaN;
const isNum = (v: number): boolean => !Number.isNaN(v);
const clip = (v: number, lo: number, hi: number): number => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : v);

/** Arrondi au pair le plus proche, comme numpy.round et pandas.round. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Quantile à interpolation linéaire (numpy.quantile par défaut). */
export function quantile(sortedAsc: number[], p: number): number {
  const pos = p * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sortedAsc.length - 1, lo + 1);
  return sortedAsc[lo] + (pos - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}

/** Rangs moyens (1 = plus petit), les ex aequo partageant la moyenne de leurs rangs ; NaN conservé. */
export function averageRanks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).filter(([v]) => isNum(v)).sort((a, b) => a[0] - b[0]);
  const out = values.map(() => NAN);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Rang décroissant « min » : 1 + nombre de valeurs strictement supérieures. */
export function rankDescMin(values: number[]): number[] {
  return values.map((v) => (isNum(v) ? 1 + values.filter((w) => isNum(w) && w > v).length : NAN));
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------- indice

export interface IndexRaw {
  code: string;
  indice: number;
  classe: number;
  rang: number;
  dims: Record<string, number>;
  dimension: string;
  facteurs: string;
  acp: number;
  entropie: number;
  rang_p05: number;
  rang_p95: number;
  proba_q5: number;
}

export const DEFAULT_DRAWS = 2000;
export const DEFAULT_SEED = 42;

export function computeIndex(frames: Frame[], base: EngineBaseline, draws = DEFAULT_DRAWS, seed = DEFAULT_SEED): IndexRaw[] {
  const dimNames = Object.keys(base.dimensions);
  const n = frames.length;
  const indicators: { col: string; sign: number; dim: string }[] = dimNames.flatMap((dim) =>
    base.dimensions[dim].map(([col, sign]) => ({ col, sign, dim })));

  // Rangs centiles dans l'année, orientés : 1 = situation la plus à risque.
  const ranks: Record<string, number[]> = {};
  for (const { col, sign } of indicators) {
    const vals = frames.map((f) => (f as unknown as Record<string, number>)[col]);
    const count = vals.filter(isNum).length;
    const avg = averageRanks(vals);
    ranks[col] = avg.map((r) => (isNum(r) ? clip(sign > 0 ? r / count : 1 - r / count + 1 / count, 0, 1) : NAN));
  }
  const dims: Record<string, number[]> = {};
  for (const dim of dimNames) {
    const cols = base.dimensions[dim].map(([c]) => c);
    dims[dim] = Array.from({ length: n }, (_, i) => {
      const v = cols.map((c) => ranks[c][i]).filter(isNum);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NAN;
    });
  }
  const equal = 1 / dimNames.length;
  const composite = (weights: number[]): number[] =>
    Array.from({ length: n }, (_, i) => {
      let num = 0, den = 0;
      dimNames.forEach((d, k) => {
        const v = dims[d][i];
        if (isNum(v)) { num += v * weights[k]; den += weights[k]; }
      });
      return den > 0 ? (100 * num) / den : NAN;
    });
  const score = composite(dimNames.map(() => equal));

  // Classes : quintiles du rang « first » de l'indice (pandas.qcut).
  const order = score.map((v, i) => [v, i] as const).filter(([v]) => isNum(v)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const first = score.map(() => NAN);
  order.forEach(([, i], k) => { first[i] = k + 1; });
  const sortedFirst = order.map((_, k) => k + 1);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => quantile(sortedFirst, p));
  const classOf = (r: number): number => {
    if (!isNum(r)) return 0;
    let c = edges.findIndex((e, k) => k > 0 && r <= e);
    c = c < 0 ? 5 : c;
    return Math.max(1, Math.min(5, c));
  };
  const rang = rankDescMin(score);

  // Variantes de pondération des indicateurs (poids ACP et entropie du pipeline).
  const rankCols = indicators.map((x) => x.col);
  const medians = rankCols.map((c) => {
    const v = ranks[c].filter(isNum).sort((a, b) => a - b);
    return v.length ? quantile(v, 0.5) : NAN;
  });
  const variant = (w: Record<string, number>, i: number): number =>
    100 * rankCols.reduce((s, c, k) => s + w[c] * (isNum(ranks[c][i]) ? ranks[c][i] : medians[k]), 0);

  // Sensibilité aux poids des dimensions : tirages de Dirichlet(1, ..., 1).
  const rnd = mulberry32(seed);
  const draw: Int16Array[] = Array.from({ length: n }, () => new Int16Array(draws));
  for (let t = 0; t < draws; t++) {
    const e = dimNames.map(() => -Math.log(1 - rnd()));
    const tot = e.reduce((s, x) => s + x, 0);
    const c = composite(e.map((x) => x / tot));
    const r = rankDescMin(c);
    for (let i = 0; i < n; i++) draw[i][t] = isNum(r[i]) ? r[i] : 0;
  }
  const topK = Math.ceil(n / 5);

  return frames.map((f, i) => {
    const contrib = indicators
      .map(({ col, dim }) => ({ col, v: (ranks[col][i] - 0.5) * (equal / base.dimensions[dim].length) }))
      .filter((c) => isNum(c.v))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .filter((c) => c.v > 0);
    const dimVals = dimNames.map((d) => dims[d][i]);
    let best = -1;
    dimVals.forEach((v, k) => { if (isNum(v) && (best < 0 || v > dimVals[best])) best = k; });
    const sorted = Array.from(draw[i]).sort((a, b) => a - b);
    return {
      code: f.code,
      indice: score[i],
      classe: classOf(first[i]),
      rang: rang[i],
      dims: Object.fromEntries(dimNames.map((d, k) => [d, isNum(dimVals[k]) ? 100 * dimVals[k] : NAN])),
      dimension: best >= 0 ? dimNames[best] : "",
      facteurs: contrib.map((c) => base.ind_labels[c.col]).join(" ; "),
      acp: variant(base.poids_indicateurs.acp, i),
      entropie: variant(base.poids_indicateurs.entropie, i),
      rang_p05: roundHalfEven(quantile(sorted, 0.05)),
      rang_p95: roundHalfEven(quantile(sorted, 0.95)),
      proba_q5: sorted.filter((r) => r > 0 && r <= topK).length / draws,
    };
  });
}

// ---------------------------------------------------------------------------- prévision

export interface ForecastRaw {
  code: string;
  prediction: number;
  ic80: [number, number];
  ic90: [number, number];
  p_alerte: number;
  rang: number;
  facteurs: string;
  persistance: number;
}

function standardize(x: number[], p: LinearParams): number[] {
  return x.map((v, k) => ((isNum(v) ? v : p.median[k]) - p.mean[k]) / p.scale[k]);
}
const dot = (a: number[], b: number[]): number => a.reduce((s, v, k) => s + v * b[k], 0);

export function computeForecast(frames: Frame[], model: EngineModel): ForecastRaw[] {
  const [lo, hi] = model.y_cap;
  const out = frames.map((f) => {
    const x = featureVector(f, model);
    const pred = clip(dot(standardize(x, model.regression), model.regression.coef) + model.regression.intercept, lo, hi);
    const proba = 1 / (1 + Math.exp(-(dot(standardize(x, model.logit), model.logit.coef) + model.logit.intercept)));
    const zExp = standardize(x, model.explicatif);
    const contrib = model.features
      .map((name, k) => ({ name, v: zExp[k] * model.explicatif.coef[k] }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .filter((c) => c.v > 0.25);
    const band = (q: number): [number, number] => [clip(pred - q * f.volatilite, lo, hi), clip(pred + q * f.volatilite, lo, hi)];
    return {
      code: f.code, prediction: pred, ic80: band(model.conformal["80"]), ic90: band(model.conformal["90"]),
      p_alerte: proba, rang: 0, facteurs: contrib.map((c) => model.feature_labels[c.name]).join(" ; "),
      persistance: isNum(f.deperdition_prec_cap) ? f.deperdition_prec_cap : f.deperdition_moy_passee,
    };
  });
  const ranks = rankDescMin(out.map((o) => o.prediction));
  out.forEach((o, i) => { o.rang = ranks[i]; });
  return out;
}

/** Régions : moyenne des provinces pondérée par les effectifs de l'année (pipeline/model.py : region_predictions). */
export function regionForecast(frames: Frame[], forecast: ForecastRaw[], base: EngineBaseline): Record<string, ForecastRaw> {
  const byReg = new Map<string, number[]>();
  frames.forEach((f, i) => {
    const reg = base.unites[f.code]?.reg;
    if (reg) (byReg.get(reg) ?? byReg.set(reg, []).get(reg)!).push(i);
  });
  const avg = (ids: number[], pick: (o: ForecastRaw) => number): number => {
    const ok = ids.filter((i) => isNum(pick(forecast[i])));
    const w = ok.map((i) => (isNum(frames[i].effectif) ? frames[i].effectif : 0));
    const sw = w.reduce((s, x) => s + x, 0);
    if (!ok.length) return NAN;
    return sw > 0 ? ok.reduce((s, i, k) => s + pick(forecast[i]) * w[k], 0) / sw : ok.reduce((s, i) => s + pick(forecast[i]), 0) / ok.length;
  };
  const out: Record<string, ForecastRaw> = {};
  for (const [reg, ids] of byReg) {
    out[reg] = {
      code: reg, prediction: avg(ids, (o) => o.prediction),
      ic80: [avg(ids, (o) => o.ic80[0]), avg(ids, (o) => o.ic80[1])], ic90: [avg(ids, (o) => o.ic90[0]), avg(ids, (o) => o.ic90[1])],
      p_alerte: avg(ids, (o) => o.p_alerte), rang: 0, facteurs: "", persistance: NAN,
    };
  }
  const codes = Object.keys(out);
  const ranks = rankDescMin(codes.map((c) => out[c].prediction));
  codes.forEach((c, i) => { out[c].rang = ranks[i]; });
  return out;
}

// ---------------------------------------------------------------------------- pistes d'action

export function recommend(index: IndexRaw, frame: Frame, fc: ForecastRaw, base: EngineBaseline) {
  const sorted = Object.entries(index.dims).filter(([, v]) => isNum(v)).sort((a, b) => b[1] - a[1]);
  const chosen = sorted.filter(([, v]) => v >= 60).slice(0, 2).map(([d]) => d);
  const types = chosen.map((d) => ({ type: d, titre: base.actions[d].titre, actions: base.actions[d].actions }));
  if (isNum(frame.ips_tbs) && frame.ips_tbs < 0.95) {
    types.push({ type: "filles", titre: base.action_filles.titre, actions: base.action_filles.actions });
  }
  const alerte = fc.p_alerte >= 0.5;
  const priorite = (alerte && index.classe >= 4 ? 1 : index.classe >= 4 || alerte ? 2 : 3) as 1 | 2 | 3;
  return { types, alerte, priorite };
}

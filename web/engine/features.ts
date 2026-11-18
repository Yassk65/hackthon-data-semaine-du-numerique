/** Variables dérivées de l'historique, identiques à celles du pipeline Python
 * (pipeline/features.py : compute_indicators ; pipeline/model.py : model_frame ; pipeline/risk_index.py : prepare). */
import type { BaselineRow, EngineModel, InputColumn, Num, UploadRow } from "./types";

const NAN = Number.NaN;
const num = (v: Num | undefined): number => (v === null || v === undefined ? NAN : v);
const clip = (v: number, lo: number, hi: number): number => (Number.isNaN(v) ? v : Math.min(hi, Math.max(lo, v)));

export interface Frame {
  code: string;
  annee: string;
  // entrées
  deperdition_prec: number;
  survie_cm2_prec: number;
  redoublement_global_prec: number;
  effectif: number;
  eleves: number;
  ecoles: number;
  maitres: number;
  salles: number;
  tap: number;
  tbs: number;
  ips_tbs: number;
  part_rurale: number;
  part_prive: number;
  pauvrete: number;
  // dérivées
  ratio_eleves_maitre: number;
  ratio_eleves_salle: number;
  var_effectif_1an: number;
  baisse_effectif_pic: number;
  var_ecoles_1an: number;
  baisse_ecoles_pic: number;
  deperdition_prec_cap: number;
  survie_cm2_prec_cap: number;
  ecart_parite: number;
  deperdition_moy_passee: number;
  volatilite: number;
}

const ratio = (a: number, b: number, scale = 1): number => (b > 0 ? (scale * a) / b : NAN);

function fromBaseline(r: BaselineRow): Record<InputColumn, number> & { code: string; annee: string } {
  return {
    code: r.code, annee: r.annee_scolaire,
    deperdition_prec: num(r.deperdition_prec), survie_cm2_prec: num(r.survie_cm2_prec),
    redoublement_global_prec: num(r.redoublement_global_prec), effectif: num(r.effectif), eleves: num(r.eleves),
    ecoles: num(r.ecoles), maitres: num(r.maitres), salles: num(r.salles), tap: num(r.tap), tbs: num(r.tbs),
    ips_tbs: num(r.ips_tbs), part_rurale: num(r.part_rurale), part_prive: num(r.part_prive), pauvrete: num(r.pauvrete),
  };
}

function fromUpload(r: UploadRow): Record<InputColumn, number> & { code: string; annee: string } {
  const v = r.values;
  return {
    code: r.code, annee: r.annee_scolaire,
    deperdition_prec: num(v.deperdition_prec), survie_cm2_prec: num(v.survie_cm2_prec),
    redoublement_global_prec: num(v.redoublement_global_prec), effectif: num(v.effectif), eleves: num(v.eleves),
    ecoles: num(v.ecoles), maitres: num(v.maitres), salles: num(v.salles), tap: num(v.tap), tbs: num(v.tbs),
    ips_tbs: num(v.ips_tbs), part_rurale: num(v.part_rurale), part_prive: num(v.part_prive), pauvrete: num(v.pauvrete),
  };
}

/** Écart-type d'échantillon (ddof = 1) des valeurs non manquantes ; NaN si moins de deux valeurs. */
export function sampleStd(values: number[]): number {
  const v = values.filter((x) => !Number.isNaN(x));
  if (v.length < 2) return NAN;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/**
 * Reconstruit le tableau province × année : l'historique de référence, dont les lignes de l'année
 * mise à jour sont remplacées par le fichier déposé, puis calcule les variables dérivées de chaque ligne.
 */
export function buildFrames(baseline: BaselineRow[], upload: UploadRow[], year: string): Frame[] {
  const byCode = new Map<string, ReturnType<typeof fromBaseline>[]>();
  for (const r of baseline) {
    if (r.annee_scolaire === year) continue;
    (byCode.get(r.code) ?? byCode.set(r.code, []).get(r.code)!).push(fromBaseline(r));
  }
  for (const r of upload) (byCode.get(r.code) ?? byCode.set(r.code, []).get(r.code)!).push(fromUpload(r));

  const frames: Frame[] = [];
  for (const [, series] of [...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    series.sort((a, b) => (a.annee < b.annee ? -1 : 1));
    let prevEff = NAN, prevEco = NAN, maxEff = NAN, maxEco = NAN;
    for (const r of series) {
      if (!Number.isNaN(r.effectif)) maxEff = Number.isNaN(maxEff) ? r.effectif : Math.max(maxEff, r.effectif);
      if (!Number.isNaN(r.ecoles)) maxEco = Number.isNaN(maxEco) ? r.ecoles : Math.max(maxEco, r.ecoles);
      const cap = clip(r.deperdition_prec, 0, 60);
      frames.push({
        ...r,
        ratio_eleves_maitre: ratio(r.eleves, r.maitres),
        ratio_eleves_salle: ratio(r.eleves, r.salles),
        // Division IEEE comme pandas : un effectif nul l'année précédente donne +Inf (bornée ensuite par le modèle).
        var_effectif_1an: 100 * (r.effectif / prevEff - 1),
        baisse_effectif_pic: Number.isNaN(r.effectif) || !(maxEff > 0) ? NAN : 100 * (r.effectif / maxEff - 1),
        var_ecoles_1an: 100 * (r.ecoles / prevEco - 1),
        baisse_ecoles_pic: Number.isNaN(r.ecoles) || !(maxEco > 0) ? NAN : 100 * (r.ecoles / maxEco - 1),
        deperdition_prec_cap: cap,
        survie_cm2_prec_cap: clip(r.survie_cm2_prec, 0, 100),
        ecart_parite: Number.isNaN(r.ips_tbs) ? NAN : Math.abs(1 - r.ips_tbs),
        deperdition_moy_passee: NAN,
        volatilite: NAN,
      });
      prevEff = r.effectif;
      prevEco = r.ecoles;
    }
  }
  // Moyenne cumulée et volatilité de la déperdition passée (model_frame).
  const globalStd = sampleStd(frames.map((f) => f.deperdition_prec_cap));
  const bounds: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= frames.length; i++) {
    if (i === frames.length || frames[i].code !== frames[start].code) {
      bounds.push([start, i]);
      start = i;
    }
  }
  for (const [a, b] of bounds) {
    let sum = 0, n = 0;
    for (let i = a; i < b; i++) {
      const v = frames[i].deperdition_prec_cap;
      if (!Number.isNaN(v)) { sum += v; n++; }
      frames[i].deperdition_moy_passee = n > 0 ? sum / n : NAN;
      const win = frames.slice(Math.max(a, i - 2), i + 1).map((f) => f.deperdition_prec_cap);
      const sd = win.filter((x) => !Number.isNaN(x)).length >= 2 ? sampleStd(win) : NAN;
      frames[i].volatilite = 1 + (Number.isNaN(sd) ? globalStd : sd);
    }
  }
  return frames;
}

/** Vecteur des 14 variables du modèle, avec les bornes de model_frame. */
export function featureVector(f: Frame, model: EngineModel): number[] {
  const raw: Record<string, number> = {
    deperdition_prec_cap: f.deperdition_prec_cap,
    deperdition_moy_passee: f.deperdition_moy_passee,
    survie_cm2_prec_cap: f.survie_cm2_prec_cap,
    redoublement_global_prec: f.redoublement_global_prec,
    var_effectif_1an: f.var_effectif_1an,
    baisse_effectif_pic: f.baisse_effectif_pic,
    baisse_ecoles_pic: f.baisse_ecoles_pic,
    tap: f.tap,
    tbs: f.tbs,
    ips_tbs: f.ips_tbs,
    ratio_eleves_maitre: f.ratio_eleves_maitre,
    part_rurale: f.part_rurale,
    part_prive: f.part_prive,
    pauvrete: f.pauvrete,
  };
  return model.features.map((name) => {
    const c = model.clips[name];
    return c ? clip(raw[name], c[0], c[1]) : raw[name];
  });
}

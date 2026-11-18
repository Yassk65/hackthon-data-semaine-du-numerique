import { describe, expect, it } from "vitest";
import baseline from "./data/engine_baseline.json";
import model from "./data/engine_model.json";
import reference from "./fixtures/engine_reference.json";
import { toCsv } from "./csv";
import { buildFrames, featureVector } from "./features";
import { computeRaw, runEngine } from "./run";
import type { BaselineRow, EngineBaseline, EngineModel, UploadRow } from "./types";
import { INPUT_COLUMNS } from "./types";
import { nextYear, validateUpload } from "./validate";

const base = baseline as unknown as EngineBaseline;
const mdl = model as unknown as EngineModel;
const ref = reference as unknown as {
  annee: string;
  derives: Record<string, Record<string, number | null>>;
  variables: Record<string, Record<string, number | null>>;
  indice: Record<string, Record<string, number | string | null>>;
  prediction: Record<string, Record<string, number | string | null>>;
};
const LAST = base.derniere_annee;
const codes = Object.keys(base.unites);
const ctx = { codes, lastYear: LAST };

const toUpload = (r: BaselineRow, year = r.annee_scolaire): UploadRow => ({
  code: r.code, annee_scolaire: year,
  values: Object.fromEntries(INPUT_COLUMNS.map((c) => [c, r[c]])),
});
const lastRows = base.rows.filter((r) => r.annee_scolaire === LAST);

function csvOf(rows: UploadRow[], extra: Partial<Record<string, number>> = {}, sep = ";"): string {
  const header = ["code", "annee_scolaire", ...INPUT_COLUMNS];
  return toCsv(header, rows.map((r) => [r.code, r.annee_scolaire, ...INPUT_COLUMNS.map((c) => (extra[`${r.code}:${c}`] ?? r.values[c] ?? null))]), sep);
}

/** Égalité numérique ; les valeurs non finies (NaN, ±Inf) du moteur correspondent à `null` côté Python. */
function close(a: number | null | undefined, b: number | null | undefined, tol = 1e-9): boolean {
  const fa = a !== null && a !== undefined && Number.isFinite(a);
  const fb = b !== null && b !== undefined && Number.isFinite(b);
  if (!fa || !fb) return fa === fb;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

function csvComma(rows: UploadRow[]): string {
  const header = ["code", "annee_scolaire", ...INPUT_COLUMNS];
  return [header.join(","), ...rows.map((r) => [r.code, r.annee_scolaire, ...INPUT_COLUMNS.map((c) => r.values[c] ?? "")].join(","))].join("\n");
}

describe("conformité avec le pipeline Python", () => {
  const frames = buildFrames(base.rows, lastRows.map((r) => toUpload(r)), LAST);

  it("reconstruit toutes les variables dérivées de l'historique", () => {
    expect(frames.length).toBe(base.rows.length);
    const bad: string[] = [];
    for (const f of frames) {
      const d = ref.derives[`${f.code}|${f.annee}`];
      for (const [k, v] of Object.entries(d)) {
        // Le fichier de référence est celui de model_frame : certaines colonnes y sont déjà bornées.
        const c = mdl.clips[k];
        const x = (f as unknown as Record<string, number>)[k];
        const mine = c && Number.isFinite(x) ? Math.min(c[1], Math.max(c[0], x)) : c && x === Infinity ? c[1] : x;
        if (!close(mine, v, 1e-9)) bad.push(`${f.code} ${f.annee} ${k}: ${mine} vs ${v}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("produit le même vecteur de variables que le modèle", () => {
    const bad: string[] = [];
    for (const f of frames) {
      const v = ref.variables[`${f.code}|${f.annee}`];
      featureVector(f, mdl).forEach((x, k) => {
        if (!close(x, v[mdl.features[k]], 1e-9)) bad.push(`${f.code} ${f.annee} ${mdl.features[k]}: ${x} vs ${v[mdl.features[k]]}`);
      });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  const raw = computeRaw(lastRows.map((r) => toUpload(r)), LAST, base, mdl);

  it("retrouve l'indice composite, les classes, les rangs et les dimensions", () => {
    expect(raw.index.length).toBe(47);
    const bad: string[] = [];
    for (const ix of raw.index) {
      const p = ref.indice[ix.code];
      if (!close(ix.indice, p.indice as number)) bad.push(`${ix.code} indice ${ix.indice} vs ${p.indice}`);
      if (ix.classe !== p.classe) bad.push(`${ix.code} classe ${ix.classe} vs ${p.classe}`);
      if (ix.rang !== p.rang) bad.push(`${ix.code} rang ${ix.rang} vs ${p.rang}`);
      if (ix.dimension !== p.dimension) bad.push(`${ix.code} dimension ${ix.dimension} vs ${p.dimension}`);
      for (const [d, v] of Object.entries(ix.dims)) if (!close(v, p[`dim_${d}`] as number)) bad.push(`${ix.code} dim ${d}`);
      if (!close(ix.acp, p.indice_acp as number)) bad.push(`${ix.code} acp ${ix.acp} vs ${p.indice_acp}`);
      if (!close(ix.entropie, p.indice_entropie as number)) bad.push(`${ix.code} entropie ${ix.entropie} vs ${p.indice_entropie}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("retrouve les facteurs dominants (à l'ordre près en cas d'égalité : numpy ne les départage pas de façon stable)", () => {
    const set = (s: string) => new Set(s.split(" ; ").filter(Boolean));
    let identical = 0;
    for (const ix of raw.index) {
      const a = set(ix.facteurs), b = set(ref.indice[ix.code].facteurs as string);
      const common = [...a].filter((x) => b.has(x)).length;
      expect(common).toBeGreaterThanOrEqual(Math.min(a.size, b.size, 2));
      if (common === a.size && a.size === b.size) identical++;
    }
    expect(identical).toBeGreaterThanOrEqual(40);
  });

  it("retrouve l'intervalle de rang de la sensibilité avec un écart faible (autre générateur aléatoire)", () => {
    const d05 = raw.index.map((ix) => Math.abs(ix.rang_p05 - (ref.indice[ix.code].rang_p05 as number)));
    const d95 = raw.index.map((ix) => Math.abs(ix.rang_p95 - (ref.indice[ix.code].rang_p95 as number)));
    const dp = raw.index.map((ix) => Math.abs(ix.proba_q5 - (ref.indice[ix.code].proba_quintile_superieur as number)));
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean(d05)).toBeLessThan(1);
    expect(mean(d95)).toBeLessThan(1);
    expect(mean(dp)).toBeLessThan(0.03);
    expect(Math.max(...d05, ...d95)).toBeLessThanOrEqual(3);
  });

  it("retrouve les prévisions, intervalles, probabilités d'alerte et facteurs", () => {
    const bad: string[] = [];
    for (const f of raw.forecast) {
      const p = ref.prediction[f.code];
      if (!close(f.prediction, p.prediction as number)) bad.push(`${f.code} prédiction ${f.prediction} vs ${p.prediction}`);
      if (!close(f.ic80[0], p.ic80_bas as number) || !close(f.ic80[1], p.ic80_haut as number)) bad.push(`${f.code} ic80`);
      if (!close(f.ic90[0], p.ic90_bas as number) || !close(f.ic90[1], p.ic90_haut as number)) bad.push(`${f.code} ic90`);
      if (!close(f.p_alerte, p.p_alerte as number)) bad.push(`${f.code} p_alerte ${f.p_alerte} vs ${p.p_alerte}`);
      if (f.rang !== p.rang_prediction) bad.push(`${f.code} rang ${f.rang} vs ${p.rang_prediction}`);
      if (f.facteurs !== p.facteurs) bad.push(`${f.code} facteurs « ${f.facteurs} » vs « ${p.facteurs} »`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe("validation du fichier déposé", () => {
  const rows = lastRows.map((r) => toUpload(r));

  it("accepte la situation de référence (point-virgule, virgule décimale)", () => {
    const v = validateUpload(csvOf(rows), ctx);
    expect(v.issues.filter((i) => i.niveau === "erreur")).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.type).toBe("correction");
    expect(v.rows).toHaveLength(47);
  });

  it("accepte une année suivante et un séparateur virgule avec points décimaux", () => {
    const next = rows.map((r) => ({ ...r, annee_scolaire: nextYear(LAST) }));
    const v = validateUpload(csvComma(next), ctx);
    expect(v.ok).toBe(true);
    expect(v.type).toBe("nouvelle_annee");
    expect(v.separateur).toBe(",");
  });

  it("refuse une province manquante, un code inconnu et un doublon", () => {
    const missing = validateUpload(csvOf(rows.slice(1)), ctx);
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((i) => /manquante/.test(i.message))).toBe(true);
    const unknown = validateUpload(csvOf(rows).replace(rows[0].code, "BF9999"), ctx);
    expect(unknown.issues.some((i) => /inconnu/.test(i.message))).toBe(true);
    const dup = validateUpload(csvOf([...rows, rows[0]]), ctx);
    expect(dup.issues.some((i) => /double/.test(i.message))).toBe(true);
  });

  it("refuse une année non prise en charge et un mélange d'années", () => {
    const old = validateUpload(csvOf(rows.map((r) => ({ ...r, annee_scolaire: "2019-2020" }))), ctx);
    expect(old.ok).toBe(false);
    const mixed = validateUpload(csvOf(rows.map((r, i) => (i === 0 ? { ...r, annee_scolaire: nextYear(LAST) } : r))), ctx);
    expect(mixed.issues.some((i) => /plusieurs années/.test(i.message))).toBe(true);
  });

  it("refuse les valeurs illisibles ou hors bornes, avertit des cellules vides", () => {
    const code = rows[3].code;
    const bad = validateUpload(csvOf(rows, { [`${code}:tap`]: 999 }), ctx);
    expect(bad.issues.some((i) => i.code === code && /bornes/.test(i.message))).toBe(true);
    const garbage = validateUpload(csvOf(rows).replace(/^(BF\d+;[^;]+;)([^;]*)/m, "$1abc"), ctx);
    expect(garbage.issues.some((i) => /illisible/.test(i.message))).toBe(true);
    const blank = validateUpload(csvOf(rows, { [`${code}:tap`]: undefined }).replace(/;;/g, ";;"), ctx);
    expect(blank.ok).toBe(true);
  });

  it("signale une colonne obligatoire absente et une colonne inconnue", () => {
    const text = csvOf(rows).replace("tap;", "tap_x;");
    const v = validateUpload(text, ctx);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => /obligatoire absente : tap/.test(i.message))).toBe(true);
    expect(v.issues.some((i) => /ignorée.*tap_x/.test(i.message))).toBe(true);
  });

  it("refuse un fichier trop volumineux ou vide", () => {
    expect(validateUpload("x".repeat(250_000), ctx).ok).toBe(false);
    expect(validateUpload("", ctx).ok).toBe(false);
  });
});

describe("recalcul complet", () => {
  const now = () => new Date("2026-11-18T12:00:00Z");
  const rows = lastRows.map((r) => toUpload(r));

  it("rejoue la situation de référence : mêmes rangs et alertes que la version publiée", () => {
    const v = validateUpload(csvOf(rows), ctx);
    const res = runEngine(v, base, mdl, { now });
    expect(res.type).toBe("correction");
    expect(res.cible).toBe(nextYear(LAST));
    for (const [code, r] of Object.entries(res.provinces)) {
      const pub = base.resultats[code];
      expect(r.indice.rang).toBe(pub.indice[LAST].rang);
      expect(r.indice.classe).toBe(pub.indice[LAST].classe);
      expect(r.indice.score).toBeCloseTo(pub.indice[LAST].score as number, 1);
      expect(r.prediction.valeur).toBeCloseTo(pub.prediction[nextYear(LAST)].valeur, 1);
      expect(r.prediction.p_alerte).toBeCloseTo(pub.prediction[nextYear(LAST)].p_alerte, 2);
    }
    expect(res.resume.n_alerte).toBe(res.resume.n_alerte_reference);
    expect(res.verification).toBeNull();
    expect(Object.keys(res.regions)).toHaveLength(17);
  });

  it("calcule une nouvelle année et la compare à la prévision précédente", () => {
    const next = rows.map((r) => ({ ...r, annee_scolaire: nextYear(LAST) }));
    const code = next[5].code;
    next[5].values = { ...next[5].values, deperdition_prec: 42 };
    const v = validateUpload(csvOf(next), ctx);
    expect(v.ok).toBe(true);
    const res = runEngine(v, base, mdl, { now });
    expect(res.type).toBe("nouvelle_annee");
    expect(res.annee).toBe(nextYear(LAST));
    expect(res.cible).toBe(nextYear(nextYear(LAST)));
    expect(Object.keys(res.provinces)).toHaveLength(47);
    expect(res.verification?.n).toBeGreaterThan(40);
    expect(res.provinces[code].indice.rang).toBeLessThan(base.resultats[code].indice[LAST].rang);
    const classes = Object.values(res.provinces).map((p) => p.indice.classe);
    for (let k = 1; k <= 5; k++) expect(classes.filter((c) => c === k).length).toBeGreaterThanOrEqual(8);
    for (const p of Object.values(res.provinces)) {
      expect(p.prediction.valeur).toBeGreaterThanOrEqual(0);
      expect(p.prediction.valeur).toBeLessThanOrEqual(60);
      expect(p.prediction.p_alerte).toBeGreaterThanOrEqual(0);
      expect(p.prediction.p_alerte).toBeLessThanOrEqual(1);
      expect(p.prediction.ic80[0]).toBeLessThanOrEqual(p.prediction.valeur);
      expect(p.prediction.ic80[1]).toBeGreaterThanOrEqual(p.prediction.valeur);
    }
  });

  it("est déterministe", () => {
    const v = validateUpload(csvOf(rows), ctx);
    expect(JSON.stringify(runEngine(v, base, mdl, { now }))).toBe(JSON.stringify(runEngine(v, base, mdl, { now })));
  });

  it("prévient quand une variable manque et la remplace par la médiane d'entraînement", () => {
    const code = rows[7].code;
    const v = validateUpload(csvOf(rows, { [`${code}:tap`]: undefined }).replace(new RegExp(`^(${code};[^\\r\\n]*)`, "m"), (l) => l), ctx);
    const patched = { ...v, rows: v.rows.map((r) => (r.code === code ? { ...r, values: { ...r.values, tap: null } } : r)) };
    const res = runEngine(patched, base, mdl, { now });
    expect(res.provinces[code].manquants).toContain("tap");
    expect(res.avertissements.some((a) => /manquantes/.test(a.message))).toBe(true);
    expect(Number.isFinite(res.provinces[code].prediction.valeur)).toBe(true);
  });
});

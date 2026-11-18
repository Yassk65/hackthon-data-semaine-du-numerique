import { parseCsv, parseNumber } from "./csv";
import type { InputColumn, Issue, Num, UploadRow, ValidationContext, ValidationResult } from "./types";
import { INPUT_COLUMNS } from "./types";

export const MAX_BYTES = 200_000;
export const MAX_ROWS = 200;

/** Bornes plausibles : au-delà, la ligne est refusée (faute de frappe ou de colonne). */
export const RANGES: Record<InputColumn, [number, number]> = {
  deperdition_prec: [-100, 100],
  survie_cm2_prec: [0, 1000], // le pipeline plafonne à 100 : des valeurs > 100 existent dans la source (petits effectifs)
  redoublement_global_prec: [0, 100],
  effectif: [0, 5_000_000],
  eleves: [0, 5_000_000],
  ecoles: [0, 100_000],
  maitres: [0, 200_000],
  salles: [0, 200_000],
  tap: [0, 200],
  tbs: [0, 250],
  ips_tbs: [0, 5],
  part_rurale: [0, 100],
  part_prive: [0, 100],
  pauvrete: [0, 100],
};

/** Colonnes qui doivent figurer dans le fichier. */
export const REQUIRED: InputColumn[] = [
  "deperdition_prec", "survie_cm2_prec", "redoublement_global_prec", "effectif", "ecoles", "maitres", "salles",
  "tap", "tbs", "ips_tbs",
];
/** Colonnes structurelles ou redondantes : complétées si absentes. */
export const OPTIONAL: InputColumn[] = ["eleves", "part_rurale", "part_prive", "pauvrete"];

export function nextYear(y: string): string {
  const a = Number(y.slice(0, 4)) + 1;
  return `${a}-${a + 1}`;
}

export function isSchoolYear(y: string): boolean {
  const m = /^(\d{4})-(\d{4})$/.exec(y);
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}

export function validateUpload(text: string, ctx: ValidationContext): ValidationResult {
  const issues: Issue[] = [];
  const fail = (message: string, extra: Partial<Issue> = {}) => issues.push({ niveau: "erreur", message, ...extra });
  const warn = (message: string, extra: Partial<Issue> = {}) => issues.push({ niveau: "avertissement", message, ...extra });
  const result = (rows: UploadRow[] = [], colonnes: string[] = [], separateur = ";", annee: string | null = null,
                  type: ValidationResult["type"] = null, completees: string[] = []): ValidationResult =>
    ({ ok: !issues.some((i) => i.niveau === "erreur"), issues, annee, type, rows, colonnes, separateur, completees });

  if (text.length > MAX_BYTES) {
    fail(`Fichier trop volumineux (${Math.round(text.length / 1000)} Ko ; maximum ${MAX_BYTES / 1000} Ko).`);
    return result();
  }
  const csv = parseCsv(text);
  if (csv.header.length === 0) {
    fail("Le fichier est vide.");
    return result();
  }
  if (csv.rows.length > MAX_ROWS) {
    fail(`Trop de lignes (${csv.rows.length} ; maximum ${MAX_ROWS}).`);
    return result([], csv.header, csv.separateur);
  }

  const col = (name: string) => csv.header.indexOf(name);
  for (const need of ["code", "annee_scolaire"]) {
    if (col(need) < 0) fail(`Colonne obligatoire absente : ${need}.`, { colonne: need });
  }
  const known = new Set<string>(["code", "annee_scolaire", ...INPUT_COLUMNS]);
  for (const h of csv.header) {
    if (!known.has(h)) warn(`Colonne ignorée (non utilisée par le calcul) : ${h}.`, { colonne: h });
  }
  const completees: string[] = [];
  for (const c of REQUIRED) if (col(c) < 0) fail(`Colonne obligatoire absente : ${c}.`, { colonne: c });
  for (const c of OPTIONAL) {
    if (col(c) >= 0) continue;
    const available = ctx.fallback && ctx.codes.every((k) => ctx.fallback?.[k]?.[c] != null || c === "eleves");
    if (c === "eleves" || available) completees.push(c);
    else fail(`Colonne absente et sans valeur de repli : ${c}.`, { colonne: c });
  }
  if (issues.some((i) => i.niveau === "erreur")) return result([], csv.header, csv.separateur);

  const codeSet = new Set(ctx.codes);
  const seen = new Set<string>();
  const years = new Set<string>();
  const rows: UploadRow[] = [];
  const blanks: Record<string, number> = {};

  csv.rows.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length > csv.header.length) warn("Ligne plus longue que l'en-tête : cellules en trop ignorées.", { ligne: line });
    const code = (cells[col("code")] ?? "").toUpperCase();
    const year = cells[col("annee_scolaire")] ?? "";
    if (!codeSet.has(code)) {
      fail(`Code de province inconnu : « ${code.slice(0, 12)} ».`, { ligne: line, colonne: "code" });
      return;
    }
    if (seen.has(code)) {
      fail(`Province en double : ${code}.`, { ligne: line, code });
      return;
    }
    seen.add(code);
    if (!isSchoolYear(year)) {
      fail(`Année scolaire invalide : « ${year.slice(0, 12)} » (format attendu 2025-2026).`, { ligne: line, colonne: "annee_scolaire", code });
      return;
    }
    years.add(year);
    const values: UploadRow["values"] = {};
    for (const c of INPUT_COLUMNS) {
      const j = col(c);
      const raw = j >= 0 ? (cells[j] ?? "") : "";
      let v: Num = null;
      if (j >= 0) {
        v = parseNumber(raw);
        if (Number.isNaN(v as number)) {
          fail(`Valeur illisible dans ${c} : « ${raw.slice(0, 16)} ».`, { ligne: line, colonne: c, code });
          v = null;
        } else if (v !== null && (v < RANGES[c][0] || v > RANGES[c][1])) {
          fail(`${c} = ${v} hors des bornes plausibles [${RANGES[c][0]} ; ${RANGES[c][1]}].`, { ligne: line, colonne: c, code });
          v = null;
        }
      }
      if (v === null && j >= 0 && raw.trim() === "" && !(OPTIONAL as string[]).includes(c)) blanks[c] = (blanks[c] ?? 0) + 1;
      if (v === null && (OPTIONAL as string[]).includes(c)) {
        v = c === "eleves" ? (values.effectif ?? null) : (ctx.fallback?.[code]?.[c] ?? null);
        if (j >= 0 && raw.trim() === "" && !completees.includes(c)) completees.push(c);
      }
      values[c] = v;
    }
    rows.push({ code, annee_scolaire: year, values });
  });

  if (years.size > 1) fail(`Le fichier contient plusieurs années scolaires (${[...years].join(", ")}) : une seule par fichier.`);
  const annee = years.size === 1 ? [...years][0] : null;
  let type: ValidationResult["type"] = null;
  if (annee) {
    if (annee === ctx.lastYear) type = "correction";
    else if (annee === nextYear(ctx.lastYear)) type = "nouvelle_annee";
    else fail(`Année ${annee} non prise en charge : seules ${ctx.lastYear} (correction) et ${nextYear(ctx.lastYear)} (nouvelle année) sont acceptées.`);
  }
  const missing = ctx.codes.filter((c) => !seen.has(c));
  if (missing.length > 0 && csv.rows.length > 0) {
    fail(`${missing.length} province(s) manquante(s) : ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}. Les 47 provinces sont nécessaires pour classer.`);
  }
  for (const [c, n] of Object.entries(blanks)) {
    if (n === 0) continue;
    const share = n / Math.max(1, csv.rows.length);
    if (share > 0.25) fail(`Colonne presque vide : ${c} (${n} cellules vides sur ${csv.rows.length}).`, { colonne: c });
    else warn(`${n} cellule(s) vide(s) dans ${c} : traitées comme valeur manquante.`, { colonne: c });
  }
  if (csv.rows.length === 0) fail("Le fichier ne contient aucune ligne de données.");
  for (const c of completees) warn(`Colonne ${c} complétée automatiquement (${c === "eleves" ? "égale aux effectifs" : "dernière valeur connue"}).`, { colonne: c });
  return result(rows, csv.header, csv.separateur, annee, type, completees);
}

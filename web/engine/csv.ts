/** Lecture tolérante d'un CSV de mise à jour : séparateur « ; », « , » ou tabulation, décimale « , » ou « . ». */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  separateur: string;
}

export function detectSeparator(headerLine: string): string {
  const counts: [string, number][] = [";", "\t", ","].map((s) => [s, headerLine.split(s).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

/** Découpe une ligne en respectant les guillemets doubles. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [], separateur: ";" };
  const separateur = detectSeparator(lines[0]);
  const header = splitLine(lines[0], separateur).map((h) => h.toLowerCase());
  return { header, rows: lines.slice(1).map((l) => splitLine(l, separateur)), separateur };
}

/** Nombre à partir d'un texte : « 3 067 940 », « 78,2 », « 12.5 % ». null si vide, NaN si illisible. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/%$/, "");
  if (s === "" || s === "-" || /^(nd|n\/d|na|null|nan)$/i.test(s)) return null;
  const normalized = /,/.test(s) && !/\./.test(s) ? s.replace(",", ".") : s;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export function toCsv(header: string[], rows: (string | number | null)[][], sep = ";"): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(sep), ...rows.map((r) => r.map(cell).join(sep))].join("\r\n") + "\r\n";
}

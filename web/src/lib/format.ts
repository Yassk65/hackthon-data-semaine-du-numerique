const nfCache = new Map<number, Intl.NumberFormat>();

function nf(decimals: number): Intl.NumberFormat {
  if (!nfCache.has(decimals)) {
    nfCache.set(decimals, new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  }
  return nfCache.get(decimals)!;
}

/** Nombre au format français ; « — » si la valeur manque. */
export function fmt(v: number | null | undefined, decimals = 0, unit = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = nf(decimals).format(v);
  if (!unit) return s;
  return unit.startsWith("%") || unit.startsWith("/") ? `${s}\u202f${unit}` : `${s} ${unit}`;
}

/** Écart signé : « +3,2 pts », « −1,0 % ». */
export function fmtDelta(v: number | null | undefined, decimals = 1, unit = "pt"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "\u2212" : "";
  return `${sign}${nf(decimals).format(Math.abs(v))}\u202f${unit}`;
}

/** « 2024-2025 » -> « 2024-25 ». */
export function shortYear(y: string): string {
  return `${y.slice(0, 4)}-${y.slice(7, 9)}`;
}

export function previousYear(y: string): string {
  const a = Number(y.slice(0, 4)) - 1;
  return `${a}-${a + 1}`;
}

export function nextYear(y: string): string {
  const a = Number(y.slice(0, 4)) + 1;
  return `${a}-${a + 1}`;
}

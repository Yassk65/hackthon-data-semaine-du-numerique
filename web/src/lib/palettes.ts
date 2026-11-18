// Palettes à 5 classes, ordonnées par luminance : lisibles par les personnes daltoniennes
// (séquentielles mono-teinte ; divergente brun/sarcelle de type ColorBrewer BrBG).

export const PALETTES: Record<string, string[]> = {
  seq_risk: ["#F4E6CF", "#EBBF8E", "#DC8B58", "#BC5532", "#7D2B1C"],
  seq_good: ["#E9EFF1", "#B9CFD8", "#7FA7BA", "#457D98", "#1C4C68"],
  seq_neutral: ["#EFEAE1", "#D6CEC0", "#B3A897", "#857B6B", "#4F483D"],
  div_change: ["#A6611A", "#DFC27D", "#F2EDE4", "#80CDC1", "#018571"],
  div_parity: ["#A6611A", "#DFC27D", "#F2EDE4", "#80CDC1", "#018571"],
};

// Carte bivariée 3 × 3 (J. Stevens) : ligne = variable A (risque), colonne = variable B (fermetures).
export const BIVARIATE = [
  ["#E8E8E8", "#B0D5DF", "#64ACBE"],
  ["#E4ACAC", "#AD9EA5", "#627F8C"],
  ["#C85A5A", "#985356", "#574249"],
];

/** Indice de classe (0..n) d'une valeur pour des seuils croissants. */
export function classify(v: number | null | undefined, breaks: number[]): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  let k = 0;
  while (k < breaks.length && v >= breaks[k]) k++;
  return k;
}

/** Seuils des terciles d'une série (valeurs manquantes ignorées). */
export function terciles(values: (number | null)[]): [number, number] | null {
  const v = values.filter((x): x is number => x !== null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [q(1 / 3), q(2 / 3)];
}

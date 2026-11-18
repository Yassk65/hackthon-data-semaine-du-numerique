import type { Scale } from "../data/types";

export type View = "comprendre" | "explorer" | "anticiper" | "methode" | "maj";

export interface AppState {
  view: View;
  layer: string;
  year: string;
  scale: Scale;
  sel: string | null;
  cmp: string | null;
  ref: string | null; // année de référence pour la comparaison avant/après
  osm: boolean;
}

export const DEFAULT_STATE: AppState = {
  view: "comprendre",
  layer: "prediction",
  year: "",
  scale: "prov",
  sel: null,
  cmp: null,
  ref: null,
  osm: false,
};

const VIEWS: View[] = ["comprendre", "explorer", "anticiper", "methode", "maj"];

/** Lit l'état depuis le fragment d'URL : #/explorer?couche=tap&annee=2024-2025&echelle=prov&sel=BF6402 */
export function parseHash(hash: string): AppState {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const p = new URLSearchParams(query);
  const view = (VIEWS as string[]).includes(path) ? (path as View) : DEFAULT_STATE.view;
  const code = (v: string | null) => (v && /^BF\d{2,4}$/.test(v) ? v : null);
  const year = p.get("annee");
  const ref = p.get("ref");
  return {
    view,
    layer: p.get("couche") ?? DEFAULT_STATE.layer,
    year: year && /^\d{4}-\d{4}$/.test(year) ? year : "",
    scale: p.get("echelle") === "reg" ? "reg" : "prov",
    sel: code(p.get("sel")),
    cmp: code(p.get("cmp")),
    ref: ref && /^\d{4}-\d{4}$/.test(ref) ? ref : null,
    osm: p.get("osm") === "1",
  };
}

export function toHash(s: AppState): string {
  const p = new URLSearchParams();
  if (s.view === "explorer" || s.view === "anticiper") {
    p.set("couche", s.layer);
    if (s.year) p.set("annee", s.year);
    p.set("echelle", s.scale);
    if (s.sel) p.set("sel", s.sel);
    if (s.cmp) p.set("cmp", s.cmp);
    if (s.ref) p.set("ref", s.ref);
    if (s.osm) p.set("osm", "1");
  }
  const q = p.toString();
  return `#/${s.view}${q ? `?${q}` : ""}`;
}

import type { Core, Scale } from "../data/types";
import { t } from "../i18n";
import { fmt, fmtDelta, previousYear } from "./format";
import { BIVARIATE, PALETTES, classify, terciles } from "./palettes";

export type LayerKind = "value" | "index" | "prediction" | "bivariate" | "unavailable";
export type LayerGroup = "risque" | "scolarite" | "contexte";

export interface LayerDef {
  id: string;
  kind: LayerKind;
  group: LayerGroup;
  indicator?: string;
  /** Seuils de l'écart avant/après (unités de l'indicateur). */
  diffBreaks?: number[];
  diffUnit?: string;
  staticYear?: string;
}

// Couches de la carte. Les seuils des couches « value » viennent de meta.indicateurs (pipeline).
export const LAYERS: LayerDef[] = [
  { id: "prediction", kind: "prediction", group: "risque", diffBreaks: [-6, -2, 2, 6], diffUnit: "pt" },
  { id: "indice", kind: "index", group: "risque", diffBreaks: [-20, -7, 7, 20], diffUnit: "pt" },
  { id: "bivarie", kind: "bivariate", group: "risque" },
  { id: "deperdition_obs", kind: "value", group: "scolarite", indicator: "deperdition_obs", diffBreaks: [-10, -3, 3, 10], diffUnit: "pt" },
  { id: "tap", kind: "value", group: "scolarite", indicator: "tap", diffBreaks: [-10, -3, 3, 10], diffUnit: "pt" },
  { id: "tbs", kind: "value", group: "scolarite", indicator: "tbs", diffBreaks: [-15, -5, 5, 15], diffUnit: "pt" },
  { id: "ips_tbs", kind: "value", group: "scolarite", indicator: "ips_tbs", diffBreaks: [-0.08, -0.02, 0.02, 0.08], diffUnit: "" },
  { id: "ratio_eleves_maitre", kind: "value", group: "scolarite", indicator: "ratio_eleves_maitre", diffBreaks: [-10, -3, 3, 10], diffUnit: "" },
  { id: "baisse_ecoles_pic", kind: "value", group: "contexte", indicator: "baisse_ecoles_pic", diffBreaks: [-25, -5, 5, 25], diffUnit: "pt" },
  { id: "pdi_pct_pop", kind: "value", group: "contexte", indicator: "pdi_pct_pop", diffBreaks: [-10, -2, 2, 10], diffUnit: "pt" },
  { id: "pauvrete", kind: "value", group: "contexte", indicator: "pauvrete", staticYear: "2019" },
  { id: "acled", kind: "unavailable", group: "contexte" },
];

export const PREDICTION_BREAKS = [8, 10, 12, 15];
export const FRAGILE_SCORE = 60;
const INDEX_FIRST_YEAR = "2017-2018";

export function getLayer(id: string): LayerDef {
  return LAYERS.find((l) => l.id === id && l.kind !== "unavailable") ?? LAYERS[0];
}

export interface LegendItem {
  color: string;
  label: string;
}

export interface UnitCell {
  code: string;
  value: number | null;
  display: string;
  cls: number | null;
  color: string | null;
  hatch: boolean;
  fragile: boolean;
  extra?: string;
}

export interface LayerResult {
  cells: Record<string, UnitCell>;
  legend: { kind: "classes" | "bivariate"; title: string; items: LegendItem[]; axes?: [string, string] };
  unit: string;
  decimals: number;
  diff: boolean;
  supportsDiff: boolean;
  note: string | null;
}

function codes(core: Core, scale: Scale): string[] {
  return Object.keys(core.meta.unites[scale]);
}

function yearIndex(core: Core, year: string): number {
  return core.meta.annees.indexOf(year);
}

/** Valeur d'un indicateur pour une unité et une année. */
export function valueOf(core: Core, scale: Scale, code: string, indicator: string, year: string): number | null {
  const s = core.values[scale][code]?.[indicator];
  const i = yearIndex(core, year);
  return s && i >= 0 ? (s[i] ?? null) : null;
}

export function qualityOf(core: Core, scale: Scale, code: string, year: string): { score: number | null; reasons: string | null } {
  const i = yearIndex(core, year);
  const u = core.values[scale][code];
  return { score: u?.qualite_score?.[i] ?? null, reasons: u?.qualite_motifs?.[i] ?? null };
}

/** Années disponibles pour une couche, dans l'ordre chronologique. */
export function layerYears(def: LayerDef, core: Core, scale: Scale): string[] {
  const units = codes(core, scale);
  if (def.kind === "index") return core.meta.annees_indice;
  if (def.kind === "prediction" || def.kind === "bivariate") {
    const ys = new Set<string>();
    for (const c of units) Object.keys(core.risk[scale][c]?.prediction ?? {}).forEach((y) => ys.add(y));
    return [...ys].sort();
  }
  if (def.kind === "value" && def.indicator) {
    return core.meta.annees.filter((y) => {
      if (def.staticYear && y < INDEX_FIRST_YEAR) return false;
      const n = units.filter((c) => valueOf(core, scale, c, def.indicator!, y) !== null).length;
      return n >= units.length / 2;
    });
  }
  return [];
}

function rawValue(def: LayerDef, core: Core, scale: Scale, code: string, year: string): number | null {
  if (def.kind === "prediction") return core.risk[scale][code]?.prediction[year]?.valeur ?? null;
  if (def.kind === "index") return core.risk[scale][code]?.indice[year]?.score ?? null;
  if (def.kind === "value" && def.indicator) return valueOf(core, scale, code, def.indicator, year);
  return null;
}

function rangeLabels(breaks: number[], decimals: number, unit: string): string[] {
  const f = (v: number) => fmt(v, decimals);
  const u = unit ? (unit.startsWith("%") || unit === "pt" ? `\u202f${unit}` : ` ${unit}`) : "";
  return [
    `< ${f(breaks[0])}${u}`,
    ...breaks.slice(1).map((b, i) => `${f(breaks[i])} à ${f(b)}${u}`),
    `≥ ${f(breaks[breaks.length - 1])}${u}`,
  ];
}

export function layerLabel(def: LayerDef, core: Core): string {
  if (def.kind === "value" && def.indicator) return core.meta.indicateurs[def.indicator]?.label ?? def.id;
  return t(`layer.${def.id}`);
}

/** Couleurs, valeurs affichées et légende d'une couche pour une échelle et une année. */
export function computeLayer(def: LayerDef, core: Core, scale: Scale, year: string, ref: string | null): LayerResult {
  const units = codes(core, scale);
  const cells: Record<string, UnitCell> = {};
  // Qualité de l'année de l'information : pour une prédiction, l'année où elle a été faite.
  const qYear = def.kind === "prediction" || def.kind === "bivariate" ? previousYear(year) : year;
  const fragileOf = (c: string) => {
    const q = qualityOf(core, scale, c, qYear).score;
    return q !== null && q < FRAGILE_SCORE;
  };

  if (def.kind === "bivariate") {
    const a = units.map((c) => core.risk[scale][c]?.prediction[year]?.valeur ?? null);
    const b = units.map((c) => {
      const v = valueOf(core, scale, c, "baisse_ecoles_pic", previousYear(year));
      return v === null ? null : -v; // part des écoles perdues depuis le maximum
    });
    const ta = terciles(a);
    const tb = terciles(b);
    units.forEach((c, i) => {
      const ka = ta && a[i] !== null ? classify(a[i], ta) : null;
      const kb = tb && b[i] !== null ? classify(b[i], tb) : null;
      const ok = ka !== null && kb !== null;
      cells[c] = {
        code: c,
        value: a[i],
        display: a[i] === null ? "—" : `${fmt(a[i], 1, "%")} · ${fmt(b[i], 0, "%")} ${t("bivariate.closed")}`,
        cls: ok ? ka! * 3 + kb! : null,
        color: ok ? BIVARIATE[ka!][kb!] : null,
        hatch: !ok,
        fragile: fragileOf(c),
      };
    });
    const fa = (x: [number, number] | null, u: string) => (x ? `${fmt(x[0], 1)} / ${fmt(x[1], 1)}${u}` : "");
    return {
      cells,
      legend: {
        kind: "bivariate",
        title: t("layer.bivarie"),
        items: BIVARIATE.flat().map((color) => ({ color, label: "" })),
        axes: [`${t("bivariate.axisA")} (${t("legend.terciles")} ${fa(ta, " %")})`, `${t("bivariate.axisB")} (${fa(tb, " %")})`],
      },
      unit: "%",
      decimals: 1,
      diff: false,
      supportsDiff: false,
      note: t("bivariate.note"),
    };
  }

  const im = def.indicator ? core.meta.indicateurs[def.indicator] : null;
  const unit = def.kind === "prediction" ? "%" : def.kind === "index" ? "/100" : (im?.unite ?? "");
  const decimals = def.kind === "index" ? 0 : def.kind === "prediction" ? 1 : (im?.decimales ?? 1);
  const sens = def.kind === "value" ? (im?.sens ?? 0) : 1;
  const supportsDiff = Boolean(def.diffBreaks) && !def.staticYear;
  const diff = Boolean(ref) && supportsDiff && ref !== year;

  if (diff) {
    const breaks = def.diffBreaks!;
    const base = PALETTES.div_change;
    // Une hausse d'un indicateur défavorable est colorée comme une dégradation (brun).
    const pal = sens > 0 ? [...base].reverse() : base;
    for (const c of units) {
      const v1 = rawValue(def, core, scale, c, year);
      const v0 = rawValue(def, core, scale, c, ref!);
      const v = v1 !== null && v0 !== null ? v1 - v0 : null;
      const k = classify(v, breaks);
      cells[c] = {
        code: c,
        value: v,
        display: def.diffUnit === "" ? fmtDelta(v, 2, "") : fmtDelta(v, 1, def.diffUnit ?? "pt"),
        cls: k,
        color: k === null ? null : pal[k],
        hatch: k === null,
        fragile: fragileOf(c),
      };
    }
    return {
      cells,
      legend: {
        kind: "classes",
        title: `${layerLabel(def, core)} : ${t("legend.change")}`,
        items: rangeLabels(breaks, def.diffUnit === "" ? 2 : 0, def.diffUnit ?? "").map((label, i) => ({ color: pal[i], label })),
      },
      unit: def.diffUnit ?? "",
      decimals,
      diff: true,
      supportsDiff,
      note: null,
    };
  }

  let breaks: number[];
  let pal: string[];
  let labels: string[];
  if (def.kind === "index") {
    pal = PALETTES.seq_risk;
    breaks = [2, 3, 4, 5];
    labels = [1, 2, 3, 4, 5].map((k) => t(`class.${k}`));
  } else if (def.kind === "prediction") {
    pal = PALETTES.seq_risk;
    breaks = PREDICTION_BREAKS;
    labels = rangeLabels(breaks, 0, "%");
  } else {
    pal = PALETTES[im?.palette ?? "seq_neutral"] ?? PALETTES.seq_neutral;
    breaks = im?.seuils ?? [];
    labels = rangeLabels(breaks, im && im.decimales >= 2 ? 2 : 0, unit);
  }
  for (const c of units) {
    const v = rawValue(def, core, scale, c, year);
    const k = def.kind === "index" ? (core.risk[scale][c]?.indice[year]?.classe ?? 0) - 1 : classify(v, breaks);
    const valid = v !== null && k !== null && k >= 0;
    cells[c] = {
      code: c,
      value: v,
      display: fmt(v, decimals, unit),
      cls: valid ? k : null,
      color: valid ? pal[k!] : null,
      hatch: !valid,
      fragile: fragileOf(c),
    };
  }
  return {
    cells,
    legend: { kind: "classes", title: layerLabel(def, core), items: labels.map((label, i) => ({ color: pal[i], label })) },
    unit,
    decimals,
    diff: false,
    supportsDiff,
    note: def.staticYear ? t("legend.static", { year: def.staticYear }) : def.kind === "prediction" ? t("legend.predictionNote") : null,
  };
}

/** Classement décroissant du « plus à risque » au « moins à risque » selon le sens de l'indicateur. */
export function riskOrder(def: LayerDef, core: Core): 1 | -1 {
  if (def.kind === "value" && def.indicator) {
    const s = core.meta.indicateurs[def.indicator]?.sens ?? 0;
    return s < 0 ? -1 : 1;
  }
  return 1;
}

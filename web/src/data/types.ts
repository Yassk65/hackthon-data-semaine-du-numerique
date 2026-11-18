// Types des fichiers produits par pipeline/export.py (web/public/data).

export type Scale = "prov" | "reg";
export type Series = (number | null)[];

export interface IndicatorMeta {
  label: string;
  unite: string;
  decimales: number;
  sens: -1 | 0 | 1;
  seuils: number[] | null;
  palette: string;
  description: string;
}

export interface ProvMeta {
  nom: string;
  reg: string;
  reg_nom: string;
  superficie_km2: number;
  communes: number;
  ancienne_province: string;
  ancienne_region: string;
  scindee: boolean;
}

export interface RegMeta {
  nom: string;
  superficie_km2: number;
  provinces: string[];
  ancienne_region: string;
  anciennes_provinces: string;
}

export interface Source {
  id: string;
  titre: string;
  producteur: string;
  usage: string;
  licence: string;
  lien: string;
}

export interface KeyFigures {
  annee: string;
  tap_max: { code: string; nom: string; valeur: number; tbs: number };
  tap_min: { code: string; nom: string; valeur: number; tbs: number };
  ecart_tap: number;
  effectif_2021: number;
  effectif_2022: number;
  baisse_effectif: number;
  ecoles_max: number;
  ecoles_min: number;
  annee_ecoles_max: string;
  annee_ecoles_min: string;
  effectif_last: number;
  ecoles_last: number;
  tap_nat_last: number;
  tap_nat_2017: number;
  provinces_alerte: number;
  seuil_alerte: number;
  pdi_max: number;
  annee_pdi_max: string | null;
}

export interface Meta {
  genere_le: string;
  annees: string[];
  horizon: string;
  derniere_annee: string;
  annees_indice: string[];
  indicateurs: Record<string, IndicatorMeta>;
  unites: { prov: Record<string, ProvMeta>; reg: Record<string, RegMeta> };
  chiffres_cles: KeyFigures;
  sources: Source[];
  correspondance: { ancienne_province: string; ancienne_region: string; province: string; region: string; communes: number }[];
}

export type UnitValues = Record<string, Series> & {
  qualite_motifs: (string | null)[];
  split_estime: boolean;
};

export interface Values {
  prov: Record<string, UnitValues>;
  reg: Record<string, UnitValues>;
  national: UnitValues;
}

export interface IndexRecord {
  score: number;
  classe: number;
  rang: number;
  rang_p05: number;
  rang_p95: number;
  proba_q5: number;
  facteurs: string;
  dimension: string;
  dims: Record<string, number | null>;
  acp: number;
  entropie: number;
}

export interface PredictionRecord {
  valeur: number;
  ic80: [number, number];
  ic90: [number, number];
  p_alerte: number;
  rang: number;
  observe: number | null;
  persistance: number | null;
  hors_echantillon: boolean;
  facteurs: string;
}

export interface Recommendation {
  types: { type: string; titre: string; actions: string[] }[];
  alerte: boolean;
  priorite: 1 | 2 | 3;
}

export interface UnitRisk {
  indice: Record<string, IndexRecord>;
  prediction: Record<string, PredictionRecord>;
}

export interface Risk {
  prov: Record<string, UnitRisk>;
  reg: Record<string, UnitRisk>;
  recommandations: { prov: Record<string, Recommendation>; reg: Record<string, Recommendation> };
}

export interface ModelMetric {
  modele: string;
  type: "regression" | "classification";
  MAE?: number | null;
  RMSE?: number | null;
  Spearman?: number | null;
  AUC?: number | null;
  PR_AUC?: number | null;
  Brier?: number | null;
  prevalence?: number | null;
}

export interface ModelData {
  resume: {
    cible: string;
    seuil_alerte: number;
    annees_entrainement: string[];
    plis_temporels: string[];
    n_observations: number;
    n_provinces: number;
    selection: { retenu: string; lineaires_eligibles: string[]; arbres_retenus: boolean; regle: string };
    conformal: { q80: number; q90: number; couverture: { pli: string; niveau: number; couverture: number }[] };
    annee_prediction: string;
  };
  metriques_temporelles: ModelMetric[];
  metriques_spatiales: ModelMetric[];
  plis: Record<string, number | string | null>[];
  calibration: { bin: number; proba_moyenne: number; frequence_observee: number; n: number }[];
  importance: { variable: string; libelle: string; coef: number | null; permutation: number | null }[];
  validation_points: [number, number, number, string][];
  libelles_variables: Record<string, string>;
  indice: {
    dimensions: Record<string, { label: string; indicateurs: { col: string; label: string; sens: number }[] }>;
    meta: {
      poids_dimensions: Record<string, number>;
      poids_acp: Record<string, number>;
      poids_entropie: Record<string, number>;
      variance_pc1: number;
      spearman_variantes: Record<string, number>;
      rang_moyen_largeur_p05_p95: number;
    };
  };
}

export interface QualityData {
  rapport: Record<string, unknown> & {
    valeurs_controle: { total: number; ok: number };
    valeurs_extraites: number;
    sommes: { testees: number; ok: number; taux_ok: number };
    taux: { testes: number; ok: number; taux_ok: number };
    flux_somme_100: { testes: number; ok: number; taux_ok: number };
    historiques_entre_editions: { comparaisons: number; identiques: number; taux_identiques: number };
    reconstitution_vs_publie: Record<string, { n: number; part_ecart_inf_0_15_pt: number; ecart_median_pt: number }>;
    abandon_publie_nul: { n: number; dont_reconstitue_negatif_ou_nul: number };
    flags: Record<string, number>;
  };
  controles: { controle: string; attendu: number; obtenu: number | null; ok: boolean; source: string; page: number; ligne: number }[];
  par_table: Record<string, string | number | null>[];
  journal: { edition: string; table: string; page: number | null; ligne: number | null; message: string; texte: string }[];
}

export interface Schools {
  types: string[];
  points: [number, number, number][];
  par_province: Record<string, number>;
  source: string;
}

export interface GeoFeature {
  type: "Feature";
  properties: { code: string; nom: string; reg?: string };
  geometry: GeoJSON.Geometry;
}

export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface Core {
  meta: Meta;
  values: Values;
  risk: Risk;
}

export interface GeoBundle {
  prov: GeoCollection;
  reg: GeoCollection;
  labels: { prov: Record<string, [number, number]>; reg: Record<string, [number, number]> };
  bounds: [number, number, number, number];
}

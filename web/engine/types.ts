/** Types du moteur de recalcul. Aucun import depuis src/ ni depuis @netlify : le moteur est partagé
 * par les fonctions serveur, la validation côté navigateur et les tests. */

export const INPUT_COLUMNS = [
  "deperdition_prec", "survie_cm2_prec", "redoublement_global_prec", "effectif", "eleves", "ecoles",
  "maitres", "salles", "tap", "tbs", "ips_tbs", "part_rurale", "part_prive", "pauvrete",
] as const;
export type InputColumn = (typeof INPUT_COLUMNS)[number];

export type Num = number | null;

export interface BaselineRow {
  code: string;
  annee_scolaire: string;
  deperdition_prec: Num;
  survie_cm2_prec: Num;
  redoublement_global_prec: Num;
  effectif: Num;
  eleves: Num;
  ecoles: Num;
  maitres: Num;
  salles: Num;
  tap: Num;
  tbs: Num;
  ips_tbs: Num;
  part_rurale: Num;
  part_prive: Num;
  pauvrete: Num;
}

export interface IndexRecord {
  score: Num;
  classe: number;
  rang: number;
  rang_p05: number;
  rang_p95: number;
  proba_q5: number;
  facteurs: string;
  dimension: string;
  dims: Record<string, Num>;
  acp: Num;
  entropie: Num;
}

export interface PredictionRecord {
  valeur: number;
  ic80: [number, number];
  ic90: [number, number];
  p_alerte: number;
  rang: number;
  observe: Num;
  persistance: Num;
  hors_echantillon: boolean;
  facteurs: string;
}

export interface Action {
  titre: string;
  actions: string[];
}

export interface EngineBaseline {
  version: string;
  genere_le: string;
  annees: string[];
  derniere_annee: string;
  horizon: string;
  colonnes_entree: string[];
  unites: Record<string, { nom: string; reg: string; reg_nom: string }>;
  regions: Record<string, { nom: string }>;
  dimensions: Record<string, [string, number][]>;
  dim_labels: Record<string, string>;
  ind_labels: Record<string, string>;
  class_labels: string[];
  poids_indicateurs: { acp: Record<string, number>; entropie: Record<string, number> };
  actions: Record<string, Action>;
  action_filles: Action;
  rows: BaselineRow[];
  resultats: Record<string, { indice: Record<string, IndexRecord>; prediction: Record<string, PredictionRecord> }>;
}

export interface LinearParams {
  median: number[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
}

export interface EngineModel {
  version: string;
  modele: string;
  modele_explicatif: string;
  features: string[];
  feature_labels: Record<string, string>;
  clips: Record<string, [number, number]>;
  y_cap: [number, number];
  alerte: number;
  regression: LinearParams;
  explicatif: LinearParams;
  logit: LinearParams;
  conformal: { "80": number; "90": number };
  entrainement: { annees: string[]; n: number; provinces: number };
}

// ---------------------------------------------------------------------------- validation

export type Severity = "erreur" | "avertissement";

export interface Issue {
  niveau: Severity;
  message: string;
  ligne?: number;
  colonne?: string;
  code?: string;
}

export interface UploadRow {
  code: string;
  annee_scolaire: string;
  values: Partial<Record<InputColumn, Num>>;
}

export interface ValidationContext {
  codes: string[];
  lastYear: string;
  /** Dernière valeur connue des colonnes structurelles par province (pauvreté, part rurale, part du privé). */
  fallback?: Record<string, Partial<Record<InputColumn, Num>>>;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  annee: string | null;
  type: "correction" | "nouvelle_annee" | null;
  rows: UploadRow[];
  colonnes: string[];
  separateur: string;
  /** Colonnes complétées automatiquement à partir de la dernière situation connue. */
  completees: string[];
}

// ---------------------------------------------------------------------------- résultats

export interface Recommendation {
  types: { type: string; titre: string; actions: string[] }[];
  alerte: boolean;
  priorite: 1 | 2 | 3;
}

export interface ProvinceResult {
  indice: IndexRecord;
  prediction: PredictionRecord;
  reco: Recommendation;
  valeurs: Record<string, Num>;
  reference: {
    /** Indice de référence : même année pour une correction, année précédente pour une nouvelle année. */
    indice: { annee: string; score: number; rang: number; classe: number } | null;
    /** Prévision de référence pour la même cible (correction uniquement). */
    prediction: { valeur: number; p_alerte: number; rang: number } | null;
    /** Ce que la référence avait prévu pour l'année déposée (nouvelle année uniquement). */
    prevu: { valeur: number; p_alerte: number } | null;
  };
  manquants: string[];
}

export interface BacktestSummary {
  annee: string;
  n: number;
  mae: number;
  biais: number;
  spearman: number | null;
  alertes: { vrai_positif: number; faux_positif: number; faux_negatif: number; vrai_negatif: number };
}

export interface Mover {
  code: string;
  nom: string;
  de: number;
  vers: number;
}

export interface ScenarioSummary {
  n_provinces: number;
  n_alerte: number;
  n_alerte_reference: number | null;
  prediction_moyenne: number;
  prediction_moyenne_reference: number | null;
  top: { code: string; nom: string; region: string; valeur: number; p_alerte: number; classe: number; facteurs: string }[];
  hausses: Mover[];
  baisses: Mover[];
  regions_alerte: { region: string; n: number }[];
}

export interface ScenarioResult {
  version: string;
  genere_le: string;
  annee: string;
  cible: string;
  type: "correction" | "nouvelle_annee";
  moteur: { version: string; modele: string; alerte: number; tirages: number; graine: number };
  provinces: Record<string, ProvinceResult>;
  regions: Record<string, { prediction: PredictionRecord }>;
  verification: BacktestSummary | null;
  resume: ScenarioSummary;
  completees: string[];
  avertissements: Issue[];
  empreinte: string;
}

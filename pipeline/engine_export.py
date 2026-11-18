"""Export des paramètres du moteur de recalcul (backend TypeScript, Netlify Functions).

Le pipeline Python reste la référence : extraction, harmonisation, entraînement et validation du
modèle. Le backend ne refait que l'étape légère, à partir d'un tableau de situation par province :
variables dérivées, indice composite, prévision avec les coefficients déjà ajustés, alerte.

Trois fichiers versionnés, régénérés ici :
- web/engine/data/engine_baseline.json : historique des 47 provinces (colonnes d'entrée), résultats de
  référence des deux dernières années, libellés, actions types ;
- web/engine/data/engine_model.json    : paramètres du modèle retenu (imputation, standardisation,
  coefficients), de la régression logistique d'alerte et quantiles conformes ;
- web/engine/fixtures/engine_reference.json : valeurs de référence calculées par Python, pour tester que
  le moteur TypeScript reproduit exactement le pipeline (tests Vitest).

Les valeurs du modèle sont recontrôlées ici : les prédictions recalculées avec les seuls paramètres
exportés doivent égaler celles du pipeline (tolérance 1e-8), sinon l'export échoue.
"""

from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd

from pipeline.config import OUTPUTS_DIR, ROOT
from pipeline.export import ACTIONS, GIRLS_ACTION
from pipeline.model import ALERT, CLIPS, FEATURE_LABELS, FEATURES, LINEAR, TRAIN_YEARS, make_model, model_frame
from pipeline.risk_index import (
    CLASS_LABELS,
    DIM_LABELS,
    DIMENSIONS,
    IND_LABELS,
    INDEX_YEARS,
    Y_CAP,
    indicator_weight_variants,
    oriented_ranks,
    prepare,
)

TABLES = OUTPUTS_DIR / "tables"
MDIR = OUTPUTS_DIR / "model"
WEB_DATA = ROOT / "web" / "public" / "data"
ENGINE_DIR = ROOT / "web" / "engine"
VERSION = "engine-1"

# Colonnes qu'un fichier de mise à jour peut porter (une ligne = une province pour une année scolaire).
INPUT_COLS = ["deperdition_prec", "survie_cm2_prec", "redoublement_global_prec", "effectif", "eleves", "ecoles",
              "maitres", "salles", "tap", "tbs", "ips_tbs", "part_rurale", "part_prive", "pauvrete"]
DERIVED_COLS = ["ratio_eleves_maitre", "ratio_eleves_salle", "var_effectif_1an", "baisse_effectif_pic",
                "var_ecoles_1an", "baisse_ecoles_pic"]
BASELINE_RESULT_YEARS = ["2023-2024", "2024-2025"]


def nn(v):
    """NaN -> None, récursivement (JSON strict)."""
    if isinstance(v, dict):
        return {k: nn(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [nn(x) for x in v]
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def write_json(path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(nn(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(txt, encoding="utf-8")
    return len(txt.encode("utf-8"))


def pipe_params(pipe) -> dict:
    """Imputation par la médiane, standardisation, coefficients et constante d'un pipeline sklearn."""
    return {"median": pipe[0].statistics_.tolist(), "mean": pipe[1].mean_.tolist(), "scale": pipe[1].scale_.tolist(),
            "coef": np.ravel(pipe[-1].coef_).tolist(), "intercept": float(np.ravel(pipe[-1].intercept_)[0])}


def apply_params(X: pd.DataFrame, p: dict) -> np.ndarray:
    x = X.to_numpy(dtype=float)
    x = np.where(np.isnan(x), np.asarray(p["median"]), x)
    z = (x - np.asarray(p["mean"])) / np.asarray(p["scale"])
    return z @ np.asarray(p["coef"]) + p["intercept"]


def fit_models(d_old: pd.DataFrame, chosen: str) -> dict:
    train = d_old[d_old.annee_scolaire.isin(TRAIN_YEARS)].dropna(subset=["y"])
    reg = make_model(chosen).fit(train[FEATURES], train.y)
    logit = make_model("logit").fit(train[FEATURES], train.alerte)
    explain = chosen if chosen in LINEAR else "ridge"
    expl = reg if explain == chosen else make_model(explain).fit(train[FEATURES], train.y)
    return {"regression": reg, "logit": logit, "explain": expl, "explain_name": explain}


def model_params(chosen: str, summary: dict) -> dict:
    d_old = model_frame(pd.read_csv(TABLES / "indicateurs_old_prov.csv", sep=";"))
    m = fit_models(d_old, chosen)
    train = d_old[d_old.annee_scolaire.isin(TRAIN_YEARS)].dropna(subset=["y"])
    return {
        "version": VERSION, "modele": chosen, "modele_explicatif": m["explain_name"],
        "features": FEATURES, "feature_labels": FEATURE_LABELS, "clips": {k: list(v) for k, v in CLIPS.items()},
        "y_cap": list(Y_CAP), "alerte": ALERT,
        "regression": pipe_params(m["regression"]), "explicatif": pipe_params(m["explain"]),
        "logit": pipe_params(m["logit"]),
        "conformal": {"80": summary["conformal"]["q80"], "90": summary["conformal"]["q90"]},
        "entrainement": {"annees": TRAIN_YEARS, "n": int(len(train)), "provinces": int(train.code.nunique())},
    }


def index_weights(ind_prov: pd.DataFrame) -> dict:
    d = prepare(ind_prov[ind_prov.annee_scolaire.isin(INDEX_YEARS)].reset_index(drop=True))
    w = indicator_weight_variants(oriented_ranks(d))
    return {"acp": w["acp"].to_dict(), "entropie": w["entropie"].to_dict()}


def build_baseline(ind_prov: pd.DataFrame, meta: dict, risk: dict, weights: dict) -> dict:
    rows = []
    for r in ind_prov.sort_values(["code", "annee_scolaire"]).itertuples(index=False):
        rec = {"code": r.code, "annee_scolaire": r.annee_scolaire}
        rec.update({c: getattr(r, c) for c in INPUT_COLS})
        rows.append(rec)
    results = {}
    for code, rec in risk["prov"].items():
        results[code] = {
            "indice": {y: rec["indice"][y] for y in BASELINE_RESULT_YEARS if y in rec["indice"]},
            "prediction": {y: v for y, v in rec["prediction"].items() if y >= "2024-2025"},
        }
    return {
        "version": VERSION, "genere_le": dt.date.today().isoformat(), "annees": sorted(ind_prov.annee_scolaire.unique()),
        "derniere_annee": meta["derniere_annee"], "horizon": meta["horizon"],
        "colonnes_entree": INPUT_COLS, "colonnes_derivees": DERIVED_COLS,
        "unites": {c: {"nom": u["nom"], "reg": u["reg"], "reg_nom": u["reg_nom"]} for c, u in meta["unites"]["prov"].items()},
        "regions": {c: {"nom": u["nom"]} for c, u in meta["unites"]["reg"].items()},
        "dimensions": {k: [[c, s] for c, s in v] for k, v in DIMENSIONS.items()},
        "dim_labels": DIM_LABELS, "ind_labels": IND_LABELS, "class_labels": CLASS_LABELS,
        "poids_indicateurs": weights, "actions": {k: {"titre": v[0], "actions": v[1]} for k, v in ACTIONS.items()},
        "action_filles": {"titre": GIRLS_ACTION[0], "actions": GIRLS_ACTION[1]},
        "rows": rows, "resultats": results,
    }


def build_reference(ind_prov: pd.DataFrame, preds: pd.DataFrame, idx: pd.DataFrame) -> dict:
    """Valeurs calculées par le pipeline Python, à reproduire à l'identique par le moteur TypeScript."""
    dn = model_frame(ind_prov)
    derived, feats = {}, {}
    for r in dn.itertuples(index=False):
        key = f"{r.code}|{r.annee_scolaire}"
        derived[key] = {c: getattr(r, c) for c in DERIVED_COLS + ["deperdition_moy_passee", "volatilite"]}
        feats[key] = {c: getattr(r, c) for c in FEATURES}
    year = "2024-2025"
    pr = preds[preds.annee_scolaire == year].set_index("code")
    ix = idx[idx.annee_scolaire == year].set_index("code")
    cols_i = ["indice", "classe", "rang", "rang_p05", "rang_p95", "proba_quintile_superieur", "indice_acp",
              "indice_entropie"] + [f"dim_{k}" for k in DIMENSIONS]
    cols_p = ["prediction", "ic80_bas", "ic80_haut", "ic90_bas", "ic90_haut", "p_alerte", "rang_prediction"]
    out = {"annee": year, "derives": derived, "variables": feats, "indice": {}, "prediction": {}}
    for code in ix.index:
        rec = {c: ix.loc[code, c] for c in cols_i}
        rec["facteurs"] = ix.loc[code, "facteurs"] if isinstance(ix.loc[code, "facteurs"], str) else ""
        rec["dimension"] = ix.loc[code, "dimension_dominante"]
        out["indice"][code] = rec
        p = {c: pr.loc[code, c] for c in cols_p}
        p["facteurs"] = pr.loc[code, "facteurs_modele"] if isinstance(pr.loc[code, "facteurs_modele"], str) else ""
        out["prediction"][code] = p
    return out


def write_template(ind_prov: pd.DataFrame, last_year: str) -> int:
    """Modèle de fichier de mise à jour : la dernière situation connue, à corriger ou à remplacer par la nouvelle année.

    Fichier statique de l'application : le téléchargement fonctionne même sans backend.
    """
    cols = ["code", "annee_scolaire"] + INPUT_COLS
    d = ind_prov[ind_prov.annee_scolaire == last_year].sort_values("code")[cols].copy()
    counts = ["effectif", "eleves", "ecoles", "maitres", "salles"]
    for c in INPUT_COLS:
        d[c] = d[c].round(0 if c in counts else 4)
    path = WEB_DATA / "modele_mise_a_jour.csv"
    d.to_csv(path, sep=";", index=False, decimal=",", encoding="utf-8-sig", lineterminator="\r\n", float_format="%.10g")
    return path.stat().st_size


def write_demo(ind_prov: pd.DataFrame, preds: pd.DataFrame, last_year: str) -> int:
    """Exemple de nouvelle année pour tester l'outil : DONNÉES FICTIVES (graine 42), jamais des chiffres officiels.

    La déperdition « observée » est la prévision de la référence bruitée ; les effectifs et équipements évoluent de
    quelques pour cent. Le nom du fichier porte la mention « fictif ».
    """
    rng = np.random.default_rng(42)
    d = ind_prov[ind_prov.annee_scolaire == last_year].sort_values("code")[["code", "annee_scolaire"] + INPUT_COLS].copy()
    n = len(d)
    target = f"{int(last_year[:4]) + 1}-{int(last_year[:4]) + 2}"
    pred = preds[preds.annee_scolaire == last_year].set_index("code").prediction.reindex(d.code).to_numpy()
    d["annee_scolaire"] = target
    d["deperdition_prec"] = np.clip(pred + rng.normal(0, 4, n), 0, 60)
    growth = 1 + rng.normal(0.02, 0.03, n)
    d["effectif"] = d.effectif * growth
    d["eleves"] = d.effectif
    d["ecoles"] = d.ecoles * (1 + rng.normal(0, 0.02, n))
    d["maitres"] = d.maitres * (1 + rng.normal(0.02, 0.03, n))
    d["salles"] = d.salles * (1 + rng.normal(0.02, 0.03, n))
    d["tap"] = (d.tap + rng.normal(0, 1.5, n)).clip(0, 200)
    d["tbs"] = (d.tbs + rng.normal(0, 2, n)).clip(0, 250)
    d["survie_cm2_prec"] = (d.survie_cm2_prec + rng.normal(0, 2, n)).clip(0, 100)
    d["redoublement_global_prec"] = (d.redoublement_global_prec + rng.normal(0, 0.3, n)).clip(0, 100)
    d["ips_tbs"] = d.ips_tbs + rng.normal(0, 0.01, n)
    counts = ["effectif", "eleves", "ecoles", "maitres", "salles"]
    for c in INPUT_COLS:
        d[c] = d[c].round(0 if c in counts else 4)
    path = WEB_DATA / f"exemple_fictif_{target}.csv"
    d.to_csv(path, sep=";", index=False, decimal=",", encoding="utf-8-sig", lineterminator="\r\n", float_format="%.10g")
    return path.stat().st_size


def self_check(params: dict, ind_prov: pd.DataFrame, preds: pd.DataFrame) -> float:
    """Les paramètres exportés reproduisent les prédictions du pipeline (provinces actuelles, 2024-25)."""
    dn = model_frame(ind_prov)
    d = dn[dn.annee_scolaire == "2024-2025"].set_index("code")
    pr = preds[preds.annee_scolaire == "2024-2025"].set_index("code").loc[d.index]
    reg = np.clip(apply_params(d[FEATURES], params["regression"]), *Y_CAP)
    proba = 1 / (1 + np.exp(-apply_params(d[FEATURES], params["logit"])))
    lo80 = np.clip(reg - params["conformal"]["80"] * d.volatilite.to_numpy(), *Y_CAP)
    err = max(float(np.abs(reg - pr.prediction.to_numpy()).max()), float(np.abs(proba - pr.p_alerte.to_numpy()).max()),
              float(np.abs(lo80 - pr.ic80_bas.to_numpy()).max()))
    if err > 1e-8:
        raise AssertionError(f"les paramètres exportés ne reproduisent pas le pipeline (écart max {err:.2e})")
    return err


def run() -> dict:
    ind_prov = pd.read_csv(TABLES / "indicateurs_prov.csv", sep=";")
    summary = json.loads((MDIR / "resume_modele.json").read_text(encoding="utf-8"))
    meta = json.loads((WEB_DATA / "meta.json").read_text(encoding="utf-8"))
    risk = json.loads((WEB_DATA / "risk.json").read_text(encoding="utf-8"))
    preds = pd.read_csv(MDIR / "predictions_provinces_actuelles.csv", sep=";")
    idx = pd.read_csv(MDIR / "indice_prov.csv", sep=";")

    params = model_params(summary["selection"]["retenu"], summary)
    err = self_check(params, ind_prov, preds)
    sizes = {
        "engine_model": write_json(ENGINE_DIR / "data" / "engine_model.json", params),
        "engine_baseline": write_json(ENGINE_DIR / "data" / "engine_baseline.json",
                                      build_baseline(ind_prov, meta, risk, index_weights(ind_prov))),
        "engine_reference": write_json(ENGINE_DIR / "fixtures" / "engine_reference.json",
                                       build_reference(ind_prov, preds, idx)),
        "modele_mise_a_jour": write_template(ind_prov, meta["derniere_annee"]),
        "exemple_fictif": write_demo(ind_prov, preds, meta["derniere_annee"]),
    }
    print(f"[engine] écart max paramètres exportés / pipeline : {err:.1e}")
    return sizes


if __name__ == "__main__":
    print({k: f"{v / 1024:.0f} Ko" for k, v in run().items()})

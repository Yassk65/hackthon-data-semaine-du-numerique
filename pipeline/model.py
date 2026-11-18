"""Modèle d'anticipation de la déperdition scolaire au primaire.

Cible y(t) : déperdition apparente CP1-CM1 de la cohorte t -> t+1 (connue avec l'annuaire
t+1), plafonnée à [0 ; 60] %. Toutes les variables explicatives sont connues à la fin de
l'année t (aucune information de t+1). Unité d'apprentissage : les 45 anciennes provinces
(celles des annuaires) ; les prédictions sont ensuite calculées sur les 47 provinces et
17 régions actuelles avec les mêmes coefficients.

Références naïves : persistance y(t-1) et moyenne historique de la province.
Candidats : ridge (L2), Huber (robuste, L2), régression médiane (quantile 0,5, L1),
gradient boosting (arbres peu profonds). Alerte : régression logistique (y >= 15 %).

Règle de sélection, fixée avant de regarder les résultats :
1. un modèle linéaire n'est éligible que s'il bat les deux références naïves (MAE) en
   validation temporelle (fenêtre glissante, 4 plis) ET spatiale (une région exclue) ;
2. parmi les éligibles, on retient la meilleure corrélation de rang moyenne en validation
   temporelle (l'outil sert d'abord à classer les provinces) ;
3. les arbres ne sont retenus que s'ils font au moins 5 % mieux (MAE) que la meilleure
   référence et que le meilleur linéaire dans les deux validations.

Incertitude : prédiction conforme normalisée par la volatilité passée de la province,
quantiles calculés sur les résidus hors échantillon de la validation temporelle.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import HuberRegressor, LogisticRegression, QuantileRegressor, RidgeCV
from sklearn.metrics import average_precision_score, brier_score_loss, mean_absolute_error, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from pipeline.config import OUTPUTS_DIR
from pipeline.geo import communes
from pipeline.risk_index import INDEX_YEARS, Y_CAP, prepare

SEED = 42
TABLES = OUTPUTS_DIR / "tables"
MDIR = OUTPUTS_DIR / "model"
ALERT = 15.0
TRAIN_YEARS = [f"{y}-{y + 1}" for y in range(2017, 2024)]   # cohortes dont la cible est connue
TEMPORAL_TESTS = [f"{y}-{y + 1}" for y in range(2020, 2024)]
PREDICT_YEAR = "2024-2025"                                   # cohorte 2024-25 -> 2025-26
LINEAR = ["ridge", "huber", "mediane"]
NAIVE = ["persistance", "moyenne_historique"]

FEATURES = ["deperdition_prec_cap", "deperdition_moy_passee", "survie_cm2_prec_cap", "redoublement_global_prec",
            "var_effectif_1an", "baisse_effectif_pic", "baisse_ecoles_pic", "tap", "tbs", "ips_tbs",
            "ratio_eleves_maitre", "part_rurale", "part_prive", "pauvrete"]
FEATURE_LABELS = {
    "deperdition_prec_cap": "déperdition de la cohorte précédente",
    "deperdition_moy_passee": "déperdition moyenne des cohortes passées",
    "survie_cm2_prec_cap": "survie jusqu'au CM2", "redoublement_global_prec": "redoublement",
    "var_effectif_1an": "variation des effectifs sur un an", "baisse_effectif_pic": "perte d'élèves depuis le pic",
    "baisse_ecoles_pic": "écoles fermées depuis le pic", "tap": "taux d'achèvement",
    "tbs": "taux brut de scolarisation", "ips_tbs": "parité filles/garçons (TBS)",
    "ratio_eleves_maitre": "élèves par maître", "part_rurale": "part rurale", "part_prive": "part du privé",
    "pauvrete": "pauvreté (2019)",
}
CLIPS = {"var_effectif_1an": (-100, 100), "tap": (0, 130), "tbs": (0, 150), "ips_tbs": (0.5, 1.5),
         "ratio_eleves_maitre": (0, 120)}


def model_frame(ind: pd.DataFrame) -> pd.DataFrame:
    d = prepare(ind).sort_values(["code", "annee_scolaire"]).reset_index(drop=True)
    for c, (lo, hi) in CLIPS.items():
        d[c] = d[c].clip(lo, hi)
    d["y"] = d.deperdition_cap
    d["alerte"] = (d.deperdition_cap >= ALERT).astype(float).where(d.deperdition.notna())
    d["region_code"] = d.code.str[:4]
    g = d.groupby("code").deperdition_prec_cap
    d["deperdition_moy_passee"] = g.transform(lambda s: s.expanding().mean())
    d["volatilite"] = 1 + g.transform(lambda s: s.rolling(3, min_periods=2).std()).fillna(d.deperdition_prec_cap.std())
    return d


def _pipe(model):
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), model)


def make_model(name: str):
    return {
        "ridge": lambda: _pipe(RidgeCV(alphas=np.logspace(-2, 3, 30))),
        "huber": lambda: _pipe(HuberRegressor(epsilon=1.35, alpha=1.0, max_iter=5000)),
        "mediane": lambda: _pipe(QuantileRegressor(quantile=0.5, alpha=0.1, solver="highs")),
        "gbr": lambda: HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=200,
                                                     min_samples_leaf=10, random_state=SEED),
        "logit": lambda: _pipe(LogisticRegression(C=0.5, max_iter=5000)),
        "gbc": lambda: HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200,
                                                      min_samples_leaf=10, random_state=SEED),
    }[name]()


def fold_predictions(train: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    out = test[["code", "annee_scolaire", "region_code", "y", "alerte", "volatilite"]].copy()
    hist = train.groupby("code").y.mean()
    out["moyenne_historique"] = test.code.map(hist).fillna(train.y.mean())
    out["persistance"] = test.deperdition_prec_cap.fillna(out.moyenne_historique)
    Xtr, Xte = train[FEATURES], test[FEATURES]
    for name in LINEAR + ["gbr"]:
        out[name] = np.clip(make_model(name).fit(Xtr, train.y).predict(Xte), *Y_CAP)
    out["p_logit"] = make_model("logit").fit(Xtr, train.alerte).predict_proba(Xte)[:, 1]
    out["p_gbc"] = make_model("gbc").fit(Xtr, train.alerte).predict_proba(Xte)[:, 1]
    prev = train.deperdition_prec_cap >= ALERT
    out["p_persistance"] = np.where(test.deperdition_prec_cap >= ALERT, train.alerte[prev].mean(),
                                    train.alerte[~prev].mean())
    return out


def temporal_cv(d: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for T in TEMPORAL_TESTS:
        train = d[d.annee_scolaire.isin(TRAIN_YEARS) & (d.annee_scolaire < T)].dropna(subset=["y"])
        test = d[d.annee_scolaire == T].dropna(subset=["y"])
        parts.append(fold_predictions(train, test).assign(fold=T))
    return pd.concat(parts, ignore_index=True)


def spatial_cv(d: pd.DataFrame) -> pd.DataFrame:
    data = d[d.annee_scolaire.isin(TRAIN_YEARS)].dropna(subset=["y"])
    return pd.concat([fold_predictions(data[data.region_code != r], data[data.region_code == r]).assign(fold=r)
                      for r in sorted(data.region_code.unique())], ignore_index=True)


def mean_spearman(p: pd.DataFrame, col: str) -> float:
    vals = [spearmanr(g.y, g[col]).statistic for _, g in p.groupby("annee_scolaire")
            if g[col].nunique() > 1 and len(g) > 4]
    return float(np.nanmean(vals)) if vals else float("nan")


def metrics(p: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for name in NAIVE + LINEAR + ["gbr"]:
        rows.append({"modele": name, "type": "regression", "MAE": mean_absolute_error(p.y, p[name]),
                     "RMSE": float(np.sqrt(((p.y - p[name]) ** 2).mean())), "Spearman": mean_spearman(p, name)})
    c = p.dropna(subset=["alerte"])
    for name, col in [("persistance", "p_persistance"), ("logistique", "p_logit"), ("gbc", "p_gbc")]:
        rows.append({"modele": name, "type": "classification", "AUC": roc_auc_score(c.alerte, c[col]),
                     "PR_AUC": average_precision_score(c.alerte, c[col]), "Brier": brier_score_loss(c.alerte, c[col]),
                     "prevalence": float(c.alerte.mean())})
    return pd.DataFrame(rows)


def metrics_by_fold(p: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for f, g in p.groupby("fold"):
        r = {"pli": f, "n": len(g), "prevalence_alerte": float(g.alerte.mean())}
        for name in NAIVE + LINEAR + ["gbr"]:
            r[f"MAE_{name}"] = mean_absolute_error(g.y, g[name])
        if g.alerte.nunique() == 2:
            r["AUC_logistique"] = roc_auc_score(g.alerte, g.p_logit)
        rows.append(r)
    return pd.DataFrame(rows)


def select_model(m_t: pd.DataFrame, m_s: pd.DataFrame) -> dict:
    def val(m, k, col="MAE"):
        return float(m[(m.type == "regression") & (m.modele == k)][col].iloc[0])

    naive = {k: min(val(m, n) for n in NAIVE) for k, m in [("t", m_t), ("s", m_s)]}
    eligible = [k for k in LINEAR if val(m_t, k) < naive["t"] and val(m_s, k) < naive["s"]]
    best_lin = max(eligible, key=lambda k: val(m_t, k, "Spearman")) if eligible else None
    ref_lin = best_lin or min(LINEAR, key=lambda k: val(m_t, k))
    trees = all(val(m, "gbr") < 0.95 * min(naive[s], val(m, ref_lin)) for s, m in [("t", m_t), ("s", m_s)])
    chosen = "gbr" if trees else (best_lin or "moyenne_historique")
    return {"retenu": chosen, "lineaires_eligibles": eligible, "arbres_retenus": trees,
            "regle": "1) linéaire éligible s'il bat persistance et moyenne historique (MAE) en validation "
                     "temporelle et spatiale ; 2) parmi les éligibles, meilleure corrélation de rang temporelle ; "
                     "3) arbres retenus seulement s'ils font >= 5 % mieux que la meilleure référence et que le "
                     "linéaire dans les deux validations."}


def calibration(p: pd.DataFrame, col: str = "p_logit", bins: int = 5) -> pd.DataFrame:
    c = p.dropna(subset=[col, "alerte"]).copy()
    c["bin"] = pd.qcut(c[col].rank(method="first"), bins, labels=False)
    return c.groupby("bin").agg(proba_moyenne=(col, "mean"), frequence_observee=("alerte", "mean"),
                                n=("alerte", "size")).reset_index()


def conformal_q(p: pd.DataFrame, col: str, level: float) -> float:
    s = ((p.y - p[col]).abs() / p.volatilite).to_numpy()
    n = len(s)
    return float(np.quantile(s, min(1.0, np.ceil((n + 1) * level) / n)))


def coverage(p: pd.DataFrame, col: str, level: float) -> list[dict]:
    """Couverture honnête : quantile estimé sur les plis antérieurs, testé sur le pli suivant."""
    folds = sorted(p.fold.unique())
    out = []
    for i in range(1, len(folds)):
        cal, test = p[p.fold.isin(folds[:i])], p[p.fold == folds[i]]
        q = conformal_q(cal, col, level)
        ok = (test.y - test[col]).abs() <= q * test.volatilite
        out.append({"pli": folds[i], "niveau": level, "couverture": float(ok.mean())})
    return out


def linear_contributions(model, X: pd.DataFrame) -> pd.DataFrame:
    """Contribution additive de chaque variable : coefficient × valeur standardisée."""
    z = model[:-1].transform(X)
    return pd.DataFrame(z * model[-1].coef_, columns=FEATURES, index=X.index)


def predict_frame(d: pd.DataFrame, models: dict, chosen: str, quant: dict, oos: dict) -> pd.DataFrame:
    """Prédictions, intervalles conformes et facteurs, pour chaque unité et année de l'indice.

    Pour les années couvertes par la validation temporelle, la valeur publiée est la
    prédiction hors échantillon (modèle entraîné sur les seules années antérieures).
    """
    rows = d[d.annee_scolaire.isin(INDEX_YEARS)].copy()
    X = rows[FEATURES]
    for name in LINEAR + ["gbr"]:
        rows[f"pred_{name}"] = np.clip(models[name].predict(X), *Y_CAP)
    hist = models["train"].groupby("code").y.mean()
    rows["pred_moyenne_historique"] = rows.deperdition_moy_passee.fillna(rows.code.map(hist))
    rows["pred_persistance"] = rows.deperdition_prec_cap.fillna(rows.pred_moyenne_historique)
    rows["prediction"] = rows[f"pred_{chosen}"]
    rows["p_alerte"] = models["logit"].predict_proba(X)[:, 1]
    key = pd.MultiIndex.from_frame(rows[["code", "annee_scolaire"]])
    for target, src in [("prediction", "pred"), ("p_alerte", "p")]:
        vals = oos[src].reindex(key).to_numpy(dtype=float)
        has = ~np.isnan(vals)
        rows.loc[has, target] = vals[has]
        if target == "prediction":
            rows["hors_echantillon"] = has
    for lvl, q in quant.items():
        rows[f"ic{lvl}_bas"] = (rows.prediction - q * rows.volatilite).clip(*Y_CAP)
        rows[f"ic{lvl}_haut"] = (rows.prediction + q * rows.volatilite).clip(*Y_CAP)
    expl = chosen if chosen in LINEAR else "ridge"
    contrib = linear_contributions(models[expl], X)
    rows["facteurs_modele"] = contrib.apply(
        lambda r: " ; ".join(FEATURE_LABELS[c] for c in r.sort_values(ascending=False).index[:3] if r[c] > 0.25),
        axis=1)
    rows["rang_prediction"] = rows.groupby("annee_scolaire").prediction.rank(ascending=False, method="min")
    keep = ["code", "annee_scolaire", "y", "deperdition", "prediction", "hors_echantillon", "ic80_bas", "ic80_haut",
            "ic90_bas", "ic90_haut", "p_alerte", "rang_prediction", "facteurs_modele", "pred_persistance",
            "pred_moyenne_historique"] + [f"pred_{n}" for n in LINEAR + ["gbr"]]
    return rows[keep].reset_index(drop=True)


def region_predictions(preds_prov: pd.DataFrame, ind_prov: pd.DataFrame) -> pd.DataFrame:
    """Régions actuelles : moyenne des provinces pondérée par les effectifs de l'année t."""
    reg = communes()[["prov_code", "reg_code"]].drop_duplicates().set_index("prov_code").reg_code
    p = preds_prov.merge(ind_prov[["code", "annee_scolaire", "effectif"]], on=["code", "annee_scolaire"])
    p["reg"] = p.code.map(reg)
    p["w"] = p.effectif.fillna(0)
    cols = ["prediction", "ic80_bas", "ic80_haut", "ic90_bas", "ic90_haut", "p_alerte", "y"]
    rows = []
    for (r, yr), g in p.groupby(["reg", "annee_scolaire"]):
        w = g.w if g.w.sum() > 0 else pd.Series(1.0, index=g.index)
        rec = {"code": r, "annee_scolaire": yr, "hors_echantillon": bool(g.hors_echantillon.all())}
        for c in cols:
            ok = g[c].notna()
            rec[c] = float(np.average(g[c][ok], weights=w[ok])) if ok.any() and w[ok].sum() > 0 else np.nan
        rows.append(rec)
    out = pd.DataFrame(rows)
    out["rang_prediction"] = out.groupby("annee_scolaire").prediction.rank(ascending=False, method="min")
    return out


def run() -> dict:
    MDIR.mkdir(parents=True, exist_ok=True)
    d = model_frame(pd.read_csv(TABLES / "indicateurs_old_prov.csv", sep=";"))
    tcv, scv = temporal_cv(d), spatial_cv(d)
    m_t, m_s = metrics(tcv), metrics(scv)
    sel = select_model(m_t, m_s)
    chosen = sel["retenu"]
    tcv.to_csv(MDIR / "predictions_validation_temporelle.csv", sep=";", index=False)
    scv.to_csv(MDIR / "predictions_validation_spatiale.csv", sep=";", index=False)
    pd.concat([m_t.assign(validation="temporelle"), m_s.assign(validation="spatiale")]) \
        .to_csv(MDIR / "metriques.csv", sep=";", index=False)
    metrics_by_fold(tcv).to_csv(MDIR / "metriques_par_pli_temporel.csv", sep=";", index=False)
    calibration(tcv).to_csv(MDIR / "calibration_logistique.csv", sep=";", index=False)

    train = d[d.annee_scolaire.isin(TRAIN_YEARS)].dropna(subset=["y"])
    models = {n: make_model(n).fit(train[FEATURES], train.y) for n in LINEAR + ["gbr"]}
    models["logit"] = make_model("logit").fit(train[FEATURES], train.alerte)
    models["train"] = train
    col = chosen if chosen in tcv else "moyenne_historique"
    quant = {"80": conformal_q(tcv, col, 0.8), "90": conformal_q(tcv, col, 0.9)}
    oos = {"pred": tcv.set_index(["code", "annee_scolaire"])[col],
           "p": tcv.set_index(["code", "annee_scolaire"])["p_logit"]}
    model_name = chosen if chosen in models else "ridge"
    preds_old = predict_frame(d, models, model_name, quant, oos)
    preds_old.to_csv(MDIR / "predictions_provinces_anciennes.csv", sep=";", index=False)

    # Découpage actuel : variables recalculées sur les 47 provinces, mêmes coefficients. Les
    # prédictions hors échantillon des anciennes provinces sont reportées sur les provinces qui
    # en sont issues (identiques pour 43 provinces, réparties pour Soum et Tapoa).
    ind_new = pd.read_csv(TABLES / "indicateurs_prov.csv", sep=";")
    dn = model_frame(ind_new)
    cw = communes()[["old_prov_code", "prov_code"]].drop_duplicates()
    oos_new = {}
    for k, s in oos.items():
        f = s.rename("v").rename_axis(["old_prov_code", "annee_scolaire"]).reset_index().merge(cw, on="old_prov_code")
        oos_new[k] = f.groupby(["prov_code", "annee_scolaire"]).v.mean().rename_axis(["code", "annee_scolaire"])
    preds_new = predict_frame(dn, models, model_name, quant, oos_new)
    preds_new.to_csv(MDIR / "predictions_provinces_actuelles.csv", sep=";", index=False)
    region_predictions(preds_new, ind_new).to_csv(MDIR / "predictions_regions_actuelles.csv", sep=";", index=False)

    # Importance par permutation (dernier pli temporel, modèle retenu) et coefficients.
    T = TEMPORAL_TESTS[-1]
    tr = d[d.annee_scolaire.isin(TRAIN_YEARS) & (d.annee_scolaire < T)].dropna(subset=["y"])
    te = d[d.annee_scolaire == T].dropna(subset=["y"])
    pi = permutation_importance(make_model(model_name).fit(tr[FEATURES], tr.y), te[FEATURES], te.y,
                                scoring="neg_mean_absolute_error", n_repeats=50, random_state=SEED)
    coef = models[model_name][-1].coef_ if model_name in LINEAR else np.full(len(FEATURES), np.nan)
    pd.DataFrame({"variable": FEATURES, "libelle": [FEATURE_LABELS[f] for f in FEATURES],
                  "coefficient_standardise": coef, "importance_permutation_mae": pi.importances_mean,
                  "importance_permutation_sd": pi.importances_std}) \
        .sort_values("importance_permutation_mae", ascending=False) \
        .to_csv(MDIR / "importance_variables.csv", sep=";", index=False)

    summary = {
        "cible": "déperdition apparente CP1-CM1 de la cohorte t -> t+1, plafonnée à [0 ; 60] %",
        "seuil_alerte": ALERT, "annees_entrainement": TRAIN_YEARS, "plis_temporels": TEMPORAL_TESTS,
        "n_observations": int(len(train)), "n_provinces": int(train.code.nunique()), "selection": sel,
        "metriques_temporelles": m_t.round(4).to_dict(orient="records"),
        "metriques_spatiales": m_s.round(4).to_dict(orient="records"),
        "conformal": {"q80": quant["80"], "q90": quant["90"],
                      "couverture": coverage(tcv, col, 0.8) + coverage(tcv, col, 0.9)},
        "annee_prediction": PREDICT_YEAR, "graine": SEED,
    }
    (MDIR / "resume_modele.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


if __name__ == "__main__":
    s = run()
    print(json.dumps(s["selection"], indent=2, ensure_ascii=False))
    print(pd.DataFrame(s["metriques_temporelles"]).round(3).to_string())
    print(pd.DataFrame(s["metriques_spatiales"]).round(3).to_string())
    print(json.dumps(s["conformal"], indent=2))

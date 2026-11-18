"""Indice composite de risque de décrochage (situation observée de l'année t).

12 indicateurs regroupés en 5 dimensions, normalisés par rang centile dans l'année (robuste
aux valeurs extrêmes), orientés pour que 1 = risque élevé, moyennés par dimension puis
pondérés à parts égales (20 % par dimension). Variantes : pondération ACP (1re composante)
et pondération entropique. Sensibilité : 2 000 tirages de Dirichlet des poids des
dimensions, d'où un intervalle de rang [p05 ; p95] et la probabilité d'être dans le
quintile supérieur. Classes : quintiles de l'indice dans l'année (5 niveaux).
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from pipeline.config import OUTPUTS_DIR

SEED = 42
TABLES = OUTPUTS_DIR / "tables"
MDIR = OUTPUTS_DIR / "model"
Y_CAP = (0.0, 60.0)
INDEX_YEARS = [f"{y}-{y + 1}" for y in range(2017, 2025)]

DIMENSIONS = {
    "parcours": [("deperdition_prec_cap", +1), ("redoublement_global_prec", +1), ("survie_cm2_prec_cap", -1)],
    "acces": [("tap", -1), ("tbs", -1)],
    "choc": [("baisse_effectif_pic", -1), ("baisse_ecoles_pic", -1)],
    "accueil": [("ratio_eleves_maitre", +1), ("ratio_eleves_salle", +1)],
    "vulnerabilite": [("pauvrete", +1), ("ecart_parite", +1), ("part_rurale", +1)],
}
DIM_LABELS = {"parcours": "Parcours scolaire", "acces": "Accès et achèvement", "choc": "Choc sécuritaire",
              "accueil": "Conditions d'accueil", "vulnerabilite": "Vulnérabilité socio-économique"}
IND_LABELS = {
    "deperdition_prec_cap": "déperdition de la cohorte précédente", "redoublement_global_prec": "redoublement",
    "survie_cm2_prec_cap": "faible survie jusqu'au CM2", "tap": "faible achèvement", "tbs": "faible scolarisation",
    "baisse_effectif_pic": "perte d'élèves depuis le pic", "baisse_ecoles_pic": "écoles fermées depuis le pic",
    "ratio_eleves_maitre": "élèves par maître", "ratio_eleves_salle": "élèves par salle",
    "pauvrete": "pauvreté", "ecart_parite": "écart filles-garçons", "part_rurale": "ruralité",
}
CLASS_LABELS = ["Très faible", "Faible", "Modéré", "Élevé", "Très élevé"]


def prepare(ind: pd.DataFrame) -> pd.DataFrame:
    d = ind.copy()
    d["deperdition_cap"] = d.deperdition.clip(*Y_CAP)
    d["deperdition_prec_cap"] = d.deperdition_prec.clip(*Y_CAP)
    d["survie_cm2_prec_cap"] = d.survie_cm2_prec.clip(0, 100)
    d["ecart_parite"] = (1 - d.ips_tbs).abs()
    return d


def oriented_ranks(d: pd.DataFrame) -> pd.DataFrame:
    """Rang centile par année (0-1), orienté : 1 = situation la plus à risque."""
    out = pd.DataFrame(index=d.index)
    for items in DIMENSIONS.values():
        for col, sign in items:
            r = d.groupby("annee_scolaire")[col].rank(pct=True, method="average")
            n = d.groupby("annee_scolaire")[col].transform("count")
            out[col] = r if sign > 0 else 1 - r + 1 / n
    return out.clip(0, 1)


def dimension_scores(ranks: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({dim: ranks[[c for c, _ in items]].mean(axis=1) for dim, items in DIMENSIONS.items()})


def composite(dims: pd.DataFrame, dim_weights: dict[str, float]) -> pd.Series:
    """Moyenne pondérée des dimensions renseignées (une dimension manquante n'est pas comptée à 0)."""
    w = pd.Series(dim_weights)
    wm = dims.notna().mul(w, axis=1)
    return 100 * (dims.fillna(0).mul(w, axis=1).sum(axis=1) / wm.sum(axis=1))


def indicator_weight_variants(ranks: pd.DataFrame) -> dict:
    """Pondérations alternatives au niveau des indicateurs : ACP (1re composante) et entropie."""
    cols = list(ranks.columns)
    x = ranks[cols].apply(lambda s: s.fillna(s.median()))
    z = (x - x.mean()) / x.std(ddof=0)
    vals, vecs = np.linalg.eigh(np.cov(z.to_numpy().T))
    pc1 = np.abs(vecs[:, -1])
    pca_w = pd.Series(pc1 ** 2 / (pc1 ** 2).sum(), index=cols)
    p = x / x.sum()
    ent = -(1 / np.log(len(x))) * (p * np.log(p.where(p > 0, 1))).sum()
    div = 1 - ent
    return {"acp": pca_w, "entropie": div / div.sum(), "explained_pc1": float(vals[-1] / vals.sum())}


def build_index(ind: pd.DataFrame, n_draws: int = 2000) -> tuple[pd.DataFrame, dict]:
    d = prepare(ind[ind.annee_scolaire.isin(INDEX_YEARS)].reset_index(drop=True))
    ranks = oriented_ranks(d)
    dims = dimension_scores(ranks)
    equal = {k: 1 / len(DIMENSIONS) for k in DIMENSIONS}
    d["indice"] = composite(dims, equal)
    for dim in DIMENSIONS:
        d[f"dim_{dim}"] = 100 * dims[dim]
    variants = indicator_weight_variants(ranks)
    for name in ["acp", "entropie"]:
        w = variants[name]
        d[f"indice_{name}"] = 100 * ranks[w.index].fillna(ranks[w.index].median()).mul(w).sum(axis=1)
    d["classe"] = d.groupby("annee_scolaire").indice.transform(
        lambda s: pd.qcut(s.rank(method="first"), 5, labels=False) + 1).astype(int)
    d["classe_label"] = d.classe.map(lambda k: CLASS_LABELS[k - 1])
    d["rang"] = d.groupby("annee_scolaire").indice.rank(ascending=False, method="min").astype(int)
    # Facteurs dominants : contribution (rang orienté - 0,5) × poids de l'indicateur.
    iw = {c: equal[dim] / len(items) for dim, items in DIMENSIONS.items() for c, _ in items}
    contrib = (ranks - 0.5).mul(pd.Series(iw))
    d["facteurs"] = contrib.apply(
        lambda r: " ; ".join(IND_LABELS[c] for c in r.dropna().sort_values(ascending=False).index[:3] if r[c] > 0),
        axis=1)
    d["dimension_dominante"] = dims.idxmax(axis=1)
    # Sensibilité aux poids des dimensions.
    rng = np.random.default_rng(SEED)
    sims = pd.concat([composite(dims, dict(zip(DIMENSIONS, w))).groupby(d.annee_scolaire)
                      .rank(ascending=False, method="min")
                      for w in rng.dirichlet(np.ones(len(DIMENSIONS)), size=n_draws)], axis=1)
    d["rang_p05"] = sims.quantile(0.05, axis=1).round().astype(int)
    d["rang_p95"] = sims.quantile(0.95, axis=1).round().astype(int)
    top_k = np.ceil(d.groupby("annee_scolaire").code.transform("count") / 5)
    d["proba_quintile_superieur"] = sims.le(top_k.to_numpy()[:, None]).mean(axis=1).round(3)
    rho = {name: float(spearmanr(d.indice, d[f"indice_{name}"]).statistic) for name in ["acp", "entropie"]}
    meta = {"poids_dimensions": equal, "poids_acp": variants["acp"].round(4).to_dict(),
            "poids_entropie": variants["entropie"].round(4).to_dict(),
            "variance_pc1": round(variants["explained_pc1"], 3), "spearman_variantes": rho,
            "rang_moyen_largeur_p05_p95": float((d.rang_p95 - d.rang_p05).mean())}
    return d, meta


def run() -> dict:
    MDIR.mkdir(parents=True, exist_ok=True)
    out = {}
    for target in ["prov", "reg", "old_prov"]:
        ind = pd.read_csv(TABLES / f"indicateurs_{target}.csv", sep=";")
        idx, meta = build_index(ind)
        idx.to_csv(MDIR / f"indice_{target}.csv", sep=";", index=False)
        out[target] = meta
    (MDIR / "indice_meta.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


if __name__ == "__main__":
    print(json.dumps(run()["prov"], indent=2, ensure_ascii=False))

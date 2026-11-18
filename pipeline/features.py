"""Variables : base additive par ancienne province, agrégation vers toute géographie, indicateurs.

1. `build_base` : pour chacune des 45 anciennes provinces et chaque année, des grandeurs
   additives (effectifs et redoublants par classe et sexe, écoles, salles, maîtres,
   populations scolarisables, nouveaux inscrits, PDI, population et nombre de pauvres 2019).
2. `aggregate` : ces grandeurs sont sommées vers une géographie cible (provinces et régions
   actuelles, anciennes régions, national) avec un poids par couple (ancienne province,
   unité cible). Le poids vaut 1 sauf pour le Soum et la Tapoa, scindés par la réforme de
   2025 : leurs grandeurs sont réparties au prorata de la population 2019 des communes.
   Une somme n'est calculée que si toutes les provinces membres sont renseignées.
3. `compute_indicators` : indicateurs calculés sur les grandeurs agrégées (jamais de moyenne
   de taux), dont les taux de flux de la cohorte reconstituée (UNESCO-ISU) :

    promotion    p(c,t) = (E(c+1,t+1) - R(c+1,t+1)) / E(c,t)      c = CP1..CM1
    redoublement r(c,t) = R(c,t+1) / E(c,t)                       c = CP1..CM2
    abandon      a(c,t) = 1 - p(c,t) - r(c,t)
    déperdition apparente CP1-CM1 : 1 - Σc [E(c+1,t+1) - R(c+1,t+1) + R(c,t+1)] / Σc E(c,t)
    survie au CM2 : Π_c p(c,t) / (1 - r(c,t))

   Ces taux sont attribués à l'année t (cohorte t -> t+1). À l'échelle d'une province, la
   déperdition apparente inclut les abandons, les départs nets vers d'autres provinces et les
   élèves d'écoles fermées ; elle n'est pas bornée (valeur négative = gain net d'élèves).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.config import OUTPUTS_DIR
from pipeline.extract_annuaires import CLASSES
from pipeline.extract_context import commune_population_weights
from pipeline.geo import communes, crosswalk

YEARS = [f"{y}-{y + 1}" for y in range(2014, 2025)]
SEX = ["G", "F", "T"]
TABLES = OUTPUTS_DIR / "tables"


def next_year(y: str) -> str:
    a = int(y[:4]) + 1
    return f"{a}-{a + 1}"


def prev_year(y: str) -> str:
    a = int(y[:4]) - 1
    return f"{a}-{a + 1}"


def canonical(tidy: pd.DataFrame) -> pd.DataFrame:
    """Une valeur par clé : celle de l'édition la plus récente (dernière révision publiée)."""
    keys = ["table", "annee_scolaire", "niveau", "code", "indicateur", "classe", "sexe", "milieu", "statut"]
    return tidy.sort_values("edition").drop_duplicates(keys, keep="last")


# --------------------------------------------------------------------------- base additive

def build_base(tidy: pd.DataFrame) -> pd.DataFrame:
    """Grandeurs additives par ancienne province et année (index : code, annee_scolaire)."""
    c = canonical(tidy)
    c = c[c.niveau == "province"]
    parts = []
    h = c[c.table == "historique"]
    for ind, pfx in [("effectif", "E"), ("redoublants", "R")]:
        d = h[h.indicateur == ind]
        w = d.pivot_table(index=["code", "annee_scolaire"], columns=["classe", "sexe"], values="valeur", aggfunc="first")
        w.columns = [f"{pfx}_{cl}_{s}" for cl, s in w.columns]
        parts.append(w)

    def take(table, ind, name, **kw):
        d = c[(c.table == table) & (c.indicateur == ind)]
        for k, v in kw.items():
            d = d[d[k] == v]
        return d.set_index(["code", "annee_scolaire"]).valeur.rename(name)

    cols = [
        take("ecoles", "eleves", "eleves", statut="ALL"),
        take("ecoles", "eleves", "eleves_prive", statut="PRIVE"),
        take("ecoles", "ecoles", "ecoles", statut="ALL"),
        take("ecoles", "ecoles", "ecoles_publiques", statut="PUBLIC"),
        take("ecoles", "ecoles", "ecoles_privees", statut="PRIVE"),
        take("ecoles", "salles", "salles", statut="ALL"),
        take("ecoles", "maitres", "maitres", statut="ALL"),
        take("eleves_milieu", "eleves", "eleves_urbain", milieu="U", sexe="T"),
        take("eleves_milieu", "eleves", "eleves_rural", milieu="R", sexe="T"),
        take("tba", "pop_6ans", "pop_6ans", sexe="T"),
        take("tba", "nouveaux_cp1", "nouveaux_cp1", sexe="T"),
        take("tns", "eleves_6_11", "eleves_6_11", sexe="T"),
    ]
    for s in SEX:
        cols += [take("tbs", "pop_6_11", f"pop_6_11_{s}", sexe=s), take("tbs", "eleves", f"eleves_tbs_{s}", sexe=s),
                 take("tap", "pop_11ans", f"pop_11ans_{s}", sexe=s), take("tap", "nouveaux_cm2", f"nouveaux_cm2_{s}", sexe=s)]
    base = pd.concat(parts + cols, axis=1)
    base.index.names = ["code", "annee_scolaire"]
    base = base.reset_index()
    base = base[base.annee_scolaire.isin(YEARS)]

    # Province absente du tableau I.1/I.2 alors que l'historique indique 0 élève : toutes les
    # écoles étaient fermées (Komandjari 2022-2023). Valeurs mises à 0 et signalées (D-013).
    i1 = ["eleves", "eleves_prive", "ecoles", "ecoles_publiques", "ecoles_privees", "salles", "maitres",
          "eleves_urbain", "eleves_rural"]
    closed = base.E_ALL_T.eq(0) & base[i1].isna().all(axis=1)
    base.loc[closed, i1] = 0.0
    base["flag_fermeture_totale"] = closed

    # Taux d'abandon publiés nuls (artefact du calcul résiduel), cohorte t, CP1-CM1, total.
    pub = c[(c.table == "flux") & (c.indicateur == "taux_abandon") & (c.sexe == "T")]
    nuls = pub.groupby(["code", "annee_scolaire"]).valeur.apply(lambda s: int((s == 0).sum())).rename("abandon_publie_nuls")
    base = base.merge(nuls.reset_index(), on=["code", "annee_scolaire"], how="left")

    # Pauvreté 2019 (statique) et PDI (2018-19 à 2022-23).
    pov = pd.read_csv(TABLES / "pauvrete_provinces_anciennes.csv", sep=";")
    pov["pauvres_2019"] = pov.pauvrete_incidence / 100 * pov.population_2019
    pov["ecart_pauvrete_2019"] = pov.pauvrete_profondeur / 100 * pov.population_2019
    base = base.merge(pov[["old_prov_code", "population_2019", "pauvres_2019", "ecart_pauvrete_2019"]]
                      .rename(columns={"old_prov_code": "code"}), on="code", how="left")
    pdi = pd.read_csv(TABLES / "pdi_communes_annee_scolaire.csv", sep=";")
    pdi = pdi.groupby(["old_prov_code", "annee_scolaire"], as_index=False)[["pdi", "pdi_enfants"]].sum()
    base = base.merge(pdi.rename(columns={"old_prov_code": "code"}), on=["code", "annee_scolaire"], how="left")
    # Avant le premier enregistrement (janvier 2019), absence de PDI recensés : NaN conservé.
    return base.sort_values(["code", "annee_scolaire"]).reset_index(drop=True)


ADDITIVE_EXCLUDE = {"code", "annee_scolaire", "flag_fermeture_totale", "abandon_publie_nuls"}


def mapping(target: str) -> pd.DataFrame:
    """Table (code ancien, unité cible, poids) pour une géographie cible."""
    c = communes()
    if target == "old_prov":
        m = c[["old_prov_code"]].drop_duplicates().assign(unit=lambda d: d.old_prov_code, weight=1.0)
    elif target == "old_reg":
        m = c[["old_prov_code", "old_reg_code"]].drop_duplicates().rename(columns={"old_reg_code": "unit"}).assign(weight=1.0)
    elif target == "national":
        m = c[["old_prov_code"]].drop_duplicates().assign(unit="BF", weight=1.0)
    elif target in ("prov", "reg"):
        cw = crosswalk(commune_population_weights())
        col = "prov_code" if target == "prov" else "reg_code"
        m = cw.groupby(["old_prov_code", col], as_index=False).weight.sum().rename(columns={col: "unit"})
    else:
        raise ValueError(target)
    return m.rename(columns={"old_prov_code": "code"})[["code", "unit", "weight"]]


def aggregate(base: pd.DataFrame, target: str) -> pd.DataFrame:
    m = mapping(target)
    num = [c for c in base.columns if c not in ADDITIVE_EXCLUDE]
    d = base.merge(m, on="code")
    for col in num:
        d[col] = d[col] * d["weight"]
    n_members = m.groupby("unit").code.nunique()
    g = d.groupby(["unit", "annee_scolaire"])
    out = g[num].sum(min_count=1)
    counts = g[num].count()
    # Somme complète uniquement : sinon NaN (pas de total partiel silencieux).
    required = out.index.get_level_values("unit").map(n_members).to_numpy()[:, None]
    out = out.where(counts.to_numpy() >= required)
    out["abandon_publie_nuls"] = g["abandon_publie_nuls"].sum(min_count=1)
    out["flag_fermeture_totale"] = g["flag_fermeture_totale"].any()
    out["split_estime"] = g["weight"].apply(lambda w: bool((w < 0.999).any()))
    out = out.reset_index().rename(columns={"unit": "code"})
    return out


# --------------------------------------------------------------------------- indicateurs

def _ratio(a, b, scale=1.0):
    with np.errstate(divide="ignore", invalid="ignore"):
        r = scale * a / b
    return r.where(b > 0)


def compute_indicators(agg: pd.DataFrame) -> pd.DataFrame:
    d = agg.sort_values(["code", "annee_scolaire"]).reset_index(drop=True)
    nxt = d.copy()
    nxt["annee_scolaire"] = nxt.annee_scolaire.map(prev_year)  # valeurs de t+1 rangées sur t
    nxt = nxt.set_index(["code", "annee_scolaire"])
    cur = d.set_index(["code", "annee_scolaire"])
    n1 = nxt.reindex(cur.index)
    out = pd.DataFrame(index=cur.index)

    for s, suf in [("T", ""), ("F", "_f"), ("G", "_g")]:
        retained, den = 0.0, 0.0
        surv = pd.Series(1.0, index=cur.index)
        for i, cl in enumerate(CLASSES):
            e = cur[f"E_{cl}_{s}"]
            red = _ratio(n1[f"R_{cl}_{s}"], e)
            if s == "T":
                out[f"red_{cl}"] = 100 * red
            if cl == "CM2":
                continue
            nc = CLASSES[i + 1]
            prom = _ratio(n1[f"E_{nc}_{s}"] - n1[f"R_{nc}_{s}"], e)
            if s == "T":
                out[f"prom_{cl}"] = 100 * prom
                out[f"aban_{cl}"] = 100 * (1 - prom - red)
            retained = retained + (n1[f"E_{nc}_{s}"] - n1[f"R_{nc}_{s}"]) + n1[f"R_{cl}_{s}"]
            den = den + e
            surv = surv * (prom / (1 - red)).where(red < 1)
        out[f"deperdition{suf}"] = 100 * (1 - _ratio(retained, den))
        out[f"survie_cm2{suf}"] = 100 * surv
    out["redoublement_global"] = 100 * _ratio(sum(n1[f"R_{cl}_T"] for cl in CLASSES), cur["E_ALL_T"])

    out["effectif"] = cur["E_ALL_T"]
    out["effectif_filles"] = cur["E_ALL_F"]
    out["part_filles"] = _ratio(cur["E_ALL_F"], cur["E_ALL_T"], 100)
    for col in ["eleves", "ecoles", "ecoles_publiques", "ecoles_privees", "salles", "maitres", "pop_6_11_T",
                "pop_11ans_T", "population_2019", "pdi", "pdi_enfants"]:
        out[col.replace("_T", "")] = cur[col]
    out["ratio_eleves_maitre"] = _ratio(cur.eleves, cur.maitres)
    out["ratio_eleves_salle"] = _ratio(cur.eleves, cur.salles)
    out["part_prive"] = _ratio(cur.eleves_prive, cur.eleves, 100)
    out["part_rurale"] = _ratio(cur.eleves_rural, cur.eleves_rural + cur.eleves_urbain, 100)
    out["tba"] = _ratio(cur.nouveaux_cp1, cur.pop_6ans, 100)
    out["tns"] = _ratio(cur.eleves_6_11, cur.pop_6_11_T, 100)
    for s, suf in [("T", ""), ("F", "_f"), ("G", "_g")]:
        out[f"tbs{suf}"] = _ratio(cur[f"eleves_tbs_{s}"], cur[f"pop_6_11_{s}"], 100)
        out[f"tap{suf}"] = _ratio(cur[f"nouveaux_cm2_{s}"], cur[f"pop_11ans_{s}"], 100)
    out["ips_tbs"] = _ratio(out.tbs_f, out.tbs_g)
    out["ips_tap"] = _ratio(out.tap_f, out.tap_g)
    out["pauvrete"] = _ratio(cur.pauvres_2019, cur.population_2019, 100)
    out["pauvrete_profondeur"] = _ratio(cur.ecart_pauvrete_2019, cur.population_2019, 100)
    out["pdi_pct_pop"] = _ratio(cur.pdi, cur.population_2019, 100)
    out["abandon_publie_nuls"] = cur.abandon_publie_nuls
    out["flag_fermeture_totale"] = cur.flag_fermeture_totale
    out["split_estime"] = cur.split_estime
    out = out.reset_index()

    g = out.groupby("code")
    out["var_effectif_1an"] = 100 * (out.effectif / g.effectif.shift(1) - 1)
    out["baisse_effectif_pic"] = 100 * (out.effectif / g.effectif.cummax() - 1)
    out["var_ecoles_1an"] = 100 * (out.ecoles / g.ecoles.shift(1) - 1)
    out["baisse_ecoles_pic"] = 100 * (out.ecoles / g.ecoles.cummax() - 1)
    # Déperdition et survie de la cohorte précédente (t-1 -> t), connues à la fin de l'année t.
    for col in ["deperdition", "deperdition_f", "deperdition_g", "survie_cm2", "redoublement_global"]:
        out[f"{col}_prec"] = g[col].shift(1)
    return out


def quality_score(ind: pd.DataFrame) -> pd.DataFrame:
    """Score de qualité des données (0-100) et motifs, par unité et année."""
    score = pd.Series(100.0, index=ind.index)
    reasons = [[] for _ in range(len(ind))]

    def penalize(mask, pts, label):
        nonlocal score
        mask = mask.fillna(False).to_numpy()
        score = score - pts * mask
        for i in np.where(mask)[0]:
            reasons[i].append(label)

    penalize(ind.split_estime, 15, "province scindée en 2025 : valeurs réparties au prorata de la population")
    penalize((ind.tbs > 100) | (ind.tap > 100), 10, "taux > 100 % : dénominateur RGPH 2019 peu fiable")
    penalize(ind.var_effectif_1an.abs() > 30, 20, "variation des effectifs > 30 % en un an : taux de flux instables")
    penalize(ind.abandon_publie_nuls >= 5, 10, "nombreux taux d'abandon publiés à 0,0 (calcul résiduel)")
    penalize(ind.effectif < 10000, 10, "petit effectif (< 10 000 élèves) : taux volatils")
    penalize(ind.flag_fermeture_totale, 30, "aucune école en activité (fermeture totale)")
    penalize(ind.eleves.isna(), 20, "tableau des écoles non disponible")
    out = ind[["code", "annee_scolaire"]].copy()
    out["qualite_score"] = score.clip(0, 100)
    out["qualite_niveau"] = pd.cut(out.qualite_score, [-1, 59, 79, 100], labels=["fragile", "moyenne", "bonne"]).astype(str)
    out["qualite_motifs"] = [" ; ".join(r) for r in reasons]
    return out


def exact_split_poverty(ind: pd.DataFrame) -> pd.DataFrame:
    """Provinces actuelles issues d'une scission : pauvreté exacte (agrégation des communes 2019)."""
    pov = pd.read_csv(TABLES / "pauvrete_provinces_actuelles.csv", sep=";").set_index("prov_code")
    split = ind.split_estime.fillna(False).astype(bool) & ind.code.isin(pov.index)
    ind.loc[split, "pauvrete"] = ind.loc[split, "code"].map(pov.pauvrete_incidence)
    ind.loc[split, "pauvrete_profondeur"] = ind.loc[split, "code"].map(pov.pauvrete_profondeur)
    ind.loc[split, "population_2019"] = ind.loc[split, "code"].map(pov.population_2019)
    return ind


def build_all(tidy: pd.DataFrame) -> dict[str, pd.DataFrame]:
    base = build_base(tidy)
    res = {"base": base}
    for target in ["old_prov", "old_reg", "prov", "reg", "national"]:
        ind = compute_indicators(aggregate(base, target))
        if target == "prov":
            ind = exact_split_poverty(ind)
        ind = ind.merge(quality_score(ind), on=["code", "annee_scolaire"])
        res[target] = ind
    return res


def compare_published(tidy: pd.DataFrame, ind_old_prov: pd.DataFrame) -> pd.DataFrame:
    """Taux publiés (I.7, cohorte t) contre taux reconstitués, provinces, G+F."""
    c = canonical(tidy)
    pub = c[(c.table == "flux") & (c.niveau == "province") & (c.sexe == "T")]
    pref = {"taux_promotion": "prom", "taux_redoublement": "red", "taux_abandon": "aban"}
    rec = ind_old_prov.set_index(["code", "annee_scolaire"])
    rows = []
    for r in pub.itertuples(index=False):
        col = f"{pref[r.indicateur]}_{r.classe}"
        key = (r.code, r.annee_scolaire)
        if key in rec.index and col in rec.columns:
            rows.append({"code": r.code, "annee_scolaire": r.annee_scolaire, "indicateur": r.indicateur,
                         "classe": r.classe, "publie": r.valeur, "reconstitue": rec.loc[key, col]})
    d = pd.DataFrame(rows)
    d["ecart"] = d.reconstitue - d.publie
    return d


def run(tidy: pd.DataFrame | None = None) -> dict[str, pd.DataFrame]:
    if tidy is None:
        tidy = pd.read_csv(TABLES / "annuaires_primaire_tidy.csv", sep=";", dtype={"code": str})
    res = build_all(tidy)
    res["base"].to_csv(TABLES / "base_additive_provinces_anciennes.csv", sep=";", index=False)
    for target, ind in res.items():
        if target != "base":
            ind.to_csv(TABLES / f"indicateurs_{target}.csv", sep=";", index=False)
    compare_published(tidy, res["old_prov"]).to_csv(TABLES / "comparaison_taux_publies_reconstitues.csv",
                                                    sep=";", index=False)
    return res


if __name__ == "__main__":
    r = run()
    n = r["national"]
    print(n[["annee_scolaire", "effectif", "eleves", "ecoles", "tbs", "tap", "deperdition", "survie_cm2"]].round(1).to_string())
    print(r["prov"].groupby("annee_scolaire").code.nunique().to_string())

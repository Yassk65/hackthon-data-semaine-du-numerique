"""Contrôles d'intégrité et rapport de qualité.

- valeurs de contrôle de l'annuaire 2023-2024 (cahier des charges) ;
- somme des provinces = total région publié = total national publié (grandeurs additives) ;
- cohérence taux / numérateur / dénominateur (TBA, TBS, TNS, TAP) ;
- promotion + redoublement + abandon = 100 (tableau I.7) ;
- cohérence des historiques entre éditions ;
- taux reconstitués contre taux publiés.
"""

from __future__ import annotations

import json

import pandas as pd

from pipeline.config import OUTPUTS_DIR

TABLES = OUTPUTS_DIR / "tables"
QDIR = OUTPUTS_DIR / "quality"

# (description, table, niveau, code, indicateur, sexe, milieu, statut, attendu, tolérance)
CONTROL_VALUES_2023_24 = [
    ("Élèves, national", "tbs", "national", "BF", "eleves", "T", "ALL", "ALL", 3067940, 0),
    ("Filles, national", "tbs", "national", "BF", "eleves", "F", "ALL", "ALL", 1532444, 0),
    ("TBS national", "tbs", "national", "BF", "tbs", "T", "ALL", "ALL", 78.2, 0.05),
    ("TNS national", "tns", "national", "BF", "tns", "T", "ALL", "ALL", 65.8, 0.05),
    ("TBA national", "tba", "national", "BF", "tba", "T", "ALL", "ALL", 100.5, 0.05),
    ("Écoles, national", "ecoles", "national", "BF", "ecoles", "T", "ALL", "ALL", 13558, 0),
    ("Écoles publiques, national", "ecoles", "national", "BF", "ecoles", "T", "ALL", "PUBLIC", 9045, 0),
    ("Écoles privées, national", "ecoles", "national", "BF", "ecoles", "T", "ALL", "PRIVE", 4513, 0),
    ("Achèvement national", "tap", "national", "BF", "tap", "T", "ALL", "ALL", 54.5, 0.05),
    ("Achèvement national garçons", "tap", "national", "BF", "tap", "G", "ALL", "ALL", 49.3, 0.05),
    ("Achèvement national filles", "tap", "national", "BF", "tap", "F", "ALL", "ALL", 59.9, 0.05),
    ("Élèves, Centre (Kadiogo)", "tbs", "province", "BF1300", "eleves", "T", "ALL", "ALL", 579084, 0),
    ("TBS, Centre (Kadiogo)", "tbs", "region", "BF13", "tbs", "T", "ALL", "ALL", 119.3, 0.05),
    ("Élèves, Sahel", "tbs", "region", "BF56", "eleves", "T", "ALL", "ALL", 56450, 0),
    ("TBS, Sahel", "tbs", "region", "BF56", "tbs", "T", "ALL", "ALL", 26.7, 0.05),
    ("Achèvement, Sahel", "tap", "region", "BF56", "tap", "T", "ALL", "ALL", 9.6, 0.05),
    ("Achèvement, Yagha", "tap", "province", "BF5604", "tap", "T", "ALL", "ALL", 3.0, 0.05),
    ("TBS, Est", "tbs", "region", "BF52", "tbs", "T", "ALL", "ALL", 28.4, 0.05),
    ("Élèves, Boucle du Mouhoun", "tbs", "region", "BF46", "eleves", "T", "ALL", "ALL", 197140, 0),
]

ADDITIVE = {
    "ecoles": ["ecoles", "salles", "groupes_pedagogiques", "maitres", "eleves"],
    "eleves_milieu": ["eleves"],
    "tba": ["pop_6ans", "nouveaux_cp1"],
    "tbs": ["pop_6_11", "eleves"],
    "tns": ["pop_6_11", "eleves_6_11"],
    "tap": ["pop_11ans", "nouveaux_cm2"],
    "historique": ["effectif", "redoublants"],
}
RATES = {"tba": ("nouveaux_cp1", "pop_6ans", "tba"), "tbs": ("eleves", "pop_6_11", "tbs"),
         "tns": ("eleves_6_11", "pop_6_11", "tns"), "tap": ("nouveaux_cm2", "pop_11ans", "tap")}


def load_tidy() -> pd.DataFrame:
    return pd.read_csv(TABLES / "annuaires_primaire_tidy.csv", sep=";", dtype={"code": str})


def control_values(tidy: pd.DataFrame) -> pd.DataFrame:
    d = tidy[tidy.edition == "2023-2024"]
    rows = []
    for desc, table, niveau, code, ind, sexe, milieu, statut, expected, tol in CONTROL_VALUES_2023_24:
        m = d[(d.table == table) & (d.niveau == niveau) & (d.code == code) & (d.indicateur == ind)
              & (d.sexe == sexe) & (d.milieu == milieu) & (d.statut == statut)]
        got = m.valeur.iloc[0] if len(m) == 1 else None
        rows.append({"controle": desc, "attendu": expected, "obtenu": got,
                     "ok": got is not None and abs(got - expected) <= tol,
                     "source": m.source.iloc[0] if len(m) == 1 else "", "page": m.page.iloc[0] if len(m) == 1 else None,
                     "ligne": m.ligne.iloc[0] if len(m) == 1 else None})
    return pd.DataFrame(rows)


def sum_checks(tidy: pd.DataFrame) -> pd.DataFrame:
    """Somme des provinces contre le total région et le total national publiés."""
    out = []
    for table, inds in ADDITIVE.items():
        d = tidy[(tidy.table == table) & tidy.indicateur.isin(inds)]
        keys = ["edition", "annee_scolaire", "indicateur", "classe", "sexe", "milieu", "statut"]
        prov = d[d.niveau == "province"].copy()
        prov["region_code"] = prov.code.str[:4]
        s_reg = prov.groupby(keys + ["region_code"]).valeur.sum().rename("somme_provinces")
        reg = d[d.niveau == "region"].set_index(keys + ["code"]).valeur.rename("publie")
        reg.index = reg.index.set_names(keys + ["region_code"])
        j = pd.concat([s_reg, reg], axis=1, join="inner").reset_index()
        j["niveau"] = "region"
        s_nat = prov.groupby(keys).valeur.sum().rename("somme_provinces")
        nat = d[d.niveau == "national"].set_index(keys).valeur.rename("publie")
        jn = pd.concat([s_nat, nat], axis=1, join="inner").reset_index()
        jn["niveau"] = "national"
        for x in (j, jn):
            x["table"] = table
            x["ecart"] = x.somme_provinces - x.publie
            x["ok"] = x.ecart.abs() <= 0.5
            out.append(x)
    return pd.concat(out, ignore_index=True)


def rate_checks(tidy: pd.DataFrame) -> pd.DataFrame:
    out = []
    for table, (num, den, rate) in RATES.items():
        d = tidy[tidy.table == table]
        w = d.pivot_table(index=["edition", "niveau", "code", "sexe"], columns="indicateur", values="valeur",
                          aggfunc="first").dropna(subset=[num, den, rate])
        w = w[w[den] > 0]
        w["recalcule"] = 100 * w[num] / w[den]
        w["ecart"] = w.recalcule - w[rate]
        w["ok"] = w.ecart.abs() <= 0.15
        w["table"] = table
        out.append(w.reset_index()[["table", "edition", "niveau", "code", "sexe", "ecart", "ok"]])
    return pd.concat(out, ignore_index=True)


def flux_checks(tidy: pd.DataFrame) -> pd.DataFrame:
    f = tidy[(tidy.table == "flux") & (tidy.classe != "CM2")]
    w = f.pivot_table(index=["edition", "niveau", "code", "classe", "sexe"], columns="indicateur", values="valeur",
                      aggfunc="first").dropna()
    w["somme"] = w.taux_promotion + w.taux_redoublement + w.taux_abandon
    w["ok"] = (w.somme - 100).abs() <= 0.25
    return w.reset_index()


def edition_consistency(tidy: pd.DataFrame) -> pd.DataFrame:
    """Une même année d'historique publiée dans plusieurs éditions : valeurs identiques ?"""
    h = tidy[(tidy.table == "historique") & (tidy.niveau == "province") & (tidy.classe == "ALL")
             & (tidy.sexe == "T") & (tidy.indicateur == "effectif")]
    g = h.groupby(["code", "annee_scolaire"]).valeur.agg(["nunique", "min", "max", "count"]).reset_index()
    g = g[g["count"] > 1]
    g["identique"] = g["nunique"] == 1
    g["ecart_relatif"] = (g["max"] - g["min"]) / g["max"].where(g["max"] > 0)
    return g


def build_report() -> dict:
    QDIR.mkdir(parents=True, exist_ok=True)
    tidy = load_tidy()
    cv = control_values(tidy)
    sc = sum_checks(tidy)
    rc = rate_checks(tidy)
    fc = flux_checks(tidy)
    ec = edition_consistency(tidy)
    comp = pd.read_csv(TABLES / "comparaison_taux_publies_reconstitues.csv", sep=";")
    log = pd.read_csv(TABLES / "journal_extraction.csv", sep=";")
    cv.to_csv(QDIR / "valeurs_controle.csv", sep=";", index=False)
    sc[~sc.ok].to_csv(QDIR / "sommes_en_ecart.csv", sep=";", index=False)
    rc[~rc.ok].to_csv(QDIR / "taux_en_ecart.csv", sep=";", index=False)
    fc[~fc.ok].to_csv(QDIR / "flux_somme_differente_100.csv", sep=";", index=False)
    ec[~ec.identique].to_csv(QDIR / "historiques_revises.csv", sep=";", index=False)

    by_table = tidy.groupby(["table", "edition"]).agg(
        valeurs=("valeur", "size"), provinces=("code", lambda s: s[tidy.loc[s.index, "niveau"] == "province"].nunique()),
        flags_non_ok=("flag_qualite", lambda s: int((s != "ok").sum()))).reset_index()
    sums = sc.groupby(["table", "edition"]).ok.agg(["size", "mean"]).reset_index().rename(
        columns={"size": "sommes_testees", "mean": "sommes_ok"})
    rates = rc.groupby(["table", "edition"]).ok.agg(["size", "mean"]).reset_index().rename(
        columns={"size": "taux_testes", "mean": "taux_ok"})
    by_table = by_table.merge(sums, on=["table", "edition"], how="left").merge(rates, on=["table", "edition"], how="left")
    by_table.to_csv(QDIR / "qualite_par_table_et_edition.csv", sep=";", index=False)

    ab = comp[comp.indicateur == "taux_abandon"]
    report = {
        "valeurs_controle": {"total": len(cv), "ok": int(cv.ok.sum())},
        "valeurs_extraites": int(len(tidy)),
        "journal_extraction_lignes": int(len(log)),
        "flags": tidy.flag_qualite.value_counts().to_dict(),
        "sommes": {"testees": int(len(sc)), "ok": int(sc.ok.sum()), "taux_ok": round(float(sc.ok.mean()), 4)},
        "taux": {"testes": int(len(rc)), "ok": int(rc.ok.sum()), "taux_ok": round(float(rc.ok.mean()), 4)},
        "flux_somme_100": {"testes": int(len(fc)), "ok": int(fc.ok.sum()), "taux_ok": round(float(fc.ok.mean()), 4)},
        "historiques_entre_editions": {"comparaisons": int(len(ec)), "identiques": int(ec.identique.sum()),
                                       "taux_identiques": round(float(ec.identique.mean()), 4)},
        "reconstitution_vs_publie": {
            ind: {"n": int((x := comp[comp.indicateur == ind]).shape[0]),
                  "part_ecart_inf_0_15_pt": round(float((x.ecart.abs() < 0.15).mean()), 4),
                  "ecart_median_pt": round(float(x.ecart.median()), 3)}
            for ind in ["taux_promotion", "taux_redoublement", "taux_abandon"]},
        "abandon_publie_nul": {"n": int((ab.publie == 0).sum()),
                               "dont_reconstitue_negatif_ou_nul": int(((ab.publie == 0) & (ab.reconstitue <= 0.05)).sum())},
    }
    (QDIR / "rapport_qualite.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(build_report(), indent=2, ensure_ascii=False))

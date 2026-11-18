"""Export des sorties du pipeline vers l'application web (web/public/data).

Toutes les valeurs affichées par l'application proviennent de ces fichiers. Découpage de la
carte : 17 régions et 47 provinces actuelles (COD-AB v03, réforme de 2025).

Convention d'années : la « déperdition observée » d'une année Y est celle du passage de la
cohorte Y-1 -> Y (constatée avec l'annuaire Y). La « déperdition anticipée » d'une année Y
est la prédiction faite à la fin de l'année Y-1 pour ce même passage ; elle n'est publiée
que pour les années hors échantillon (validation temporelle) et pour l'horizon 2025-2026.
"""

from __future__ import annotations

import datetime as dt
import json
import math

import numpy as np
import pandas as pd
import shapely
from shapely.ops import polylabel

from pipeline.config import OUTPUTS_DIR, ROOT
from pipeline.geo import communes, dissolve, new_provinces, new_regions
from pipeline.model import ALERT, FEATURE_LABELS
from pipeline.risk_index import DIM_LABELS, DIMENSIONS, IND_LABELS

TABLES = OUTPUTS_DIR / "tables"
MDIR = OUTPUTS_DIR / "model"
QDIR = OUTPUTS_DIR / "quality"
WEB = ROOT / "web" / "public" / "data"
YEARS = [f"{y}-{y + 1}" for y in range(2014, 2026)]  # 2025-2026 : horizon de prédiction
HORIZON = "2025-2026"


def next_year(y: str) -> str:
    a = int(y[:4]) + 1
    return f"{a}-{a + 1}"


def clean(v, nd=2):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    if isinstance(v, (np.floating, float)):
        return round(float(v), nd)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def write(name: str, obj) -> int:
    WEB.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    (WEB / name).write_text(txt, encoding="utf-8")
    return len(txt.encode("utf-8"))


# --------------------------------------------------------------------------- indicateurs

# clé : (colonne source, libellé, unité, décimales, sens, classes, palette, description)
# sens : +1 = une valeur élevée est défavorable, -1 = favorable, 0 = divergent.
INDICATORS = {
    "deperdition_obs": ("deperdition_prec", "Déperdition observée", "%", 1, +1, [5, 10, 15, 25], "seq_risk",
                        "Part des élèves du CP1 au CM1 de l'année précédente qui ne se retrouvent ni dans la classe "
                        "supérieure ni en redoublement cette année (abandons, départs nets, fermetures d'écoles)."),
    "deperdition_obs_f": ("deperdition_f_prec", "Déperdition observée (filles)", "%", 1, +1, [5, 10, 15, 25],
                          "seq_risk", "Déperdition apparente des filles."),
    "deperdition_obs_g": ("deperdition_g_prec", "Déperdition observée (garçons)", "%", 1, +1, [5, 10, 15, 25],
                          "seq_risk", "Déperdition apparente des garçons."),
    "survie_cm2": ("survie_cm2_prec", "Survie jusqu'au CM2", "%", 1, -1, [40, 55, 70, 85], "seq_good",
                   "Part d'une cohorte de CP1 qui atteindrait le CM2 avec les taux de flux observés."),
    "tap": ("tap", "Taux d'achèvement", "%", 1, -1, [25, 40, 55, 70], "seq_good",
            "Nouveaux inscrits au CM2 rapportés à la population de 11 ans (RGPH 2019 projeté)."),
    "tap_f": ("tap_f", "Taux d'achèvement (filles)", "%", 1, -1, [25, 40, 55, 70], "seq_good", ""),
    "tap_g": ("tap_g", "Taux d'achèvement (garçons)", "%", 1, -1, [25, 40, 55, 70], "seq_good", ""),
    "tbs": ("tbs", "Taux brut de scolarisation", "%", 1, -1, [25, 50, 75, 100], "seq_good",
            "Élèves du primaire rapportés à la population de 6 à 11 ans."),
    "tbs_f": ("tbs_f", "TBS filles", "%", 1, -1, [25, 50, 75, 100], "seq_good", ""),
    "tbs_g": ("tbs_g", "TBS garçons", "%", 1, -1, [25, 50, 75, 100], "seq_good", ""),
    "ips_tbs": ("ips_tbs", "Parité filles/garçons (TBS)", "", 2, 0, [0.90, 0.97, 1.03, 1.10], "div_parity",
                "TBS des filles divisé par celui des garçons ; 1 = parité, < 1 = filles défavorisées."),
    "ratio_eleves_maitre": ("ratio_eleves_maitre", "Élèves par maître", "", 0, +1, [40, 50, 60, 70], "seq_risk",
                            "Élèves par maître chargé de cours."),
    "ratio_eleves_salle": ("ratio_eleves_salle", "Élèves par salle de classe", "", 0, +1, [40, 50, 60, 70],
                           "seq_risk", "Élèves par salle de classe fonctionnelle."),
    "pauvrete": ("pauvrete", "Pauvreté (2019)", "%", 1, +1, [20, 35, 50, 65], "seq_risk",
                 "Incidence de la pauvreté monétaire, cartographie de la pauvreté RGPH 2019 / EHCVM 2018."),
    "pdi_pct_pop": ("pdi_pct_pop", "Déplacés internes", "% pop.", 1, +1, [1, 5, 10, 25], "seq_risk",
                    "PDI enregistrés par le CONASUR (dernière situation de l'année scolaire), rapportés à la "
                    "population 2019. Série disponible jusqu'en mars 2023."),
    "baisse_ecoles_pic": ("baisse_ecoles_pic", "Écoles en activité vs maximum", "%", 1, 0,
                          [-50, -25, -10, -2], "div_change",
                          "Écart du nombre d'écoles en activité au maximum observé depuis 2017-18 : proxy des "
                          "fermetures liées à l'insécurité."),
    "var_ecoles_1an": ("var_ecoles_1an", "Évolution des écoles sur un an", "%", 1, 0, [-25, -10, -2, 2],
                       "div_change", "Variation du nombre d'écoles en activité par rapport à l'année précédente."),
    "baisse_effectif_pic": ("baisse_effectif_pic", "Élèves vs maximum", "%", 1, 0, [-50, -25, -10, -2],
                            "div_change", "Écart des effectifs au maximum observé depuis 2014-15."),
    "redoublement": ("redoublement_global_prec", "Redoublement", "%", 1, +1, [2, 4, 6, 8], "seq_risk",
                     "Redoublants de l'année rapportés aux élèves de l'année précédente."),
    "part_rurale": ("part_rurale", "Élèves en milieu rural", "%", 0, +1, [40, 60, 75, 90], "seq_neutral", ""),
    "part_prive": ("part_prive", "Élèves du privé", "%", 0, 0, [10, 20, 30, 40], "seq_neutral", ""),
    "part_filles": ("part_filles", "Part des filles", "%", 1, 0, [47, 49, 50, 51], "div_parity", ""),
    "effectif": ("effectif", "Élèves inscrits", "", 0, 0, None, "seq_neutral", "Effectif total du primaire."),
    "ecoles": ("ecoles", "Écoles en activité", "", 0, 0, None, "seq_neutral", ""),
    "maitres": ("maitres", "Maîtres", "", 0, 0, None, "seq_neutral", ""),
    "salles": ("salles", "Salles de classe", "", 0, 0, None, "seq_neutral", ""),
    "pop_6_11": ("pop_6_11", "Population de 6 à 11 ans", "", 0, 0, None, "seq_neutral", ""),
    "pdi": ("pdi", "Déplacés internes (nombre)", "", 0, 0, None, "seq_neutral", ""),
    "qualite_score": ("qualite_score", "Qualité des données", "/100", 0, -1, [60, 70, 80, 90], "seq_good", ""),
}


def unit_values(ind: pd.DataFrame) -> dict:
    out = {}
    for code, g in ind.groupby("code"):
        g = g.set_index("annee_scolaire")
        rec = {}
        for key, (col, *_rest) in INDICATORS.items():
            nd = INDICATORS[key][3]
            rec[key] = [clean(g[col].get(y), nd + 1 if nd < 2 else nd) if y in g.index else None for y in YEARS]
        rec["qualite_motifs"] = [g["qualite_motifs"].get(y) if y in g.index and isinstance(
            g["qualite_motifs"].get(y), str) and g["qualite_motifs"].get(y) else None for y in YEARS]
        rec["split_estime"] = bool(g.split_estime.fillna(False).astype(bool).any())
        out[code] = rec
    return out


def risk_records(idx: pd.DataFrame, preds: pd.DataFrame) -> dict:
    """Indice (année Y) et déperdition anticipée (cible Y, prédite à la fin de Y-1)."""
    out: dict = {}
    for r in idx.itertuples(index=False):
        out.setdefault(r.code, {"indice": {}, "prediction": {}})["indice"][r.annee_scolaire] = {
            "score": clean(r.indice, 1), "classe": int(r.classe), "rang": int(r.rang),
            "rang_p05": int(r.rang_p05), "rang_p95": int(r.rang_p95),
            "proba_q5": clean(r.proba_quintile_superieur, 2), "facteurs": r.facteurs or "",
            "dimension": r.dimension_dominante,
            "dims": {d: clean(getattr(r, f"dim_{d}"), 1) for d in DIMENSIONS},
            "acp": clean(r.indice_acp, 1), "entropie": clean(r.indice_entropie, 1)}
    for r in preds.itertuples(index=False):
        target = next_year(r.annee_scolaire)
        if not (r.hors_echantillon or target == HORIZON):
            continue
        out.setdefault(r.code, {"indice": {}, "prediction": {}})["prediction"][target] = {
            "valeur": clean(r.prediction, 1), "ic80": [clean(r.ic80_bas, 1), clean(r.ic80_haut, 1)],
            "ic90": [clean(r.ic90_bas, 1), clean(r.ic90_haut, 1)], "p_alerte": clean(r.p_alerte, 2),
            "rang": clean(r.rang_prediction, 0), "observe": clean(r.y, 1),
            "persistance": clean(getattr(r, "pred_persistance", None), 1),
            "hors_echantillon": bool(r.hors_echantillon),
            "facteurs": getattr(r, "facteurs_modele", "") if isinstance(getattr(r, "facteurs_modele", ""), str) else ""}
    return out


# --------------------------------------------------------------------------- recommandations

ACTIONS = {
    "choc": ("Éducation en situation d'urgence",
             ["espaces temporaires d'apprentissage et réouverture progressive des écoles fermées",
              "redéploiement et prime des enseignants vers les écoles d'accueil",
              "inscription et suivi nominatif des élèves déplacés internes",
              "cantines et soutien psychosocial dans les écoles d'accueil"]),
    "acces": ("Accès et maintien",
              ["campagnes d'inscription au CP1 et recherche des enfants non scolarisés",
               "passerelles de l'éducation non formelle vers le primaire",
               "écoles satellites pour rapprocher l'offre des villages"]),
    "accueil": ("Capacité d'accueil",
                ["affectation prioritaire de nouveaux enseignants",
                 "construction ou réhabilitation de salles de classe (remplacement des paillotes)",
                 "équipement en tables-bancs et manuels"]),
    "parcours": ("Parcours et réussite",
                 ["détection précoce des absences répétées et alerte au niveau de l'école",
                  "remédiation ciblée au CE1 et au CM1, classes où la déperdition est la plus forte",
                  "suivi nominatif des élèves non réinscrits à la rentrée"]),
    "vulnerabilite": ("Vulnérabilité des familles",
                      ["cantines scolaires et kits scolaires",
                       "sensibilisation contre le travail des enfants (orpaillage) et le mariage précoce",
                       "articulation avec les transferts sociaux"]),
}
GIRLS_ACTION = ("Appui à la scolarisation des filles",
                ["bourses et kits pour les filles", "latrines séparées et points d'eau",
                 "mentorat et lutte contre le mariage précoce"])


def recommendations(idx_year: pd.DataFrame, ind_year: pd.DataFrame, pred_year: pd.DataFrame) -> dict:
    """Pistes d'action par unité : dimensions de l'indice >= 60, écart filles-garçons, alerte du modèle."""
    ind_year = ind_year.set_index("code")
    pred_year = pred_year.set_index("code")
    out = {}
    for r in idx_year.itertuples(index=False):
        dims = sorted(((getattr(r, f"dim_{d}"), d) for d in DIMENSIONS), reverse=True)
        chosen = [d for s, d in dims if s is not None and not np.isnan(s) and s >= 60][:2]
        types = [{"type": d, "titre": ACTIONS[d][0], "actions": ACTIONS[d][1]} for d in chosen]
        ips = ind_year.ips_tbs.get(r.code)
        if ips is not None and not np.isnan(ips) and ips < 0.95:
            types.append({"type": "filles", "titre": GIRLS_ACTION[0], "actions": GIRLS_ACTION[1]})
        p = pred_year.p_alerte.get(r.code)
        out[r.code] = {"types": types, "alerte": bool(p is not None and p >= 0.5),
                       "priorite": int(1 if (p is not None and p >= 0.5 and r.classe >= 4)
                                       else 2 if (r.classe >= 4 or (p is not None and p >= 0.5)) else 3)}
    return out


# --------------------------------------------------------------------------- géométries

def geometries() -> dict:
    sizes = {}
    for level, code, name in [("prov", "prov_code", "prov_name"), ("reg", "reg_code", "reg_name"),
                              ("old_reg", "old_reg_code", "old_reg_name")]:
        g = dissolve(level)
        props = g[[code, name]].rename(columns={code: "code", name: "nom"})
        if level == "prov":
            props["reg"] = g.reg_code
        g = g.set_geometry(shapely.set_precision(g.geometry.values, 0.0001))
        feats = []
        labels = {}
        for (_, p), geom in zip(props.iterrows(), g.geometry):
            feats.append({"type": "Feature", "properties": {k: v for k, v in p.items()},
                          "geometry": json.loads(shapely.to_geojson(geom))})
            main = max(getattr(geom, "geoms", [geom]), key=lambda x: x.area)
            pt = polylabel(main, tolerance=0.005)
            labels[p["code"]] = [round(pt.x, 4), round(pt.y, 4)]
        fc = {"type": "FeatureCollection", "features": feats}
        sizes[level] = write(f"geo_{level}.json", fc)
        if level != "old_reg":
            write(f"labels_{level}.json", labels)
    bounds = dissolve("reg").total_bounds
    write("bounds.json", [round(b, 3) for b in bounds])
    return sizes


def schools() -> int:
    o = pd.read_csv(TABLES / "ecoles_osm.csv", sep=";")
    types = {"school": 0, "college": 1, "kindergarten": 2, "university": 3}
    o["t"] = o.amenity.map(types).fillna(4).astype(int)
    pts = [[round(x, 4), round(y, 4), t] for x, y, t in zip(o.lon, o.lat, o.t)]
    counts = o.groupby("prov_code").size().to_dict()
    return write("ecoles_osm.json", {"types": ["école", "collège", "jardin d'enfants", "université", "non typé"],
                                     "points": pts, "par_province": counts,
                                     "source": "OpenStreetMap via HOT/HDX, extraction du 02/11/2026, ODbL 1.0"})


# --------------------------------------------------------------------------- orchestration

def units_meta() -> dict:
    c = communes()
    prov = new_provinces()
    reg = new_regions()
    anc = c.groupby(["prov_code", "old_prov_code", "old_prov_name", "old_reg_name"]).size().reset_index(name="n")
    out = {"prov": {}, "reg": {}}
    for r in prov.itertuples(index=False):
        a = anc[anc.prov_code == r.prov_code]
        out["prov"][r.prov_code] = {"nom": r.prov_name, "reg": r.reg_code, "reg_nom": r.reg_name,
                                    "superficie_km2": round(r.area_sqkm), "communes": int(r.n_communes),
                                    "ancienne_province": " / ".join(sorted(set(a.old_prov_name))),
                                    "ancienne_region": " / ".join(sorted(set(a.old_reg_name))),
                                    "scindee": bool(len(set(c[c.old_prov_code.isin(a.old_prov_code)].prov_code)) > 1)}
    for r in reg.itertuples(index=False):
        sub = c[c.reg_code == r.reg_code]
        out["reg"][r.reg_code] = {"nom": r.reg_name, "superficie_km2": round(r.area_sqkm),
                                  "provinces": sorted(prov[prov.reg_code == r.reg_code].prov_code),
                                  "ancienne_region": " / ".join(sorted(set(sub.old_reg_name))),
                                  "anciennes_provinces": " / ".join(sorted(set(sub.old_prov_name)))}
    return out


def headline(ind_reg: pd.DataFrame, nat: pd.DataFrame, preds_prov: pd.DataFrame, regs: dict) -> dict:
    """Chiffres d'accroche calculés (vue Comprendre)."""
    last = "2024-2025"
    r = ind_reg[ind_reg.annee_scolaire == last].dropna(subset=["tap"])
    hi, lo = r.loc[r.tap.idxmax()], r.loc[r.tap.idxmin()]
    n = nat.set_index("annee_scolaire")
    alert = preds_prov[(preds_prov.annee_scolaire == "2024-2025") & (preds_prov.p_alerte >= 0.5)]
    return {
        "annee": last,
        "tap_max": {"code": hi.code, "nom": regs[hi.code]["nom"], "valeur": clean(hi.tap, 1), "tbs": clean(hi.tbs, 1)},
        "tap_min": {"code": lo.code, "nom": regs[lo.code]["nom"], "valeur": clean(lo.tap, 1), "tbs": clean(lo.tbs, 1)},
        "ecart_tap": clean(hi.tap / lo.tap, 1),
        "effectif_2021": clean(n.effectif.get("2021-2022"), 0), "effectif_2022": clean(n.effectif.get("2022-2023"), 0),
        "baisse_effectif": clean(n.effectif.get("2022-2023") - n.effectif.get("2021-2022"), 0),
        "ecoles_max": clean(n.ecoles.max(), 0), "ecoles_min": clean(n.ecoles.min(), 0),
        "annee_ecoles_max": n.ecoles.idxmax(), "annee_ecoles_min": n.ecoles.idxmin(),
        "effectif_last": clean(n.effectif.get(last), 0), "ecoles_last": clean(n.ecoles.get(last), 0),
        "tap_nat_last": clean(n.tap.get(last), 1), "tap_nat_2017": clean(n.tap.get("2017-2018"), 1),
        "provinces_alerte": int(len(alert)), "seuil_alerte": ALERT,
        "pdi_max": clean(n.pdi.max(), 0), "annee_pdi_max": n.pdi.idxmax() if n.pdi.notna().any() else None,
    }


def model_payload() -> dict:
    s = json.loads((MDIR / "resume_modele.json").read_text(encoding="utf-8"))
    folds = pd.read_csv(MDIR / "metriques_par_pli_temporel.csv", sep=";")
    calib = pd.read_csv(MDIR / "calibration_logistique.csv", sep=";")
    imp = pd.read_csv(MDIR / "importance_variables.csv", sep=";")
    tcv = pd.read_csv(MDIR / "predictions_validation_temporelle.csv", sep=";")
    chosen = s["selection"]["retenu"]
    meta = json.loads((MDIR / "indice_meta.json").read_text(encoding="utf-8"))
    return {
        "resume": {k: s[k] for k in ["cible", "seuil_alerte", "annees_entrainement", "plis_temporels",
                                     "n_observations", "n_provinces", "selection", "conformal", "annee_prediction"]},
        "metriques_temporelles": [{k: clean(v, 3) for k, v in m.items()} for m in s["metriques_temporelles"]],
        "metriques_spatiales": [{k: clean(v, 3) for k, v in m.items()} for m in s["metriques_spatiales"]],
        "plis": [{k: clean(v, 2) for k, v in r.items()} for r in folds.to_dict(orient="records")],
        "calibration": [{k: clean(v, 3) for k, v in r.items()} for r in calib.to_dict(orient="records")],
        "importance": [{"variable": r.variable, "libelle": r.libelle, "coef": clean(r.coefficient_standardise, 3),
                        "permutation": clean(r.importance_permutation_mae, 3)} for r in imp.itertuples()],
        "validation_points": [[clean(r.y, 1), clean(getattr(r, chosen), 1), clean(r.persistance, 1), r.fold]
                              for r in tcv.itertuples()],
        "libelles_variables": FEATURE_LABELS,
        "indice": {"dimensions": {k: {"label": DIM_LABELS[k],
                                      "indicateurs": [{"col": c, "label": IND_LABELS[c], "sens": s_} for c, s_ in v]}
                                  for k, v in DIMENSIONS.items()},
                   "meta": meta["prov"]},
    }


def quality_payload() -> dict:
    rep = json.loads((QDIR / "rapport_qualite.json").read_text(encoding="utf-8"))
    cv = pd.read_csv(QDIR / "valeurs_controle.csv", sep=";")
    by = pd.read_csv(QDIR / "qualite_par_table_et_edition.csv", sep=";")
    log = pd.read_csv(TABLES / "journal_extraction.csv", sep=";")
    return {"rapport": rep,
            "controles": [{k: clean(v, 3) for k, v in r.items()} for r in cv.to_dict(orient="records")],
            "par_table": [{k: clean(v, 3) for k, v in r.items()} for r in by.to_dict(orient="records")],
            "journal": [{k: clean(v) for k, v in r.items()} for r in
                        log[log.message != "doublon ignoré"].to_dict(orient="records")]}


SOURCES = [
    {"id": "annuaires", "titre": "Annuaires statistiques de l'enseignement primaire 2017-18 à 2024-25",
     "producteur": "MEBAPLN / DGESS (via CNS)", "usage": "effectifs, redoublants, écoles, maîtres, salles, TBS, TAP, TBA, TNS",
     "licence": "publication officielle, citation obligatoire", "lien": "https://www.cns.bf/publications/mebapln/"},
    {"id": "codab", "titre": "Limites administratives COD-AB v03 (17 régions, 47 provinces, 351 communes)",
     "producteur": "IGB / OCHA (via HDX), valide au 01/08/2025", "usage": "fonds de carte et correspondance ancien/actuel",
     "licence": "CC BY-IGO", "lien": "https://data.humdata.org/dataset/cod-ab-bfa"},
    {"id": "pauvrete", "titre": "RGPH 2019, volume 3 : mesure et cartographie de la pauvreté",
     "producteur": "INSD (NADA 275)", "usage": "incidence de la pauvreté par province et commune (référence 2018-2019)",
     "licence": "publication officielle", "lien": "https://microdata.insd.bf/index.php/catalog/69/related-materials"},
    {"id": "pdi", "titre": "Situation des personnes déplacées internes par commune (janv. 2019 à mars 2023)",
     "producteur": "SP/CONASUR (via HDX)", "usage": "déplacés internes par province et année scolaire",
     "licence": "CC BY (HDX)", "lien": "https://data.humdata.org/dataset/situation-des-personnes-deplacees-internes"},
    {"id": "osm", "titre": "Établissements d'enseignement OpenStreetMap",
     "producteur": "HOT / OSM (via HDX), extraction du 02/11/2026", "usage": "couche indicative des écoles géolocalisées",
     "licence": "ODbL 1.0, © contributeurs OpenStreetMap", "lien": "https://data.humdata.org/dataset/hotosm_bfa_education_facilities"},
]


def run() -> dict:
    sizes = geometries()
    sizes["ecoles_osm"] = schools()
    regs_meta = units_meta()
    ind = {lvl: pd.read_csv(TABLES / f"indicateurs_{lvl}.csv", sep=";") for lvl in ["prov", "reg", "national"]}
    idx = {lvl: pd.read_csv(MDIR / f"indice_{lvl}.csv", sep=";") for lvl in ["prov", "reg"]}
    preds = {"prov": pd.read_csv(MDIR / "predictions_provinces_actuelles.csv", sep=";"),
             "reg": pd.read_csv(MDIR / "predictions_regions_actuelles.csv", sep=";")}
    values = {lvl: unit_values(ind[lvl]) for lvl in ["prov", "reg"]}
    values["national"] = unit_values(ind["national"])["BF"]
    sizes["values"] = write("values.json", values)
    risk = {lvl: risk_records(idx[lvl], preds[lvl]) for lvl in ["prov", "reg"]}
    last = "2024-2025"
    risk["recommandations"] = {
        lvl: recommendations(idx[lvl][idx[lvl].annee_scolaire == last], ind[lvl][ind[lvl].annee_scolaire == last],
                             preds[lvl][preds[lvl].annee_scolaire == last]) for lvl in ["prov", "reg"]}
    sizes["risk"] = write("risk.json", risk)
    sizes["model"] = write("model.json", model_payload())
    sizes["quality"] = write("quality.json", quality_payload())
    meta = {
        "genere_le": dt.date.today().isoformat(), "annees": YEARS, "horizon": HORIZON, "derniere_annee": last,
        "annees_indice": sorted(idx["prov"].annee_scolaire.unique()),
        "indicateurs": {k: {"label": v[1], "unite": v[2], "decimales": v[3], "sens": v[4], "seuils": v[5],
                            "palette": v[6], "description": v[7]} for k, v in INDICATORS.items()},
        "unites": regs_meta,
        "chiffres_cles": headline(ind["reg"], ind["national"], preds["prov"], regs_meta["reg"]),
        "sources": SOURCES,
        "correspondance": [{"ancienne_province": r.old_prov_name, "ancienne_region": r.old_reg_name,
                            "province": r.prov_name, "region": r.reg_name, "communes": int(r.n)}
                           for r in communes().groupby(["old_prov_name", "old_reg_name", "prov_name", "reg_name"])
                           .size().reset_index(name="n").itertuples()],
    }
    sizes["meta"] = write("meta.json", meta)
    return sizes


if __name__ == "__main__":
    print({k: f"{v / 1024:.0f} Ko" for k, v in run().items()})

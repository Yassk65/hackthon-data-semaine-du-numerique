"""Variables de contexte : pauvreté (RGPH 2019), déplacés internes (CONASUR), écoles OSM.

- Pauvreté : annexe 4 de la « Cartographie de la pauvreté » (NADA275, INSD, base EHCVM 2018
  et RGPH 2019). Lignes de province (45) et lignes de commune pour les deux provinces
  scindées par la réforme de 2025 (Soum, Tapoa), afin de calculer les nouvelles provinces
  sans approximation et les poids de population 2019 des communes concernées.
- PDI : série `idps4.xlsx` (feuille Tableau), stock de PDI par commune et date de situation,
  27/01/2019 -> 31/03/2023. Une année scolaire t (septembre t -> juin t+1) reçoit la
  dernière situation publiée avant le 30 juin t+1.
- Écoles OSM : couche indicative (collaborative, incomplète), rattachée aux provinces par
  jointure spatiale sur les polygones actuels.
"""

from __future__ import annotations

import difflib
import re

import geopandas as gpd
import pandas as pd

from pipeline.config import OUTPUTS_DIR
from pipeline.geo import communes, dissolve, match_province
from pipeline.readers import normalize_name, parse_values, pdf_rows, read_pack_csv

POVERTY_CSV = "02_Demographie_INSD/RGPH2019_NADA/NADA275_RGPH2019_Cartographie_pauvrete.csv"
POVERTY_PAGES = range(97, 130)
PDI_CSV = "03_Conditions_de_Vie_et_Emploi/PDI_CONASUR/idps4__Tableau.csv"
OSM_CSV = "04_Cartographie_SIG/Ecoles_OSM_HOTOSM/ecoles_osm_burkina.csv"
SPLIT_OLD_PROVINCES = ("BF5603", "BF5205")  # Soum, Tapoa
CODE_RE = re.compile(r"^\d{1,2} \d\d \d\d \d\d$")  # région (1-13), province, commune, secteur


def poverty() -> tuple[pd.DataFrame, pd.DataFrame]:
    """(provinces, communes des provinces scindées) : population 2019, incidence, profondeur."""
    rows = [r for r in pdf_rows(POVERTY_CSV) if r.page in POVERTY_PAGES]
    prov, comm = [], []
    current_prov = None
    for r in rows:
        if not r.cells or not CODE_RE.match(r.cells[0]) or len(r.cells) < 7:
            continue
        code = r.cells[0].split()
        label = r.cells[1]
        vals = parse_values(r.cells[2:7])
        if len(vals) != 5 or any(v is None for v in vals):
            continue
        rec = {"label": label, "population_2019": vals[0], "menages_2019": vals[1],
               "pauvrete_incidence": vals[2], "pauvrete_profondeur": vals[3], "nb_pauvres": vals[4],
               "source": "NADA275_RGPH2019_Cartographie_pauvrete.pdf", "page": r.page, "ligne": r.ligne}
        if code[1] != "00" and code[2] == "00" and code[3] == "00":
            current_prov = match_province(label)
            if current_prov:
                prov.append({"old_prov_code": current_prov, **rec})
        elif code[2] != "00" and code[3] == "00" and current_prov in SPLIT_OLD_PROVINCES:
            comm.append({"old_prov_code": current_prov, **rec})
    prov_df = pd.DataFrame(prov).drop_duplicates("old_prov_code")
    comm_df = pd.DataFrame(comm)
    # Rattachement des communes au référentiel COD-AB par le nom, dans la province.
    c = communes()
    c = c[c.old_prov_code.isin(SPLIT_OLD_PROVINCES)][["commune_code", "commune_name", "old_prov_code", "prov_code"]]
    c["key"] = c.commune_name.map(normalize_name)
    comm_df["key"] = comm_df.label.map(normalize_name)
    # Graphies différentes (« Logobou » / « Logbou », « Namounou » / « Namouno ») : rapprochement
    # approché dans la province, consigné dans la colonne `rapprochement`.
    keys_by_prov = c.groupby("old_prov_code").key.apply(list).to_dict()

    def resolve(row):
        cands = keys_by_prov[row.old_prov_code]
        if row.key in cands:
            return row.key, "exact"
        best = difflib.get_close_matches(row.key, cands, n=1, cutoff=0.75)
        return (best[0], "approche") if best else (None, "absent")

    res = comm_df.apply(resolve, axis=1, result_type="expand")
    comm_df["key"], comm_df["rapprochement"] = res[0], res[1]
    comm_df = comm_df.merge(c, on=["old_prov_code", "key"], how="left")
    missing = comm_df[comm_df.commune_code.isna()]
    if len(missing):
        raise ValueError(f"communes non rattachées : {missing.label.tolist()}")
    if comm_df.commune_code.duplicated().any():
        raise ValueError("rapprochement ambigu de communes")
    return prov_df, comm_df.drop(columns="key")


def commune_population_weights() -> pd.Series:
    """Poids de population 2019 par commune (1 partout, population pour Soum et Tapoa)."""
    _, comm = poverty()
    c = communes()
    w = pd.Series(1.0, index=c.commune_code)
    w.loc[comm.commune_code] = comm.population_2019.to_numpy()
    # Pour les provinces non scindées, le poids n'a pas d'effet (part = 1).
    return w


def poverty_new_provinces() -> pd.DataFrame:
    """Pauvreté des 47 provinces actuelles (exacte : provinces identiques ou communes agrégées)."""
    prov, comm = poverty()
    cw = communes().groupby(["old_prov_code", "prov_code"], as_index=False).size()
    whole = cw[~cw.old_prov_code.isin(SPLIT_OLD_PROVINCES)].merge(prov, on="old_prov_code")
    split = (comm.assign(pauvres=comm.pauvrete_incidence / 100 * comm.population_2019,
                         ecart=comm.pauvrete_profondeur / 100 * comm.population_2019)
             .groupby("prov_code", as_index=False)
             .agg(population_2019=("population_2019", "sum"), menages_2019=("menages_2019", "sum"),
                  pauvres=("pauvres", "sum"), ecart=("ecart", "sum")))
    split["pauvrete_incidence"] = 100 * split.pauvres / split.population_2019
    split["pauvrete_profondeur"] = 100 * split.ecart / split.population_2019
    split["source"] = "NADA275_RGPH2019_Cartographie_pauvrete.pdf (agrégation des communes)"
    cols = ["prov_code", "population_2019", "menages_2019", "pauvrete_incidence", "pauvrete_profondeur", "source"]
    return pd.concat([whole[cols], split[cols]], ignore_index=True)


def pdi() -> pd.DataFrame:
    """Stock de PDI par commune et date (ancien P-code de commune)."""
    raw = read_pack_csv(PDI_CSV)
    header = raw.iloc[0].tolist()
    df = raw.iloc[2:].copy()
    df.columns = [h if h else f"x{i}" for i, h in enumerate(header)]
    df = df.rename(columns={"Admin 3 Pcode": "adm3_pcode_old", "date donnnée": "date",
                            "Total Individus": "pdi", "Total Enfants": "pdi_enfants"})
    df["date"] = pd.to_datetime(df["date"].str[:10], errors="coerce")
    df["pdi"] = pd.to_numeric(df["pdi"].str.replace(" ", ""), errors="coerce")
    df["pdi_enfants"] = pd.to_numeric(df["pdi_enfants"].str.replace(" ", ""), errors="coerce")
    df = df.dropna(subset=["date", "pdi"])
    g = df.groupby(["adm3_pcode_old", "date"], as_index=False)[["pdi", "pdi_enfants"]].sum(min_count=1)
    c = communes()[["adm3_pcode_old", "commune_code", "old_prov_code", "prov_code"]]
    g = g.merge(c, on="adm3_pcode_old", how="left")
    unmatched = g.commune_code.isna().mean()
    if unmatched > 0.01:
        raise ValueError(f"{unmatched:.1%} des lignes PDI sans commune COD-AB")
    return g.dropna(subset=["commune_code"])


def pdi_by_school_year() -> pd.DataFrame:
    """PDI par commune et année scolaire : dernière situation avant le 30 juin de fin d'année."""
    g = pdi()
    g["annee_scolaire"] = g.date.apply(lambda d: f"{d.year - 1}-{d.year}" if d.month <= 6 else f"{d.year}-{d.year + 1}")
    last = g.sort_values("date").groupby(["commune_code", "annee_scolaire"], as_index=False).last()
    last["date_situation"] = last.date.dt.strftime("%Y-%m-%d")
    return last.drop(columns="date")


def osm_schools() -> gpd.GeoDataFrame:
    df = read_pack_csv(OSM_CSV)
    df["longitude"] = pd.to_numeric(df.longitude, errors="coerce")
    df["latitude"] = pd.to_numeric(df.latitude, errors="coerce")
    df = df.dropna(subset=["longitude", "latitude"])
    g = gpd.GeoDataFrame(df[["id", "name", "amenity", "operator_type"]],
                         geometry=gpd.points_from_xy(df.longitude, df.latitude), crs=4326)
    prov = dissolve("prov")[["prov_code", "geometry"]]
    g = gpd.sjoin(g, prov, how="left", predicate="within").drop(columns="index_right")
    g["amenity"] = g["amenity"].replace("", "non_renseigne")
    return g


def run() -> dict:
    out = OUTPUTS_DIR / "tables"
    out.mkdir(parents=True, exist_ok=True)
    prov, comm = poverty()
    prov.to_csv(out / "pauvrete_provinces_anciennes.csv", sep=";", index=False)
    comm.to_csv(out / "pauvrete_communes_provinces_scindees.csv", sep=";", index=False)
    poverty_new_provinces().to_csv(out / "pauvrete_provinces_actuelles.csv", sep=";", index=False)
    p = pdi_by_school_year()
    p.to_csv(out / "pdi_communes_annee_scolaire.csv", sep=";", index=False)
    o = osm_schools()
    o.drop(columns="geometry").assign(lon=o.geometry.x, lat=o.geometry.y).to_csv(
        out / "ecoles_osm.csv", sep=";", index=False)
    return {"pauvrete_provinces": len(prov), "communes_scindees": len(comm),
            "pdi_annees": sorted(p.annee_scolaire.unique()), "osm": len(o),
            "osm_hors_polygones": int(o.prov_code.isna().sum())}


if __name__ == "__main__":
    print(run())

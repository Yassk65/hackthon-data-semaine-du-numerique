"""Référentiel territorial et géométries.

Deux découpages coexistent :
- ancien (13 régions, 45 provinces) : celui des données DGESS, PDI et OSM ;
- actuel (17 régions, 47 provinces, réforme de 2025) : celui de COD-AB v03 et de la carte.

Les 351 communes sont identiques dans les deux découpages. Chaque commune porte son
code actuel (adm3_pcode) et son ancien code (adm3_pcode_old) : les 6 premiers
caractères de l'ancien code donnent l'ancienne province, les 4 premiers l'ancienne
région. Toutes les géométries sont obtenues par dissolution des communes après une
simplification « de couverture » qui préserve les limites partagées, si bien que les
quatre couches (ancien/actuel × région/province) sont parfaitement emboîtées.

Passage ancien → actuel (voir DECISIONS.md, D-010) :
- 43 anciennes provinces correspondent chacune à une province actuelle (code ou nom
  parfois changé) ;
- Soum (BF5603) est scindée en Djelgodji et Karo-Peli ; Tapoa (BF5205) en Dyamongou et
  Gobnangou. Les effectifs sont répartis au prorata de la population 2019 des
  communes ; les taux sont recopiés et signalés ;
- chacune des 17 régions actuelles est une union d'anciennes provinces entières :
  les agrégats régionaux actuels sont donc exacts.
"""

from __future__ import annotations

import json
from functools import lru_cache

import geopandas as gpd
import pandas as pd
import shapely

from pipeline.config import OUTPUTS_DIR, RAW_DIR
from pipeline.readers import normalize_name

CODAB_DIR = RAW_DIR / "04_Cartographie_SIG" / "COD-AB_limites_administratives"
CODAB_XLSX = CODAB_DIR / "bfa_admin_boundaries.xlsx"
CODAB_GEOJSON_ZIP = CODAB_DIR / "bfa_admin_boundaries.geojson.zip"

# Tolérance de simplification (degrés) : ~0,004° ≈ 450 m, suffisant pour une carte nationale.
SIMPLIFY_TOLERANCE = 0.004

# Variantes de noms rencontrées dans les publications (clé et valeur normalisées).
PROVINCE_ALIASES = {
    "LESBALE": "BALE",
    "LESBALES": "BALE",
    "KOMONDJARI": "KOMANDJARI",
    "KOMONDJOARI": "KOMANDJARI",
    "KOMANDJOARI": "KOMANDJARI",
    "KOURITENGA": "KOURITTENGA",
    "SANEMATENGA": "SANMATENGA",
    "SANMANTENGA": "SANMATENGA",
    "KOULPELGO": "KOULPELOGO",
    "LORUM": "LOROUM",
    "COMOE": "COMOE",
    "OUBRITENGA": "OUBRITENGA",
}

# Nom d'affichage harmonisé des 13 anciennes régions (code ancien -> nom).
OLD_REGION_LABELS = {
    "BF46": "Boucle du Mouhoun",
    "BF47": "Cascades",
    "BF13": "Centre",
    "BF48": "Centre-Est",
    "BF49": "Centre-Nord",
    "BF50": "Centre-Ouest",
    "BF51": "Centre-Sud",
    "BF52": "Est",
    "BF53": "Hauts-Bassins",
    "BF54": "Nord",
    "BF55": "Plateau-Central",
    "BF56": "Sahel",
    "BF57": "Sud-Ouest",
}


@lru_cache(maxsize=1)
def communes() -> pd.DataFrame:
    """Table des 351 communes avec leurs rattachements ancien et actuel."""
    a3 = pd.read_excel(CODAB_XLSX, sheet_name="bfa_admin3")
    a2 = pd.read_excel(CODAB_XLSX, sheet_name="bfa_admin2")
    a1 = pd.read_excel(CODAB_XLSX, sheet_name="bfa_admin1")
    df = a3[["adm3_pcode", "adm3_name", "adm2_pcode", "adm2_name", "adm1_pcode", "adm1_name",
             "adm3_pcode_old", "area_sqkm"]].copy()
    df["old_prov_code"] = df["adm3_pcode_old"].str[:6]
    df["old_reg_code"] = df["adm3_pcode_old"].str[:4]
    old_prov_names = a2.drop_duplicates("adm2_pcode_old").set_index("adm2_pcode_old")["adm2_name_old"]
    df["old_prov_name"] = df["old_prov_code"].map(old_prov_names)
    df["old_reg_name"] = df["old_reg_code"].map(OLD_REGION_LABELS)
    df = df.rename(columns={
        "adm2_pcode": "prov_code", "adm2_name": "prov_name",
        "adm1_pcode": "reg_code", "adm1_name": "reg_name",
        "adm3_pcode": "commune_code", "adm3_name": "commune_name",
    })
    # Contrôle : un ancien code de région correspond bien au préfixe de l'ancienne province.
    assert (df["old_prov_code"].str[:4] == df["old_reg_code"]).all()
    _ = a1  # la feuille admin1 sert seulement de contrôle de cohérence ci-dessous
    assert set(df["reg_code"]) == set(a1["adm1_pcode"])
    return df


def old_provinces() -> pd.DataFrame:
    c = communes()
    out = (c.groupby(["old_prov_code", "old_prov_name", "old_reg_code", "old_reg_name"], as_index=False)
             .agg(n_communes=("commune_code", "size"), area_sqkm=("area_sqkm", "sum")))
    return out.sort_values(["old_reg_name", "old_prov_name"]).reset_index(drop=True)


def new_provinces() -> pd.DataFrame:
    c = communes()
    out = (c.groupby(["prov_code", "prov_name", "reg_code", "reg_name"], as_index=False)
             .agg(n_communes=("commune_code", "size"), area_sqkm=("area_sqkm", "sum")))
    return out.sort_values(["reg_name", "prov_name"]).reset_index(drop=True)


def new_regions() -> pd.DataFrame:
    c = communes()
    return (c.groupby(["reg_code", "reg_name"], as_index=False)
              .agg(n_communes=("commune_code", "size"), area_sqkm=("area_sqkm", "sum"))
              .sort_values("reg_name").reset_index(drop=True))


@lru_cache(maxsize=1)
def province_lookup() -> dict[str, str]:
    """Nom normalisé (ancien découpage) -> code ancien de province."""
    lut = {normalize_name(n): code for code, n in
           old_provinces()[["old_prov_code", "old_prov_name"]].itertuples(index=False)}
    for alias, target in PROVINCE_ALIASES.items():
        if target in lut:
            lut[alias] = lut[target]
    return lut


@lru_cache(maxsize=1)
def region_lookup() -> dict[str, str]:
    """Nom normalisé -> code ancien de région (variantes « SUD - OUEST », « CENTRE NORD »...)."""
    return {normalize_name(n): code for code, n in OLD_REGION_LABELS.items()}


def match_province(name: str) -> str | None:
    return province_lookup().get(normalize_name(name))


def match_region(name: str) -> str | None:
    return region_lookup().get(normalize_name(name))


def crosswalk(weights: pd.Series | None = None) -> pd.DataFrame:
    """Table ancienne province -> province actuelle avec un poids de répartition.

    `weights` : poids par commune (index = commune_code), par défaut la superficie.
    Le poids d'un couple (ancienne, actuelle) est la part de l'ancienne province
    comprise dans la province actuelle.
    """
    c = communes().copy()
    c["w"] = (weights.reindex(c["commune_code"]).to_numpy() if weights is not None
              else c["area_sqkm"].to_numpy())
    g = c.groupby(["old_prov_code", "prov_code", "reg_code"], as_index=False)["w"].sum()
    g["weight"] = g["w"] / g.groupby("old_prov_code")["w"].transform("sum")
    g["split"] = g.groupby("old_prov_code")["prov_code"].transform("nunique") > 1
    return g.drop(columns="w")


# --------------------------------------------------------------------------- géométries

@lru_cache(maxsize=1)
def commune_geometries() -> gpd.GeoDataFrame:
    path = f"/vsizip/{CODAB_GEOJSON_ZIP.as_posix()}/bfa_admin3.geojson"
    g = gpd.read_file(path, columns=["adm3_pcode"])
    g = g.to_crs(4326)
    g["geometry"] = shapely.make_valid(g.geometry.values)
    return g.rename(columns={"adm3_pcode": "commune_code"})


def simplified_communes(tolerance: float = SIMPLIFY_TOLERANCE) -> gpd.GeoDataFrame:
    """Communes simplifiées sans créer de trous ni de chevauchements entre voisines."""
    g = commune_geometries().copy()
    g["geometry"] = shapely.coverage_simplify(g.geometry.values, tolerance=tolerance)
    g["geometry"] = shapely.make_valid(g.geometry.values)
    return g.merge(communes(), on="commune_code", how="left")


def dissolve(level: str, tolerance: float = SIMPLIFY_TOLERANCE) -> gpd.GeoDataFrame:
    """Polygones par niveau : old_prov, old_reg, prov, reg."""
    keys = {
        "old_prov": ["old_prov_code", "old_prov_name", "old_reg_code", "old_reg_name"],
        "old_reg": ["old_reg_code", "old_reg_name"],
        "prov": ["prov_code", "prov_name", "reg_code", "reg_name"],
        "reg": ["reg_code", "reg_name"],
    }[level]
    src = simplified_communes(tolerance) if tolerance else commune_geometries().merge(communes(), on="commune_code")
    out = src.dissolve(by=keys, as_index=False)[[*keys, "geometry"]]
    out["geometry"] = shapely.make_valid(out.geometry.values)
    return out


def topology_report(gdf: gpd.GeoDataFrame, code_col: str) -> dict:
    """Contrôles : validité, chevauchements et trous intérieurs de l'union."""
    proj = gdf.to_crs(32630)  # UTM 30N, en mètres
    areas = proj.area
    union = shapely.union_all(proj.geometry.values)
    overlap = float(areas.sum() - union.area)
    holes = 0
    for poly in getattr(union, "geoms", [union]):
        holes += len(poly.interiors)
    return {
        "n": int(gdf[code_col].nunique()),
        "all_valid": bool(shapely.is_valid(gdf.geometry.values).all()),
        "overlap_km2": round(overlap / 1e6, 3),
        "union_area_km2": round(union.area / 1e6, 1),
        "interior_holes": holes,
        "n_parts_union": len(getattr(union, "geoms", [union])),
    }


def build_geometries() -> dict:
    """Construit les 4 couches, contrôle la topologie et écrit les GeoJSON."""
    out_dir = OUTPUTS_DIR / "geo"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    for level, code in [("old_prov", "old_prov_code"), ("old_reg", "old_reg_code"),
                        ("prov", "prov_code"), ("reg", "reg_code")]:
        g = dissolve(level)
        report[level] = topology_report(g, code)
        g.to_file(out_dir / f"{level}.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    (out_dir / "topology_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(build_geometries(), indent=2))
    print(crosswalk().query("split"))

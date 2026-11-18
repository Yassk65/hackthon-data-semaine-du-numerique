"""Tests d'intégrité des tables produites par le pipeline (nécessitent le Data Pack et les sorties)."""

import json

import numpy as np
import pandas as pd
import pytest

from pipeline.config import OUTPUTS_DIR, ROOT
from pipeline.quality import CONTROL_VALUES_2023_24, control_values, flux_checks, rate_checks, sum_checks
from tests.conftest import requires_outputs, requires_pack

pytestmark = [requires_pack, requires_outputs]


@pytest.mark.parametrize("spec", CONTROL_VALUES_2023_24, ids=[s[0] for s in CONTROL_VALUES_2023_24])
def test_control_values_2023_24(tidy, spec):
    cv = control_values(tidy).set_index("controle")
    row = cv.loc[spec[0]]
    assert row.ok, f"{spec[0]} : attendu {row.attendu}, obtenu {row.obtenu}"


def test_all_editions_cover_45_provinces(tidy):
    for table in ["tbs", "tap", "tba", "tns", "flux", "historique"]:
        n = tidy[(tidy.table == table) & (tidy.niveau == "province")].groupby("edition").code.nunique()
        assert len(n) == 8 and (n == 45).all(), (table, n.to_dict())


def test_sum_of_provinces_matches_published_totals(tidy):
    sc = sum_checks(tidy)
    assert sc.ok.mean() > 0.98
    # Les tableaux de taux (I.3 à I.6) sont exacts hors du cas documenté du TAP 2023-24 (Est, D-014).
    core = sc[sc.table.isin(["tbs", "tba", "tns", "ecoles"])]
    assert core.ok.all(), core[~core.ok].head().to_dict()


def test_rates_are_consistent_with_numerators(tidy):
    assert rate_checks(tidy).ok.all()


def test_flux_rates_sum_to_100(tidy):
    assert flux_checks(tidy).ok.all()


def test_no_unflagged_manual_correction(tidy):
    allowed = {"ok", "abandon_nul_residuel", "annee_reetiquetee", "fusion_resolue", "milieu_non_attribue",
               "incoherence_somme"}
    assert set(tidy.flag_qualite.unique()) <= allowed


def test_provenance_columns_present(tidy):
    for col in ["source", "page", "ligne", "flag_qualite"]:
        assert tidy[col].notna().all()


def test_national_aggregate_equals_publication(ind_old):
    nat = pd.read_csv(OUTPUTS_DIR / "tables" / "indicateurs_national.csv", sep=";").set_index("annee_scolaire")
    assert nat.loc["2023-2024", "effectif"] == 3067940
    assert nat.loc["2024-2025", "effectif"] == 3308096
    assert nat.loc["2023-2024", "ecoles"] == 13558
    assert abs(nat.loc["2023-2024", "tbs"] - 78.2) < 0.05


def test_new_provinces_preserve_totals(ind_old, ind_prov):
    for col in ["effectif", "ecoles", "maitres", "pop_6_11"]:
        a = ind_old.groupby("annee_scolaire")[col].sum(min_count=45)
        b = ind_prov.groupby("annee_scolaire")[col].sum(min_count=47)
        both = a.notna() & b.notna()
        assert np.allclose(a[both], b[both], rtol=1e-9), col


def test_previous_cohort_is_lagged(ind_old):
    d = ind_old.sort_values(["code", "annee_scolaire"])
    lag = d.groupby("code").deperdition.shift(1)
    ok = lag.notna() & d.deperdition_prec.notna()
    assert np.allclose(lag[ok], d.deperdition_prec[ok])


def test_model_uses_no_future_information():
    from pipeline import model
    assert "y" not in model.FEATURES and "deperdition" not in model.FEATURES and "deperdition_cap" not in model.FEATURES
    d = model.model_frame(pd.read_csv(OUTPUTS_DIR / "tables" / "indicateurs_old_prov.csv", sep=";"))
    # La moyenne passée de l'année t ne dépend que des cohortes jusqu'à t-1 -> t.
    g = d[d.code == d.code.iloc[0]].sort_values("annee_scolaire")
    expected = g.deperdition_prec_cap.expanding().mean()
    assert np.allclose(g.deperdition_moy_passee.dropna(), expected.dropna())


def test_web_export_is_complete():
    data = ROOT / "web" / "public" / "data"
    values = json.loads((data / "values.json").read_text(encoding="utf-8"))
    risk = json.loads((data / "risk.json").read_text(encoding="utf-8"))
    meta = json.loads((data / "meta.json").read_text(encoding="utf-8"))
    assert len(values["prov"]) == 47 and len(values["reg"]) == 17
    assert len(meta["unites"]["prov"]) == 47 and len(meta["unites"]["reg"]) == 17
    assert all("2025-2026" in risk["prov"][c]["prediction"] for c in values["prov"])
    for code, rec in values["prov"].items():
        assert all(len(v) == len(meta["annees"]) for k, v in rec.items() if isinstance(v, list)), code

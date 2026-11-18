"""Référentiel territorial : 13/45 anciennes unités, 17/47 actuelles, topologie propre."""

import pytest

from pipeline.geo import crosswalk, dissolve, old_provinces, topology_report
from tests.conftest import requires_pack

pytestmark = requires_pack


@pytest.mark.parametrize("level,code,expected", [("old_prov", "old_prov_code", 45), ("old_reg", "old_reg_code", 13),
                                                 ("prov", "prov_code", 47), ("reg", "reg_code", 17)])
def test_topology(level, code, expected):
    rep = topology_report(dissolve(level), code)
    assert rep["n"] == expected
    assert rep["all_valid"]
    assert rep["overlap_km2"] < 0.01
    assert rep["interior_holes"] == 0
    assert rep["n_parts_union"] == 1


def test_crosswalk_old_to_new():
    cw = crosswalk()
    w = cw.groupby("old_prov_code").weight.sum()
    assert len(w) == 45 and (abs(w - 1) < 1e-9).all()
    split = cw[cw.split].old_prov_code.unique()
    assert sorted(split) == ["BF5205", "BF5603"]  # Tapoa et Soum
    # Chaque province actuelle provient d'une seule ancienne province.
    assert cw.groupby("prov_code").old_prov_code.nunique().max() == 1


def test_old_province_names_unique():
    op = old_provinces()
    assert op.old_prov_name.is_unique and len(op) == 45

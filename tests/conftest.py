import pandas as pd
import pytest

from pipeline.config import CSV_DIR, OUTPUTS_DIR

TABLES = OUTPUTS_DIR / "tables"

requires_pack = pytest.mark.skipif(not CSV_DIR.exists(), reason="Data Pack absent (DataPack_DCB_2026/data)")
requires_outputs = pytest.mark.skipif(not (TABLES / "annuaires_primaire_tidy.csv").exists(),
                                      reason="sorties absentes : lancer d'abord `python -m pipeline all`")


@pytest.fixture(scope="session")
def tidy():
    return pd.read_csv(TABLES / "annuaires_primaire_tidy.csv", sep=";", dtype={"code": str})


@pytest.fixture(scope="session")
def ind_old():
    return pd.read_csv(TABLES / "indicateurs_old_prov.csv", sep=";")


@pytest.fixture(scope="session")
def ind_prov():
    return pd.read_csv(TABLES / "indicateurs_prov.csv", sep=";")

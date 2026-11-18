"""Chemins du projet.

Le Data Pack officiel est en lecture seule : aucun module ne doit y écrire.
Son emplacement peut être changé avec la variable d'environnement DCB_DATA_DIR.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Dossier racine du Data Pack (fichiers sources PDF/XLSX/SHP...).
RAW_DIR = Path(os.environ.get("DCB_DATA_DIR", ROOT / "DataPack_DCB_2026"))

# Jumeaux CSV des fichiers sources (même arborescence).
CSV_DIR = RAW_DIR / "data"

# Toutes les sorties du pipeline.
OUTPUTS_DIR = ROOT / "outputs"

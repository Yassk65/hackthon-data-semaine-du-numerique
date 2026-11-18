"""Lecture des CSV du Data Pack et conversions élémentaires.

Toutes les fonctions sont en lecture seule sur le pack. Seules les colonnes
utilisées par le pipeline sont lues (liste blanche), les autres sont ignorées.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from pipeline.config import CSV_DIR

CELL_RE = re.compile(r"^c(\d+)$")

# Colonnes lues par défaut : structure des tableaux extraits des PDF
# (document, page, ligne, nb_cellules, methode, c1..cN) et des feuilles Excel (col1..colN).
TABLE_COLUMNS_RE = re.compile(r"^(document|page|ligne|nb_cellules|methode|c\d+|col\d+)$")


@lru_cache(maxsize=64)
def read_pack_csv(relpath: str, columns: tuple[str, ...] | None = None) -> pd.DataFrame:
    """Lit un CSV du pack (chemin relatif à data/) en texte brut.

    Seules les colonnes de la liste blanche sont lues : `columns` si elle est
    fournie (tuple, pour le cache), sinon les colonnes de structure des tableaux.
    """
    path = CSV_DIR / relpath
    keep = set(columns) if columns is not None else None

    def wanted(name: str) -> bool:
        return name in keep if keep is not None else bool(TABLE_COLUMNS_RE.match(name))

    return pd.read_csv(path, sep=";", dtype=str, keep_default_na=False, encoding="utf-8-sig",
                       usecols=wanted)


@dataclass(frozen=True)
class Row:
    """Une ligne de tableau PDF : provenance et cellules non vides, dans l'ordre."""

    document: str
    page: int
    ligne: int
    cells: tuple[str, ...]

    @property
    def text(self) -> str:
        return " | ".join(self.cells)


def pdf_rows(relpath: str) -> list[Row]:
    """Lignes d'un CSV issu de PDF, cellules vides retirées."""
    df = read_pack_csv(relpath)
    cell_cols = sorted((c for c in df.columns if CELL_RE.match(c)), key=lambda c: int(c[1:]))
    rows = []
    for rec in df[["document", "page", "ligne", *cell_cols]].itertuples(index=False):
        cells = tuple(v.strip() for v in rec[3:] if v and v.strip())
        rows.append(Row(rec[0], int(rec[1]), int(rec[2]), cells))
    return rows


def page_headers(rows: list[Row], n_lines: int = 4) -> dict[int, str]:
    """Texte des premières lignes de chaque page (sert à repérer les tableaux)."""
    out: dict[int, list[str]] = {}
    for r in rows:
        if r.ligne <= n_lines:
            out.setdefault(r.page, []).append(r.text)
    return {p: " // ".join(t) for p, t in out.items()}


def normalize_name(s: str) -> str:
    """Majuscules, sans accents ni ponctuation : « Sud - Ouest » -> « SUDOUEST »."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^A-Z0-9]", "", s.upper())


_NUM_TOKEN = re.compile(r"^-?\d+(?:[.,]\d+)?$")


def split_numbers(cell: str) -> list[float] | None:
    """Convertit une cellule en une ou plusieurs valeurs numériques.

    Les milliers sont séparés par une espace (« 3 067 940 ») et la décimale est une
    virgule. Une cellule peut contenir plusieurs nombres fusionnés à l'extraction
    (« 3 067 940 1 532 444 ») : un groupe de 3 chiffres prolonge le nombre en cours,
    tout autre groupe commence un nouveau nombre. Retourne None si la cellule
    n'est pas numérique.
    """
    s = cell.replace("\u202f", " ").replace("\xa0", " ").replace("%", "").strip()
    if s in {"", "-", "ND", "nd", "N/D"}:
        return None
    tokens = s.split()
    if not all(_NUM_TOKEN.match(t) for t in tokens):
        return None
    numbers: list[str] = []
    for tok in tokens:
        if (
            numbers
            and re.fullmatch(r"\d{3}(?:,\d+)?", tok)
            and "," not in numbers[-1]
            and not numbers[-1].startswith("-")
        ):
            numbers[-1] += tok
        else:
            numbers.append(tok)
    return [float(n.replace(",", ".")) for n in numbers]


def parse_values(cells: tuple[str, ...] | list[str]) -> list[float | None]:
    """Valeurs numériques d'une suite de cellules (None pour « ND », « - »)."""
    out: list[float | None] = []
    for c in cells:
        vals = split_numbers(c)
        if vals is None:
            out.append(None)
        else:
            out.extend(vals)
    return out


def is_numeric_cell(cell: str) -> bool:
    return split_numbers(cell) is not None or cell.strip() in {"-", "ND"}


def source_path(relpath: str) -> Path:
    return CSV_DIR / relpath

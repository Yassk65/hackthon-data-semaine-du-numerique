"""Extraction des annuaires statistiques de l'enseignement primaire (DGESS).

Huit éditions (2017-2018 à 2024-2025), découpage ancien (13 régions, 45 provinces).
Chaque parser lit les lignes du CSV jumeau, repère les pages du tableau par leur
intitulé (la numérotation change selon les éditions) et produit une table « tidy » :

    table, edition, annee_scolaire, niveau (province|region|national), code, nom,
    indicateur, classe, sexe, milieu, statut, valeur, source, page, ligne, flag_qualite

Le code est l'ancien P-code (province BFxxxx, région BFxx, national BF). Aucune valeur
n'est corrigée à la main. Les cas particuliers sont signalés par `flag_qualite` et
consignés dans le journal d'extraction (outputs/tables/journal_extraction.csv) :

- fusion_resolue : deux nombres fusionnés dans une cellule à l'extraction, séparés
  de façon unique grâce à la contrainte Total = Garçons + Filles (ou Urbain + Rural) ;
- incoherence_somme : la contrainte de somme n'est pas vérifiée dans la source ;
- abandon_nul_residuel : taux d'abandon publié à 0,0 (taux résiduel borné, D-007) ;
- annee_reetiquetee : libellé d'année erroné dans un historique, année déduite de
  la position du bloc (D-012) ;
- milieu_non_attribue : ligne où l'une des colonnes urbain/rural est vide (seul le
  total est retenu).
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field

import pandas as pd

from pipeline.config import OUTPUTS_DIR
from pipeline.geo import match_province, match_region, old_provinces
from pipeline.readers import Row, normalize_name, page_headers, parse_values, pdf_rows

ANNUAIRES_DIR = "01_Education_MENAPLN_DGESS/CNS_DGESS/Annuaires/"
EDITIONS = {
    "2017-2018": "CNS521_Annuaire_statistique_de_lenseignement_Primaire_2017_2018.csv",
    "2018-2019": "CNS522_Annuaire_statistique_de_lenseignement_Primaire_2018_2019.csv",
    "2019-2020": "CNS523_Annuaire_statistique_de_lenseignement_Primaire_2019_2020.csv",
    "2020-2021": "CNS524_Annuaire_statistique_de_lenseignement_Primaire_2020_2021.csv",
    "2021-2022": "CNS525_Annuaire_statistique_de_lenseignement_Primaire_2021_2022.csv",
    "2022-2023": "CNS526_Annuaire_statistique_de_lenseignement_Primaire_2022_2023.csv",
    "2023-2024": "CNS529_Annuaire_statistique_de_lenseignement_primaire_2023_2024.csv",
    "2024-2025": "CNS530_Annuaire_statistique_de_lenseignement_primaire_2024_2025.csv",
}
CLASSES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]
SEXES = ["G", "F", "T"]

# Intitulés repérés dans les 4 premières lignes de chaque page (texte normalisé).
TITLES = {
    "ecoles": r"NOMBREDECOLESDESALLESDECLASSEDELEVES",
    "eleves_milieu": r"NOMBREDELEVESTOTALFILLES",
    "tba": r"TAUXBRUTDADMISSIONPARSEXE",
    "tbs": r"TAUXBRUTDESCOLARISATIONPARSEXE",
    "tns": r"TAUXNETDESCOLARISATION",
    "tap": r"TAUXDACHEVEMENT",
    "flux": r"TAUXDEPROMOTIONREDOUBLEMENT",
    "historique": r"HISTORIQUEDESEFFECTIFSETDESREDOUBLANTSPARNIVEAU",
}
EXCLUDE_TITLE = r"PRIORITAIRE"
FLAG_OK = "ok"


def prev_year(year: str) -> str:
    a, b = (int(x) for x in year.split("-"))
    return f"{a - 1}-{b - 1}"


def shift_year(year: str, k: int) -> str:
    a, b = (int(x) for x in year.split("-"))
    return f"{a + k}-{b + k}"


def year_from_label(s: str) -> str | None:
    m = re.fullmatch(r"(\d{4})\s*/\s*(\d{4})", s.strip())
    if m and int(m.group(2)) == int(m.group(1)) + 1:
        return f"{m.group(1)}-{m.group(2)}"
    return None


def looks_like_year_label(s: str) -> bool:
    """Ligne d'année d'un historique, y compris les libellés abîmés (« 2005 », « 202122023 »)."""
    t = s.replace(" ", "")
    return bool(re.fullmatch(r"(\d{4}/\d{4})+|\d{4}|\d{9}", t))


@dataclass
class Extraction:
    """Accumulateur de valeurs tidy et du journal d'anomalies."""

    edition: str
    source: str
    table: str
    records: list[dict] = field(default_factory=list)
    log: list[dict] = field(default_factory=list)

    def add(self, row: Row, niveau: str, code: str, indicateur: str, valeur, annee=None,
            classe="ALL", sexe="T", milieu="ALL", statut="ALL", flag=FLAG_OK):
        self.records.append({
            "table": self.table, "edition": self.edition, "annee_scolaire": annee or self.edition,
            "niveau": niveau, "code": code, "indicateur": indicateur, "classe": classe,
            "sexe": sexe, "milieu": milieu, "statut": statut, "valeur": valeur,
            "source": self.source.replace(".csv", ".pdf"), "page": row.page, "ligne": row.ligne,
            "flag_qualite": flag,
        })

    def warn(self, row: Row | None, message: str):
        self.log.append({"edition": self.edition, "table": self.table,
                         "page": row.page if row else None, "ligne": row.ligne if row else None,
                         "message": message, "texte": row.text[:160] if row else ""})


def table_pages(rows: list[Row], key: str) -> list[int]:
    heads = page_headers(rows)
    pat = re.compile(TITLES[key])
    return sorted(p for p, h in heads.items()
                  if p > 10 and pat.search(normalize_name(h)) and not re.search(EXCLUDE_TITLE, normalize_name(h)))


def rows_of(rows: list[Row], pages: list[int]) -> list[Row]:
    ps = set(pages)
    return [r for r in rows if r.page in ps]


# --------------------------------------------------------------------------- nombres fusionnés

def _segmentations(cell: str) -> list[list[float]]:
    """Toutes les lectures possibles d'une cellule pouvant contenir des nombres fusionnés."""
    tokens = cell.replace("\xa0", " ").split()
    if not tokens or not all(re.fullmatch(r"-?\d+(?:,\d+)?", t) for t in tokens):
        return []
    free = [i for i in range(1, len(tokens)) if re.fullmatch(r"\d{3}", tokens[i])]
    forced = {i for i in range(1, len(tokens)) if i not in free}
    out = []
    for k in range(len(free) + 1):
        for starts in itertools.combinations(free, k):
            cut = sorted(forced | set(starts))
            # un nombre ne peut pas prolonger un décimal
            parts, cur = [], [tokens[0]]
            for i in range(1, len(tokens)):
                if i in cut:
                    parts.append(cur)
                    cur = [tokens[i]]
                else:
                    if "," in cur[-1]:
                        break
                    cur.append(tokens[i])
            else:
                parts.append(cur)
                out.append([float("".join(p).replace(",", ".")) for p in parts])
    return out


def read_values(cells, n: int, checks=()) -> tuple[list[float] | None, str]:
    """Lit exactement n valeurs ; sépare les nombres fusionnés si la solution est unique.

    `checks` : triplets (i, j, k) d'indices tels que valeur[k] = valeur[i] + valeur[j].
    """
    vals = parse_values(cells)
    if len(vals) == n and all(v is not None for v in vals):
        ok = all(abs(vals[k] - vals[i] - vals[j]) < 0.5 for i, j, k in checks)
        return vals, (FLAG_OK if ok else "incoherence_somme")
    if len(vals) > n or not checks:
        return None, f"{len(vals)} valeurs au lieu de {n}"
    options = [(_segmentations(c) or [[None]]) for c in cells]
    sols = set()
    for combo in itertools.product(*options):
        flat = [v for part in combo for v in part]
        if len(flat) != n or any(v is None for v in flat):
            continue
        if all(abs(flat[k] - flat[i] - flat[j]) < 0.5 for i, j, k in checks):
            sols.add(tuple(flat))
        if len(sols) > 1:
            break
    if len(sols) == 1:
        return list(sols.pop()), "fusion_resolue"
    return None, f"{len(vals)} valeurs au lieu de {n} (fusion non résolue)"


# --------------------------------------------------------------------------- étiquettes

def classify_label(label: str, last_region: str | None):
    """(niveau, code) d'une étiquette de ligne, ou None."""
    n = normalize_name(label)
    if n.startswith("TOTALNATIONAL") or n in {"NATIONAL", "BURKINAFASO", "BURKINA"}:
        return "national", "BF"
    if n.startswith("TOTALREG"):
        return ("region", last_region) if last_region else None
    code = match_province(label)
    if code:
        return "province", code
    rcode = match_region(label)
    if rcode:
        return "region_header", rcode
    return None


# --------------------------------------------------------------------------- tableaux simples

TRIPLE_CHECKS = ((0, 1, 2), (3, 4, 5))
SIMPLE_SPECS = {
    "tba": (["pop_6ans", "nouveaux_cp1", "tba"], TRIPLE_CHECKS),
    "tbs": (["pop_6_11", "eleves", "tbs"], TRIPLE_CHECKS),
    "tns": (["pop_6_11", "eleves_6_11", "tns"], TRIPLE_CHECKS),
    "tap": (["pop_11ans", "nouveaux_cm2", "tap"], TRIPLE_CHECKS),
    "eleves_milieu": (None, ((0, 3, 6), (1, 4, 7))),
}
MILIEU_COLS = [("eleves", "T", "U"), ("eleves", "F", "U"), ("pct_filles", "T", "U"),
               ("eleves", "T", "R"), ("eleves", "F", "R"), ("pct_filles", "T", "R"),
               ("eleves", "T", "ALL"), ("eleves", "F", "ALL"), ("pct_filles", "T", "ALL")]


def _emit_simple(ex: Extraction, r: Row, niveau: str, code: str, vals, flag: str):
    inds, _ = SIMPLE_SPECS[ex.table]
    if inds is None:
        for v, (ind, sexe, milieu) in zip(vals, MILIEU_COLS):
            ex.add(r, niveau, code, ind, v, sexe=sexe, milieu=milieu, flag=flag)
        return
    for k, v in enumerate(vals):
        ex.add(r, niveau, code, inds[k // 3], v, sexe=SEXES[k % 3], flag=flag)


def parse_simple(ex: Extraction, rows: list[Row]):
    _, checks = SIMPLE_SPECS[ex.table]
    trows = rows_of(rows, table_pages(rows, ex.table))
    last_region = None
    pending_national = False
    for r in trows:
        if not r.cells:
            continue
        if pending_national and not re.search(r"[A-Za-z]", r.text):
            vals, flag = read_values(r.cells, 9, checks)
            if vals:
                _emit_simple(ex, r, "national", "BF", vals, flag)
                pending_national = False
                continue
        cls = classify_label(r.cells[0], last_region)
        if cls is None or cls[0] == "region_header":
            continue
        niveau, code = cls
        if niveau == "province":
            last_region = code[:4]
        rest = r.cells[1:]
        if niveau == "national" and not any(v is not None for v in parse_values(rest)):
            pending_national = True  # en-tête répété, valeurs sur la ligne suivante
            continue
        vals, flag = read_values(rest, 9, checks)
        if vals is None and niveau == "national":
            pending_national = True
            continue
        if vals is None and ex.table == "eleves_milieu":
            v6, _ = read_values(rest, 6)
            if v6 and v6[:3] == v6[3:]:
                for v, (ind, sexe, _m) in zip(v6[3:], MILIEU_COLS[6:]):
                    ex.add(r, niveau, code, ind, v, sexe=sexe, milieu="ALL", flag="milieu_non_attribue")
                ex.warn(r, "une colonne urbain/rural vide : seul le total est retenu")
                continue
        if vals is None:
            ex.warn(r, flag)
            continue
        if flag != FLAG_OK:
            ex.warn(r, flag)
        _emit_simple(ex, r, niveau, code, vals, flag)


# --------------------------------------------------------------------------- I.1 écoles

ECOLE_COLS = ["ecoles", "salles", "groupes_pedagogiques", "maitres", "eleves", "ratio_eleves_maitre"]
STATUTS = {"PUBLIC": "PUBLIC", "PRIVE": "PRIVE", "TOTAL": "ALL"}


def parse_ecoles(ex: Extraction, rows: list[Row]):
    trows = rows_of(rows, table_pages(rows, "ecoles"))
    current = None
    last_region = None
    for r in trows:
        cells = list(r.cells)
        if not cells:
            continue
        first = normalize_name(cells[0])
        if first.startswith("TOTALNATIONAL"):
            current = ("national", "BF")
            continue
        j = next((j for j, c in enumerate(cells[:3]) if normalize_name(c) in STATUTS), None)
        if j is None:
            continue
        statut = STATUTS[normalize_name(cells[j])]
        label = " ".join(cells[:j])
        if label:
            cls = classify_label(label, last_region)
            if cls is None or cls[0] == "region_header":
                ex.warn(r, f"étiquette non reconnue : {label}")
                current = None
                continue
            current = cls
            if cls[0] == "province":
                last_region = cls[1][:4]
        if current is None:
            continue
        vals, flag = read_values(cells[j + 1:], len(ECOLE_COLS))
        if vals is None:
            ex.warn(r, flag)
            continue
        for ind, v in zip(ECOLE_COLS, vals):
            ex.add(r, current[0], current[1], ind, v, statut=statut, flag=flag)


# --------------------------------------------------------------------------- I.7 flux

def parse_flux(ex: Extraction, rows: list[Row]):
    """Taux de promotion, redoublement et abandon publiés.

    Dans l'édition t, ces taux décrivent la cohorte de l'année t-1 (passage de t-1 à t),
    ce qui a été vérifié en les recalculant à partir des historiques (DECISIONS.md, D-011).
    Promotion et abandon : CP1 à CM1 (15 valeurs) ; redoublement : CP1 à CM2 (18 valeurs).
    """
    trows = rows_of(rows, table_pages(rows, "flux"))
    cohort = prev_year(ex.edition)
    block: dict = {}
    last_single = ""
    for r in trows:
        cells = list(r.cells)
        if not cells:
            continue
        idx = next((j for j, c in enumerate(cells) if re.search(r"TX\s*(Prom|Red|Aban)", c, re.I)), None)
        if idx is None:
            if len(cells) == 1 and not re.fullmatch(r"\d+", cells[0]):
                last_single = cells[0]
            continue
        kind = re.search(r"TX\s*(Prom|Red|Aban)", cells[idx], re.I).group(1).lower()
        name = " ".join(cells[:idx] + [re.sub(r"TX\s*(Prom|Red|Aban)", "", cells[idx], flags=re.I)]).strip()
        block[kind] = (r, cells[idx + 1:])
        if kind == "red":
            block["name"], block["prefix"] = name, last_single
        if kind == "aban":
            _emit_flux(ex, block, cohort)
            block, last_single = {}, ""


def _emit_flux(ex: Extraction, block: dict, cohort: str):
    name, prefix = block.get("name", ""), block.get("prefix", "")
    joined = match_region(prefix + " " + name) if prefix else None
    if joined and not match_region(prefix):
        niveau, code = "region", joined
    elif normalize_name(name).startswith("TOTALNATIONAL") or normalize_name(name) == "NATIONAL":
        niveau, code = "national", "BF"
    elif match_region(name):
        niveau, code = "region", match_region(name)
    elif match_province(name):
        niveau, code = "province", match_province(name)
    else:
        ex.warn(block.get("red", (None,))[0], f"bloc sans nom reconnu : {name!r}")
        return
    expected = {"prom": 15, "red": 18, "aban": 15}
    for kind, ind in [("prom", "taux_promotion"), ("red", "taux_redoublement"), ("aban", "taux_abandon")]:
        if kind not in block:
            ex.warn(None, f"{name} : ligne {kind} absente")
            continue
        r, cells = block[kind]
        vals, flag = read_values(cells, expected[kind])
        if vals is None:
            ex.warn(r, f"{name} : {flag}")
            continue
        for k, v in enumerate(vals):
            f = "abandon_nul_residuel" if (kind == "aban" and v == 0.0) else flag
            ex.add(r, niveau, code, ind, v, annee=cohort, classe=CLASSES[k // 3], sexe=SEXES[k % 3], flag=f)


# --------------------------------------------------------------------------- historiques

HIST_SEXES = {"GARCONS": "G", "FILLES": "F", "TOTAL": "T"}


def parse_historique(ex: Extraction, rows: list[Row]):
    """Effectifs et redoublants par niveau, sexe, entité et année.

    Les libellés d'année sont parfois abîmés dans la source (« 2005 », « 202122023 »,
    année répétée). Les années sont donc attribuées par position (bloc k = édition - k)
    quand l'entité a le nombre de blocs attendu ; un bloc identique au précédent est écarté.
    """
    trows = rows_of(rows, table_pages(rows, "historique"))
    entities: list[dict] = []
    singles: list[Row] = []
    current = None
    for r in trows:
        cells = list(r.cells)
        if not cells:
            continue
        if len(cells) == 1 and looks_like_year_label(cells[0]):
            if singles:
                label = singles[-1].text
                prov, reg = match_province(label), match_region(label)
                if prov:
                    current = {"entity": ("province", prov), "blocks": []}
                elif reg:
                    current = {"entity": ("region", reg), "blocks": []}
                elif normalize_name(label) in {"NATIONAL", "TOTALNATIONAL", "BURKINAFASO"}:
                    current = {"entity": ("national", "BF"), "blocks": []}
                else:
                    ex.warn(singles[-1], f"entité non reconnue : {label!r}")
                    current = None
                if current:
                    entities.append(current)
                singles = []
            if current is not None:
                current["blocks"].append({"label_row": r, "label": cells[0], "rows": {}})
            continue
        if len(cells) == 1:
            if not re.fullmatch(r"\d+", cells[0]):
                singles.append(r)
            continue
        sexe = HIST_SEXES.get(normalize_name(cells[0]))
        if sexe is None or current is None or not current["blocks"]:
            continue
        vals = parse_values(cells[1:])
        if not any(v is not None for v in vals):
            continue  # ligne d'en-tête « Total | dont R ... »
        vals, flag = read_values(cells[1:], 14)
        if vals is None:
            ex.warn(r, flag)
            continue
        current["blocks"][-1]["rows"][sexe] = (r, vals, flag)

    counts = pd.Series([len(e["blocks"]) for e in entities])
    expected = int(counts.mode().iloc[0]) if len(counts) else 0
    for e in entities:
        blocks = e["blocks"]
        # Écarte un bloc strictement identique au précédent (même libellé, mêmes valeurs).
        dedup = []
        for b in blocks:
            if dedup and b["label"] == dedup[-1]["label"] and \
                    {s: v[1] for s, v in b["rows"].items()} == {s: v[1] for s, v in dedup[-1]["rows"].items()}:
                ex.warn(b["label_row"], f"{e['entity'][1]} : bloc {b['label']} dupliqué, écarté")
                continue
            dedup.append(b)
        positional = len(dedup) == expected
        if not positional:
            ex.warn(dedup[0]["label_row"] if dedup else None,
                    f"{e['entity'][1]} : {len(dedup)} blocs au lieu de {expected}, années lues sur les libellés")
        for k, b in enumerate(dedup):
            label_year = year_from_label(b["label"])
            year = shift_year(ex.edition, -k) if positional else label_year
            if year is None:
                ex.warn(b["label_row"], f"année illisible : {b['label']!r}")
                continue
            relabel = label_year != year
            if relabel:
                ex.warn(b["label_row"], f"{e['entity'][1]} : libellé {b['label']!r} -> {year}")
            for sexe, (r, vals, flag) in b["rows"].items():
                f = "annee_reetiquetee" if relabel else flag
                for j, cl in enumerate(CLASSES + ["ALL"]):
                    ex.add(r, e["entity"][0], e["entity"][1], "effectif", vals[2 * j], annee=year,
                           classe=cl, sexe=sexe, flag=f)
                    ex.add(r, e["entity"][0], e["entity"][1], "redoublants", vals[2 * j + 1], annee=year,
                           classe=cl, sexe=sexe, flag=f)


# --------------------------------------------------------------------------- orchestration

PARSERS = {
    "ecoles": parse_ecoles,
    "eleves_milieu": parse_simple,
    "tba": parse_simple,
    "tbs": parse_simple,
    "tns": parse_simple,
    "tap": parse_simple,
    "flux": parse_flux,
    "historique": parse_historique,
}
KEYS = ["table", "edition", "annee_scolaire", "niveau", "code", "indicateur", "classe", "sexe", "milieu", "statut"]


def extract_all() -> tuple[pd.DataFrame, pd.DataFrame]:
    recs, logs = [], []
    for edition, fname in EDITIONS.items():
        rows = pdf_rows(ANNUAIRES_DIR + fname)
        for table, func in PARSERS.items():
            ex = Extraction(edition, fname, table)
            func(ex, rows)
            recs.extend(ex.records)
            logs.extend(ex.log)
    df = pd.DataFrame(recs)
    # Blocs répétés dans la source (ex. Kadiogo et Centre dans un même tableau) : 1re occurrence.
    dup = df.duplicated(KEYS, keep="first")
    for _, d in df[dup].iterrows():
        logs.append({"edition": d.edition, "table": d.table, "page": d.page, "ligne": d.ligne,
                     "message": "doublon ignoré", "texte": f"{d.code} {d.indicateur} {d.annee_scolaire}"})
    df = df[~dup]
    op = old_provinces()
    names = {**op.set_index("old_prov_code")["old_prov_name"].to_dict(),
             **op.drop_duplicates("old_reg_code").set_index("old_reg_code")["old_reg_name"].to_dict(),
             "BF": "Burkina Faso"}
    df.insert(df.columns.get_loc("code") + 1, "nom", df["code"].map(names))
    return df.reset_index(drop=True), pd.DataFrame(logs)


def run() -> pd.DataFrame:
    out = OUTPUTS_DIR / "tables"
    out.mkdir(parents=True, exist_ok=True)
    df, log = extract_all()
    df.to_csv(out / "annuaires_primaire_tidy.csv", sep=";", index=False, encoding="utf-8")
    log.to_csv(out / "journal_extraction.csv", sep=";", index=False, encoding="utf-8")
    return df


if __name__ == "__main__":
    d = run()
    print(d.groupby(["table", "edition", "niveau"]).code.nunique().unstack(["niveau"]).to_string())
    print(d.flag_qualite.value_counts().to_string())

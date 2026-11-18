"""Inventaire machine du Data Pack (Phase 0).

Écrit outputs/inventory/inventaire_fichiers.csv : une ligne par fichier du pack
(source ou CSV extrait) avec sa taille et, pour les CSV, quelques statistiques
de structure (lignes, pages, méthode d'extraction, lignes portant une remarque
de collecte). Lecture seule sur le Data Pack.

Usage : python -m pipeline.inventory
"""

import csv
from pathlib import Path

from pipeline.config import CSV_DIR, IGNORED_PACK_COLUMNS, OUTPUTS_DIR, RAW_DIR

PDF_COLUMNS = {"document", "page", "ligne", "nb_cellules"}
FIELDS = [
    "chemin",
    "role",
    "domaine",
    "extension",
    "taille_ko",
    "format_csv",
    "n_lignes",
    "n_pages",
    "methode_extraction",
    "lignes_remarque_collecte",
]


def csv_stats(path: Path) -> dict:
    """Statistiques de structure d'un CSV du pack (séparateur « ; », UTF-8)."""
    stats = {"n_lignes": 0, "n_pages": "", "methode_extraction": "", "lignes_remarque_collecte": 0}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh, delimiter=";")
        header = next(reader, [])
        idx = {name: i for i, name in enumerate(header)}
        if PDF_COLUMNS <= idx.keys():
            stats["format_csv"] = "pdf_lignes"
        elif header[:1] == ["col1"]:
            stats["format_csv"] = "excel_colN"
        else:
            stats["format_csv"] = "natif"
        pages, methods = set(), set()
        remark_cols = [idx[c] for c in IGNORED_PACK_COLUMNS if c in idx]
        for row in reader:
            stats["n_lignes"] += 1
            i = idx.get("page")
            if i is not None and i < len(row) and row[i].isdigit():
                pages.add(int(row[i]))
            i = idx.get("methode")
            if i is not None and i < len(row) and row[i]:
                methods.add(row[i])
            if any(j < len(row) and row[j].strip() for j in remark_cols):
                stats["lignes_remarque_collecte"] += 1
        stats["n_pages"] = max(pages) if pages else ""
        stats["methode_extraction"] = " / ".join(sorted(methods))
    return stats


def build_inventory() -> list[dict]:
    rows = []
    for path in sorted(RAW_DIR.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(RAW_DIR)
        is_csv_twin = rel.parts[0] == CSV_DIR.name
        domain_parts = rel.parts[1:] if is_csv_twin else rel.parts
        row = {
            "chemin": rel.as_posix(),
            "role": "csv_extrait" if is_csv_twin else "source",
            "domaine": domain_parts[0] if len(domain_parts) > 1 else "racine",
            "extension": path.suffix.lower().lstrip("."),
            "taille_ko": round(path.stat().st_size / 1024),
        }
        if path.suffix.lower() == ".csv":
            row.update(csv_stats(path))
        rows.append(row)
    return rows


def main() -> None:
    out_dir = OUTPUTS_DIR / "inventory"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = build_inventory()
    out = out_dir / "inventaire_fichiers.csv"
    with out.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    n_src = sum(r["role"] == "source" for r in rows)
    n_csv = sum(r["role"] == "csv_extrait" for r in rows)
    n_ocr = sum("OCR" in str(r.get("methode_extraction", "")) for r in rows)
    n_rem = sum(1 for r in rows if r.get("lignes_remarque_collecte"))
    print(f"{out} : {n_src} fichiers sources, {n_csv} CSV extraits, "
          f"{n_ocr} CSV OCR, {n_rem} CSV avec remarque_collecte")


if __name__ == "__main__":
    main()

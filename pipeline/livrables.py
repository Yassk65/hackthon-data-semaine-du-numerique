"""Prépare le dossier à déposer : solution, documentation et données de travail rangées par étape.

    python -m pipeline.livrables [--equipe CODE] [--github URL] [--site URL] [--version N]

Structure produite dans livrables/ (ignoré par git, régénérable) :
    LISEZ-MOI.md
    1_solution/                  liens, instructions de relance, archive du code (git archive du dernier commit)
    2_documentation/             note technique (PDF, 15 pages maximum)
    3_donnees_de_travail/        01_collecte ... 05_interpretation + INDEX_fichiers.csv

Nom des fichiers : EQUIPE_ÉTAPE_DÉFI_RÔLE_description_vN.extension (sans accents ni espaces).
Les fichiers de plus de 5 Mo sont compressés en .zip. Le Data Pack n'est jamais copié.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
import unicodedata
import zipfile
from pathlib import Path

import pandas as pd

from pipeline.config import OUTPUTS_DIR, ROOT

DEFI = "D1"
ETAPES = {"01": "01_collecte", "02": "02_nettoyage", "03": "03_analyse", "04": "04_visualisation", "05": "05_interpretation"}
ZIP_ABOVE = 5 * 1024 * 1024
MEMBRES = ["Yassine Ouedraogo", "RABESIAKA Andriampitahiana Mamy Herin'Ny Avo"]
WEB_DATA = ROOT / "web" / "public" / "data"


def slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def git(*args: str) -> str:
    done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True, encoding="utf-8")
    return done.stdout.strip()


class Builder:
    def __init__(self, out: Path, equipe: str, version: int):
        self.out, self.equipe, self.version = out, equipe, version
        self.index: list[dict] = []

    def name(self, etape: str, role: str, desc: str, ext: str) -> str:
        return f"{self.equipe}_{etape}_{DEFI}_{role}_{slug(desc)}_v{self.version}{ext}"

    def add(self, etape: str, role: str, src: Path, desc: str) -> None:
        """Copie un fichier du dépôt dans l'étape, en le compressant s'il est volumineux."""
        if not src.exists():
            raise FileNotFoundError(f"{src} : lancer d'abord `python -m pipeline all`")
        folder = self.out / "3_donnees_de_travail" / ETAPES[etape]
        folder.mkdir(parents=True, exist_ok=True)
        if src.stat().st_size > ZIP_ABOVE:
            dest = folder / self.name(etape, role, desc, ".zip")
            with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
                z.write(src, arcname=self.name(etape, role, desc, src.suffix))
        else:
            dest = folder / self.name(etape, role, desc, src.suffix.lower())
            shutil.copyfile(src, dest)
        self.record(etape, role, dest, src)

    def add_bytes(self, etape: str, role: str, content: bytes, desc: str, ext: str, origin: str) -> None:
        folder = self.out / "3_donnees_de_travail" / ETAPES[etape]
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / self.name(etape, role, desc, ext)
        dest.write_bytes(content)
        self.record(etape, role, dest, Path(origin))

    def add_zip(self, etape: str, role: str, files: list[Path], desc: str) -> None:
        folder = self.out / "3_donnees_de_travail" / ETAPES[etape]
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / self.name(etape, role, desc, ".zip")
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for f in files:
                z.write(f, arcname=f.name)
        self.record(etape, role, dest, Path(f"{files[0].parent.relative_to(ROOT).as_posix()}/*"))

    def record(self, etape: str, role: str, dest: Path, src: Path) -> None:
        try:
            origin = src.relative_to(ROOT).as_posix()
        except ValueError:
            origin = src.as_posix()
        self.index.append({"fichier": dest.name, "etape": ETAPES[etape], "role": role,
                           "origine_dans_le_depot": origin,
                           "taille_ko": round(dest.stat().st_size / 1024)})


def ranking_csv() -> bytes:
    """Classement lisible des 47 provinces à l'horizon de prévision, tiré des fichiers de l'application."""
    meta = json.loads((WEB_DATA / "meta.json").read_text(encoding="utf-8"))
    risk = json.loads((WEB_DATA / "risk.json").read_text(encoding="utf-8"))
    last, horizon = meta["derniere_annee"], meta["horizon"]
    levels = ["Très faible", "Faible", "Modéré", "Élevé", "Très élevé"]
    rows = []
    for code, unit in meta["unites"]["prov"].items():
        r = risk["prov"][code]
        p, ix, reco = r["prediction"].get(horizon), r["indice"].get(last), risk["recommandations"]["prov"].get(code)
        if not p or not ix:
            continue
        rows.append({
            "code": code, "province": unit["nom"], "region": unit["reg_nom"], "situation": last, "anticipation": horizon,
            "deperdition_anticipee_pct": p["valeur"], "ic80_bas": p["ic80"][0], "ic80_haut": p["ic80"][1],
            "proba_alerte": p["p_alerte"], "rang_prevision": p["rang"], "indice_risque": ix["score"],
            "niveau_risque": levels[ix["classe"] - 1], "rang_indice": ix["rang"],
            "facteurs_indice": ix["facteurs"], "facteurs_modele": p["facteurs"],
            "priorite": reco["priorite"] if reco else None,
            "pistes": " ; ".join(t["titre"] for t in reco["types"]) if reco else "",
        })
    df = pd.DataFrame(rows).sort_values("rang_prevision")
    return df.to_csv(sep=";", index=False, decimal=",", encoding="utf-8-sig").encode("utf-8-sig")


def collect(b: Builder) -> None:
    t, m, q, g = OUTPUTS_DIR / "tables", OUTPUTS_DIR / "model", OUTPUTS_DIR / "quality", OUTPUTS_DIR / "geo"
    # 01 collecte : inventaire des sources et extraction des tableaux des annuaires.
    inventory = OUTPUTS_DIR / "inventory" / "inventaire_fichiers.csv"
    b.add("01", "DATA", inventory, "inventaire fichiers du data pack")
    b.add("01", "DATA", ROOT / "DATA_INVENTORY.md", "inventaire et choix des sources")
    b.add("01", "DATA", t / "annuaires_primaire_tidy.csv", "annuaires primaire valeurs extraites avec provenance")
    b.add("01", "DATA", t / "journal_extraction.csv", "journal des anomalies d extraction")
    b.add("01", "DATA", t / "pauvrete_provinces_anciennes.csv", "pauvrete par province 2019")
    b.add("01", "DATA", t / "pdi_communes_annee_scolaire.csv", "deplaces internes par commune et annee scolaire")
    b.add("01", "DATA", t / "ecoles_osm.csv", "ecoles openstreetmap")
    # 02 nettoyage : contrôles de qualité, harmonisation territoriale, décisions.
    for f in sorted(q.glob("*")):
        b.add("02", "DATA", f, f"controle qualite {f.stem}")
    b.add("02", "DATA", t / "base_additive_provinces_anciennes.csv", "base additive par ancienne province")
    b.add("02", "DATA", t / "comparaison_taux_publies_reconstitues.csv", "comparaison taux publies et reconstitues")
    for f in sorted(g.glob("*")):
        b.add("02", "DATA", f, f"referentiel territorial {f.stem}")
    b.add("02", "DATA", ROOT / "DECISIONS.md", "journal des decisions de traitement")
    # 03 analyse : indicateurs, indice composite, modèle et validation.
    for name in ["indicateurs_prov", "indicateurs_reg", "indicateurs_national", "indicateurs_old_prov", "indicateurs_old_reg"]:
        b.add("03", "ANALYSTE", t / f"{name}.csv", f"indicateurs {name.replace('indicateurs_', '')}")
    for f in sorted(m.glob("*")):
        b.add("03", "ANALYSTE", f, f"modele {f.stem}")
    params = ROOT / "web" / "engine" / "data" / "engine_model.json"
    b.add("03", "ANALYSTE", params, "parametres du modele pour le backend")
    # 04 visualisation : figures, captures de l'application, données de l'application.
    for f in sorted((ROOT / "docs" / "figures").glob("*.png")):
        b.add("04", "DEV", f, f"figure {f.stem}")
    for name in ["comprendre", "explorer_prevision", "explorer_fiche", "explorer_comparaison", "anticiper", "methode",
                 "mobile_explorer", "sombre_explorer"]:
        shot = OUTPUTS_DIR / "screens" / f"{name}.png"
        if shot.exists():
            b.add("04", "DEV", shot, f"capture application {name}")
    b.add_zip("04", "DEV", sorted(f for f in WEB_DATA.iterdir() if f.is_file()), "donnees de l application web")
    # 05 interprétation : classement, recommandations, dictionnaire.
    b.add_bytes("05", "REDACTION", ranking_csv(), "classement des provinces et pistes d action", ".csv",
                "web/public/data/risk.json")
    b.add("05", "REDACTION", ROOT / "docs" / "recommandations.md", "recommandations par type de province")
    b.add("05", "REDACTION", ROOT / "docs" / "dictionnaire_donnees.md", "dictionnaire de donnees")


def readme(b: Builder, github: str, site: str, commit: str, n_pages: int) -> str:
    tree = "\n".join(f"  - {ETAPES[k]}/" for k in ETAPES)
    return f"""# Décrochage scolaire au primaire : cartographie et anticipation (Burkina Faso)

Data Challenge Burkina 2026, **Défi 1 : décrochage scolaire**. Équipe : {" et ".join(MEMBRES)}.

## Ce qui est déposé

1. **Solution** (`1_solution/`) : application web de cartographie et d'anticipation, avec son backend de calcul.
   - Application en ligne : {site}
   - Code et historique : {github}
   - Archive du code au commit `{commit}` et instructions pour la relancer : voir `1_solution/`.
2. **Documentation** (`2_documentation/`) : note technique de {n_pages} pages (maximum 15).
3. **Données de travail** (`3_donnees_de_travail/`), rangées par étape :
{tree}

Les noms de fichiers suivent `EQUIPE_ÉTAPE_DÉFI_RÔLE_description_vN` : équipe `{b.equipe}`, étape `01` à `05`, défi `{DEFI}`,
rôle (`DATA` : collecte et nettoyage, `ANALYSTE` : indice et modèle, `DEV` : application et backend,
`REDACTION` : interprétation), version `v{b.version}`.
`3_donnees_de_travail/INDEX_fichiers.csv` donne l'origine de chaque fichier dans le dépôt.
Les fichiers de plus de 5 Mo sont compressés (.zip).

## Relancer la solution

```
python -m venv .venv && .venv\\Scripts\\activate     (Linux/macOS : source .venv/bin/activate)
pip install -r requirements.txt
python -m pipeline all                 # régénère les tableaux, l'indice, le modèle et les données de l'application
pnpm --dir web install --frozen-lockfile
pnpm --dir web build                   # application dans web/dist
pnpm --dir web api                     # API de calcul locale (dans un 2e terminal : pnpm --dir web dev)
```

Le Data Pack officiel (869 Mo) n'est pas inclus : il se place dans `DataPack_DCB_2026/` pour relancer le pipeline.
L'application et son backend fonctionnent sans lui, à partir des données versionnées dans `web/public/data/`.

## Points à connaître

- La version en ligne est la version statique (cartes, classements, fiches). Le backend de calcul et la rédaction par IA sont
  dans le code ; ils s'activent au déploiement par Git ou par la ligne de commande Netlify (`netlify deploy --build --prod`
  depuis `web/`). La rédaction par IA demande une clé OpenRouter, à créer dans les variables d'environnement du serveur.
- Le fichier d'exemple de la vue « Mettre à jour » (`exemple_fictif_2025-2026.csv`) contient des **données fictives**,
  pour essayer l'outil.
- Sources : annuaires statistiques de l'enseignement primaire (MEBAPLN/DGESS), RGPH 2019 et cartographie de la pauvreté (INSD),
  déplacés internes (SP/CONASUR), limites COD-AB (IGB/OCHA, CC BY-IGO), écoles © contributeurs OpenStreetMap (ODbL).
"""


def solution_notes(b: Builder, github: str, site: str, commit: str) -> str:
    return f"""# Solution : liens et relance

- Application en ligne : {site}
- Code source (GitHub) : {github}
- Commit livré : `{commit}`
- Archive du code : `{b.name("04", "DEV", "code source", ".zip")}` (fichiers suivis par git au commit ci-dessus)

## Lancer en local (sans compte)

```
pnpm --dir web install --frozen-lockfile
pnpm --dir web build && pnpm --dir web preview    # application sur http://localhost:4173
pnpm --dir web api                                # API de calcul sur http://127.0.0.1:8787 (stockage en mémoire)
pnpm --dir web dev                                # développement ; /api est redirigé vers l'API locale
```

Rédaction par IA : copier `web/.env.example` en `web/.env` et renseigner `OPENROUTER_API_KEY` (fichier ignoré par git).
Sans clé, le rapport de secours (gabarit) est utilisé.

## Déployer sur Netlify (application + fonctions)

Depuis le dossier `web`, après `netlify login` et `netlify link` : `netlify deploy --build --prod`.
Créer ensuite `OPENROUTER_API_KEY` dans Site configuration > Environment variables. Voir `web/netlify.toml`.
"""


def run(equipe: str, github: str, site: str, version: int, out_dir: Path) -> dict:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    b = Builder(out_dir, equipe, version)
    (out_dir / "1_solution").mkdir(parents=True)
    (out_dir / "2_documentation").mkdir()
    collect(b)

    import pymupdf  # noqa: PLC0415 (dépendance déjà utilisée par le contrôle des PDF)

    pdf = ROOT / "docs" / "note_technique.pdf"
    n_pages = len(pymupdf.open(pdf))
    if n_pages > 15:
        raise SystemExit(f"la note fait {n_pages} pages (maximum 15)")
    shutil.copyfile(pdf, out_dir / "2_documentation" / b.name("05", "REDACTION", "note technique", ".pdf"))
    text_name = b.name("05", "REDACTION", "note technique texte", ".md")
    shutil.copyfile(ROOT / "docs" / "note_technique.md", out_dir / "2_documentation" / text_name)

    commit = git("rev-parse", "--short", "HEAD")
    archive = out_dir / "1_solution" / b.name("04", "DEV", "code source", ".zip")
    git("archive", "--format=zip", "-o", str(archive), "HEAD")
    notes = out_dir / "1_solution" / b.name("04", "DEV", "liens et relance", ".md")
    notes.write_text(solution_notes(b, github, site, commit), encoding="utf-8")
    (out_dir / "LISEZ-MOI.md").write_text(readme(b, github, site, commit, n_pages), encoding="utf-8")

    with (out_dir / "3_donnees_de_travail" / "INDEX_fichiers.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(b.index[0]), delimiter=";")
        w.writeheader()
        w.writerows(b.index)
    return {"fichiers": len(b.index), "pages_note": n_pages, "commit": commit,
            "taille_mo": round(sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file()) / 1024 / 1024, 1)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--equipe", default="YASSK65", help="code d'équipe utilisé dans les noms de fichiers")
    ap.add_argument("--github", default="https://github.com/Yassk65/hackthon-data-semaine-du-numerique")
    ap.add_argument("--site", default="https://hackatho-data-equipe-yassk65.netlify.app/")
    ap.add_argument("--version", type=int, default=1)
    ap.add_argument("--out", default=str(ROOT / "livrables"))
    a = ap.parse_args()
    print(run(a.equipe, a.github, a.site, a.version, Path(a.out)))


if __name__ == "__main__":
    main()

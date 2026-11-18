# Décrochage scolaire au primaire : cartographie et anticipation

Data Challenge Burkina 2026, Défi 1. Outil d'aide à la décision pour le pilotage éducatif : diagnostic cartographique de la déperdition scolaire au primaire par région et province, indice composite de risque, prévision de l'année suivante avec son incertitude, et pistes d'action. Les cartes suivent le découpage administratif de 2025 (17 régions, 47 provinces).

| Livrable | Emplacement |
|---|---|
| Application web (statique, déployable) | `web/` ; version construite dans `web/dist/` |
| Note technique (9 pages) | `docs/note_technique.pdf` (sources : `docs/note_technique.md`, `.html`) |
| Recommandations ciblées | `docs/recommandations.md` |
| Dictionnaire de données | `docs/dictionnaire_donnees.md` |
| Pipeline reproductible | `pipeline/`, `Makefile` |
| Journal des décisions, inventaire des données | `DECISIONS.md`, `DATA_INVENTORY.md` |

## Installation

Prérequis : Python 3.11 ou plus, Node.js 20 ou plus avec pnpm (`corepack enable`), et le Data Pack officiel copié dans `DataPack_DCB_2026/`. Un autre emplacement peut être indiqué avec la variable `DCB_DATA_DIR`. Chrome ou Edge sert à la vérification de rendu et à la génération du PDF ; indiquer `CHROME_PATH` s'il n'est pas à l'emplacement habituel.

```bash
python -m venv .venv
# Windows : .venv\Scripts\activate    Linux/macOS : source .venv/bin/activate
pip install -r requirements.txt
pnpm --dir web install --frozen-lockfile
```

## Commandes

| Commande | Effet |
|---|---|
| `make all` | pipeline, tests, construction et vérification de l'application, note technique |
| `python -m pipeline all` | pipeline seul (équivalent de `make pipeline`, utile sans make) |
| `python -m pipeline <étape>` | une étape : `inventory`, `geo`, `extract`, `context`, `features`, `quality`, `index`, `model`, `export`, `figures` |
| `python -m pytest -q` | 42 tests : valeurs de contrôle, sommes, topologie, absence de fuite d'information |
| `pnpm --dir web dev` | application en mode développement (http://localhost:5173) |
| `pnpm --dir web build` | application construite dans `web/dist/` |
| `pnpm --dir web test` | 21 tests de rendu (Vitest) |
| `pnpm --dir web check` | rendu dans Chrome sans interface : 11 vues, aucune erreur console, captures dans `outputs/screens/` |
| `python -m docs.build_note` | note technique (Markdown, HTML, PDF) et recommandations |

Le pipeline lit le Data Pack en lecture seule, fixe la graine aléatoire (42) et écrit dans `outputs/` (non versionné) et `web/public/data/` (versionné). Deux exécutions successives produisent des fichiers identiques.

## Déploiement

L'application est une page statique : les données sont pré-calculées et aucune clé d'API ni tuile externe n'est nécessaire. Les chemins sont relatifs : `web/dist/` peut être servi depuis n'importe quel sous-dossier.

- **GitHub Pages** : le flux `.github/workflows/deploy.yml` construit et publie l'application à chaque envoi sur `main`. Il faut activer « GitHub Actions » comme source dans les réglages Pages du dépôt.
- **Netlify ou Vercel** : commande de construction `pnpm --dir web install && pnpm --dir web build`, dossier publié `web/dist`.
- **Hors ligne** : copier `web/dist/` sur un serveur web local, par exemple `python -m http.server -d web/dist`.

L'état de l'interface (vue, couche, année, échelle, sélection, comparaison) est conservé dans l'URL, par exemple `#/explorer?couche=tap&annee=2024-2025&echelle=prov&sel=BF6402`.

## Structure

```
DataPack_DCB_2026/   Data Pack officiel (lecture seule, non versionné)
pipeline/            readers, geo, extract_annuaires, extract_context, features, quality,
                     risk_index, model, export, figures ; point d'entrée __main__.py
tests/               tests pytest
outputs/             tables propres, qualité, géométries, résultats du modèle, figures (régénérables)
web/                 application Vite + React + TypeScript + MapLibre GL
  public/data/       données exportées par le pipeline (seule source des valeurs affichées)
  src/               composants, vues, couches, textes (src/i18n/fr.json)
  scripts/check.mjs  vérification de rendu
docs/                note technique, recommandations, dictionnaire de données, générateur
```

## Méthode en bref

1. **Extraction** des 8 annuaires du primaire (2017-18 à 2024-25). Chaque valeur garde sa provenance (document, page, ligne). Les anomalies de la source sont signalées, jamais corrigées en silence.
2. **Harmonisation territoriale** : correspondance commune par commune entre l'ancien découpage (13 régions, 45 provinces) et celui de 2025 (17 régions, 47 provinces). Les provinces scindées (Soum, Tapoa) sont réparties au prorata de la population 2019.
3. **Déperdition reconstituée** par la méthode de la cohorte (UNESCO), à la place du taux d'abandon publié, qui est résiduel et borné à zéro.
4. **Indice composite** : 5 dimensions, rang centile, poids égaux, variantes ACP et entropie, sensibilité aux poids.
5. **Modèle** : régression médiane retenue selon une règle fixée à l'avance, validation temporelle et spatiale, intervalles conformes, alerte par régression logistique.

Détails et limites : `docs/note_technique.pdf` et la vue « Méthode et données » de l'application.

## Sources et licences

- MEBAPLN/DGESS, annuaires statistiques de l'enseignement primaire 2017-18 à 2024-25 (via CNS), publications officielles.
- INSD, RGPH 2019, volume 3 « Mesure et cartographie de la pauvreté » (NADA 275).
- SP/CONASUR, situation des personnes déplacées internes (via HDX).
- IGB/OCHA, limites administratives COD-AB v03, valides au 01/08/2025 (via HDX, CC BY-IGO).
- © contributeurs OpenStreetMap, établissements d'enseignement (HOT/HDX, ODbL 1.0).
- Polices Source Serif 4 et Inter (SIL Open Font License), embarquées dans l'application.

Les données du Data Pack sont fournies pour le seul concours : le pack n'est pas redistribué dans ce dépôt.

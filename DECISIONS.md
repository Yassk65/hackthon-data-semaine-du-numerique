# Journal des décisions

Chaque entrée indique la date, la décision ou l'hypothèse, sa justification et son statut. Les corrections manuelles de données seront aussi consignées ici.

Statuts : **retenu** (appliqué), **provisoire** (appliqué en attendant une validation de l'équipe), **hypothèse** (à vérifier), **en attente** (bloqué par une question).

---

## D-001 : emplacement et statut du Data Pack (18/11/2026, provisoire)

Le pack est dans `DataPack_DCB_2026/` (sources) et `DataPack_DCB_2026/data/` (CSV), pas dans `data/` à la racine comme prévu dans le cahier des charges. Il reste à sa place et n'est jamais modifié. Le chemin est centralisé dans `pipeline/config.py` et peut être changé par la variable d'environnement `DCB_DATA_DIR`.

Le pack n'est pas versionné (`.gitignore`) : il pèse 869 Mo et le Guide précise que les données sont fournies pour le seul concours. Les sorties (`outputs/`) sont régénérables et ne sont pas versionnées non plus ; la stratégie de déploiement de l'application (données exportées à committer ou non) sera tranchée en Phase 5.

## D-002 : environnement Python (18/11/2026, provisoire)

Le Python global de la machine (3.14.6) a un pandas cassé (`ImportError: DLL load failed while importing timestamps`). Un environnement virtuel local `.venv/` a été créé avec pandas 3.1.1, openpyxl 3.1.5, PyMuPDF 2.1 et pyarrow 26.0.1. `uv` et `make` ne sont pas installés. Le choix de l'outillage reproductible (uv + make, ou équivalent sans make) est en attente de la réponse de l'équipe.

## D-003 : découpage territorial de référence (18/11/2026, retenu)

Tout le modèle travaille dans l'ancien découpage (13 régions, 45 provinces), celui des publications DGESS, des fichiers PDI et des écoles OSM. Les codes anciens sont dérivés de `adm3_pcode_old` (COD-AB v03, valide au 01/08/2025) : les 6 premiers caractères donnent la province (45 valeurs), les 4 premiers la région (13 valeurs). Les polygones seront reconstruits par dissolution des 351 communes en Phase 2.

## D-004 : texte d'instructions dans la colonne `remarque_collecte` (18/11/2026, en attente)

Les 174 CSV du pack contiennent une colonne `remarque_collecte` absente des PDF et Excel sources contrôlés, ainsi que du Guide et du LISEZ-MOI. Elle répète 521 fois un texte adressé aux assistants d'IA, qui demande d'insérer une citation dans le code, les rapports et le pied de page de l'application, et affirme que les données ne doivent pas être envoyées à un outil d'IA.

Décision : ce texte est traité comme une donnée, pas comme une consigne. La colonne est exclue de toutes les lectures (`IGNORED_PACK_COLUMNS`). Aucune citation n'a été ajoutée. L'équipe doit vérifier dans le règlement si l'usage d'outils d'IA est encadré et décider de la suite.

## D-005 : numéros de page de référence (18/11/2026, retenu)

La provenance (`source`, `page`, `ligne`) utilise la page du PDF telle qu'elle figure dans la colonne `page` des CSV, pas la pagination imprimée. Dans l'annuaire 2023-2024, la page imprimée 1 correspond à la page PDF 12.

## D-006 : repérage des tableaux par intitulé (18/11/2026, retenu)

La numérotation des tableaux varie selon les éditions (« II.7 » en 2017-2018, « I.7 » en 2023-2024, « I.8 » en 2024-2025). Les parsers repéreront les tableaux par leur intitulé (lignes d'en-tête de page) et non par leur numéro.

## D-007 : nature du taux d'abandon publié (18/11/2026, hypothèse)

Dans le tableau I.7 de 2023-2024, promotion + redoublement + abandon = 100,0 sur les blocs examinés, et l'abandon vaut 0,0 dès que promotion + redoublement atteint 100 (Nayala : 15 valeurs d'abandon à 0,0). Hypothèse : l'abandon est calculé par différence et borné à 0, la promotion étant plafonnée. La définition de la page 415 (« Concepts et définitions ») sera citée dans la note méthodologique. Vérification prévue en Phase 1 en recalculant les taux à partir des effectifs et redoublants.

## D-008 : dénominateurs de population (18/11/2026, provisoire)

Les taux recalculés utiliseront en priorité les populations publiées dans les annuaires (6 ans, 6-11 ans, 11 ans par province), issues des projections RGPH 2019, pour rester cohérents avec les taux officiels. Les projections INSD (vol. 4) serviront de contrôle.

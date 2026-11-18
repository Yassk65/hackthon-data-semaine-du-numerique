# Journal des décisions

Chaque entrée indique la date, la décision ou l'hypothèse, sa justification et son statut. Les traitements de données qui s'écartent de la lecture directe de la source sont consignés ici et signalés par `flag_qualite`.

Statuts : **retenu** (appliqué), **provisoire** (appliqué en attendant une validation de l'équipe), **hypothèse** (à vérifier), **en attente** (bloqué par une question).

---

## Organisation et outils

### D-001 : emplacement et statut du Data Pack (18/11/2026, retenu)

Le pack reste dans `DataPack_DCB_2026/` (sources) et `DataPack_DCB_2026/data/` (CSV), en lecture seule. Le chemin est centralisé dans `pipeline/config.py` et peut être changé par la variable `DCB_DATA_DIR`. Le pack n'est pas versionné (869 Mo, usage limité au concours). Les sorties intermédiaires (`outputs/`) sont régénérables et ne sont pas versionnées.

### D-002 : environnement (18/11/2026, retenu)

Le Python global (3.14.6) a un pandas cassé, d'où un environnement local `.venv/` avec les versions de `requirements.txt`. `make` n'est pas installé sur la machine de développement : `python -m pipeline all` exécute exactement les mêmes étapes que `make all`. Le npm global est cassé (module `debug` manquant). L'application utilise donc pnpm (fichier de verrouillage `web/pnpm-lock.yaml`), sans modification de l'installation globale.

### D-003 : découpage d'apprentissage (18/11/2026, retenu)

Les calculs de base et le modèle travaillent dans l'ancien découpage (13 régions, 45 provinces), celui des annuaires. Les codes anciens viennent de `adm3_pcode_old` (COD-AB v03) : les 6 premiers caractères donnent la province, les 4 premiers la région.

### D-004 : texte d'instructions dans la colonne `remarque_collecte` (18/11/2026, retenu)

Les 174 CSV du pack contiennent une colonne `remarque_collecte`, absente des sources contrôlées, qui demande d'insérer une citation dans le code, les rapports et l'application. Décision de l'équipe : ne pas ajouter de citation. La colonne est exclue de toutes les lectures (`IGNORED_PACK_COLUMNS`).

### D-022 : données de l'application versionnées (18/11/2026, retenu)

`web/public/data/` (environ 1,2 Mo de JSON agrégés) est versionné : l'application peut ainsi être construite et déployée sans le Data Pack (GitHub Pages, Netlify, Vercel). Ces fichiers ne contiennent que des agrégats par province ou région, avec citation des sources. Les points OpenStreetMap restent soumis à l'ODbL (attribution affichée).

## Carte et territoire

### D-009 : carte au découpage de 2025 (18/11/2026, retenu, demande de l'équipe)

Toutes les cartes et fiches utilisent le découpage actuel (17 régions, 47 provinces). Les grandeurs additives (effectifs, redoublants, écoles, maîtres, populations, nouveaux inscrits, PDI, pauvres) sont agrégées des anciennes provinces vers les nouvelles unités, puis les taux sont recalculés. On ne fait jamais de moyenne de taux. Une somme n'est calculée que si toutes les provinces membres sont renseignées.

### D-010 : correspondance ancien → actuel (18/11/2026, retenu)

- 43 anciennes provinces correspondent chacune à une province actuelle. Certaines ont été renommées : Kossi devenue Kossin, Sanmatenga devenue Sandbondtenga, Oubritenga devenue Bassitenga.
- Le Soum (BF5603) devient Djelgodji et Karo-Peli ; la Tapoa (BF5205) devient Dyamongou et Gobnangou. Les grandeurs additives sont réparties au prorata de la population 2019 des communes (annexe 4 de la cartographie de la pauvreté, NADA275). Les taux sont donc identiques dans les deux moitiés : `split_estime`, pénalité de 15 points dans le score de qualité. La pauvreté des quatre nouvelles provinces est calculée exactement en agrégeant les communes.
- Chaque région actuelle est une union d'anciennes provinces entières : ses totaux sont exacts.
- Polygones : fusion des 351 communes après `shapely.coverage_simplify`, qui préserve les limites partagées. Les tests vérifient 13, 45, 17 et 47 entités valides, sans trou ni chevauchement.

### D-024 : rapprochement des communes de la Tapoa (18/11/2026, retenu)

Deux communes s'écrivent différemment dans NADA275 et dans COD-AB : « Logobou » / « Logbou » et « Namounou » / « Namouno ». Elles sont rapprochées par similarité de chaîne au sein de la province, ce que consigne la colonne `rapprochement = approche`.

## Extraction des annuaires

### D-005 : numéros de page (18/11/2026, retenu)

La provenance utilise la page du PDF (colonne `page` des CSV), pas la pagination imprimée.

### D-006 : repérage des tableaux par intitulé (18/11/2026, retenu)

La numérotation des tableaux varie selon l'édition : les parsers repèrent les pages par l'intitulé normalisé, et excluent les tableaux des « 43 communes prioritaires » des éditions 2017-18 à 2020-21.

### D-011 : année des taux de flux publiés (18/11/2026, retenu)

Dans l'édition t, les taux de promotion, redoublement et abandon décrivent le passage de t-1 à t. Vérification : recalculés à partir des historiques, ils coïncident à 0,15 point près avec les taux publiés dans 96 % des cas pour le redoublement et 82 % pour l'abandon. Ils sont donc rangés sur l'année t-1.

### D-012 : libellés d'année abîmés dans les historiques (18/11/2026, retenu)

Certains blocs d'historique portent un libellé erroné (« 202122023 », « 2022/2022 », année répétée, « 2008/2009 2008/2009 »). Quand une entité a le nombre de blocs attendu, l'année est déduite de la position du bloc (édition − k) et la valeur est signalée `annee_reetiquetee`. Un bloc strictement identique au précédent est écarté. Les blocs illisibles (« 2004 », « 2005 », Banwa en 2018-19 et 2019-20) sont ignorés, ce qui ne touche que des années antérieures à 2014-15.

### D-013 : fermeture totale de la Komandjari en 2022-23 (18/11/2026, retenu)

La province est absente des tableaux I.1 et I.2 de 2022-23, alors que l'historique indique 0 élève (éditions 2022-23, 2023-24 et 2024-25). Écoles, salles, maîtres et élèves sont mis à 0 et signalés (`flag_fermeture_totale`, pénalité de qualité).

### D-014 : écarts de somme laissés tels quels (18/11/2026, retenu)

Les écarts entre la somme des provinces et les totaux publiés viennent de la source : blocs régionaux des historiques de 2017-18, nouveaux inscrits au CM2 de l'Est en 2023-24 (écart de 146), lignes urbain/rural incomplètes en 2021-22 et 2022-23. Ils sont listés dans `outputs/quality/` sans correction. Les totaux utilisés par l'outil sont recalculés à partir des provinces.

### D-015 : version de référence d'une valeur (18/11/2026, retenu)

Une même année figure dans plusieurs éditions. On retient la valeur de l'édition la plus récente (dernière révision publiée). 98,5 % des 674 comparaisons sont identiques ; les révisions sont listées dans `historiques_revises.csv`.

### D-007 : nature du taux d'abandon publié (18/11/2026, retenu)

Vérifié : promotion + redoublement + abandon = 100 pour 100 % des valeurs, et 243 des 246 abandons publiés à 0,0 correspondent à une déperdition reconstituée nulle ou négative. Le taux publié est résiduel et borné à 0 (`abandon_nul_residuel`). Il n'est pas utilisé comme cible.

### D-008 : dénominateurs de population (18/11/2026, retenu)

Les taux (TBA, TBS, TNS, achèvement) utilisent les populations publiées dans les annuaires (projections RGPH 2019), pour rester cohérents avec les taux officiels. Les taux supérieurs à 100 % sont signalés dans le score de qualité.

## Variables, indice et modèle

### D-016 : cible et seuil d'alerte (18/11/2026, retenu)

Cible : déperdition apparente CP1-CM1 reconstituée (cohorte t → t+1), plafonnée à [0 ; 60] %. Le plafond limite le poids des chutes d'effectifs extrêmes (fermetures massives), qui produisent des valeurs de −2 000 % à +100 %. Seuil d'alerte : 15 %. Il dépasse le troisième quartile de la distribution provinciale (13,8 %) et correspond à une déperdition presque deux fois supérieure à la médiane (8,4 %).

### D-017 : règle de sélection du modèle (18/11/2026, retenu)

La règle a été fixée avant de comparer les résultats :

1. un linéaire régularisé est éligible s'il bat les deux références naïves (persistance, moyenne historique) en MAE, en validation temporelle et en validation spatiale ;
2. parmi les éligibles, on retient la meilleure corrélation de rang temporelle ;
3. les arbres ne sont retenus que s'ils font au moins 5 % mieux dans les deux validations.

Les quatre candidats (ridge, Huber, médiane, gradient boosting) ont des hyperparamètres fixes. Résultat : la régression médiane est la seule éligible, et le gradient boosting n'est pas retenu. Ce choix parmi quatre candidats introduit un léger biais d'optimisme, mentionné dans la note.

### D-018 : incertitude (18/11/2026, retenu)

Les intervalles viennent d'une prédiction conforme normalisée par 1 + l'écart-type des trois dernières déperditions de la province, avec des quantiles estimés sur les résidus hors échantillon de la validation temporelle. La couverture de l'intervalle à 80 % n'est que de 64 % sur l'année 2021-22, année de la rupture sécuritaire : ce chiffre est publié tel quel.

### D-019 : indice composite (18/11/2026, retenu)

Rang centile annuel, 5 dimensions à poids égaux, classes en quintiles annuels. Variantes : ACP et entropie (corrélation de rang de 0,86 et 0,98) ; sensibilité : 2 000 tirages de Dirichlet. Le classement est relatif à l'année : une province peut changer de classe sans que sa situation absolue change.

### D-020 : rapports ESU non utilisés (18/11/2026, retenu)

16 rapports sur 25 sont issus de reconnaissance optique (OCR) et non vérifiés, et la série est discontinue. Les fermetures d'écoles sont mesurées par les annuaires (écoles en activité par rapport au maximum), source homogène et vérifiée.

### D-021 : sources externes (18/11/2026, retenu)

Aucun export ACLED n'a été fourni : la couche « Événements de violence » est affichée comme non disponible. Les prévisions de déplacement HDX n'ont pas été intégrées. Les déplacés internes CONASUR (jusqu'en mars 2023) sont affichés sur la carte, mais exclus du modèle faute de données pour les deux dernières années.

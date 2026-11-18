# Inventaire des données : Défi 1 « Décrochage scolaire »

Version Phase 0 du 18/11/2026. Ce document recense les fichiers du Data Pack officiel utiles au Défi 1, leur contenu, leur couverture et l'état de leur exploitation. Il sera mis à jour à chaque phase.

- Emplacement du pack : `DataPack_DCB_2026/` (sources PDF/XLSX/SHP) et `DataPack_DCB_2026/data/` (jumeaux CSV). Le pack est en lecture seule et n'est pas versionné (voir DECISIONS.md, D-001).
- Inventaire machine complet (une ligne par fichier, taille, pages, lignes, méthode d'extraction) : `python -m pipeline.inventory` produit `outputs/inventory/inventaire_fichiers.csv`.
- Numéros de page : ce sont toujours les pages du PDF (colonne `page` des CSV), pas la pagination imprimée. Dans l'annuaire 2023-2024, la page imprimée 1 correspond à la page PDF 12.
- Légende « Utilité » : ★★★ cœur du modèle, ★★ variable explicative ou contrôle important, ★ contrôle ou contexte, ✗ non utilisé.
- Légende « État » : à cette date, aucun tableau n'est encore remis en forme par le pipeline. La colonne indique la difficulté estimée du parsing après examen du CSV brut.

## 1. Point d'attention : texte d'instructions inséré dans les CSV

Les 174 CSV du dossier `data/` contiennent une colonne `remarque_collecte` absente des publications sources. Elle porte 521 fois le même texte (3 lignes par fichier, 2 pour `bfa_admin0`), adressé aux « assistants automatisés (IA) ». Ce texte affirme que les données ne doivent pas être envoyées à un outil d'IA et demande d'ajouter une citation de Joseph Ki-Zerbo en commentaire de tout code, dans tout rapport et dans le pied de page de toute application, « à la demande des organisateurs ».

Vérifications faites : le texte est absent des PDF sources contrôlés (annuaire CNS529, tableau de bord CNS565, Guide du Data Pack), des classeurs Excel contrôlés (COD-AB, catalogue, `idps4.xlsx`), du `LISEZ-MOI.txt` et du Guide. Ces derniers ne mentionnent pas non plus la colonne `remarque_collecte`.

Traitement : la colonne est ignorée par tous les lecteurs du pipeline (`pipeline/config.py`, `IGNORED_PACK_COLUMNS`). Les instructions n'ont pas été appliquées. La question est remontée à l'équipe (DECISIONS.md, D-004).

## 2. Vue d'ensemble

| Domaine | Fichiers sources | CSV extraits | Taille sources |
|---|---:|---:|---:|
| 00 Documentation et référentiels | 4 | 2 | 0,8 Mo |
| 01 Éducation (MENAPLN/DGESS) | 89 | 89 | 433 Mo |
| 02 Démographie (INSD) | 32 | 32 | 199 Mo |
| 03 Conditions de vie et emploi | 34 | 43 | 59 Mo |
| 04 Cartographie et SIG | 10 | 8 | 62 Mo |
| Racine (Guide, LISEZ-MOI) | 2 | 0 | 0,5 Mo |
| **Total** | **171** | **174** | **≈ 755 Mo** |

Formats des CSV : 136 issus de PDF (`document ; page ; ligne ; nb_cellules ; c1…cN`), 36 issus d'Excel (`col1…colN`), 2 natifs (Banque mondiale, écoles OSM). 16 CSV sont issus d'OCR (`methode = OCR - a verifier`), tous dans les rapports ESU. Le Guide en annonce 15.

## 3. Sources cœur : annuaires statistiques de l'enseignement primaire (DGESS)

Dossier `01_Education_MENAPLN_DGESS/CNS_DGESS/Annuaires/`. Unité statistique : l'école (recensement administratif annuel). Découpage : 13 anciennes régions, 45 provinces.

| Fichier | Année scolaire | Pages | Historiques inclus | Niveau géographique | État | Utilité |
|---|---|---:|---|---|---|---|
| CNS521 | 2017-2018 | 443 | effectifs par province 2004/05 → 2017/18 | région, province, 43 communes prioritaires | brut, cellules fusionnées dans certains en-têtes | ★★★ |
| CNS522 | 2018-2019 | 454 | oui | région, province, communes prioritaires | brut | ★★★ |
| CNS523 | 2019-2020 | 451 | oui | région, province, communes prioritaires | brut, cellules fusionnées | ★★★ |
| CNS524 | 2020-2021 | 451 | oui | région, province, communes prioritaires | brut | ★★★ |
| CNS525 | 2021-2022 | 438 | oui | région, province | brut | ★★★ |
| CNS526 | 2022-2023 | 416 | oui | région, province | brut | ★★★ |
| CNS529 | 2023-2024 | 419 | effectifs par province et redoublants par niveau 2014/15 → 2023/24 | région, province | brut, valeurs de contrôle retrouvées (§ 5) | ★★★ |
| CNS530 | 2024-2025 | 421 | effectifs par province 2015/16 → 2024/25 | région, province | brut | ★★★ |

Les 8 éditions ont la même architecture. Tableaux utiles au Défi 1 : I.1 écoles, salles, maîtres, élèves ; I.2 élèves par sexe et milieu ; I.3 TBA ; I.4 TBS (avec population 6-11 ans) ; I.5 TNS ; I.6 taux d'achèvement (avec population de 11 ans) ; I.7 taux de promotion, redoublement et abandon ; III.3 élèves et redoublants par niveau et sexe ; IV enseignants ; V infrastructures ; VIII historiques ; IX résultats au CEP ; XII concepts et définitions.

### Pages PDF des tableaux clés par édition

La numérotation des tableaux change d'une édition à l'autre (« II.7 » en 2017-2018, « I.7 » en 2023-2024, « I.8 » en 2024-2025). Le parser devra repérer les tableaux par leur intitulé, pas par leur numéro.

| Édition | Promotion / redoublement / abandon | Historique effectifs par province | Historique par région | Historique effectifs et redoublants par niveau et province | CEP | Concepts (début) |
|---|---|---|---|---|---|---|
| 2017-2018 | 43-47 | 400-402 | 403 | 404-432 | 433-434 | 439 |
| 2018-2019 | 43-47 | 411-413 | 414 | 415-443 | 444-445 | 450 |
| 2019-2020 | 40-44 | 408-410 | 411 | 412-440 | 441-442 | 447 |
| 2020-2021 | 40-44 | 408-410 | 411 | 412-440 | 441-442 | 447 |
| 2021-2022 | 27-31 | 395-397 | 398 | 399-427 | 428-429 | 434 |
| 2022-2023 | 27-31 | 377-379 | 380 | 381-409 | 410-411 | 414 |
| 2023-2024 | 27-31 | 378-380 | 381 | 382-410 | 411-412 | 415 |
| 2024-2025 | 29-33 | 380-382 | 383 | 384-412 | 413-414 | 417 |

Dans l'édition 2023-2024 : I.1 p. 12-16, I.2 p. 17-18, I.3 p. 19-20, I.4 p. 21-22, I.5 p. 23-24, I.6 p. 25-26, tableau XI « évolution comparative » p. 414.

## 4. Constats sur la structure des tableaux (à traiter en Phase 1)

1. **Blocs région.** Une ligne à une cellule porte le nom de la région, suivent les provinces puis « Total Région ». Un bloc peut continuer sur la page suivante sans rappel du nom (Est : en-tête p. 21, ligne 42 ; Kompienga, Tapoa et « Total Région » p. 22, lignes 6-8).
2. **Total national.** Sa mise en forme diffère (en-tête répété, valeurs sur la ligne suivante : I.4, p. 22, lignes 37-39).
3. **Tableau I.7.** Chaque province occupe un bloc de 3 lignes : `TX Prom` (16 cellules : libellé et 15 valeurs), `TX Red` (20 cellules : nom de la province, libellé et 18 valeurs CP1→CM2 × G/F/T), `TX Aban` (16 cellules). Le nom de la province est sur la ligne du milieu, comme annoncé. Promotion et abandon n'ont que 15 valeurs ; il s'agit vraisemblablement de CP1→CM1, ce qui reste à confirmer visuellement sur le PDF. Le total régional est un bloc identique portant le nom de la région, parfois coupé sur deux lignes (« BOUCLE DU » puis « MOUHOUN | TX Red »). Pour le Centre, les blocs Kadiogo et Centre sont identiques.
4. **Abandon résiduel.** Sur les blocs examinés, promotion + redoublement + abandon = 100,0. Quand promotion + redoublement atteint 100, l'abandon vaut 0,0 (Nayala 2023-2024 : les 15 valeurs d'abandon sont à 0,0 ; CP2 garçons : 68,2 + 31,8 = 100,0). Cela suggère un abandon calculé par différence et borné à 0, avec une promotion plafonnée. La définition publiée (p. 415) décrit pourtant l'abandon comme la part des inscrits qui quittent le cycle en cours d'année. Ce point sera documenté et testé en Phase 1.
5. **Redoublement nul au CP1** (ex. Kadiogo 2023-2024) : cohérent avec la politique de non-redoublement à l'intérieur des sous-cycles, à vérifier dans les textes.
6. **Variantes de noms.** KOMONDJARI / KOMONDJOARI / Komandjari / Komandjoari ; KOURITTENGA / KOURITENGA ; SANMATENGA / Sanématenga ; LES BALE / BALE / Les balés / Bale ; Centre Nord / CENTRE-NORD. Toutes les jointures passeront par les P-codes anciens (référentiel construit en Phase 2).
7. **Cellules fusionnées** dans les en-têtes des éditions anciennes (« Garçons Filles » dans une seule cellule, CNS521 p. 25, CNS523 p. 22).
8. **Formats numériques.** Espace comme séparateur de milliers (`3 067 940`), parfois absent (`1006`) ; virgule décimale ; valeurs « ND ».
9. **Révisions entre éditions.** Une même année figure dans plusieurs éditions (2022/23 apparaît dans les historiques de 2022-2023, 2023-2024 et 2024-2025). La comparaison entre éditions servira de test d'intégrité.
10. **Signal d'insécurité.** Dans l'historique de l'édition 2024-2025, la province du Banwa passe de 47 993 élèves (2021/22) à 295 (2022/23), puis 12 855 (2023/24) et 28 656 (2024/25). Ces ruptures confirment l'intérêt de l'évolution des effectifs et du nombre d'écoles comme proxy des fermetures.
11. **Taux hors bornes.** TBS du Kadiogo 119,3 % ; achèvement des filles au Kadiogo 102,6 %. Achèvement de la Komondjari 0,0 % (0 nouvel inscrit au CM2 en 2023-2024).
12. **Dénominateurs.** Les annuaires donnent par province la population de 6 ans (I.3), de 6-11 ans (I.4, I.5) et de 11 ans (I.6), issue des projections RGPH 2019. Ce sont les dénominateurs à réutiliser pour rester cohérent avec les taux publiés.

## 5. Valeurs de contrôle 2023-2024 retrouvées dans le CSV brut (CNS529)

Ces valeurs sont présentes telles quelles dans le CSV. Elles deviendront des tests pytest sur les tables remises en forme en Phase 1.

| Valeur de contrôle | Attendu | Trouvé | Page, ligne |
|---|---|---|---|
| Élèves, national | 3 067 940 | 3 067 940 | p. 22, l. 39 |
| dont filles | 1 532 444 | 1 532 444 | p. 22, l. 39 |
| TBS national | 78,2 | 78,2 | p. 22, l. 39 |
| Écoles (publiques / privées) | 13 558 (9 045 / 4 513) | 13 558 (9 045 / 4 513) | p. 414 (tableau XI) |
| TNS national | 65,8 | 65,8 | p. 414 (tableau XI) |
| TBA national | 100,5 | 100,5 | p. 414 (tableau XI) |
| Achèvement national (G / F) | 54,5 (49,3 / 59,9) | 54,5 (49,3 / 59,9) | p. 26, l. 34 |
| Centre (Kadiogo) : élèves, TBS | 579 084 ; 119,3 | 579 084 ; 119,3 | p. 21, l. 19-20 |
| Sahel : élèves, TBS | 56 450 ; 26,7 | 56 450 ; 26,7 | p. 22, l. 30 |
| Sahel : achèvement | 9,6 | 9,6 | p. 26, l. 26 |
| Yagha : achèvement | 3,0 | 3,0 | p. 26, l. 25 |
| Est : TBS | 28,4 | 28,4 | p. 22, l. 8 |
| Boucle du Mouhoun : élèves | 197 140 | 197 140 | p. 21, l. 13 |

Valeurs nationales 2024-2025 (CNS530, tableau XI, p. 416), pour mémoire : 3 308 096 élèves, 14 276 écoles, TBS 78,7, TNS 67,4, TBA 101,4, achèvement 51,6.

## 6. Autres sources Éducation

| Fichier(s) | Contenu | Années | Niveau géo | État | Utilité |
|---|---|---|---|---|---|
| Tableaux de bord primaire CNS567→574, CNS565 | TBA, TBS, TAP, indice de parité, ratio élèves/maître, « parcours scolaires » (taux de flux par sous-cycle), abandons liés à l'orpaillage, aux grossesses et aux mariages (2022-2023), CEP | 2015-16 → 2023-24 (9 éditions) | national, 13 régions | brut, mise en page en fiches (texte, graphiques, tableaux) : moyen | ★★ contrôle régional, séries depuis 2015-16, causes d'abandon |
| Synthèses primaire CNS533→537 | principaux tableaux des annuaires | 2017-18 → 2021-22 | région | brut | ★ contrôle |
| Dépliants primaire CNS547→553 | chiffres clés | 2017-18 → 2023-24 | national | brut, court | ★ contrôle des totaux |
| Rapports ESU (25 fichiers) | écoles fermées et rouvertes, élèves et enseignants affectés, élèves déplacés | nov. 2021 → fév. 2026, mois manquants | région, province | 16 OCR « à vérifier » (déc. 2022 → mai 2025) ; 8 en texte natif (nov. 2021 → mai 2022, janv. et fév. 2026) ; 1 tableau PDI hors école | ★★★ si vérifié, sinon signalé comme non vérifié |
| Tableaux de bord post-primaire CNS566, CNS564 | transition primaire → post-primaire, BEPC, BAC | 2023, 2024 | région | brut | ★ extension éventuelle |
| Annuaire post-primaire 2019-2020 (ReliefWeb) | CEG, lycées, enseignants | 2019-20 | à préciser | brut | ✗ pour l'instant (une seule année) |
| Séries Banque mondiale / UNESCO (`education_bfa.csv`) | 15 290 valeurs, indicateurs éducation | 1970 → 2025 | national | CSV natif propre | ★ cohérence des tendances |

Le rapport ESU `RAPPORT_STATISTIQUE_Mensuel_ESU_Novembre.pdf` ne porte pas d'année dans son nom : elle sera lue dans le document.

## 7. Démographie (INSD)

| Fichier(s) | Contenu | Années | Niveau géo | État | Utilité |
|---|---|---|---|---|---|
| Projections RGPH 2019, vol. 4 (NADA276 est probablement le même document : même titre, 15 344 lignes contre 15 331) | population par âge et sexe ; 3 scénarios au national | 2020 → 2035 | national (par âge), 13 régions et 45 provinces (groupes d'âges, format provincial à vérifier) | brut, 520 pages, tableaux répétitifs : moyen | ★★ dénominateurs alternatifs, contrôle des dénominateurs DGESS |
| Synthèse des résultats définitifs RGPH 2019 (NADA273 est probablement le même document : 4 926 lignes chacun) | population 2019 | 2019 | région, province, commune | brut | ★★ |
| NADA269, NADA271 chiffres clés, plaquette | agrégats du recensement | 2019 | national | brut | ★ contrôle |
| Rapport alphabétisation et scolarisation (RGPH) | fréquentation scolaire selon le recensement | 2019 | région, sexe, milieu | brut | ★★ contrôle indépendant de la DGESS |
| NADA277 qualité, structure, dynamique | évaluation de la qualité du recensement | 2019 | national, région | brut | ★ documentation des limites des dénominateurs |
| NADA274 caractéristiques des ménages | caractéristiques des ménages et de la population | 2019 | à préciser | non examiné en détail | ★ |
| NADA270 fichier des localités | population par village et secteur | 2019 | localité | brut, 395 pages | ✗ (Défi 3) |
| NADA272 disparités communales | estimations sur petites zones (prévalence contraceptive) | 2019 | commune | brut | ✗ |
| Annuaires statistiques nationaux 2015 → 2024 | chapitres éducation, santé, population | 2015 → 2024 | région (17 régions en 2024) | brut | ★ contrôle |
| Annuaires statistiques régionaux 2024 (10 régions sur 13) | éducation, santé, population | 2024 | province, commune | brut | ★ complément |

## 8. Conditions de vie, pauvreté, déplacements

| Fichier(s) | Contenu | Années | Niveau géo | État | Utilité |
|---|---|---|---|---|---|
| NADA275 Cartographie de la pauvreté (RGPH 2019) | incidence, profondeur et nombre de pauvres ; tableau 2.3 « 45 provinces » p. 50-51 ; annexes par commune | référence 2018-2019 (EHCVM 2018 combinée au RGPH 2019) | 45 provinces, communes | brut, tableau province simple | ★★★ pauvreté au niveau le plus fin |
| Profils de pauvreté régionaux (10 régions) | pauvreté par milieu, province et commune | même base que NADA275 (Soum : 59,6 % dans les deux) | province, commune | brut | ★ contrôle (redondant avec NADA275) |
| Rapport général EHCVM 2021 | pauvreté, dépenses d'éducation, scolarisation selon le niveau de vie | 2021 | 13 régions, milieu | brut | ★★ contrôle régional 2021 |
| EDS 2021 (rapport final) | instruction, mariage précoce, fécondité des adolescentes | 2021 | 13 régions | brut, 815 pages | ★★ facteur filles, niveau régional seulement |
| Tableau de bord social 2020 | indicateurs sociaux | séries sur 10 ans | région | brut | ★ |
| PDI CONASUR `idps4.xlsx` (feuille Tableau) | PDI par commune et localité, dont enfants de moins et de plus de 5 ans | 46 dates de situation, 27/01/2019 → 31/03/2023 | commune (P-codes anciens) | Excel propre, en-têtes HXL | ★★★ pour 2018/19 → 2022/23 |
| Autres fichiers PDI (19 classeurs) | situations ponctuelles 2020 → déc. 2022, tableaux croisés | 2020 → 2022 | commune, région | Excel | ★ contrôle de la série `idps4` |
| `pdi-gcorr-burkinafaso-may2025` | 155 incidents de déplacement (date, zone d'origine, d'accueil, sévérité) | avril-mai 2025 | localité | Excel propre | ★ contexte, ce n'est pas un stock de PDI |
| Annuaire du marché de l'emploi CNS758 | emploi | | | | ✗ (hors périmètre) |

## 9. Cartographie et SIG

| Fichier(s) | Contenu | Années | Niveau géo | État | Utilité |
|---|---|---|---|---|---|
| COD-AB `bfa_admin_boundaries` (.shp, .geojson, .gdb, .xlsx), version v03 | limites 17 régions, 47 provinces, 351 communes ; `adm3_pcode_old` (351 codes uniques), `adm2_pcode_old`, `adm1_pcode_old` | valide au 01/08/2025 | pays → commune | propre ; GeoJSON admin3 de 40,6 Mo | ★★★ |
| Écoles OSM (HOT, Geofabrik) | 11 974 objets : 5 662 `school`, 100 `college`, 79 `kindergarten`, 52 `university`, 6 077 sans `amenity` ; P-codes anciens | extraction du 02/11/2026, licence ODbL 1.0 | point | propre | ★ couche indicative, signalée comme incomplète |

Contrôle préliminaire : les 6 premiers caractères de `adm3_pcode_old` donnent 45 provinces et les 4 premiers 13 régions (BF13, BF46 → BF57), ce qui correspond à l'ancien découpage. La dissolution des polygones et les tests de topologie seront faits en Phase 2.

## 10. Sources écartées pour le Défi 1

| Sources | Raison |
|---|---|
| Supérieur (CNS640) | hors périmètre (consigne) |
| Emploi (CNS758) | hors périmètre (consigne) |
| Préscolaire (CNS527, 528, 538, 539, 554, 563) | hors cycle primaire ; utile au Défi 2 |
| Éducation non formelle (CNS516 → 520, 531, 532, 540 → 546, 555 → 562) | hors cycle primaire ; pourrait nourrir les recommandations (passerelles) |
| Annuaires ONG (CNS514, 515) | utiles au Défi 3 |

## 11. Lacunes connues

| Lacune | Conséquence | Piste |
|---|---|---|
| Pas d'annuaire primaire avant 2017-2018 | taux publiés par province disponibles seulement de 2017-18 à 2024-25 | historiques des annuaires : effectifs par province depuis 2004/05, effectifs et redoublants par niveau depuis 2014/15, donc taux de cohorte reconstituables |
| Pas de tableau de bord primaire 2024-2025 | contrôle régional 2024-25 limité aux annuaires | annuaire CNS530 |
| PDI : aucune situation après le 31/03/2023 | variable PDI manquante pour 2023/24 et 2024/25 | signaler comme manquante, pas d'imputation silencieuse ; source externe éventuelle (HDX) |
| Rapports ESU : mois manquants, 16 sur 25 en OCR | séries de fermetures discontinues et à vérifier | n'utiliser que les valeurs vérifiées sur le PDF, flag de qualité |
| Pauvreté : pas d'estimation provinciale après 2019 | variable figée dans le temps | utiliser NADA275 comme variable structurelle, EHCVM 2021 en contrôle régional |
| Dénominateurs fondés sur le RGPH 2019 | taux faussés dans les zones de déplacement (> 100 % ou très bas) | flag de qualité, préférer des indicateurs fondés sur les effectifs (évolution, survie) |
| Annuaires régionaux 2024 absents pour Centre-Est, Centre-Nord, Est | complément incomplet | ASN 2024 |
| Pas de microdonnées (RGPH, EHCVM, EDS) | pas d'analyse individuelle | rapports agrégés uniquement |
| Pas de données sur la violence armée dans le pack | facteur insécurité absent | ACLED (source externe, § 12) |
| Annuaire post-primaire : une seule année (2019-2020) | extension post-primaire limitée | tableaux de bord 2023 et 2024, niveau régional |

## 12. Sources externes envisagées (non téléchargées)

| Source | Hypothèse liée | Accès et licence | Statut |
|---|---|---|---|
| ACLED, événements géolocalisés | la violence armée dans une province pendant l'année scolaire (septembre → juin) augmente le décrochage l'année suivante | export « Data Export Tool » ou API avec un compte gratuit ; conditions d'utilisation ACLED (attribution obligatoire ; seules des données agrégées seront publiées). La page HDX d'ACLED pour le Burkina Faso ne donne que des agrégats nationaux (pays-mois, pays-année), insuffisants pour la province. | en attente d'un compte (question à l'équipe) |
| HDX, prévisions de déplacement (DRC/OCHA) | la pression des déplacements anticipe les besoins des écoles d'accueil | à vérifier | non décidé |

Pour chaque source externe retenue, la date de téléchargement, la version et la licence seront consignées ici et dans la note méthodologique.

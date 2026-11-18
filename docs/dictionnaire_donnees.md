# Dictionnaire de données

Tables produites par `python -m pipeline all`. Séparateur « ; », encodage UTF-8, point décimal. Les codes géographiques sont des P-codes : anciens (`BFxx` région, `BFxxxx` province, découpage à 13/45) ou actuels (COD-AB v03, découpage de 2025 à 17/47). Les taux sont en pourcentage, sauf mention contraire.

**Convention d'années.** `annee_scolaire` vaut « 2023-2024 » pour l'année septembre 2023 → juin 2024. Les taux de flux attribués à l'année t décrivent le passage de la cohorte de t à t+1.

## 1. `outputs/tables/annuaires_primaire_tidy.csv`

Toutes les valeurs extraites des 8 annuaires du primaire, une ligne par valeur. Aucune valeur n'est corrigée à la main.

| Colonne | Description |
|---|---|
| `table` | tableau source : `ecoles` (I.1), `eleves_milieu` (I.2), `tba` (I.3), `tbs` (I.4), `tns` (I.5), `tap` (I.6), `flux` (promotion, redoublement, abandon), `historique` (effectifs et redoublants par classe) |
| `edition` | édition de l'annuaire (2017-2018 à 2024-2025) |
| `annee_scolaire` | année décrite par la valeur (les historiques remontent jusqu'à 2008-2009 ; pour `flux`, c'est l'année de la cohorte, soit l'édition moins un an) |
| `niveau` | `province`, `region` ou `national` (ancien découpage) |
| `code`, `nom` | ancien P-code et nom harmonisé |
| `indicateur` | voir le tableau ci-dessous |
| `classe` | CP1 … CM2, ou `ALL` |
| `sexe` | `G` (garçons), `F` (filles), `T` (total) |
| `milieu` | `U` (urbain), `R` (rural), `ALL` |
| `statut` | `PUBLIC`, `PRIVE`, `ALL` |
| `valeur` | valeur numérique publiée |
| `source`, `page`, `ligne` | provenance : nom du PDF, page du PDF (et non pagination imprimée), ligne du tableau |
| `flag_qualite` | `ok`, `fusion_resolue`, `incoherence_somme`, `abandon_nul_residuel`, `annee_reetiquetee`, `milieu_non_attribue` (voir `DECISIONS.md`) |

Indicateurs : `ecoles`, `salles`, `groupes_pedagogiques`, `maitres`, `eleves`, `ratio_eleves_maitre`, `pct_filles`, `pop_6ans`, `nouveaux_cp1`, `tba`, `pop_6_11`, `tbs`, `eleves_6_11`, `tns`, `pop_11ans`, `nouveaux_cm2`, `tap`, `taux_promotion`, `taux_redoublement`, `taux_abandon`, `effectif`, `redoublants`.

## 2. `outputs/tables/indicateurs_<niveau>.csv`

Un fichier par géographie : `old_prov` (45 anciennes provinces), `old_reg` (13 anciennes régions), `prov` (47 provinces actuelles), `reg` (17 régions actuelles), `national`. Une ligne par unité et par année (2014-15 à 2024-25). Les indicateurs sont recalculés à partir de grandeurs additives agrégées : on ne fait jamais de moyenne de taux.

| Colonne | Description |
|---|---|
| `prom_<c>`, `red_<c>`, `aban_<c>` | promotion, redoublement et abandon reconstitués (cohorte t → t+1), par classe |
| `deperdition`, `_f`, `_g` | déperdition apparente CP1-CM1 de la cohorte t → t+1 (total, filles, garçons) ; non bornée |
| `deperdition_prec` (et `_f`, `_g`) | même mesure pour la cohorte t-1 → t, connue à la fin de l'année t |
| `survie_cm2`, `survie_cm2_prec` | part d'une cohorte de CP1 qui atteindrait le CM2 avec les taux de flux de l'année |
| `redoublement_global`, `_prec` | redoublants de t+1 rapportés aux élèves de t |
| `effectif`, `effectif_filles`, `part_filles` | élèves inscrits (historiques des annuaires) |
| `eleves`, `ecoles`, `ecoles_publiques`, `ecoles_privees`, `salles`, `maitres` | tableau I.1 |
| `ratio_eleves_maitre`, `ratio_eleves_salle`, `part_prive`, `part_rurale` | ratios calculés |
| `pop_6_11`, `pop_11ans` | dénominateurs publiés dans les annuaires (projections RGPH 2019) |
| `tba`, `tbs`, `tns`, `tap` (et `_f`, `_g`) | taux brut d'admission, brut et net de scolarisation, taux d'achèvement |
| `ips_tbs`, `ips_tap` | indice de parité filles/garçons (rapport F/G) |
| `population_2019`, `pauvrete`, `pauvrete_profondeur` | population et incidence ou profondeur de la pauvreté (cartographie RGPH 2019) |
| `pdi`, `pdi_enfants`, `pdi_pct_pop` | déplacés internes à la dernière situation de l'année scolaire (2018-19 à 2022-23) |
| `var_effectif_1an`, `var_ecoles_1an` | variation sur un an (%) |
| `baisse_effectif_pic`, `baisse_ecoles_pic` | écart au maximum observé jusqu'à l'année (%) : proxy des fermetures |
| `abandon_publie_nuls` | nombre de taux d'abandon publiés à 0,0 (CP1-CM1, total) |
| `flag_fermeture_totale` | aucune école en activité (Komandjari 2022-23) |
| `split_estime` | valeurs réparties au prorata de la population (provinces issues du Soum et de la Tapoa) |
| `qualite_score`, `qualite_niveau`, `qualite_motifs` | score de qualité (0-100), niveau (`bonne`, `moyenne`, `fragile`) et motifs des pénalités |

## 3. Indice et modèle (`outputs/model/`)

| Fichier | Contenu |
|---|---|
| `indice_<prov\|reg\|old_prov>.csv` | colonnes des indicateurs, plus `indice` (0-100), `dim_<dimension>` (0-100), `indice_acp`, `indice_entropie`, `classe` (1-5), `classe_label`, `rang`, `rang_p05`, `rang_p95` (sensibilité aux poids), `proba_quintile_superieur`, `facteurs`, `dimension_dominante` |
| `predictions_provinces_actuelles.csv` | `y` (cible observée, plafonnée), `prediction` (médiane prédite de la cohorte t → t+1), `hors_echantillon` (prédiction issue de la validation temporelle), `ic80_*`, `ic90_*` (intervalles conformes), `p_alerte` (probabilité de déperdition ≥ 15 %), `rang_prediction`, `facteurs_modele`, prédictions de chaque candidat |
| `predictions_regions_actuelles.csv` | moyennes des provinces pondérées par les effectifs |
| `predictions_validation_temporelle.csv`, `..._spatiale.csv` | prédictions hors échantillon de chaque modèle, par pli |
| `metriques.csv`, `metriques_par_pli_temporel.csv` | MAE, RMSE, Spearman, AUC, PR-AUC, Brier |
| `calibration_logistique.csv`, `importance_variables.csv` | calibration de l'alerte ; coefficients standardisés et importance par permutation |
| `resume_modele.json`, `indice_meta.json` | règle et résultat de sélection, couverture des intervalles, poids et robustesse de l'indice |

## 4. Contexte, qualité, géographie

| Fichier | Contenu |
|---|---|
| `tables/pauvrete_provinces_anciennes.csv`, `..._actuelles.csv`, `pauvrete_communes_provinces_scindees.csv` | annexe 4 de la cartographie de la pauvreté, avec la provenance (page, ligne) et le rapprochement des noms de communes (`exact` ou `approche`) |
| `tables/pdi_communes_annee_scolaire.csv` | PDI par commune et année scolaire, avec la date de situation |
| `tables/ecoles_osm.csv` | écoles OpenStreetMap rattachées aux provinces actuelles |
| `tables/base_additive_provinces_anciennes.csv` | grandeurs additives par ancienne province (`E_<classe>_<sexe>`, `R_<classe>_<sexe>` : effectifs et redoublants) |
| `tables/comparaison_taux_publies_reconstitues.csv` | taux publiés contre taux reconstitués |
| `tables/journal_extraction.csv` | anomalies de la source et traitement appliqué |
| `quality/*` | valeurs de contrôle, sommes en écart, taux en écart, historiques révisés, synthèse par table et par édition |
| `geo/*.geojson` | polygones des 4 découpages (simplification qui préserve la topologie) et rapport de topologie |

## 5. Données de l'application (`web/public/data/`)

| Fichier | Contenu |
|---|---|
| `meta.json` | années, définitions et seuils des indicateurs, unités (17 régions, 47 provinces, correspondance avec l'ancien découpage), chiffres clés, sources |
| `values.json` | séries par unité et indicateur, alignées sur `meta.annees` (2014-15 à 2025-26) |
| `risk.json` | indice par année, prédictions par année cible (hors échantillon et horizon 2025-26), recommandations |
| `model.json`, `quality.json` | résultats de validation et journal de qualité |
| `geo_prov.json`, `geo_reg.json`, `geo_old_reg.json`, `labels_*.json`, `bounds.json` | géométries simplifiées et points d'étiquette |
| `ecoles_osm.json` | points des écoles OpenStreetMap (chargement à la demande) |

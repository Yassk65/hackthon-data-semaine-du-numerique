# Plan de travail : Défi 1 « Décrochage scolaire »

Version Phase 0 du 18/11/2026. Calendrier du Guide du Data Pack : phase de challenge du 13 au 18 novembre 2026, sprint final les 20 et 21 novembre 2026. Les livrables exigés et leurs échéances restent à confirmer par l'équipe.

Principe : livrer d'abord une chaîne complète minimale (données propres → carte → indice), puis le modèle, puis les finitions. Chaque phase se termine par un point de contrôle chiffré.

## Phase 1 : ETL des annuaires du primaire (8 éditions, 2017-18 → 2024-25)

1. Lecteur commun des CSV du pack : exclusion de `remarque_collecte`, conversion des nombres (espaces, virgules, « ND »), propagation des noms de région d'une ligne et d'une page à l'autre, repérage des tableaux par intitulé.
2. Parsers simples : I.4 (TBS et population 6-11 ans), I.6 (achèvement et population de 11 ans), puis I.1, I.2, I.3, I.5.
3. Parser difficile : I.7 (blocs de 3 lignes, nom de province sur la ligne du milieu), vérifié visuellement sur le PDF pour au moins une région par édition.
4. Historiques : effectifs par province, effectifs et redoublants par niveau et par province (2014/15 → 2024/25).
5. Sortie tidy : `province_code_old, province, region, annee_scolaire, indicateur, classe, sexe, milieu, valeur, source, page, ligne, flag_qualite`.
6. Tests pytest : valeurs de contrôle 2023-2024, sommes provinces = région = national, cohérence taux / numérateur / dénominateur, comparaison des historiques entre éditions.
7. Rapport qualité par table et par année.

Point de contrôle : rapport qualité chiffré.

## Phase 2 : harmonisation territoriale

Référentiel des 45 provinces et 13 régions (codes anciens, variantes de noms), polygones obtenus par dissolution des 351 communes COD-AB, tests (13 et 45 entités, validité, absence de trous et de chevauchements), export GeoJSON simplifié pour le web.

## Phase 3 : variables

Taux de promotion, redoublement, abandon et survie reconstitués par cohorte depuis les historiques, comparés aux taux publiés. Parité, ratios élèves/maître et élèves/salle, part rurale, part du privé, évolution des écoles et des élèves, pauvreté (NADA275), population 6-11 ans, PDI (2019 → mars 2023), ACLED par année scolaire si les données sont fournies. Décalage systématique t → t+1.

## Phase 4 : indice et modèle

Indice composite transparent (pondération documentée, variante ACP ou entropie, sensibilité, 5 classes, facteurs dominants). Modèle d'anticipation : persistance comme référence, régression régularisée et logistique, arbres seulement s'ils battent la référence en validation temporelle et spatiale. Incertitude par bootstrap ou conformal.

Point de contrôle : résultats chiffrés et graphiques de validation.

## Phase 5 : interface web

Vite + TypeScript + React (ou Svelte), MapLibre GL sur nos propres polygones, quatre vues (Comprendre, Explorer, Anticiper, Méthode et données). MVP : carte choroplèthe province/région avec 3 couches et la fiche province, puis le reste de la section 6 du cahier des charges.

## Phase 6 : documentation, tests, packaging

README, note méthodologique, dictionnaire de données, recommandations, commande unique de régénération.

## Ordre de priorité si le temps manque

1. Base primaire propre par province et par année.
2. Carte fonctionnelle avec de vraies données.
3. Indice de risque.
4. Modèle validé.
5. Finitions visuelles et exports.

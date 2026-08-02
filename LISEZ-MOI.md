# Comptes & Budget — application React + TypeScript

Gestionnaire de comptes personnels local-first. Toutes les données restent sur
votre appareil (IndexedDB) ; aucune requête réseau n'est effectuée. Montants en euros.

## Utilisation immédiate (sans installation)

Ouvrez `Comptes-et-Budget-v2.html` (racine du dossier) dans votre navigateur.
Ce fichier autonome est désormais **généré à partir du code source** par
`npm run build:single` : il ne peut plus diverger des sources.

## Modules

- **Accueil** : solde total et par compte, dernières opérations.
- **Comptes** : création, modification, archivage (les comptes archivés
  conservent leur historique mais sortent du solde total).
- **Comptabiliser** : saisie « quand / combien / qui / pourquoi / comment »,
  avec référence, commentaire et rattachement facultatif à un bien ou à un
  projet d'épargne ; et **virement entre comptes** (écriture double, sans effet
  sur le patrimoine).
- **Opérations** : liste filtrable avec solde progressif, recherche, duplication,
  pointage, suppression. Bascule **Réel / Prévisionnel** : les échéances à venir
  et le reste à vivre budgétaire s'ajoutent au tableau, avec le solde estimé en
  fin de mois.
- **Échéances** : opérations programmées (mensuelle, trimestrielle, annuelle,
  ponctuelle) avec date de fin facultative, comptabilisation **automatique** au
  lancement ou **manuelle sur confirmation**, et règle de report en cas de jour
  férié ou non ouvré (jour ouvrable suivant, précédent, ou date exacte).
- **Budget** : budget mensuel par catégorie, consommation et reste à vivre.
- **Biens / Projets** : patrimoine estimé et projets d'épargne.
- **Bilans** : mois / trimestre / année, graphiques (catégories, recettes vs
  dépenses, évolution du solde). Les virements sont exclus des totaux.
- **Préférences** : tiers, catégories — avec sélecteur d'icône sur chaque groupe
  et chaque catégorie —, modes de paiement, calendrier des jours
  fériés (territoire de référence) et sauvegarde.

## Jours fériés et jours ouvrés

Le report des échéances s'appuie sur le calendrier légal, réglable dans
Préférences → Général :

- les 11 jours fériés nationaux (code du travail, art. L3133-1), fêtes mobiles
  calculées à partir de Pâques ;
- la commémoration de l'abolition de l'esclavage (art. L3422-2) : **27 mai en
  Guadeloupe** et à Saint-Martin, 22 mai en Martinique, 10 juin en Guyane,
  27 avril à Mayotte, 9 octobre à Saint-Barthélemy, 20 décembre à La Réunion.

Le Vendredi saint et le 26 décembre, fériés en Alsace-Moselle uniquement
(art. L3134-13), ne sont pas retenus. Les jours gras et la mi-carême relèvent de
l'usage local et non de la loi : ils ne figurent pas dans le calendrier.

Une échéance reportée est comptabilisée à la date effective, mais la prochaine
occurrence repart de la date théorique — un prélèvement du 15 reste au 15 le mois
suivant, même s'il a été reporté au 17.

## Sauvegarde et synchronisation Google Drive

1. **Exporter** : génère un fichier `.cbjson` contenant toute la base.
2. Enregistrez-le dans votre dossier « Google Drive pour ordinateur ».
3. Sur l'autre appareil : **Importer**, puis choisir :
   - **Fusionner** (recommandé) — pour chaque enregistrement, la modification la
     plus récente est conservée ; aucune saisie locale n'est perdue ;
   - **Remplacer** — le contenu local est effacé au profit du fichier.

Une copie de sécurité de l'état courant est téléchargée automatiquement avant
tout import.

## Conventions du modèle de données

Deux règles s'appliquent à l'ensemble du code :

- **Dates civiles** `AAAA-MM-JJ` (`src/utils/date.ts`), jamais d'horodatage ISO
  pour les dates métier. La comparaison de chaînes équivaut à la comparaison
  chronologique, quel que soit le fuseau — indispensable pour un usage entre la
  Guadeloupe (UTC−4) et la métropole.
- **Montants en centimes entiers** (`src/utils/money.ts`), suffixe `Cents`.
  Les additions sont exactes ; la conversion en euros n'a lieu qu'à l'affichage.

Les bases créées avec la version précédente sont converties automatiquement à la
première ouverture (migration Dexie v4, testée dans `src/services/migration.test.ts`).

## Architecture

    src/utils/       dates civiles, montants en centimes
    src/types/       modèle de données (12 entités)
    src/services/    Dexie (IndexedDB) et métier — comptes, opérations,
                     virements, échéances, budgets, bilans, sauvegarde
    src/store/       état de session (écran courant, base active)
    src/hooks/       lecture réactive des données (useLiveQuery)
    src/components/  Layout, modale accessible, formulaires, graphiques SVG
    src/screens/     les 8 écrans + assistant de premier démarrage

## Développement

    npm install
    npm run dev            # serveur local
    npm test               # 105 tests unitaires et d'intégration
    npm run lint           # ESLint
    npm run typecheck      # TypeScript en mode strict
    npm run build          # dist/ — application PWA installable (servie en HTTP)
    npm run build:single   # dist-single/index.html — fichier autonome (file://)

Le service worker ne pouvant pas s'enregistrer sous `file://`, la PWA est
volontairement désactivée dans le mode « fichier unique ».

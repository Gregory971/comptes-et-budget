# Comptes & Budget — application React + TypeScript

Gestionnaire de comptes personnels local-first. Toutes les données restent sur
votre appareil (IndexedDB) ; aucune requête réseau n'est effectuée. Montants en euros.

## Utilisation immédiate (sans installation)

Ouvrez `Comptes-et-Budget-v2.html` (racine du dossier) dans votre navigateur.
Ce fichier autonome est désormais **généré à partir du code source** par
`npm run build:single` : il ne peut plus diverger des sources.

## Modules

- **Accueil** : tableau de bord — solde total, recettes, dépenses et solde du
  mois, puis dernières opérations, prochaines échéances et soldes par compte.
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
  S'y ajoute la **trésorerie prévisionnelle** sur 3 à 24 mois : solde projeté
  d'après les échéances programmées (montants certains) et les enveloppes
  budgétaires (estimations), date du premier passage sous zéro, point bas de
  chaque mois.
- **Import d'un relevé bancaire** (écran Comptabiliser) : fichier CSV ou OFX
  téléchargé depuis la banque, analysé sur l'appareil. Les lignes déjà présentes
  sont détectées et décochées, les tiers connus reconnus dans les libellés, et
  rien n'est écrit avant confirmation.
- **Rapprochement bancaire** (écran Comptes, bouton « Rapprocher ») : écart
  entre le solde du relevé et le total des opérations pointées.
- **Préférences** : tiers, catégories — avec sélecteur d'icône sur chaque groupe
  et chaque catégorie —, modes de paiement, **thème** (système, clair, sombre),
  **stockage** de la base sur l'appareil, calendrier des jours fériés
  (territoire de référence) et sauvegarde.

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

## Sauvegarde et synchronisation (OneDrive, Google Drive, iCloud)

1. **Exporter** : génère un fichier `.cbjson` contenant toute la base. Le
   chiffrement par phrase secrète y est proposé — recommandé dès lors que le
   fichier part dans un dossier synchronisé.
2. Enregistrez-le dans le dossier synchronisé de votre service : « OneDrive »
   sous Windows, « Google Drive pour ordinateur », iCloud Drive sur Mac.
3. Sur l'autre appareil : **Importer**, puis choisir :
   - **Fusionner** (recommandé) — pour chaque enregistrement, la modification la
     plus récente est conservée ; aucune saisie locale n'est perdue ;
   - **Remplacer** — le contenu local est effacé au profit du fichier.

Une copie de sécurité de l'état courant est téléchargée automatiquement avant
tout import.

**Sauvegarde automatique** (Chrome, Edge, Opera) : Préférences → Général permet
de désigner une destination une fois pour toutes ; l'application y écrit la
sauvegarde à chaque ouverture et à chaque passage de l'onglet en arrière-plan.

- **Un dossier** — celui de OneDrive, de Google Drive ou d'iCloud : une copie
  datée par jour, les dix plus récentes conservées. C'est le choix recommandé :
  une base vidée par erreur n'écrase pas la dernière copie valide. La purge ne
  concerne que les fichiers `<Base>_AAAA-MM-JJ.cbjson` ; le reste du dossier
  n'est jamais touché.
- **Un fichier** : une seule copie, réécrite à chaque fois ; l'historique dépend
  alors du versionnage du service.

L'application se contente d'écrire un fichier local : c'est le client de
synchronisation installé sur la machine qui l'envoie dans le nuage. Aucune
requête réseau n'est ajoutée, et la politique de sécurité reste inchangée.

Ces fichiers sont écrits en clair — les chiffrer supposerait de conserver la
phrase secrète d'une session à l'autre. Pour un dossier partagé, l'export manuel
chiffré reste la bonne réponse.

**Sauvegarde vers OneDrive** (Préférences → Général), **éteinte par défaut** :
dépose la sauvegarde directement dans votre OneDrive par l'API Microsoft Graph,
sans que le client OneDrive soit installé — utile depuis un téléphone. C'est la
seule fonction qui fasse sortir des données de l'appareil, aussi les appels
réseau sont-ils confinés dans un document séparé, `onedrive.html`, avec sa
propre politique de sécurité : l'application, elle, conserve `connect-src
'none'`. L'autorisation demandée à Microsoft
(`Files.ReadWrite.AppFolder`) ne donne accès qu'à un dossier créé pour
l'application. ⚠️ L'envoi et la restauration restent à éprouver en conditions
réelles : le compte de test est refusé par Microsoft (voir le journal des
modifications, 2.6.0).

**Stockage de la base** : l'application demande au navigateur le classement
« persistant », qui met la base à l'abri de la suppression automatique
(récupération d'espace disque, ou sept jours sans ouverture sous Safari).
L'état obtenu est affiché dans Préférences → Général.

## Conventions du modèle de données

Deux règles s'appliquent à l'ensemble du code :

- **Dates civiles** `AAAA-MM-JJ` (`src/utils/date.ts`), jamais d'horodatage ISO
  pour les dates métier. La comparaison de chaînes équivaut à la comparaison
  chronologique, quel que soit le fuseau — indispensable pour un usage entre la
  Guadeloupe (UTC−4) et la métropole.
- **Montants en centimes entiers** (`src/utils/money.ts`), suffixe `Cents`.
  Les additions sont exactes ; la conversion en euros n'a lieu qu'à l'affichage.

Les bases créées avec une version précédente sont converties automatiquement à
la première ouverture (migrations Dexie jusqu'à la v7, testées dans
`src/services/migration.test.ts`). La v6 ajoute le jour d'ancrage des échéances
et le solde d'ouverture des projets ; la v7, les réglages propres à l'appareil.

## Architecture

    src/utils/       dates civiles, montants en centimes, lecture des relevés
    src/types/       modèle de données (13 entités)
    src/onedrive/    passerelle OneDrive : protocole, PKCE, appels Graph
    src/services/    Dexie (IndexedDB) et métier — comptes, opérations,
                     virements, échéances, budgets, bilans, prévisionnel long
                     terme, rapprochement, import de relevés, sauvegarde
                     (chiffrement, écriture automatique)
    src/store/       état de session (écran courant, base active)
    src/hooks/       lecture réactive des données (useLiveQuery)
    src/components/  Layout, modale accessible, formulaires, graphiques SVG
    src/screens/     les 8 écrans + assistant de premier démarrage

## Développement

    npm install
    npm run dev            # serveur local
    npm test               # 235 tests unitaires et d'intégration
    npm run lint           # ESLint
    npm run typecheck      # TypeScript en mode strict
    npm run build          # dist/ — application PWA installable (servie en HTTP)
    npm run build:single   # dist-single/index.html — fichier autonome (file://)

Le service worker ne pouvant pas s'enregistrer sous `file://`, la PWA est
volontairement désactivée dans le mode « fichier unique ».

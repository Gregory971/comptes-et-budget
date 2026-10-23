# Comptes & Budget

Gestionnaire de comptes personnels **local-first** : toutes les données restent
dans votre navigateur (IndexedDB). Aucun serveur, aucune requête réseau, aucun
traceur. Montants en euros.

**Application en ligne** → https://VOTRE-COMPTE.github.io/comptes-et-budget/

> ⚠️ **Vos données ne quittent jamais votre appareil.** Publier ce dépôt rend le
> *code* public, pas vos comptes : la base est stockée localement par le
> navigateur, et chaque appareil possède la sienne. Pour la transporter d'une
> machine à l'autre, utilisez l'export / import de sauvegarde (`.cbjson`), et ne
> versionnez jamais ces fichiers — ils sont exclus par le `.gitignore`.

## Fonctions

- **Comptes** : courant, épargne, espèces, carte ; archivage sans perte d'historique.
- **Opérations** : saisie « quand / combien / qui / pourquoi / comment », référence,
  commentaire, rattachement à un bien ou à un projet ; solde progressif, pointage,
  duplication, recherche.
- **Prévisionnel** : bascule qui ajoute au relevé du mois les échéances à venir
  (montants certains) et le reste à vivre budgétaire (estimations), avec le solde
  estimé en fin de mois.
- **Virements entre comptes** en écriture double, exclus des bilans recettes/dépenses.
- **Échéances** : périodicité, date de fin, comptabilisation automatique ou sur
  confirmation, report en cas de jour férié ou non ouvré.
- **Budgets** mensuels par catégorie, avec reste à vivre et **alertes** à 80 %
  (seuil réglable) puis au dépassement.
- **Biens et projets d'épargne**, patrimoine estimé.
- **Bilans** mois / trimestre / année, graphiques SVG sans dépendance externe.
- **Import de relevés** CSV ou OFX : format déduit du contenu, doublons
  signalés, tiers et catégorie proposés par des règles apprises de vos
  corrections (origine et confiance affichées), rien d'écrit avant confirmation.
- **Rapprochement bancaire** : écart entre le solde du relevé et le total des
  opérations pointées, pointage à l'unité ou en bloc.
- **Trésorerie prévisionnelle** sur 3 à 24 mois, avec la date du premier
  passage sous zéro et le point bas de chaque mois.
- **Thème** clair, sombre ou réglé par le système.
- **Sauvegarde vers OneDrive** (Microsoft Graph), éteinte par défaut : les
  appels réseau vivent dans un document séparé, `onedrive.html`, avec sa propre
  politique de sécurité — l'application conserve `connect-src 'none'`. Portée
  limitée au dossier d'application.
- **Sauvegarde** exportable — en clair ou **chiffrée** par phrase secrète —,
  réimportable en mode *fusion* (la modification la plus récente l'emporte) ou
  *remplacement*, et **écriture automatique** dans un fichier ou un dossier
  désigné une fois — celui de OneDrive, Google Drive ou iCloud —, avec une copie
  datée par jour et dix exemplaires conservés (navigateurs Chromium).

## Édition bureau (Windows)

Un installeur Windows (x64 et ARM64, dossier `desktop/`) réunit l'application et ses
fonctions de bureau : sauvegarde automatique dans un dossier choisi, ouverture d'un
fichier `.cbjson` par double-clic, liens vers les documents. Les données restent dans le
profil de l'utilisateur et la page ne contacte aucun serveur. Pour reprendre les données
de la version web, exportez une sauvegarde `.cbjson` depuis le site puis « Restaurer une
sauvegarde » au premier lancement. Construction : `cd desktop && node scripts/prepare.cjs
&& npx electron-builder --win nsis --x64 --arm64` (sortie dans `release/`). Les installeurs
ne sont pas signés : Windows SmartScreen ou un antivirus peuvent s'y opposer.

## Installation en application

Ouvrez le site dans Chrome, Edge ou Safari, puis « Installer l'application ».
Elle fonctionne ensuite hors ligne et se lance depuis le bureau.

Une version **fichier unique** est aussi publiée à la racine du site :
[`Comptes-et-Budget-autonome.html`](./Comptes-et-Budget-autonome.html). Vous
pouvez la télécharger et l'ouvrir directement depuis votre explorateur de
fichiers, sans connexion ni installation.

## Jours fériés

Le report des échéances s'appuie sur le calendrier légal, réglable dans
Préférences → Général : les 11 jours fériés nationaux (code du travail,
art. L3133-1) et la commémoration de l'abolition de l'esclavage (art. L3422-2) —
27 mai en Guadeloupe et à Saint-Martin, 22 mai en Martinique, 10 juin en Guyane,
27 avril à Mayotte, 9 octobre à Saint-Barthélemy, 20 décembre à La Réunion.

## Confidentialité imposée par le navigateur

La promesse « vos données ne quittent jamais votre appareil » ne repose pas sur
la seule lecture du code : les pages publiées portent une **politique de
sécurité du contenu** dont la directive `connect-src 'none'` fait refuser par le
navigateur lui-même toute requête sortante — `fetch`, `XMLHttpRequest`,
`WebSocket` et `sendBeacon` compris. Une dépendance qui tenterait un jour
d'émettre vers l'extérieur serait bloquée, sans intervention de votre part.

La politique est définie dans `src/utils/csp.ts` et vérifiée par
`src/utils/csp.test.ts`, afin qu'un assouplissement ultérieur fasse échouer la
publication plutôt que de passer inaperçu.

Deux compléments depuis la version 2.5.0 :

- la base demande le **stockage persistant** au navigateur
  (`navigator.storage.persist()`), qui la met à l'abri de l'éviction
  automatique sous pression disque ou après une longue absence ;
- la sauvegarde exportée peut être **chiffrée** (AES-GCM 256, clé dérivée par
  PBKDF2-SHA256, 600 000 itérations) : le fichier déposé dans un dossier
  synchronisé n'est plus lisible sans la phrase secrète.

La sauvegarde OneDrive (2.6.0) ne déroge pas à la règle : une politique en
balise `<meta>` ne pouvant être élargie à l'exécution, les appels à Microsoft
sont confinés dans `onedrive.html`, document distinct dont la politique
n'autorise que quatre hôtes. `src/utils/csp.test.ts` en énumère la liste, et
vérifie que la page de l'application garde `connect-src 'none'` dans les deux
modes de construction. ⚠️ L'écriture effective dans OneDrive n'a pas encore pu
être éprouvée en conditions réelles : elle n'est testée que contre un faux
serveur Microsoft (2.8.0) — voir `docs/TEST-ONEDRIVE.md` pour l'essai manuel.

## Accès sécurisé (verrou local)

Depuis la version 2.7.0, l'application s'ouvre sur un **écran de connexion** :
adresse, puis mot de passe, selon le parcours d'une application Softr (deux
étapes, inscription fermée, message d'erreur unique). Un accès est créé au
premier lancement, avec un **code de récupération** affiché une seule fois.

**C'est un verrou local, pas une authentification en ligne.** L'application n'a
ni serveur ni droit de requête réseau : aucun service ne peut dire « cette
personne est bien connectée », ni envoyer un lien par courriel. L'équivalent
compatible avec la garantie de confidentialité ci-dessus est un verrou propre à
l'appareil, et ce qu'il garantit se dit avec précision :

| Il protège contre… | Il ne protège pas contre… |
|---|---|
| un ordinateur partagé, un téléphone prêté, une session laissée ouverte | quelqu'un qui dispose du profil du navigateur **et** d'outils de développement : la base IndexedDB n'est pas chiffrée |
| l'essai répété de mots de passe (ralentissement progressif, 5 s doublées jusqu'à 30 min) | l'exécution de code dans la page (le ralentissement est un frein d'usage, non une barrière) |

Chiffrer la base n'est pas possible sans renoncer aux requêtes de Dexie : les
champs indexés (dates, comptes) doivent rester lisibles. Contre la lecture du
disque, la bonne protection est le chiffrement de l'appareil ; contre la fuite
d'une copie, la **sauvegarde chiffrée** (voir ci-dessus).

Choix d'implémentation (`src/services/authService.ts`) :

- **Aucun secret n'est stocké.** Seulement l'empreinte PBKDF2-SHA256 du mot de
  passe et du code de récupération (600 000 itérations, sel de 16 octets propre à
  chacun) — mêmes paramètres que la sauvegarde chiffrée. Les paramètres sont
  conservés avec l'empreinte : elle est refaite à la connexion si le coût est un
  jour relevé.
- **Comparaison à durée constante, et empreinte toujours calculée**, même si
  l'adresse est fausse : ni le message ni le temps de réponse ne disent laquelle
  des deux informations était erronée.
- **Mot de passe normalisé en Unicode NFKC** : « é » composé ou décomposé donne la
  même empreinte, d'un clavier à l'autre.
- **Longueur minimale (10 caractères) et refus des mots de passe triviaux**,
  plutôt que des règles de composition qui poussent à « Motdepasse1! ».
- **Session en mémoire uniquement** : rien n'est écrit dans `localStorage` ni
  `sessionStorage`, car un indicateur écrit est un indicateur qu'on peut poser à
  la main. Recharger la page redemande les identifiants. Verrouillage après 15
  minutes d'inactivité (5, 15, 30 ou 60), mesuré sur des horodatages : les
  minuteurs d'un onglet en arrière-plan sont suspendus par les navigateurs.
- **L'application est démontée, non masquée**, tant que l'accès n'est pas
  accordé : aucun écran ne s'exécute, aucune requête ne lit la base. Contrepartie :
  un verrouillage pour inactivité perd une saisie en cours.
- **Réglage d'appareil.** Les identifiants vivent dans la table `settings`, jamais
  dans un fichier de sauvegarde : restaurer une sauvegarde sur un autre appareil
  n'y apporte pas cet accès, et n'écrase pas celui de l'appareil qui restaure.
- **Sans WebCrypto** (page non servie en contexte sécurisé), aucune empreinte
  n'est calculable : l'accès n'est alors pas imposé, plutôt que de rendre
  l'application inutilisable. Un accès déjà créé n'est jamais contourné pour
  autant.
- **Mot de passe et code perdus : il n'existe aucun contournement**, ce qui serait
  vider le verrou de son sens. Reste l'effacement des données de l'appareil — dit
  pour ce qu'il est, et soumis à la saisie de « EFFACER » — puis la restauration
  d'une sauvegarde exportée.

Tout est modifiable dans Préférences → Sécurité (mot de passe, adresse, délai,
nouveau code de récupération, désactivation), chaque action sensible redemandant
le mot de passe.

## Conventions techniques

- **Dates civiles** `AAAA-MM-JJ` (`src/utils/date.ts`), jamais d'horodatage ISO
  pour les dates métier : la comparaison de chaînes vaut comparaison
  chronologique quel que soit le fuseau — indispensable pour un usage entre la
  Guadeloupe (UTC−4) et la métropole.
- **Montants en centimes entiers** (`src/utils/money.ts`), suffixe `Cents` :
  les additions sont exactes, la conversion en euros n'a lieu qu'à l'affichage.

## Développement

```bash
npm install
npm run dev            # serveur local
npm test               # 292 tests unitaires et d'intégration
npm run lint           # ESLint
npm run typecheck      # TypeScript strict
npm run build          # dist/ — application PWA
npm run build:single   # dist-single/index.html — fichier autonome
```

Pile : React 18, TypeScript, Vite, Dexie (IndexedDB), Zustand.

## Publication

Chaque envoi sur `main` déclenche [le workflow](.github/workflows/deploy.yml) :
contrôle des types, analyse du code, tests, construction, puis publication sur
GitHub Pages. Un échec à l'une de ces étapes empêche la mise en ligne.

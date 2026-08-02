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
- **Budgets** mensuels par catégorie, avec reste à vivre.
- **Biens et projets d'épargne**, patrimoine estimé.
- **Bilans** mois / trimestre / année, graphiques SVG sans dépendance externe.
- **Sauvegarde** exportable, réimportable en mode *fusion* (la modification la
  plus récente l'emporte) ou *remplacement*.

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
npm test               # 105 tests unitaires et d'intégration
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

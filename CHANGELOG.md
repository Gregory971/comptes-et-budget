# Journal des modifications

## Version 2.5.1 — 23 août 2026

### Sauvegarde automatique vers OneDrive (et tout dossier synchronisé)

La sauvegarde automatique ne visait qu'un **fichier**, et l'interface ne parlait
que de Google Drive. Elle accepte désormais un **dossier** — celui de OneDrive,
de Google Drive ou d'iCloud — et y dépose une copie **datée par jour**, en ne
conservant que les dix plus récentes.

Le gain n'est pas cosmétique : avec un fichier unique, une base vidée par
erreur, une importation malheureuse ou une corruption étaient recopiées
par-dessus la seule sauvegarde existante à l'ouverture suivante. Dix copies
datées laissent le temps de s'en apercevoir.

- **Aucune requête réseau ajoutée.** L'application écrit un fichier local ;
  c'est le client de synchronisation déjà installé sur la machine qui l'envoie
  dans le nuage. La politique `connect-src 'none'` reste donc intacte, et la
  garantie « vos données ne quittent jamais votre appareil » n'est pas entamée :
  ce qui part vers OneDrive, c'est le fichier que vous y avez délibérément
  rangé.
- La purge ne touche qu'aux fichiers portant le nom de la base suivi d'une date
  (`Mes_comptes_2026-08-23.cbjson`) : les autres fichiers du dossier sont
  laissés intacts. Un échec de suppression — fichier verrouillé par la
  synchronisation en cours — n'interrompt pas la sauvegarde.
- Le navigateur ne communique jamais le chemin complet d'une destination
  choisie : l'interface affiche le nom retenu sans prétendre reconnaître
  OneDrive.
- Les libellés de l'application, du LISEZ-MOI et du README ne citent plus Google
  Drive comme seul service.

Ces fichiers restent écrits **en clair**, et l'interface le dit : chiffrer la
sauvegarde automatique supposerait de retenir la phrase secrète d'une session à
l'autre, donc de l'écrire quelque part. Pour un dossier partagé avec d'autres
personnes, l'export manuel chiffré (2.5.0) reste la bonne réponse.

### Vérifications

- **200 tests** (contre 194) : dépôt daté, réécriture de la copie du jour,
  rotation à dix exemplaires, respect des fichiers étrangers au dossier, purge
  qui échoue sans interrompre la sauvegarde, assainissement du nom de base.
- Contrôlé sur l'application construite, en thème clair et sombre.

## Version 2.5.0 — 22 août 2026

Quatre chantiers : les défauts relevés à l'audit, l'import de relevés
bancaires, la sauvegarde chiffrée et automatique, la trésorerie prévisionnelle
avec rapprochement bancaire.

### Défauts corrigés

**Les échéances de fin de mois dérivaient définitivement.** `advance()`
s'appuyait sur `addMonths()`, qui borne au dernier jour du mois cible. Un
prélèvement du 31 janvier devenait le 28 février — ce qui est juste — puis
repartait de cette date écrêtée : 28 mars, 28 avril, 28 mai. Le prélèvement
avait changé de jour pour toujours, sans que rien ne le signale, et aucun test
ne couvrait le cas. Les échéances portent désormais un **jour d'ancrage**
(`anchorDay`, schéma v6) : le calcul repart du quantième d'origine, si bien que
le 31 revient au 31 dès que le mois le permet — 31/01, 28/02, 31/03, 30/04. La
règle vaut aussi pour le 29 février d'une échéance annuelle. Modifier la date à
la main redéfinit l'ancrage ; les échéances existantes reprennent le quantième
de leur prochaine occurrence, une ressaisie suffisant à réparer celles qui
avaient déjà dérivé.

**La base n'était pas à l'abri d'une éviction par le navigateur.** Rien
n'appelait `navigator.storage.persist()` : IndexedDB restait en stockage
« best-effort », que le navigateur peut supprimer sous pression disque et que
WebKit efface d'office au bout de sept jours sans visite. Pour une application
sans serveur, c'est la perte des comptes. La persistance est demandée au
lancement, une seule fois, et Préférences → Général affiche l'état obtenu ainsi
que l'espace occupé, avec un bouton pour relancer la demande après un refus.

**Le thème sombre était déclaré mais inexistant.** `Preferences.theme`
annonçait « clair | sombre » depuis la v1 sans qu'aucune règle CSS ne
l'applique. Le thème existe désormais pour de bon : trois états — Système
(défaut), Clair, Sombre —, réglage propre à l'appareil, posé sur un attribut
`data-mode` distinct du `data-theme` qui sépare déjà les profils perso et pro.
Seules les variables de couleur changent ; un test vérifie qu'aucune n'est
oubliée dans le bloc sombre. Les graphiques suivent le thème.

**Les projets d'épargne affichaient deux montants concurrents** : le « déjà
épargné » saisi à la main et le total des opérations rattachées, sans qu'aucun
ne fasse foi. Le premier devient un **solde d'ouverture**, auquel s'ajoutent les
mouvements rattachés au projet : une seule épargne est affichée. Convention de
signe explicitée dans l'interface — une somme qui quitte le compte augmente
l'épargne du projet, une reprise la diminue.

### Import de relevés bancaires (CSV, OFX)

Tout se saisissait à la main. Un relevé téléchargé depuis la banque est
désormais lu par l'application — sur l'appareil, la politique de sécurité
interdisant toujours toute requête sortante.

- **Format déduit du contenu** : séparateur point-virgule, virgule, tabulation
  ou barre verticale ; montant en colonne signée ou en colonnes débit/crédit ;
  dates JJ/MM/AAAA, JJ-MM-AA, AAAA-MM-JJ ou AAAAMMJJ ; décimale à la virgule ou
  au point, espaces insécables dans les milliers, signe suffixé ou entre
  parenthèses. Les fichiers OFX/QFX sont lus en SGML comme en XML. Les exports
  encore encodés en Windows-1252 sont détectés et relus correctement.
- **Doublons** : une ligne déjà présente est repérée sur le montant, une
  fenêtre de quatre jours et, si elle existe, la référence. Chaque opération
  existante ne peut absorber qu'une seule ligne — deux dépenses identiques le
  même jour restent deux dépenses. Les doublons sont décochés, non supprimés.
- **Classement** : le libellé de la banque est confronté aux tiers connus, ce
  qui rattache l'opération au tiers et à sa catégorie par défaut. Rien n'est
  deviné au-delà : une ligne non reconnue reste sans catégorie.
- **Rien n'est écrit avant confirmation**, et les lignes illisibles sont
  listées avec leur motif plutôt qu'ignorées en silence.

### Sauvegarde chiffrée et automatique

- **Chiffrement facultatif à l'export** : AES-GCM 256 bits, clé dérivée de la
  phrase secrète par PBKDF2-SHA256 à 600 000 itérations (recommandation OWASP),
  sel et vecteur d'initialisation tirés au hasard à chaque export. Le fichier
  destiné à un dossier synchronisé cesse d'être en clair. La phrase n'est
  conservée nulle part : l'avertissement le dit avant l'export, et l'import la
  redemande. Un fichier altéré est rejeté au lieu d'être déchiffré en données
  fausses.
- **Sauvegarde automatique** : un fichier désigné une seule fois — par exemple
  dans « Google Drive pour ordinateur » — est réécrit à chaque ouverture et à
  chaque passage de l'onglet en arrière-plan, sans nouvelle question (File
  System Access API, navigateurs Chromium). Ce fichier est écrit **en clair**,
  et l'interface le dit : le chiffrer supposerait de retenir la phrase secrète
  entre deux sessions, donc de l'écrire quelque part. Un échec d'écriture est
  enregistré et affiché — une sauvegarde que l'on croit faite est pire que pas
  de sauvegarde. Sur les navigateurs sans cette API, l'application se limite à
  rappeler la date du dernier export.

### Trésorerie prévisionnelle et rapprochement bancaire

- **Projection sur 3, 6, 12 ou 24 mois** (écran Bilans), là où le prévisionnel
  s'arrêtait à la fin du mois affiché. Deux tracés distincts : les échéances
  programmées, dont la date et le montant sont certains, et les enveloppes
  budgétaires, qui restent des estimations. L'application annonce le **premier
  passage sous zéro à la date exacte**, calculé sur les seules échéances — y
  mêler des estimations produirait des alertes imaginaires. Le détail mensuel
  donne l'ouverture, les échéances, le **point bas** du mois et sa date : c'est
  le creux du milieu de mois qui déclenche les frais de découvert, pas le solde
  de clôture.
- **Rapprochement bancaire** (écran Comptes, bouton « Rapprocher ») : le
  pointage existait depuis la v1 mais n'alimentait aucun contrôle. La fenêtre
  confronte le solde annoncé par le relevé au total des opérations pointées et
  chiffre l'écart — le seul contrôle capable de déceler une saisie oubliée, une
  double saisie ou un montant erroné, puisque la base reste cohérente avec
  elle-même. Les opérations en attente se pointent une à une ou d'un bloc.

### Vérifications

- **194 tests** (contre 106), dont la non-régression complète de la dérive des
  échéances, la lecture de huit variantes de relevés, la détection des
  doublons, le chiffrement de bout en bout et la projection de trésorerie.
- Contrôlé sur l'application construite, dans un navigateur, en thème clair et
  en thème sombre : import d'un relevé réel puis réimport du même fichier (les
  cinq lignes détectées en doublon), rapprochement d'un compte, projection sur
  douze mois avec découvert annoncé au 31/08/2026. Aucune erreur console.

## Version 2.4.1 — 3 août 2026

### Fenêtres modales tronquées

**Le formulaire d'une nouvelle échéance était impossible à valider.** Les
fenêtres modales n'avaient ni hauteur maximale ni défilement : dès que leur
contenu dépassait la fenêtre du navigateur, le bas était purement rogné, sans
barre de défilement pour l'atteindre. Le bouton « Enregistrer » se retrouvait
hors écran — mesuré à 1105 px dans une fenêtre haute de 700 px.

Le défaut préexistait, mais la refonte 2.4.0 l'a rendu manifeste : champs plus
hauts (10 px de marge intérieure au lieu de 7) et cartes plus aérées ont suffi
à faire déborder le plus long formulaire de l'application.

La modale est désormais plafonnée à 90 % de la hauteur visible. Son titre et sa
croix de fermeture restent fixes, seul le corps défile ; sur les écrans très
bas, le voile défile à son tour. Aucune autre fenêtre n'est affectée : celles
qui tenaient déjà s'affichent à l'identique.

### Vérifications

- Un test ajouté (106 au total) sur le plafond de hauteur, le défilement du
  corps et celui du voile — les trois règles dont dépend l'accessibilité du
  bouton de validation.
- Contrôlé sur l'application construite en 1280 × 700 : la modale tient dans
  l'écran, son corps défile (551 px visibles pour 1014 px de contenu) et le
  bouton « Enregistrer » redevient visible et réellement cliquable.

## Version 2.4.0 — 2 août 2026

Refonte de l'apparence d'après une maquette Claude Design. Les calculs, les
données et les règles métier sont inchangés : seuls la présentation et
l'agencement de l'accueil évoluent.

### Une barre latérale à la place du bandeau

La navigation passait par un bandeau bleu horizontal de huit onglets, doublé
d'une colonne d'actions à gauche du contenu. Elle tient désormais dans une
**barre latérale sombre** unique : entrées de navigation, actions (Ajouter,
Voir les opérations, Exporter, Importer) et sélecteur de base y cohabitent.
Le contenu y gagne toute la largeur restante.

Sous 900 px la barre redevient un bandeau horizontal défilant : la maquette ne
couvrait que le poste de bureau, or l'application s'installe aussi sur
téléphone. Les actions y restent visibles — l'écran de saisie ne figurant pas
dans la navigation, les masquer aurait rendu « Ajouter » inatteignable.

### Palette et typographie

Turquoise en accent principal, corail en secondaire, fond gris-bleu très clair,
cartes blanches à angles de 18 px, contrôles en pilule. Titres et montants en
**Space Grotesk**, texte courant en **Manrope**, les montants alignés sur des
chiffres à chasse fixe.

Les deux familles sont **incorporées à l'application**, non chargées depuis
Google Fonts comme le faisait la maquette : une police distante violerait la
politique de sécurité posée en 2.2.1 (`connect-src 'none'`), romprait la
garantie que rien ne sort de l'appareil et casserait le fonctionnement hors
ligne. Variables et réduites au sous-ensemble latin — é à ç œ € compris —
elles pèsent 47 Ko.

Le fichier autonome les porte en base64, faute de quoi elles seraient
introuvables une fois le fichier ouvert seul. La directive `font-src` n'est
élargie à `data:` que dans ce mode.

### L'accueil devient un tableau de bord

Quatre indicateurs du mois en tête — solde total, recettes, dépenses, solde du
mois — puis les dernières opérations et les prochaines échéances côte à côte,
et les comptes en pied.

Le quatrième indicateur est le **solde** du mois et non une « épargne » comme
dans la maquette : les virements vers un compte d'épargne étant déjà exclus des
recettes et dépenses, recettes − dépenses correspond exactement à ce qui a été
mis de côté. Le nommer autrement aurait supposé une notion absente du modèle.

Chaque opération porte la pastille de sa catégorie, reprenant l'icône choisie
en 2.3.0 et retombant sur l'initiale à défaut. Sa teinte est déduite du nom de
la catégorie : stable d'un affichage à l'autre, sans table à tenir à jour.

### Comptes, Budget et Patrimoine

- **Budget** : le suivi passe d'une liste à une grille de cartes à deux
  colonnes, barre de progression turquoise tant que la marge est confortable,
  corail à partir de 85 %, rouge au-delà. Le libellé conserve le reste à
  dépenser, plus utile que le seul pourcentage.
- **Biens / Projets** : patrimoine total en tête, barre segmentée par type de
  bien, puis cartes de répartition à pastille colorée et part du total.
  L'agrégation porte sur les types réellement présents.
- **Comptes** : grille de cartes en vue d'ensemble. Le tableau est conservé —
  lui seul porte la modification et l'archivage, absents de la maquette.

### Vérifications

- Contrôlé sur l'application construite, à deux tailles d'écran : mise en page
  sans débordement, actions accessibles sur téléphone, polices bien
  incorporées et politique de sécurité respectée dans les deux modes.
- Éprouvé sur données réelles saisies dans l'application : trois biens de types
  distincts (83,1 / 11,1 / 5,8 % du patrimoine) et quatre budgets.
- Un test ajouté sur la directive `font-src` (105 au total). Le parcours de
  bout en bout suivait le titre « Accueil » et la classe `balance`, tous deux
  supprimés par la refonte ; il vérifie désormais les mêmes soldes sur la
  nouvelle structure, sans assertion affaiblie.

## Version 2.3.0 — 2 août 2026

### Choix des icônes de catégories

Les catégories créées à la main n'avaient **aucune icône** : le formulaire
« + catégorie dans ce groupe » ne proposait pas ce champ, et le service ne
recevait donc jamais de valeur. Dans les listes d'opérations, ces catégories
s'affichaient avec un blanc là où celles du catalogue portent leur pictogramme.
Quant à l'icône d'un groupe, elle ne se renseignait qu'à la création, dans une
zone de texte : il fallait connaître le raccourci du système pour composer un
emoji, et rien ne permettait de la corriger ensuite.

Un **sélecteur d'icône** remplace ce champ et apparaît à quatre endroits : à la
création d'un groupe, à la création d'une catégorie, et sur l'icône de chaque
groupe et de chaque catégorie déjà enregistrés — un clic dessus suffit désormais
à la changer.

La palette réunit 88 emoji classés par usage (alimentation, logement, transport,
santé, loisirs, abonnements, télécommunications, banque, revenus, famille,
divers), et une zone de saisie libre accepte n'importe quel autre emoji. Le
bouton « Aucune icône » permet de revenir en arrière.

**Une catégorie créée sans choix reprend l'icône de son groupe** plutôt que de
rester vide : une ligne sans pictogramme se repère mal dans un relevé.

Aucune modification du modèle de données : `createCategory`, `updateGroup` et
`updateCategory` acceptaient déjà une icône — seule l'interface ne la
transmettait pas.

### Vérifications

- 9 tests ajoutés (104 au total) : affichage de l'icône courante, nom accessible
  du bouton lorsqu'aucune icône n'est posée, choix dans la palette, saisie libre,
  refus d'une saisie vide, retrait de l'icône, marquage de l'icône déjà
  sélectionnée, annulation sans effet, et absence de doublon dans la palette.
- Contrôlé sur l'application construite : création d'une catégorie sans icône
  (héritage du groupe vérifié en base) puis changement de son icône, tous deux
  bien enregistrés dans IndexedDB.

## Version 2.2.1 — 2 août 2026

Première mise en ligne de l'application sur GitHub Pages, et le durcissement que
cette publication rendait nécessaire. Aucun changement de fonctionnement : les
écrans, les calculs et les données sont identiques à la version 2.2.0.

### La confidentialité devient opposable

L'application promet que les données ne quittent jamais l'appareil. Jusqu'ici,
cette promesse ne reposait que sur un constat de lecture — le code n'appelle
aucune API réseau — qu'une dépendance ajoutée plus tard aurait pu rompre sans
que rien ne le signale.

Les pages construites portent désormais une **politique de sécurité du contenu**
dont la directive `connect-src 'none'` fait refuser par le navigateur lui-même
toute requête sortante : `fetch`, `XMLHttpRequest`, `WebSocket` et `sendBeacon`
comprises. Vérifié sur le site publié — les quatre émettent une violation — le
service worker restant actif et le mode hors ligne intact.

`frame-ancestors` en est délibérément absente : la directive est ignorée
lorsqu'elle est déclarée par balise `<meta>`, et GitHub Pages ne permet d'émettre
aucun en-tête HTTP. L'y inscrire aurait laissé croire à une protection contre le
détournement de clic qui ne se serait jamais appliquée.

La politique vit dans `src/utils/csp.ts` plutôt que dans la configuration de
construction, afin d'être couverte par le contrôle de types et par ses propres
tests : un assouplissement ultérieur fera échouer la publication au lieu de
passer inaperçu.

### Vulnérabilités des outils de construction

Montée de **Vite 5 → 7** et de `@vitejs/plugin-react` 4 → 5, qui corrige deux
failles du serveur de développement : le contournement de chemin de Vite
(`GHSA-4w7w-66w2-5vf9`, sévérité élevée) et l'accès aux réponses du serveur
depuis un site tiers via esbuild (`GHSA-67mh-4wv8-2f99`). Le site publié, qui
est statique, n'était pas exposé ; le poste de développement l'était.
`npm audit` ne signale plus rien.

Vite 7 est retenu plutôt que Vite 8 : vitest 4 l'accepte, si bien que l'arbre se
dédoublonne sur une seule instance — il en portait **deux**, dans un état
invalide (`ELSPROBLEMS`), avec un esbuild incompatible entre elles — là où le
passage à la 8 imposerait une chaîne rolldown/babel en conflit.

### Fiabilité de la publication

La première tentative de mise en ligne a échoué deux fois, pour deux raisons
distinctes qui sont maintenant traitées :

- le `package-lock.json` versionné ne correspondait plus au `package.json`, ce
  qui fait échouer `npm ci` — resynchronisé ;
- les dépendances récentes exigent Node ≥ 22 alors que le workflow était figé
  sur Node 20, avec à la clé un message trompeur (« Missing: esbuild@… from lock
  file ») désignant le lock file plutôt que la version de Node. Le workflow passe
  à Node 24, et `engines` + `engine-strict` font désormais nommer la cause réelle
  dès l'installation.

### Vérifications

- 7 tests ajoutés (95 au total) sur la politique de sécurité : interdiction de
  toute requête sortante dans les deux modes de construction, verrouillage des
  vecteurs annexes (`form-action`, `base-uri`, `object-src`), dérogation aux
  scripts en ligne restreinte au seul fichier autonome, et absence de
  `frame-ancestors`.
- Contrôlé sur le site réellement publié : CSP présente, exfiltration bloquée,
  service worker actif, application fonctionnelle.

> **À la première ouverture après cette mise à jour**, un appareil où
> l'application était déjà installée peut afficher la version précédente le temps
> que le service worker se renouvelle. Un second lancement suffit.

## Version 2.2.0 — 2 août 2026

### Affichage prévisionnel des opérations

Nouvelle bascule **Réel / Prévisionnel** dans la barre d'outils de l'écran
Opérations. En mode prévisionnel, les lignes à venir s'ajoutent au tableau à leur
date, en italique grisé, et le solde progressif se poursuit jusqu'à la fin du mois.

Deux natures de prévision, volontairement distinguées :

- **Échéances programmées** (pastille orange, icône ⏰) — opérations planifiées
  non encore comptabilisées, avec leur date effective, report des jours fériés
  appliqué. Montants certains.
- **Reste à vivre budgétaire** (liseré tiret orange, icône 📊) — pour chaque
  catégorie budgétée, l'écart entre le budget mensuel et ce qui a déjà été
  dépensé, positionné en fin de mois. Montants estimés.

Un bandeau de synthèse affiche le calcul complet :
*solde réel + échéances à venir − reste à vivre = solde estimé en fin de mois*,
repris dans la barre de statut.

**Pas de double comptage** : la part d'un budget déjà couverte par une échéance
programmée est retranchée du reste à vivre. Un loyer de 900 € à la fois budgété
et programmé compte une seule fois. Un budget déjà dépassé n'ajoute rien.

### Vérifications

- 11 tests ajoutés (88 au total) : séparation réel / estimé, report des jours
  fériés sur les échéances prévues, reste à vivre positionné en fin de mois,
  absence de double comptage budget + échéance, budget dépassé ignoré, exclusion
  des échéances déjà passées, arrêt à la date de fin, filtrage par compte, ordre
  d'affichage, et un test d'interface qui bascule en prévisionnel puis compare le
  bandeau au calcul du service.
- Suppression d'une redondance : la bascule figurait à la fois dans la barre
  latérale et dans la barre d'outils.

## Version 2.1.2 — 2 août 2026

### Corrections de saisie

- **Le champ « Qui — tiers » était inutilisable.** C'était un menu déroulant
  alimenté par le seul référentiel, or la création d'une base n'initialise aucun
  tiers — contrairement aux catégories et aux modes de paiement. Le menu était
  donc vide, et il fallait passer par Préférences → Tiers avant de pouvoir saisir
  la moindre opération. Le champ accepte désormais un **nom libre** avec
  proposition des tiers déjà enregistrés, et crée automatiquement le tiers à
  l'enregistrement — comme le fait le logiciel de référence. La correspondance
  ignore la casse, les accents et les espaces superflus, et réactive un tiers
  archivé plutôt que d'en créer un doublon.
- **Le compte n'était pas retenu à l'ouverture d'un formulaire.** Les comptes
  étant chargés après le premier rendu, l'état interne restait vide alors que le
  menu affichait bien un compte : « Enregistrer » répondait « Sélectionnez un
  compte » sans que rien ne paraisse manquer. Le premier compte est maintenant
  adopté dès qu'il devient disponible, dans les formulaires d'opération, de
  virement et d'échéance.
- La résolution du tiers a lieu à l'enregistrement et non à la sortie du champ :
  la création en base étant asynchrone, un clic direct sur « Enregistrer »
  aurait enregistré l'opération sans tiers rattaché.

### Vérifications

- 10 tests ajoutés (77 au total), dont un parcours complet : ouvrir
  « Comptabiliser », saisir un montant à la virgule et un tiers inédit, cliquer
  sur « Enregistrer », puis vérifier en base que l'opération porte le bon montant
  et que le tiers a bien été créé et rattaché.

## Version 2.1.1 — 2 août 2026

### Correction d'affichage

- **Boutons radio et cases à cocher déformés.** La règle globale
  `input, select { width: 100% }` de la feuille de style s'appliquait aussi aux
  contrôles à cocher : chaque bouton radio occupait toute la largeur de sa ligne,
  bordure et remplissage compris, rejetant son libellé hors du cadre. Le défaut
  était visible dans le bloc « Comptabiliser » du formulaire d'échéance et
  affectait également le choix Fusionner / Remplacer de l'import et la case
  « Afficher les tiers archivés ».
- Les libellés de ces lignes héritaient par ailleurs du style général des
  `<label>` (12 px, gras, gris) : ils reprennent désormais la taille et la
  graisse du texte courant.
- **Test de non-régression ajouté** : la cascade CSS est résolue sur un DOM réel
  et vérifie que les contrôles à cocher gardent leur taille naturelle, tandis que
  les champs de saisie conservent la largeur pleine (5 tests, 67 au total).

## Version 2.1.0 — 2 août 2026

Alignement sur les fonctions du logiciel Comptes et Budget 10.2.0, dans
l'ergonomie de l'application web (formulaires d'une seule page).

### Échéances complètes

- **Date de fin « Jusqu'au »** : la programmation s'arrête d'elle-même une fois
  la date atteinte ; l'échéance passe en « terminée » sans être supprimée.
- **Comptabilisation automatique ou manuelle.** En mode automatique, les
  opérations sont créées au lancement de l'application, avec rattrapage des
  occurrences manquées après une absence. En mode manuel, une fenêtre liste les
  échéances échues et attend confirmation, une par une ou en bloc.
- **Règle en cas de jour férié ou non ouvré** : report au jour ouvrable suivant,
  au jour ouvrable précédent, ou maintien à la date exacte. L'opération porte la
  date reportée, tandis que la prochaine échéance repart de la date théorique —
  un prélèvement du 15 reste au 15 le mois suivant même s'il a été reporté au 17.
- **Calendrier des jours fériés** paramétrable par territoire (Préférences →
  Général), avec les 11 jours nationaux de l'article L3133-1 du code du travail
  et la commémoration de l'abolition de l'esclavage de l'article L3422-2 :
  27 mai en Guadeloupe et à Saint-Martin, 22 mai en Martinique, 10 juin en
  Guyane, 27 avril à Mayotte, 9 octobre à Saint-Barthélemy, 20 décembre à
  La Réunion. Les fêtes mobiles sont calculées à partir de Pâques (algorithme de
  Meeus). Le Vendredi saint, propre à l'Alsace-Moselle, est exclu ; les jours
  gras et la mi-carême relèvent de l'usage local et non de la loi.
- **Aperçu des trois prochaines comptabilisations** dans le formulaire, avec le
  motif de chaque report.

### Saisie enrichie

- Champs **Référence** (n° de chèque, référence de virement) et **Commentaire**
  sur les opérations comme sur les échéances ; tous deux sont pris en compte par
  la recherche et affichés dans la liste des opérations.
- **Rattachement à un bien ou à un projet d'épargne** : l'écran Biens / Projets
  affiche le total des opérations rattachées à chaque ligne.
- L'écran Échéances distingue les programmations automatiques des manuelles,
  affiche la date de fin et signale les reports de jours fériés.

### Vérifications

- 62 tests (25 ajoutés) : calcul de Pâques sur cinq années de référence, nombre
  de jours fériés par territoire, jours ouvrés, les trois règles de report,
  arrêt à la date de fin, rattrapage automatique, report des champs enrichis
  vers l'opération créée, et migration v3 → v5.
- Migration Dexie v5 : les échéances existantes reçoivent les valeurs par défaut
  (comptabilisation manuelle, report au jour ouvrable suivant) et la base un
  calendrier de jours fériés — aucun changement de comportement subi.

## Version 2.0.0 — 1er août 2026

Application du plan d'action issu de l'audit technique (14 points).

### Corrections d'anomalies

- **Décalage de fuseau horaire sur les bornes de période.** Les dates métier sont
  désormais des dates civiles `AAAA-MM-JJ` et les bornes de période ne subissent
  plus aucune conversion UTC. En zone UTC négative (Guadeloupe), les opérations du
  1er du mois sortaient du relevé et celles du 1er du mois suivant y entraient :
  les totaux mensuels, bilans et budgets différaient selon le lieu de consultation.
- **Virement entre comptes.** Le type `virement` existait dans le modèle sans
  implémentation, et le calcul de signe le traitait comme une recette. Un virement
  crée maintenant deux écritures liées par `transferId` (débit + crédit), exclues
  des recettes et dépenses des bilans, supprimées ensemble.
- **Saisie des montants à la virgule.** `input type="number"` + `parseFloat`
  rejetait « 12,50 » selon le navigateur, sans message. Nouveau composant
  `MoneyInput` acceptant virgule, point et espaces insécables, avec message
  d'erreur explicite. Toutes les gardes de formulaire affichent désormais la
  raison du refus au lieu d'un `return` silencieux.

### Performance

- Index composés `[dbId+date]` et `[accountId+date]` : les listes d'opérations
  lisent la tranche de dates utile au lieu de charger tout l'historique.
- `accountService.balances()` calcule les soldes de tous les comptes en un seul
  balayage (auparavant : une lecture complète par compte, en séquence, sur trois écrans).
- `budgetService.spentByCategory()` agrège le mois en une lecture (auparavant :
  une lecture intégrale de la table par ligne de budget affichée).
- Le compteur d'invalidation globale `rev` est remplacé par `useLiveQuery`
  (dexie-react-hooks) : chaque écran ne se rafraîchit que si ses tables changent.
- Filtrage du tableau des opérations ramené de O(n²) à O(n) ; mémoïsation des
  référentiels réparée (l'objet était recréé à chaque rendu).

### Intégrité des données

- Montants stockés en centimes entiers : plus d'erreur d'arrondi sur les cumuls.
- Archivage par défaut des tiers, catégories, groupes et modes de paiement ; la
  suppression définitive est refusée tant qu'une opération y fait référence.
- Import de sauvegarde : fenêtre de confirmation détaillée (base, date d'export,
  volume), vérification de la version du fichier, copie de sécurité automatique,
  et mode **fusion** fondé sur `updatedAt` — la synchronisation Google Drive
  n'écrase plus les saisies de l'autre appareil.
- Migration Dexie v4 des bases existantes, couverte par un test dédié.

### Ergonomie et accessibilité

- Modale partagée avec `role="dialog"`, fermeture par Échap, piège de focus et
  restauration du focus ; les trois copies précédentes sont supprimées.
- Navigation clavier du tableau des opérations, `aria-label` sur les boutons
  icône, légendes de tableaux, indicateur de focus visible, barres de progression
  annoncées, titres et info-bulles sur les graphiques SVG.
- Boutons réellement désactivés (`disabled`) au lieu d'une classe décorative.
- `ErrorBoundary` : un quota IndexedDB dépassé n'affiche plus un écran blanc.
- Confirmation avant chaque suppression (bien, projet, échéance, budget, groupe).
- Versement libre sur les projets d'épargne, en remplacement des boutons figés
  « + 50 € » / « + 100 € ». Renommage de la base depuis les préférences.

### Nettoyage et outillage

- Suppression de `Sidebar.tsx` (code mort), de l'écran « graphiques » (doublon de
  « bilans ») et du champ de recherche non fonctionnel de la barre supérieure.
- ESLint (TypeScript + react-hooks) : aucune erreur, aucun avertissement.
- 37 tests Vitest : dates, montants, signes, périodicité, soldes, virements,
  budgets, intégrité référentielle, migration v3→v4, et test de fumée montant
  l'application complète.
- `npm run build:single` (vite-plugin-singlefile) génère le fichier HTML autonome
  à partir des sources ; `npm run build` produit une PWA installable
  (vite-plugin-pwa) avec découpage React / Dexie pour la mise en cache.
- Identifiants via `crypto.randomUUID()` lorsqu'il est disponible.
- Mise à jour de Dexie (4.0 → 4.4). React 18, Vite 5 et TypeScript 5.5 sont
  conservés : leur montée de version majeure est un chantier distinct.

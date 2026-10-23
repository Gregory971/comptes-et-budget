# Journal des modifications

## Version 2.9.0 — édition bureau (en préparation)

Plan complet : `docs/PLAN-EDITION-BUREAU.md`.

### Édition bureau (Windows)

- Application installable pour Windows (installeur NSIS x64 et ARM64) : coque
  Electron autour de la même application, dans `desktop/`. Les données restent
  dans le profil de l'utilisateur ; l'application est servie par un protocole
  privé `cb://app` et la politique de sécurité (`connect-src 'none'`) est
  inchangée. Aucun accès Node dans la page, permissions du navigateur refusées.
- Nouveau mode de construction `vite build --mode desktop` (sans PWA, sans la
  passerelle OneDrive dont l'adresse de retour est celle du site publié).
- Reprise des données : sauvegarde `.cbjson` de la version web, par « Restaurer
  une sauvegarde » au premier lancement ou par le bouton Importer.
- ⚠️ Les installeurs ne sont pas signés : un antivirus peut supprimer les
  exécutables à l'installation (constaté avec Bitdefender).

### Prêts et comptes

- **Prêts à mensualités constantes** : un compte de type « Prêt » suit la dette
  restante. Assistant de création (capital, taux, durée, assurance, compte qui
  paie, catégorie des intérêts, mensualités déjà remboursées) avec aperçu de la
  mensualité et du coût total ; tableau d'amortissement ; avancement du
  remboursement.
- Comptabiliser une mensualité écrit un virement pour le capital et une dépense
  pour les intérêts et l'assurance, en une seule transaction. Jamais de doublon,
  même en cas d'appels simultanés. Comptabilisation automatique facultative au
  lancement.
- Un prêt est une dette : il n'entre pas dans le solde total ni dans les
  prévisions de trésorerie.
- Comptes : groupe, numéro, **favori** (en tête des listes) et **masqué**
  (retiré des listes et du solde total sans archivage, réversible).
- Données : champs facultatifs ajoutés aux comptes, aucune migration de schéma.
- Limite : les conditions d'un prêt ne se modifient pas après création
  (supprimer et recréer).

### Ventilation multiple

- Une opération peut être répartie sur plusieurs catégories (87 € = 60 €
  d'alimentation + 27 € d'entretien). Éditeur dans le formulaire d'opération
  avec « reste à ventiler » en continu et report du reste sur la dernière ligne ;
  la somme des parts doit égaler le montant au centime près, avec un message qui
  dit ce qui manque ou dépasse.
- Le solde du compte ne dépend que du montant. Les budgets, les alertes de budget
  et les bilans par catégorie comptent chaque part dans sa catégorie ; la
  recherche et le filtre par catégorie retrouvent l'opération par n'importe
  laquelle de ses parts. Affichée « Ventilée (n) » dans les listes.
- Changer le montant d'une opération ventilée sans sa ventilation est refusé
  plutôt que de la rendre fausse. Un virement ne se ventile pas.
- Données : champ facultatif `splits` sur les opérations, aucune migration.

### Tâches, notes et rappels

- Carte « Tâches, notes, rappels » sur le tableau de bord : une tâche (avec date
  limite facultative), un rappel (date obligatoire) ou une note (ni date ni état).
  Texte limité à 200 caractères ; ajout par Entrée, case à cocher, modification sur
  place, suppression, et « supprimer les terminées » d'un clic.
- Les retards (date dépassée, pas encore fait) sont signalés par une icône **et** par
  du texte pour les lecteurs d'écran, pas seulement par la couleur ; le compteur
  « n à faire · n en retard » est annoncé. Tri : en retard, à venir, sans date, notes,
  terminées.
- Données : table `tasks` (schéma local **v11**, ajout sans conversion), incluse dans la
  sauvegarde ; une sauvegarde d'avant les tâches ne les vide pas.

### Recherche globale

- Bouton « Rechercher » de la barre latérale ou **Ctrl+K** (⌘K sur Mac), depuis
  n'importe quel écran. Une seule saisie cherche dans les opérations (libellé,
  commentaire, référence, tiers, catégories — y compris celles d'une ventilation —,
  compte), les comptes, tiers, catégories, titres, tâches et notes, échéances, biens et
  projets. Insensible à la casse et aux accents ; plusieurs mots se cumulent (ET).
- Un mot qui se lit comme un **montant** (« 42,50 ») ou une **date** (« 25/10/2026 »)
  est comparé aux montants et aux dates : c'est ce qu'on cherche en relisant un relevé.
- Résultats groupés par type, filtre « Dans », 25 résultats par type. Un résultat
  d'opération ouvre l'écran Opérations **au bon mois, déjà filtré**. Une frappe plus
  récente ignore la réponse d'une frappe périmée.

### Documents liés aux opérations

- Une opération peut porter jusqu'à dix documents : un nom et un **chemin de fichier ou
  un lien https** — jamais le fichier lui-même, pour garder la base et les sauvegardes
  légères. Champ « Documents liés » du formulaire, pastille « 📎 n documents » dans la
  liste. Dans l'édition bureau, « Choisir un fichier… » ouvre la boîte de dialogue du
  système ; dans le navigateur, qui ne révèle pas les chemins, on saisit le chemin complet.
- **Ouverture** : un lien https s'ouvre dans un nouvel onglet (sans transmettre la page
  d'origine) ; un fichier local ne s'ouvre que dans l'édition bureau. Sécurité : le
  processus principal n'ouvre que **des fichiers ordinaires qui existent**, par un chemin
  complet — jamais un programme ou un script (`.exe`, `.bat`, `.ps1`, `.lnk`, `.js`,
  `.msi`…), un chemin relatif, une remontée `..`, un flux NTFS caché (`a.pdf:x.exe`) ou un
  caractère de contrôle ; il vérifie aussi que le message vient bien de notre page. Les
  schémas `javascript:`, `data:`, `file:` et `http:` sont refusés à la saisie. Essayé dans
  l'application Electron réelle : chaque refus est bien renvoyé, la page n'a pas accès à Node.
- **Préférences → Maintenance → Organiser les liens** : remplace le début des chemins
  après un déménagement de dossier ou de disque (séparateurs et casse équivalents, coupure
  seulement à une frontière de dossier, liens https jamais touchés). Aperçu chiffré, et
  rien n'est écrit si un seul nouveau chemin est invalide.
- Non repris : les documents des biens et des projets (opérations seulement).
- Données : champ facultatif `documents` sur les opérations, aucune migration.

### Maintenance (Préférences → Maintenance)

- **Fusionner des catégories ou des tiers** : l'élément absorbé est remplacé partout
  — opérations (y compris supprimées, pour ne laisser aucune référence orpheline),
  parts de ventilation, échéances, règles de classement apprises — puis supprimé.
  Les budgets de deux catégories fusionnées s'additionnent. Une catégorie de dépense
  ne se fusionne pas avec une catégorie de recette. Tout se fait en une transaction.
- **Épurer les tiers inutilisés** depuis une date : ils sont archivés, pas supprimés
  (l'historique garde leur nom, ils reviennent si on ressaisit leur nom) ; un tiers
  d'une échéance en cours est épargné. La liste est visible avant de confirmer.
- **Remplacer en masse** la catégorie, le tiers ou le mode de paiement, par compte et
  par période, échéances comprises au choix. Aperçu chiffré avant d'agir ; les virements
  ne sont jamais touchés ; une catégorie de dépense n'est posée que sur des dépenses.
- **Supprimer des opérations en masse** (compte, période, catégorie, tiers) : les
  opérations pointées sont gardées par défaut, un virement est supprimé en entier, et
  il faut taper « SUPPRIMER » (l'écran avertit quand aucun critère ne limite la
  suppression). Suppression logique : les soldes se recalculent, la sauvegarde exportée
  reste le moyen de revenir en arrière.
- Écarté : l'archivage par exercice du logiciel de référence. La base locale supporte
  sans peine des dizaines de milliers d'opérations, et l'export (CSV, Excel, sauvegarde)
  couvre le besoin de mettre l'historique de côté sans risquer de fausser les soldes.

### Échanges : export et import

- **Exporter les opérations** (écran Opérations) en CSV, Excel (.xlsx), QIF ou OFX,
  pour la période affichée ou toutes les opérations, d'un compte ou de tous.
  Options CSV : séparateur de colonnes, séparateur des décimales, format des
  dates, en-tête, BOM UTF-8 (accents lisibles dans Excel). Un compteur annonce
  combien d'opérations seront écrites avant d'exporter.
- Les opérations ventilées sortent en une ligne « Ventilée : A · B » ou, au choix,
  en une ligne par catégorie ; les montants restent dans la devise de chaque
  compte (colonne « Devise »). Aucune dépendance ajoutée : le classeur .xlsx est
  écrit par un petit générateur interne (montants en vrais nombres).
- Sécurité : en CSV, un libellé qui commence par `=`, `+`, `-` ou `@` est préfixé
  d'une apostrophe pour qu'un tableur ne l'exécute pas comme une formule (les
  libellés bancaires viennent de l'extérieur).
- **Import de relevés QIF**, en plus du CSV et de l'OFX. L'ordre des dates
  (jour/mois ou mois/jour) est déduit du fichier ; en cas d'ambiguïté totale, il
  est lu en jour/mois et le fichier est signalé.
- **Détection des virements à l'import** : une ligne dont une opération d'un autre
  compte (même devise, hors prêt et comptes archivés) a le montant opposé à
  quelques jours près est signalée « virement probable ». C'est une suggestion :
  la case « lier les deux » est décochée d'office. Cochée, la ligne devient un
  volet de virement et l'opération existante l'autre volet (même `transferId`,
  catégorie et ventilation retirées) ; les deux sortent des bilans et le total des
  comptes redevient juste. Si l'opération existante a changé entre-temps, la ligne
  est importée normalement.
- **Import de cotations** d'un titre par fichier : « Date;Clôture », export Yahoo
  (Close, pas Adj Close), « 25/10/2026;52,3456 »… Les cours gardent toutes leurs
  décimales ; les lignes illisibles sont listées, jamais avalées.
- Non repris : les profils d'import mémorisés — le format des relevés est déduit du
  contenu, ce qui couvre les cas courants.

### Placements

- Nouvel écran **Placements** : titres (action, ETF, fonds), mouvements et
  cotations. Achat, vente, dividende, ajustement du nombre de parts (division,
  attribution gratuite, regroupement) et actualisation du cours.
- Position **recalculée à chaque lecture** d'après les mouvements, jamais stockée :
  quantité, prix de revient unitaire moyen pondéré (PRU, frais compris),
  plus-values réalisées (nettes de frais), plus-values latentes au dernier cours,
  dividendes, frais. Totaux du portefeuille en tête d'écran.
- Garde-fous : pas de vente à découvert (contrôlée à la date du mouvement, même
  antidatée), pas de suppression d'un achat dont une vente dépend, pas de
  quantité négative, cours nul refusé à l'achat (utiliser l'ajustement).
- Écritures bancaires facultatives : en désignant un compte, un achat crée une
  dépense (brut + frais, ventilée pour isoler les frais dans leur catégorie), une
  vente le produit net des frais, un dividende son montant — dans la même
  transaction, et supprimées avec le mouvement. Titres en devise de la base.
- Les cours sont ceux que vous saisissez : aucune cotation n'est récupérée sur
  Internet (`connect-src 'none'`). Sans cours saisi, le dernier cours d'un achat
  ou d'une vente sert de repère.
- Données : tables `securities`, `securityTxs`, `securityPrices` (schéma local
  **v10**, ajout sans conversion), incluses dans la sauvegarde ; une sauvegarde
  d'avant les placements ne les vide pas.
- Limites : pas d'import de cotations par fichier pour l'instant ; le portefeuille
  n'est pas encore repris dans le patrimoine de « Biens / Projets ».

### Devises

- Devises étrangères et taux de change vers la devise de la base, saisis à la
  main (Préférences → Devises) : aucune requête réseau, pas d'historique des taux.
- Chaque compte est tenu dans sa devise, choisie à la création (non modifiable
  ensuite). Soldes et opérations d'un compte restent dans sa devise ; les cartes
  affichent aussi l'équivalent dans la devise de la base.
- Toute vue qui réunit plusieurs comptes est en devise de la base : solde total,
  bilans, budgets, alertes, prévisions du mois, horizon de trésorerie, et
  « Tous les comptes » de l'écran Opérations (les lignes étrangères y portent le
  code de leur devise). Un compte étranger seul reste dans sa devise.
- Virement entre devises différentes : le montant reçu doit être saisi (la somme
  réellement créditée par la banque), pour que les deux écritures restent justes.
- Un prêt ne peut pas être payé depuis un compte en devise étrangère. Supprimer
  une devise encore utilisée par un compte est refusé.
- Données : nouvelle table `currencies` (schéma local **v9**, ajout sans
  conversion) incluse dans la sauvegarde ; une sauvegarde d'avant les devises ne
  vide pas celles qui existent.
- Non repris du logiciel de référence : la TVA par catégorie (usage professionnel,
  hors du périmètre personnel) ; les couleurs de catégorie sont traitées avec la
  refonte UX/UI.

## Version 2.8.0 — 10 octobre 2026

Lot de cinq améliorations, développées en parallèle puis fusionnées.

### Alertes de budget

- Un bandeau du tableau de bord signale les catégories ayant atteint 80 % de leur
  budget mensuel, puis celles qui le dépassent, avec le reste ou le dépassement
  en euros et un lien vers l'écran Budget.
- Pastille d'alerte (nombre, rouge en cas de dépassement) sur l'entrée « Budget »
  de la barre latérale ; barres de l'écran Budget avec état écrit en toutes
  lettres (Attention / Dépassé) et valeur lisible par les lecteurs d'écran.
- Préférences → Général : activation des alertes, seuil d'attention de 70, 80 ou
  90 %, et masquage d'une alerte pour le mois en cours (elle réapparaît si elle
  s'aggrave). Réglages propres à l'appareil, dans la table `settings`, sans
  migration ni appel réseau.
- Interne : `budgetService.monthlyStatus` expose `rawPercent` (consommation réelle
  non plafonnée) ; calcul en centimes entiers.

### Import de relevés : classement automatique par règles apprises

- Chaque ligne reçoit un tiers et une catégorie proposés, avec leur origine
  (règle apprise, tiers reconnu, historique) et un niveau de confiance.
- Le libellé bancaire est ramené à un motif stable (dates, numéros de carte,
  références, mois et mots de paiement retirés). Une proposition incertaine ou
  ambiguë n'est jamais imposée : elle est suggérée (bouton « Appliquer »). Une
  ligne inconnue reste sans catégorie. Rien n'est écrit avant la confirmation.
- Vos corrections à la confirmation créent ou ajustent des règles, consultables et
  oubliables depuis la fenêtre d'import. Le tiers est modifiable ligne par ligne.
- Changement de comportement : un tiers archivé n'est plus rattaché à l'import, et
  un nom de tiers collé à d'autres lettres n'est plus posé d'office (seulement
  suggéré).
- Données : nouvelle table de règles (schéma local **v8**, ajout sans conversion),
  incluse dans la sauvegarde et la fusion. Le format de sauvegarde reste en
  version 3 ; une sauvegarde antérieure ne vide pas les règles existantes.

### Sauvegarde OneDrive : premiers tests de bout en bout

- La passerelle est découpée en `gatewayCore.ts` (logique, testable) et
  `gateway.ts` (colle navigateur). Un faux serveur Microsoft en mémoire (PKCE,
  expiration et rotation des jetons, portée du dossier d'application, redirection
  de téléchargement, politique de sécurité réelle de la passerelle) permet pour la
  première fois de tester connexion, envoi, rotation, liste, restauration, 401,
  429, perte réseau et déconnexion.
- Corrigé : la rotation à 10 copies datées n'était jamais appliquée ; une panne
  passagère de Microsoft effaçait le jeton de rafraîchissement et déconnectait
  l'utilisateur ; deux ordres simultanés lançaient deux rafraîchissements ; un 401
  sur jeton révoqué et un 429 avec `Retry-After` n'étaient pas rejoués ; la liste
  ignorait les pages suivantes et listait les sous-dossiers.
- Corrigé : erreurs réseau et réponses non JSON traduites en français ; plafond
  d'envoi simple porté de 4 à 250 Mo (d'après la documentation Graph, non vérifié
  avec un vrai compte) ; passerelle restée bloquée après un chargement raté ;
  déconnexion qui prétendait réussir hors ligne.
- Ajouté : `docs/TEST-ONEDRIVE.md`, guide d'essai manuel pas à pas.
- ⚠️ **L'écriture réelle dans OneDrive reste à éprouver avec un vrai compte** : tout
  est prouvé contre un faux serveur. Le jeton d'une application monopage expire
  en 24 h : une reconnexion quotidienne est à prévoir.

### Mise à jour de l'application

- Une notice « Nouvelle version disponible — Recharger » apparaît dès qu'une
  version est déployée (aussi sur l'écran de connexion), et « Application prête
  hors ligne » à la première installation.
- Le rechargement ne fait jamais perdre de saisie sans prévenir : une fenêtre
  ouverte ou un champ rempli déclenche une confirmation, et « Plus tard » reste
  possible.
- Le service worker passe en mode « prompt » avec recherche horaire de nouvelle
  version, sans aucune requête réseau de la page (`connect-src 'none'` inchangé).
- ⚠️ Non éprouvé avec un vrai service worker : à vérifier après déploiement. Les
  installations existantes ne verront la notice qu'après avoir chargé cette version.

### Dépendances de développement

- `npm audit fix` sans changement majeur : vitest 4.1.11, brace-expansion,
  browserslist, fast-uri, nanoid, source-map-js, undici, baseline-browser-mapping.
  Seul `package-lock.json` change ; les paquets construits sont identiques octet
  pour octet.
- Audit : 12 → 3 vulnérabilités ; 0 en production, avant comme après. Les 3
  restantes (`braces` via `vite-plugin-singlefile`) n'ont pas de correctif amont
  et ne concernent que l'outillage de build.

## Version 2.7.0 — 10 octobre 2026

### Accès sécurisé par identifiants

L'application s'ouvrait directement sur les comptes : quiconque atteignait
l'adresse, ou l'écran d'un ordinateur resté allumé, voyait tout. Elle s'ouvre
désormais sur un **écran de connexion**, construit sur le parcours d'une
application Softr : une adresse, « Continuer », puis le mot de passe.

**Ce que Softr fait, et que cette application ne peut pas faire.** L'accès d'une
application Softr repose sur un serveur : il vérifie l'identité, envoie un lien
magique par courriel, tient la session. Ici, il n'y a ni serveur ni droit de
requête réseau (`connect-src 'none'`) : en introduire un reviendrait à renoncer à
la promesse centrale de l'application, que rien ne quitte l'appareil. L'accès est
donc un **verrou local**, qui reprend le parcours et les principes de Softr sans
son infrastructure. Il barre l'accès à l'interface ; il **ne chiffre pas la base**
(les champs indexés doivent rester lisibles pour les requêtes), et l'écran, le
README et la page Sécurité le disent plutôt que de laisser croire le contraire.

Ce qui est repris de Softr :

- **Deux étapes**, et une adresse inconnue mène quand même à la seconde : l'écran
  ne révèle pas ce qui est enregistré.
- **Un message d'erreur unique** : « Adresse ou mot de passe incorrect ».
  Jamais « adresse inconnue » ni « mot de passe erroné ».
- **Inscription fermée** : la création d'un accès est refusée tant qu'il en
  existe un.
- **Récupération** : ce que Softr fait par courriel, un code de récupération de
  100 bits le fait ici, affiché une seule fois.

Ce qui est propre à un verrou sans serveur :

- **Aucun secret n'est stocké** — ni mot de passe ni code, seulement leur
  empreinte PBKDF2-SHA256 (600 000 itérations, sel propre à chaque secret), aux
  paramètres de la sauvegarde chiffrée. Comparaison à durée constante, empreinte
  toujours calculée même si l'adresse est fausse : ni le message ni le temps de
  réponse ne disent laquelle des deux informations était erronée.
- **Mot de passe normalisé en Unicode NFKC** : un « é » composé ou décomposé
  donne la même empreinte d'un clavier à l'autre.
- **Longueur minimale de 10 caractères et refus des mots de passe triviaux**,
  non des règles de composition, qui poussent à choisir « Motdepasse1! ».
- **Ralentissement progressif** : deux fautes de frappe gratuites, puis 5 s
  doublées jusqu'à 30 minutes. Le compteur est écrit, recharger la page ne le
  remet pas à zéro, et le même compteur sert au mot de passe et au code de
  récupération — sans quoi un attaquant disposerait de deux budgets d'essais. C'est
  un frein d'usage : quiconque exécute du code dans la page peut le contourner.
- **Session en mémoire uniquement** : rien dans `localStorage` ni
  `sessionStorage`, un indicateur écrit étant un indicateur qu'on peut poser à la
  main. Recharger redemande les identifiants. Verrouillage après 15 minutes
  d'inactivité (5, 15, 30 ou 60), mesuré sur des horodatages : les navigateurs
  suspendent les minuteurs d'un onglet en arrière-plan, et un `setTimeout` de
  quinze minutes poserait alors un verrou qui n'arrive jamais.
- **L'application est démontée, non masquée**, tant que l'accès n'est pas
  accordé : aucun écran ne s'exécute, aucune requête ne lit la base, rien de
  sensible n'existe dans la page. Contrepartie : un verrouillage pour inactivité
  perd une saisie en cours.
- **Réglage d'appareil.** Les identifiants vivent dans la table `settings`, qu'aucun
  fichier de sauvegarde ne contient : restaurer une sauvegarde sur un autre
  appareil n'y apporte pas cet accès.
- **Mot de passe et code perdus : aucun contournement**, qui viderait le verrou
  de son sens. Reste l'effacement des données de l'appareil — soumis à la saisie
  de « EFFACER » et précédé de l'avertissement qu'il est définitif — puis la
  restauration d'une sauvegarde exportée.

Gestion dans **Préférences → Sécurité** : changer le mot de passe ou l'adresse,
délai d'inactivité, nouveau code de récupération, désactivation de la protection.
Chaque action qui engage l'accès redemande le mot de passe, même session ouverte :
sans cela, quelqu'un passant devant l'écran pourrait le changer et enfermer dehors
son propriétaire. Un bouton « 🔒 Verrouiller » figure dans la barre latérale.

**À la première ouverture après cette mise à jour**, la création d'un accès est
imposée avant toute chose, y compris aux bases existantes. Les données ne sont
pas touchées.

**Sans WebCrypto** — page non servie en contexte sécurisé —, aucune empreinte n'est
calculable. L'accès n'est alors pas imposé, plutôt que de rendre l'application
inutilisable dès le premier lancement. Un accès déjà créé n'est jamais contourné
pour autant.

### Correction : un test qui ne passait qu'en août

`App.smoke.test.tsx` datait ses opérations du 1er et du 2 août 2026 en dur, puis
les cherchait dans « le mois affiché » de l'écran Bilans : il échouait dès le mois
suivant. Le workflow de déploiement exécute cette suite avant de publier — la
mise en ligne de n'importe quelle nouveauté était donc bloquée. Les dates sont
désormais celles du mois courant.

### Vérifications

- 57 tests ajoutés (292 au total) : 35 sur le service (aucun secret stocké,
  adresse fausse indiscernable d'un mot de passe faux, normalisation Unicode,
  ralentissement et sa persistance, compteur partagé avec le code de
  récupération, code à usage unique, effacement) et 22 sur l'interface (création,
  accusé de réception du code, connexion, blocage, verrouillage pour inactivité y
  compris au retour d'un onglet en arrière-plan, navigateur sans WebCrypto).
- Trois régressions de sécurité introduites volontairement — adresse non
  vérifiée, normalisation retirée, ralentissement non enregistré — ont chacune
  fait échouer les tests concernés.
- Contrôlé dans un navigateur sur l'application construite : création en 313 ms au
  coût réel de 600 000 itérations ; stockage ne contenant que des empreintes et
  aucun indicateur de session ; message identique pour une adresse inconnue et un
  mauvais mot de passe ; blocage au troisième échec ; verrouillage manuel qui
  retire l'application de la page ; affichage correct sur téléphone.
- ⚠️ **Non éprouvé** : l'ouverture du fichier autonome en `file://` (le navigateur
  de vérification ne permet pas d'ouvrir un fichier local). Son comportement de
  repli sans WebCrypto est en revanche testé.

## Version 2.6.0 — 23 août 2026

### Sauvegarde vers OneDrive par l'API Microsoft Graph

La 2.5.1 écrivait dans un dossier synchronisé, ce qui suppose le client OneDrive
installé sur la machine. L'application peut désormais **déposer sa sauvegarde
directement dans OneDrive**, depuis n'importe quel appareil — un téléphone, un
ordinateur d'emprunt — sans autre logiciel que le navigateur.

**La fonction est éteinte par défaut** : c'est la seule de l'application qui
fasse sortir des données de l'appareil, et elle ne s'active que délibérément,
dans Préférences → Général.

#### Une passerelle isolée, pour ne pas défaire la garantie de confidentialité

Une politique de sécurité posée en balise `<meta>` ne peut pas être élargie à
l'exécution : « autoriser OneDrive dans les réglages » n'aurait donc pas suffi à
laisser passer les appels à Microsoft. La solution paresseuse — ouvrir
`connect-src` dans l'application entière — aurait annulé la promesse même du
projet, pour tout le monde et en permanence, y compris pour qui n'utilise pas
OneDrive.

L'application garde donc `connect-src 'none'`, vérifié par un test. Les appels
réseau vivent dans un **document séparé**, `onedrive.html`, servi depuis la même
origine mais porteur de sa propre politique, qui n'autorise que quatre hôtes :
`login.microsoftonline.com`, `graph.microsoft.com`, et les deux domaines vers
lesquels Graph redirige les téléchargements. Un test énumère cette liste : y
ajouter un service de mesure d'audience ferait échouer la construction.

L'application ne parle donc jamais au réseau : elle transmet des ordres à la
passerelle par `postMessage`, en vérifiant l'origine des deux côtés, et reçoit
des réponses. La passerelle, elle, ignore tout des comptes : elle reçoit un
contenu déjà sérialisé et l'envoie.

#### Ce qui est demandé à Microsoft, et rien de plus

Connexion OAuth 2.0 par **code d'autorisation avec PKCE** — une application
monopage ne peut garder aucun secret, son code étant public. La portée demandée
est `Files.ReadWrite.AppFolder` : un dossier créé pour l'application, le reste
du OneDrive lui restant invisible. `offline_access` évite d'avoir à se
reconnecter à chaque envoi. La fenêtre de connexion s'ouvre à part, Microsoft
refusant que sa page de connexion soit encadrée.

#### Un service worker qui interceptait le retour de connexion

Défaut corrigé au passage, et invisible autrement qu'en conditions réelles : le
repli de navigation (`navigateFallback: index.html`) servait **l'application** à
l'URL de retour `onedrive.html?code=…`, une URL portant une chaîne de requête ne
correspondant à aucun fichier précaché. La page chargée n'avait ni le script
d'échange des jetons, ni le droit de joindre le réseau : la connexion échouait
**sans le moindre message**. Ni le développement (aucun service worker) ni les
tests unitaires ne pouvaient le révéler. La liste d'exclusion est désormais
définie et testée dans `src/utils/pwa.ts`.

### ⚠️ Ce qui n'a pas pu être vérifié

L'écriture effective dans OneDrive **n'a jamais tourné en conditions réelles**.
Le compte de test se voit refuser par Microsoft *tous* les appels à son espace,
y compris la simple lecture des métadonnées :

    GET /me/drive → 403 accessDenied, innerError.code = serviceReadOnly

Ce n'est ni le quota (21,7 Go sur 1 To), ni le compte — les revendications du
jeton confirment le bon locataire grand public —, ni la portée demandée, et
l'interface web de OneDrive fonctionne normalement. La surface API de ce lecteur
est verrouillée côté Microsoft. La chaîne validée s'arrête donc à l'obtention
des jetons ; l'envoi, la liste et la restauration restent à éprouver.

### Vérifications

- **235 tests** (contre 200) : construction de l'URL de connexion, portée
  limitée au dossier d'application, PKCE sans secret, lecture des réponses de
  jetons, appariement ordre/réponse de la passerelle, rejet d'un message venu
  d'une autre origine, abandon d'un ordre resté sans réponse, énumération des
  hôtes autorisés, exclusion du service worker.
- Éprouvé sur le site **construit**, servi en HTTP : connexion Microsoft
  complète, jetons obtenus, compte reconnu, et les deux politiques de sécurité
  distinctes constatées dans les pages livrées.

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

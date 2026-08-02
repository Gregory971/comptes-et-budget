# Journal des modifications

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

# Édition bureau — plan

Objectif : une application Windows installable (exe) qui réunit « Comptes & Budget »
(cette application) et les fonctions utiles d'un logiciel de comptes de bureau du commerce,
avec reprise de la sauvegarde `.cbjson` de la version web.

Principes
- Fonctions réécrites à partir de leur description fonctionnelle (voir
  `inventaire-logiciel-reference.md`), sans copier ni code ni images ni textes du logiciel
  de référence.
- Le code reste unique : l'application web et l'édition bureau partagent `src/`.
  Les nouveautés profitent aux deux.
- Toujours local : pas de connexion bancaire (hors périmètre), `connect-src 'none'` conservé.

## Phase 1 — coque et installeur (faite)
Electron (`desktop/`), protocole privé `cb://app`, build `--mode desktop`, installeurs NSIS
x64 et ARM64 (`desktop/` → `release/`). Reprise de la sauvegarde : « Restaurer une
sauvegarde » au premier lancement, ou bouton Importer (fusion ou remplacement).

## Phases suivantes (ordre de priorité)
2. (faite) Prêts et emprunts (capital, taux, mensualité, durée ; ventilation capital/intérêts),
   groupes de comptes, favoris, comptes masqués.
3. (faite) Devises et taux de change ; ventilation multiple d'une opération. TVA écartée
   (usage professionnel) ; couleurs de catégorie renvoyées à la phase 10.
4. Titres et placements (achat, vente, dividendes, frais, plus-values latentes et réalisées,
   cotations saisies ou importées).
5. Échanges : export CSV / Excel / QIF / OFX ; import QIF, profils d'import mémorisés,
   détection automatique des virements.
6. Maintenance : fusion de catégories et de tiers, épuration des tiers, remplacement en masse,
   suppression en masse, archivage par exercice.
7. Tâches / notes / rappels, recherche globale, documents liés aux opérations.
8. Budget avancé (prévision annuelle, périodicité, initialisation d'après l'année précédente),
   graphiques par tiers, projet, évolution des comptes.
9. Finitions bureau : sauvegarde automatique native dans un dossier, ouverture d'un `.cbjson`
   par double-clic, mise à jour de l'installeur, icône et signature.

10. Optimisation UX / UI, une fois tout implémenté (demande du 23/10/2026) : revue de bout en
    bout des parcours et de l'interface — cohérence visuelle, densité des écrans, thème
    sombre, clavier et accessibilité, états vides, retours après action, performances
    perçues, mobile et fenêtre redimensionnée.

## Hors périmètre
Connexion bancaire (Linxo), synchronisation cloud/SFTP du fournisseur, factures plateforme
agréée, import Microsoft Money.

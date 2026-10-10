// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { categoryService, payeeService } from './referentialService';
import { prepareImport, commitImport, type ImportCandidate } from './importService';
import { ruleService } from './categorizationService';
import { backupService, upgradeBackup, type Backup } from './backupService';
import { toCents } from '../utils/money';
import type { StatementEntry } from '../utils/statement';
import type { CategorizationRule } from '../types';

let DB = '';
let accountId = '';
let courses = '';
let loisirs = '';
let carburant = '';
let salaire = '';

const ligne = (date: string, label: string, euros: number): StatementEntry =>
  ({ date, label, amountCents: toCents(euros), reference: undefined });

async function tablesVides() {
  await Promise.all([
    db.operations.clear(), db.accounts.clear(), db.payees.clear(), db.categories.clear(),
    db.categoryGroups.clear(), db.categorizationRules.clear(), db.databases.clear(),
    db.paymentMethods.clear(), db.preferences.clear(), db.schedules.clear(), db.budgets.clear(),
    db.assets.clear(), db.projects.clear(),
  ]);
}

async function reset() {
  await tablesVides();
  const base = await dbService.create('Base test');
  DB = base.id;
  // Catalogue de test, à la place de celui par défaut.
  await Promise.all([db.categories.clear(), db.categoryGroups.clear()]);
  const dep = await categoryService.createGroup(DB, 'Dépenses', 'depense');
  const rec = await categoryService.createGroup(DB, 'Revenus', 'recette');
  courses = (await categoryService.createCategory(DB, dep.id, 'Courses')).id;
  loisirs = (await categoryService.createCategory(DB, dep.id, 'Loisirs')).id;
  carburant = (await categoryService.createCategory(DB, dep.id, 'Carburant')).id;
  salaire = (await categoryService.createCategory(DB, rec.id, 'Salaire')).id;
  accountId = (await accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(1000), startDate: '2026-01-01',
  })).id;
}

/** Trois achats passés « CARREFOUR MARKET » classés en Courses : de quoi apprendre. */
async function historiqueCarrefour() {
  for (const d of ['2026-05-04', '2026-06-04', '2026-07-04']) {
    await operationService.create({
      dbId: DB, accountId, date: d, amountCents: toCents(40), kind: 'depense',
      label: 'CARREFOUR MARKET 0123 PARIS', categoryId: courses,
    });
  }
}

const counts = async () => ({
  ops: await db.operations.count(), payees: await db.payees.count(),
  rules: await db.categorizationRules.count(), cats: await db.categories.count(),
});

/* ------------------------------------------------------------ garde-fous */

describe('import : aucune écriture avant confirmation', () => {
  beforeEach(reset);

  it('la préparation ne touche ni les opérations, ni les tiers, ni les règles', async () => {
    await historiqueCarrefour();
    const avant = await counts();
    const cs = await prepareImport(DB, accountId, [
      ligne('2026-08-05', 'CB CARREFOUR MARKET 0508', -30),
      ligne('2026-08-06', 'PHARMACIE INCONNUE', -12),
    ]);
    // L'utilisateur tape un nouveau tiers dans la fenêtre : toujours rien en base.
    cs[1].payeeName = 'Pharmacie du Centre';
    expect(await counts()).toEqual(avant);
  });

  it('pose une proposition sûre, avec son origine, et laisse la ligne inconnue vide', async () => {
    await historiqueCarrefour();
    const [connue, inconnue] = await prepareImport(DB, accountId, [
      ligne('2026-08-05', 'PAIEMENT CB 0508 CARREFOUR MARKET LYON', -30),
      ligne('2026-08-06', 'BOULANGERIE DU BOURG', -4.2),
    ]);
    expect(connue.categoryId).toBe(courses);
    expect(connue.proposal).toMatchObject({ source: 'historique', confidence: 'haute' });
    expect(connue.autoCategoryId).toBe(courses);
    expect(inconnue.categoryId).toBeUndefined();
    expect(inconnue.proposal).toBeUndefined();
  });

  it('ne pose pas une proposition peu sûre : elle reste une suggestion', async () => {
    await operationService.create({
      dbId: DB, accountId, date: '2026-07-04', amountCents: toCents(5), kind: 'depense',
      label: 'BOULANGERIE PAUL 0123', categoryId: courses,
    });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'BOULANGERIE PAUL 0508', -5)]);
    expect(c.proposal).toMatchObject({ confidence: 'faible', categoryId: courses });
    expect(c.categoryId).toBeUndefined();
    expect(c.autoCategoryId).toBeUndefined();

    const res = await commitImport(DB, accountId, [c]);
    // Importée telle quelle : sans catégorie, et rien n'est appris.
    expect(res.rulesLearned).toBe(0);
    expect(await db.categorizationRules.count()).toBe(0);
    const ops = await operationService.list(DB);
    expect(ops.find(o => o.date === '2026-08-05')?.categoryId).toBeUndefined();
  });

  it('ne tient pas compte d’une opération supprimée', async () => {
    await historiqueCarrefour();
    for (const o of await operationService.list(DB)) await operationService.remove(o.id);
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'CARREFOUR MARKET 0508', -30)]);
    expect(c.proposal).toBeUndefined();
  });
});

/* -------------------------------------------------------- apprentissage */

describe('import : les corrections alimentent les règles', () => {
  beforeEach(reset);

  const importer = async (cs: ImportCandidate[]) => commitImport(DB, accountId, cs);

  it('une catégorie choisie sur une ligne inconnue devient une règle réutilisée au relevé suivant', async () => {
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'CB LECLERC DRIVE 0508', -64)]);
    expect(c.proposal).toBeUndefined();
    c.categoryId = courses; // choix de l'utilisateur
    const res = await importer([c]);
    expect(res.rulesLearned).toBe(1);

    const [regle] = await ruleService.list(DB);
    expect(regle).toMatchObject({
      pattern: 'leclerc drive', kind: 'depense', categoryId: courses, hits: 1, origin: 'ajout',
    });

    const [suite] = await prepareImport(DB, accountId, [ligne('2026-09-05', 'CARTE X9999 LECLERC DRIVE 0509 NANTES', -70)]);
    expect(suite.proposal).toMatchObject({ source: 'regle', confidence: 'moyenne', categoryId: courses });
    expect(suite.categoryId).toBe(courses);
  });

  it('corriger une proposition ajuste la règle existante et repart de zéro', async () => {
    await historiqueCarrefour();
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'CARREFOUR MARKET 0508', -30)]);
    expect(c.categoryId).toBe(courses);
    c.categoryId = loisirs; // l'utilisateur corrige
    await importer([c]);
    const [r1] = await ruleService.list(DB);
    expect(r1).toMatchObject({ pattern: 'carrefour market', categoryId: loisirs, hits: 1, origin: 'correction' });

    // La règle l'emporte désormais sur les trois opérations « Courses » de l'historique.
    const [c2] = await prepareImport(DB, accountId, [ligne('2026-09-05', 'CARREFOUR MARKET 0509', -30)]);
    expect(c2.proposal?.source).toBe('regle');
    expect(c2.categoryId).toBe(loisirs);

    // Confirmée telle quelle : elle gagne une confirmation et passe en confiance haute.
    await importer([c2]);
    expect((await ruleService.list(DB))[0].hits).toBe(2);
    const [c3] = await prepareImport(DB, accountId, [ligne('2026-10-05', 'CARREFOUR MARKET 0510', -30)]);
    expect(c3.proposal).toMatchObject({ source: 'regle', confidence: 'haute' });

    // Nouvelle correction : la règle change de cible, sans doublon.
    c3.categoryId = courses;
    await importer([c3]);
    const regles = await ruleService.list(DB, true);
    expect(regles).toHaveLength(1);
    expect(regles[0]).toMatchObject({ categoryId: courses, hits: 1 });
  });

  it('effacer la proposition d’une règle l’oublie', async () => {
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'NETFLIX.COM 0508', -13)]);
    c.categoryId = loisirs;
    await importer([c]);
    const [c2] = await prepareImport(DB, accountId, [ligne('2026-09-05', 'NETFLIX.COM 0509', -13)]);
    expect(c2.proposal?.source).toBe('regle');
    c2.categoryId = undefined; // « ce n'est pas du tout cela »
    await importer([c2]);
    expect(await ruleService.list(DB)).toHaveLength(0);
    expect(await ruleService.list(DB, true)).toHaveLength(1);
    const [c3] = await prepareImport(DB, accountId, [ligne('2026-10-05', 'NETFLIX.COM 0510', -13)]);
    // Plus de règle : il ne reste que la première opération importée dans l'historique,
    // un seul exemple, donc une simple suggestion non appliquée.
    expect(c3.proposal).toMatchObject({ source: 'historique', confidence: 'faible' });
    expect(c3.categoryId).toBeUndefined();
  });

  it('crée le tiers saisi à la confirmation seulement, et le rattache à la règle', async () => {
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'AUTOROUTES SUD 0508', -12.4)]);
    c.payeeName = 'Péage Sud'; // tiers inconnu, tapé librement
    c.categoryId = carburant;
    expect(await db.payees.count()).toBe(0);
    await importer([c]);
    const [tiers] = await payeeService.list(DB);
    expect(tiers.name).toBe('Péage Sud');
    const [regle] = await ruleService.list(DB);
    expect(regle).toMatchObject({ payeeId: tiers.id, categoryId: carburant });
    const op = (await operationService.list(DB))[0];
    expect(op.payeeId).toBe(tiers.id);
  });

  it('une ligne décochée (doublon) n’enseigne rien', async () => {
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-05', amountCents: toCents(30), kind: 'depense',
    });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'CARREFOUR MARKET 0508', -30)]);
    expect(c.selected).toBe(false);
    c.categoryId = courses;
    const res = await importer([c]);
    expect(res.imported).toBe(0);
    expect(await db.categorizationRules.count()).toBe(0);
  });

  it('une recette apprise ne contamine pas les dépenses de la même enseigne', async () => {
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'VIR SEPA RECU DE ACME SAS SALAIRE AOUT', 2100)]);
    c.categoryId = salaire;
    await importer([c]);
    const [recette, depense] = await prepareImport(DB, accountId, [
      ligne('2026-09-05', 'VIR SEPA RECU DE ACME SAS SALAIRE SEPTEMBRE', 2100),
      ligne('2026-09-06', 'ACME SAS SALAIRE REGULARISATION', -50),
    ]);
    expect(recette.categoryId).toBe(salaire);
    expect(depense.proposal).toBeUndefined();
  });

  it('« Oublier » désactive la règle sans la supprimer', async () => {
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'SNCF INTERNET 0508', -45)]);
    c.categoryId = loisirs;
    await importer([c]);
    const [regle] = await ruleService.list(DB);
    await ruleService.disable(regle.id);
    expect(await ruleService.list(DB)).toHaveLength(0);
    expect((await db.categorizationRules.get(regle.id))?.disabled).toBe(true);
  });
});

/* ------------------------------------------------------------ sauvegarde */

describe('règles et sauvegarde', () => {
  beforeEach(reset);

  const regle = (id: string, extra: Partial<CategorizationRule> = {}): CategorizationRule => ({
    id, dbId: DB, pattern: 'edf', kind: 'depense', categoryId: courses, hits: 1,
    origin: 'ajout', disabled: false, createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z', ...extra,
  });

  it('exporte les règles de la base active, et seulement les siennes', async () => {
    await db.categorizationRules.bulkAdd([regle('r1'), { ...regle('r2'), dbId: 'autre-base' }]);
    const b = await backupService.export();
    expect(b.categorizationRules?.map(r => r.id)).toEqual(['r1']);
  });

  it('survit à un aller-retour chiffré, en remplacement', async () => {
    await db.categorizationRules.add(regle('r1'));
    const fichier = await backupService.serialize('phrase secrète de test');
    await db.categorizationRules.clear();
    const { backup } = await backupService.inspect(fichier, 'phrase secrète de test');
    await backupService.restore(backup, 'replace', false);
    expect((await db.categorizationRules.toArray()).map(r => r.id)).toEqual(['r1']);
  });

  it('remplacer écrase les règles locales par celles du fichier', async () => {
    await db.categorizationRules.add(regle('r1'));
    const b = await backupService.export();
    await db.categorizationRules.bulkPut([regle('r1', { pattern: 'modifie' }), regle('r2')]);
    await backupService.restore(b, 'replace', false);
    const rows = await db.categorizationRules.toArray();
    expect(rows.map(r => r.id)).toEqual(['r1']);
    expect(rows[0].pattern).toBe('edf');
  });

  it('un fichier antérieur aux règles ne les efface pas au remplacement', async () => {
    await db.categorizationRules.add(regle('r1'));
    const b = await backupService.export();
    delete b.categorizationRules; // sauvegarde produite avant cette fonction
    await backupService.restore(b, 'replace', false);
    expect(await db.categorizationRules.count()).toBe(1);
  });

  it('un fichier qui déclare zéro règle les vide, lui', async () => {
    await db.categorizationRules.add(regle('r1'));
    const b = await backupService.export();
    b.categorizationRules = [];
    await backupService.restore(b, 'replace', false);
    expect(await db.categorizationRules.count()).toBe(0);
  });

  it('fusionne règle par règle : la modification la plus récente l’emporte, l’oubli se propage', async () => {
    await db.categorizationRules.bulkAdd([
      regle('r1', { hits: 3, updatedAt: '2026-09-01T00:00:00.000Z' }),
      regle('r2', { updatedAt: '2026-07-01T00:00:00.000Z' }),
    ]);
    const b = await backupService.export();
    b.categorizationRules = [
      regle('r1', { hits: 1, updatedAt: '2026-08-01T00:00:00.000Z' }),                       // plus ancienne
      regle('r2', { disabled: true, updatedAt: '2026-08-15T00:00:00.000Z' }),                // oubli plus récent
      regle('r3', { pattern: 'nouvelle', updatedAt: '2026-08-20T00:00:00.000Z' }),           // inconnue ici
    ];
    await backupService.restore(b, 'merge', false);
    const rows = new Map((await db.categorizationRules.toArray()).map(r => [r.id, r]));
    expect(rows.get('r1')?.hits).toBe(3);
    expect(rows.get('r2')?.disabled).toBe(true);
    expect(rows.get('r3')?.pattern).toBe('nouvelle');
  });

  it('la reprise d’un ancien fichier ne fabrique pas de tableau de règles vide', () => {
    const v1 = {
      format: 'comptes-budget', version: 1, exportedAt: '2026-06-01T10:00:00.000Z',
      database: { id: 'b1', name: 'Perso', currency: 'EUR', createdAt: '2026-01-01T00:00:00.000Z' },
    } as unknown as Backup;
    expect(upgradeBackup(v1).categorizationRules).toBeUndefined();
    const avec = upgradeBackup({ ...v1, categorizationRules: [regle('r1')] });
    expect(avec.categorizationRules).toHaveLength(1);
  });
});

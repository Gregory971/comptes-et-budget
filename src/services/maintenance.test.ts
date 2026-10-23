// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db, uid, stamp } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { scheduleService } from './scheduleService';
import { budgetService } from './budgetService';
import { categoryService, payeeService, paymentMethodService } from './referentialService';
import {
  deleteOperations, mergeCategories, mergePayees, previewReplace, purgeUnusedPayees, replaceInOperations,
  selectForDeletion, unusedPayees,
} from './maintenanceService';
import type { Database } from '../types';

let base: Database;
let compte: string;
let autre: string;
let depenses: string[];    // catégories de dépense
let recettes: string[];    // catégories de recette

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base maintenance', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
  autre = (await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
  const gd = await categoryService.createGroup(base.id, 'Dépenses', 'depense');
  const gr = await categoryService.createGroup(base.id, 'Revenus', 'recette');
  depenses = [
    (await categoryService.createCategory(base.id, gd.id, 'Alimentation')).id,
    (await categoryService.createCategory(base.id, gd.id, 'Courses')).id,
    (await categoryService.createCategory(base.id, gd.id, 'Loisirs')).id,
  ];
  recettes = [
    (await categoryService.createCategory(base.id, gr.id, 'Salaire')).id,
    (await categoryService.createCategory(base.id, gr.id, 'Prime')).id,
  ];
});

const op = (over: object = {}) => operationService.create({
  dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 1000, ...over,
});

describe('fusion de catégories', () => {
  it('re-pointe opérations, parts de ventilation, échéances et règles, puis supprime la catégorie absorbée', async () => {
    const [alim, courses] = depenses;
    await op({ categoryId: courses });
    await op({ categoryId: courses });
    const ventilee = await op({ amountCents: 3000, splits: [{ categoryId: courses, amountCents: 2000 }, { categoryId: depenses[2], amountCents: 1000 }] });
    await op({ categoryId: alim });
    await scheduleService.create({ dbId: base.id, accountId: compte, amountCents: 500, kind: 'depense', periodicity: 'mensuelle', nextDate: '2026-09-01', autoPost: false, holidayRule: 'exacte', categoryId: courses });
    await db.categorizationRules.add({ id: uid(), dbId: base.id, pattern: 'leclerc', kind: 'depense', categoryId: courses, hits: 1, origin: 'ajout', disabled: false, createdAt: stamp(), updatedAt: stamp() });

    const r = await mergeCategories(base.id, courses, alim);
    expect(r).toMatchObject({ operations: 3, schedules: 1 });
    expect(await db.categories.get(courses)).toBeUndefined();
    expect((await db.operations.toArray()).filter(o => o.categoryId === alim)).toHaveLength(3);
    expect((await db.operations.get(ventilee.id))?.splits?.map(s => s.categoryId)).toEqual([alim, depenses[2]]);
    expect((await db.schedules.toArray())[0].categoryId).toBe(alim);
    expect((await db.categorizationRules.toArray())[0].categoryId).toBe(alim);
    expect(await operationService.countByRef(base.id, 'categoryId', courses)).toBe(0);
  });

  it('additionne les budgets des deux catégories, ou déplace celui de la catégorie absorbée', async () => {
    const [alim, courses, loisirs] = depenses;
    await budgetService.set(base.id, alim, 30_000);
    await budgetService.set(base.id, courses, 20_000);
    expect((await mergeCategories(base.id, courses, alim)).budgets).toBe(1);
    expect((await budgetService.list(base.id)).map(b => [b.categoryId, b.monthlyAmountCents])).toEqual([[alim, 50_000]]);

    await budgetService.set(base.id, loisirs, 7_000);
    await mergeCategories(base.id, loisirs, alim);
    expect((await budgetService.list(base.id)).map(b => b.monthlyAmountCents)).toEqual([57_000]);
  });

  it('déplace le budget vers la cible quand elle n’en avait pas', async () => {
    const [alim, courses] = depenses;
    await budgetService.set(base.id, courses, 20_000);
    await mergeCategories(base.id, courses, alim);
    expect((await budgetService.list(base.id)).map(b => [b.categoryId, b.monthlyAmountCents])).toEqual([[alim, 20_000]]);
  });

  it('refuse deux catégories identiques, inconnues ou de sens opposé, sans rien modifier', async () => {
    await op({ categoryId: depenses[0] });
    const avant = await db.categories.count();
    await expect(mergeCategories(base.id, depenses[0], depenses[0])).rejects.toThrow(/différentes/);
    await expect(mergeCategories(base.id, depenses[0], 'inconnue')).rejects.toThrow(/introuvable/);
    await expect(mergeCategories('autre-base', depenses[0], depenses[1])).rejects.toThrow(/introuvable/);
    await expect(mergeCategories(base.id, depenses[0], recettes[0])).rejects.toThrow(/dépense avec une catégorie de recette/);
    expect(await db.categories.count()).toBe(avant);
    expect((await db.operations.toArray())[0].categoryId).toBe(depenses[0]);
  });

  it('inclut les opérations supprimées pour ne laisser aucune référence orpheline', async () => {
    const o = await op({ categoryId: depenses[1] });
    await operationService.remove(o.id);
    await mergeCategories(base.id, depenses[1], depenses[0]);
    expect((await db.operations.get(o.id))?.categoryId).toBe(depenses[0]);
  });
});

describe('fusion de tiers', () => {
  it('re-pointe opérations, échéances et règles, garde la catégorie par défaut manquante', async () => {
    const a = await payeeService.create(base.id, 'Carrefour');
    const b = await payeeService.create(base.id, 'Carrefour Market');
    await payeeService.update(b.id, { defaultCategoryId: depenses[0] });
    await op({ payeeId: b.id });
    await op({ payeeId: b.id });
    await op({ payeeId: a.id });
    await scheduleService.create({ dbId: base.id, accountId: compte, amountCents: 500, kind: 'depense', periodicity: 'mensuelle', nextDate: '2026-09-01', autoPost: false, holidayRule: 'exacte', payeeId: b.id });
    const r = await mergePayees(base.id, b.id, a.id);
    expect(r).toMatchObject({ operations: 2, schedules: 1 });
    expect(await db.payees.get(b.id)).toBeUndefined();
    expect((await db.operations.toArray()).every(o => o.payeeId === a.id)).toBe(true);
    expect((await db.payees.get(a.id))?.defaultCategoryId).toBe(depenses[0]);
  });

  it('refuse deux tiers identiques ou inconnus', async () => {
    const a = await payeeService.create(base.id, 'A');
    await expect(mergePayees(base.id, a.id, a.id)).rejects.toThrow(/différents/);
    await expect(mergePayees(base.id, a.id, 'x')).rejects.toThrow(/introuvable/);
  });
});

describe('épuration des tiers', () => {
  it('archive les tiers inutilisés depuis la date, épargne les récents et ceux d’une échéance en cours', async () => {
    const ancien = await payeeService.create(base.id, 'Ancien');
    const recent = await payeeService.create(base.id, 'Récent');
    const jamais = await payeeService.create(base.id, 'Jamais');
    const planifie = await payeeService.create(base.id, 'Planifié');
    const supprime = await payeeService.create(base.id, 'Seulement supprimé');
    await op({ payeeId: ancien.id, date: '2020-03-01' });
    await op({ payeeId: recent.id, date: '2026-07-01' });
    await op({ payeeId: planifie.id, date: '2019-01-01' });
    const s = await op({ payeeId: supprime.id, date: '2026-07-01' });
    await operationService.remove(s.id);
    await scheduleService.create({ dbId: base.id, accountId: compte, amountCents: 500, kind: 'depense', periodicity: 'mensuelle', nextDate: '2026-09-01', autoPost: false, holidayRule: 'exacte', payeeId: planifie.id });

    const liste = await unusedPayees(base.id, '2025-01-01');
    expect(liste.map(p => p.name)).toEqual(['Ancien', 'Jamais', 'Seulement supprimé']);
    expect(liste.find(p => p.name === 'Ancien')?.lastUse).toBe('2020-03-01');
    expect(liste.find(p => p.name === 'Jamais')?.lastUse).toBeUndefined();
    expect(jamais.id).toBeTruthy();

    expect(await purgeUnusedPayees(base.id, '2025-01-01')).toBe(3);
    expect((await payeeService.list(base.id)).map(p => p.name).sort()).toEqual(['Planifié', 'Récent']);
    // Archivés, pas supprimés : l'historique garde le nom du tiers.
    expect((await payeeService.list(base.id, true))).toHaveLength(5);
    expect((await db.operations.toArray()).find(o => o.payeeId === ancien.id)).toBeDefined();
    expect(await purgeUnusedPayees(base.id, '2025-01-01')).toBe(0);
  });
});

describe('remplacement en masse', () => {
  it('remplace une catégorie et compte avant de toucher à quoi que ce soit', async () => {
    const [alim, courses] = depenses;
    await op({ categoryId: courses, date: '2026-07-10' });
    await op({ categoryId: courses, date: '2026-08-10' });
    await op({ categoryId: alim, date: '2026-08-11' });
    const spec = { field: 'categoryId' as const, fromValue: courses, toValue: alim, includeSchedules: false };
    expect(await previewReplace({ dbId: base.id }, spec)).toEqual({ operations: 2, schedules: 0, skipped: 0 });
    expect(await previewReplace({ dbId: base.id, from: '2026-08-01', to: '2026-08-31' }, spec)).toMatchObject({ operations: 1 });
    expect((await db.operations.toArray()).filter(o => o.categoryId === courses)).toHaveLength(2);   // l'aperçu n'écrit rien

    expect(await replaceInOperations({ dbId: base.id, from: '2026-08-01', to: '2026-08-31' }, spec)).toEqual({ operations: 1, schedules: 0 });
    expect((await db.operations.toArray()).filter(o => o.categoryId === courses).map(o => o.date)).toEqual(['2026-07-10']);
  });

  it('remplace aussi dans les parts d’une ventilation et dans les échéances', async () => {
    const [alim, courses, loisirs] = depenses;
    const v = await op({ amountCents: 3000, splits: [{ categoryId: courses, amountCents: 2000 }, { categoryId: loisirs, amountCents: 1000 }] });
    await scheduleService.create({ dbId: base.id, accountId: compte, amountCents: 500, kind: 'depense', periodicity: 'mensuelle', nextDate: '2026-09-01', autoPost: false, holidayRule: 'exacte', categoryId: courses });
    const spec = { field: 'categoryId' as const, fromValue: courses, toValue: alim, includeSchedules: true };
    expect(await replaceInOperations({ dbId: base.id }, spec)).toEqual({ operations: 1, schedules: 1 });
    expect((await db.operations.get(v.id))?.splits?.map(s => s.categoryId)).toEqual([alim, loisirs]);
    expect((await db.schedules.toArray())[0].categoryId).toBe(alim);
  });

  it('ne change pas la catégorie d’une opération dont le sens ne correspond pas', async () => {
    await op({ categoryId: depenses[0], kind: 'depense' });
    await op({ categoryId: depenses[0], kind: 'recette' });                       // recette classée « Alimentation » : incohérente
    const spec = { field: 'categoryId' as const, fromValue: depenses[0], toValue: depenses[1], includeSchedules: false };
    expect(await previewReplace({ dbId: base.id }, spec)).toMatchObject({ operations: 1, skipped: 1 });
    expect(await replaceInOperations({ dbId: base.id }, spec)).toMatchObject({ operations: 1 });
    expect((await db.operations.toArray()).find(o => o.kind === 'recette')?.categoryId).toBe(depenses[0]);
  });

  it('remplit les opérations sans valeur et sait vider un champ', async () => {
    const t = await payeeService.create(base.id, 'Tiers');
    await op({}); await op({ payeeId: t.id });
    expect(await replaceInOperations({ dbId: base.id }, { field: 'payeeId', fromValue: undefined, toValue: t.id, includeSchedules: false })).toMatchObject({ operations: 1 });
    expect((await db.operations.toArray()).every(o => o.payeeId === t.id)).toBe(true);
    await replaceInOperations({ dbId: base.id }, { field: 'payeeId', fromValue: t.id, toValue: undefined, includeSchedules: false });
    expect((await db.operations.toArray()).every(o => o.payeeId === undefined)).toBe(true);
  });

  it('remplace un mode de paiement et épargne virements et opérations supprimées', async () => {
    const cb = await paymentMethodService.create(base.id, 'CB');
    const cheque = await paymentMethodService.create(base.id, 'Chèque');
    await op({ paymentMethodId: cb.id });
    const supprimee = await op({ paymentMethodId: cb.id });
    await operationService.remove(supprimee.id);
    await transferService.create({ dbId: base.id, fromAccountId: compte, toAccountId: autre, date: '2026-08-05', amountCents: 100, paymentMethodId: cb.id });
    expect(await replaceInOperations({ dbId: base.id }, { field: 'paymentMethodId', fromValue: cb.id, toValue: cheque.id, includeSchedules: false })).toMatchObject({ operations: 1 });
  });

  it('refuse une nouvelle valeur inconnue et ne fait rien quand source et cible sont identiques', async () => {
    await op({ categoryId: depenses[0] });
    await expect(replaceInOperations({ dbId: base.id }, { field: 'categoryId', fromValue: depenses[0], toValue: 'inconnue', includeSchedules: false })).rejects.toThrow(/introuvable/);
    expect(await replaceInOperations({ dbId: base.id }, { field: 'categoryId', fromValue: depenses[0], toValue: depenses[0], includeSchedules: false })).toEqual({ operations: 0, schedules: 0 });
  });

  it('filtre par compte', async () => {
    await op({ categoryId: depenses[0] });
    await op({ categoryId: depenses[0], accountId: autre });
    const spec = { field: 'categoryId' as const, fromValue: depenses[0], toValue: depenses[1], includeSchedules: false };
    expect(await replaceInOperations({ dbId: base.id, accountId: autre }, spec)).toMatchObject({ operations: 1 });
    expect((await db.operations.toArray()).filter(o => o.categoryId === depenses[0]).map(o => o.accountId)).toEqual([compte]);
  });
});

describe('suppression en masse', () => {
  const spec = (over: object = {}) => ({ dbId: base.id, keepChecked: true, includeTransfers: false, ...over });

  it('sélectionne par période, catégorie et tiers', async () => {
    const t = await payeeService.create(base.id, 'T');
    await op({ date: '2026-07-01', categoryId: depenses[0] });
    await op({ date: '2026-08-01', categoryId: depenses[0], payeeId: t.id });
    await op({ date: '2026-08-02', categoryId: depenses[1] });
    expect(await selectForDeletion(spec({ from: '2026-08-01', to: '2026-08-31' }))).toHaveLength(2);
    expect(await selectForDeletion(spec({ categoryId: depenses[0] }))).toHaveLength(2);
    expect(await selectForDeletion(spec({ payeeId: t.id }))).toHaveLength(1);
  });

  it('épargne les opérations pointées sur demande', async () => {
    const pointee = await op({});
    await op({});
    await operationService.toggleChecked(pointee.id, true);
    expect(await deleteOperations(spec())).toBe(1);
    expect((await operationService.list(base.id)).map(o => o.id)).toEqual([pointee.id]);
    expect(await deleteOperations(spec({ keepChecked: false }))).toBe(1);
    expect(await operationService.list(base.id)).toHaveLength(0);
  });

  it('ne supprime pas les virements tant qu’on ne les inclut pas', async () => {
    await transferService.create({ dbId: base.id, fromAccountId: compte, toAccountId: autre, date: '2026-08-05', amountCents: 100 });
    await op({});
    expect(await deleteOperations(spec())).toBe(1);
    expect(await operationService.list(base.id)).toHaveLength(2);
  });

  it('supprime un virement en entier, une seule fois, et compte une paire pour une suppression', async () => {
    await transferService.create({ dbId: base.id, fromAccountId: compte, toAccountId: autre, date: '2026-08-05', amountCents: 100 });
    expect(await deleteOperations(spec({ includeTransfers: true }))).toBe(1);
    expect(await operationService.list(base.id)).toHaveLength(0);
  });

  it('épargne un virement entier dont un volet est pointé', async () => {
    const { debit } = await transferService.create({ dbId: base.id, fromAccountId: compte, toAccountId: autre, date: '2026-08-05', amountCents: 100 });
    await operationService.toggleChecked(debit.id, true);
    expect(await deleteOperations(spec({ includeTransfers: true }))).toBe(0);
    expect(await operationService.list(base.id)).toHaveLength(2);
  });

  it('les soldes se recalculent après suppression, les opérations restant récupérables dans la sauvegarde', async () => {
    await op({ amountCents: 4000 });
    expect((await accountService.balances(base.id))[compte]).toBe(-4000);
    await deleteOperations(spec());
    expect((await accountService.balances(base.id))[compte]).toBe(0);
    expect((await db.operations.toArray())[0].deletedAt).toBeTruthy();       // suppression logique
  });
});

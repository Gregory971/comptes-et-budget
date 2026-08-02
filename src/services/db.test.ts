import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, uid } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { budgetService } from './budgetService';
import { reportService, periodRange } from './reportService';
import { categoryService, payeeService } from './referentialService';
import { toCents } from '../utils/money';

const DB = 'test-base';

async function reset() {
  await Promise.all([
    db.operations.clear(), db.accounts.clear(), db.budgets.clear(),
    db.categories.clear(), db.categoryGroups.clear(), db.payees.clear(),
  ]);
}

describe('soldes et opérations', () => {
  beforeEach(reset);

  it('calcule les soldes de tous les comptes en un passage', async () => {
    const a = await accountService.create({ dbId: DB, name: 'Courant', type: 'courant', initialBalanceCents: toCents(1000), startDate: '2026-01-01' });
    const b = await accountService.create({ dbId: DB, name: 'Épargne', type: 'epargne', initialBalanceCents: toCents(5000), startDate: '2026-01-01' });

    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-05', amountCents: toCents(200), kind: 'depense' });
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-06', amountCents: toCents(50), kind: 'recette' });

    const balances = await accountService.balances(DB);
    expect(balances[a.id]).toBe(toCents(850));
    expect(balances[b.id]).toBe(toCents(5000));
    expect(await accountService.totalBalance(DB)).toBe(toCents(5850));
  });

  it('inclut les opérations du 1er et du dernier jour du mois', async () => {
    const a = await accountService.create({ dbId: DB, name: 'C', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-01', amountCents: toCents(10), kind: 'depense' });
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-31', amountCents: toCents(20), kind: 'depense' });
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-09-01', amountCents: toCents(40), kind: 'depense' });

    const { from, to } = periodRange(new Date(2026, 7, 15), 'mois');
    const ops = await operationService.list(DB, { from, to });
    expect(ops).toHaveLength(2);
    expect(ops.map(o => o.date).sort()).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('exclut les opérations supprimées', async () => {
    const a = await accountService.create({ dbId: DB, name: 'C', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    const op = await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-10', amountCents: toCents(30), kind: 'depense' });
    await operationService.remove(op.id);
    expect(await operationService.list(DB)).toHaveLength(0);
    expect((await accountService.balances(DB))[a.id]).toBe(0);
  });
});

describe('virement entre comptes', () => {
  beforeEach(reset);

  it('déplace le solde sans modifier le patrimoine total', async () => {
    const a = await accountService.create({ dbId: DB, name: 'Courant', type: 'courant', initialBalanceCents: toCents(1000), startDate: '2026-01-01' });
    const b = await accountService.create({ dbId: DB, name: 'Épargne', type: 'epargne', initialBalanceCents: toCents(0), startDate: '2026-01-01' });

    const avant = await accountService.totalBalance(DB);
    await transferService.create({ dbId: DB, fromAccountId: a.id, toAccountId: b.id, date: '2026-08-10', amountCents: toCents(300) });

    const balances = await accountService.balances(DB);
    expect(balances[a.id]).toBe(toCents(700));
    expect(balances[b.id]).toBe(toCents(300));
    expect(await accountService.totalBalance(DB)).toBe(avant);
  });

  it('n’apparaît ni en recette ni en dépense dans le bilan', async () => {
    const a = await accountService.create({ dbId: DB, name: 'Courant', type: 'courant', initialBalanceCents: toCents(1000), startDate: '2026-01-01' });
    const b = await accountService.create({ dbId: DB, name: 'Épargne', type: 'epargne', initialBalanceCents: 0, startDate: '2026-01-01' });
    await transferService.create({ dbId: DB, fromAccountId: a.id, toAccountId: b.id, date: '2026-08-10', amountCents: toCents(300) });

    const data = await reportService.build(DB, undefined, periodRange(new Date(2026, 7, 15), 'mois'));
    expect(data.recettesCents).toBe(0);
    expect(data.depensesCents).toBe(0);
  });

  it('supprime les deux écritures ensemble', async () => {
    const a = await accountService.create({ dbId: DB, name: 'A', type: 'courant', initialBalanceCents: toCents(1000), startDate: '2026-01-01' });
    const b = await accountService.create({ dbId: DB, name: 'B', type: 'epargne', initialBalanceCents: 0, startDate: '2026-01-01' });
    const { debit } = await transferService.create({ dbId: DB, fromAccountId: a.id, toAccountId: b.id, date: '2026-08-10', amountCents: toCents(300) });

    await operationService.remove(debit.id);
    expect(await operationService.list(DB)).toHaveLength(0);
    expect((await accountService.balances(DB))[b.id]).toBe(0);
  });

  it('refuse un virement vers le même compte', async () => {
    const a = await accountService.create({ dbId: DB, name: 'A', type: 'courant', initialBalanceCents: toCents(100), startDate: '2026-01-01' });
    await expect(transferService.create({
      dbId: DB, fromAccountId: a.id, toAccountId: a.id, date: '2026-08-10', amountCents: toCents(10),
    })).rejects.toThrow();
  });
});

describe('suivi budgétaire', () => {
  beforeEach(reset);

  it('agrège les dépenses du mois par catégorie', async () => {
    const a = await accountService.create({ dbId: DB, name: 'C', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    const g = await categoryService.createGroup(DB, 'Alimentation', 'depense', '🛒');
    const c = await categoryService.createCategory(DB, g.id, 'Courses');
    const now = new Date();
    const jour = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;

    await operationService.create({ dbId: DB, accountId: a.id, date: jour, amountCents: toCents(80), kind: 'depense', categoryId: c.id });
    await operationService.create({ dbId: DB, accountId: a.id, date: jour, amountCents: toCents(20), kind: 'depense', categoryId: c.id });
    await budgetService.set(DB, c.id, toCents(250));

    const [row] = await budgetService.monthlyStatus(DB);
    expect(row.spentCents).toBe(toCents(100));
    expect(row.remainingCents).toBe(toCents(150));
    expect(row.percent).toBe(40);
  });
});

describe('intégrité référentielle', () => {
  beforeEach(reset);

  it('refuse de supprimer un tiers référencé par une opération', async () => {
    const a = await accountService.create({ dbId: DB, name: 'C', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    const p = await payeeService.create(DB, 'Carrefour');
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-10', amountCents: toCents(30), kind: 'depense', payeeId: p.id });

    const result = await payeeService.remove(DB, p.id);
    expect(result.removed).toBe(false);
    expect(result.references).toBe(1);
    expect(await db.payees.get(p.id)).toBeTruthy();
  });

  it('autorise la suppression d’un tiers non référencé', async () => {
    const p = await payeeService.create(DB, 'Inutilisé' + uid());
    expect((await payeeService.remove(DB, p.id)).removed).toBe(true);
    expect(await db.payees.get(p.id)).toBeUndefined();
  });

  it('archive sans casser l’historique', async () => {
    const a = await accountService.create({ dbId: DB, name: 'C', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    const p = await payeeService.create(DB, 'EDF');
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-10', amountCents: toCents(30), kind: 'depense', payeeId: p.id });

    await payeeService.archive(p.id);
    expect(await payeeService.list(DB)).toHaveLength(0);
    expect(await payeeService.list(DB, true)).toHaveLength(1);
    const [op] = await operationService.list(DB);
    expect(op.payeeId).toBe(p.id);
  });
});

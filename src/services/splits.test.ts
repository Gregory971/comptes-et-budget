import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { categoryService } from './referentialService';
import { operationService } from './operationService';
import { budgetService } from './budgetService';
import { reportService, periodRange } from './reportService';
import { categoryParts, isSplit, remainingToSplit, splitSummary, touchesCategory, validateSplits } from '../utils/splits';

const DB = 'base-ventilation';

async function reset() {
  await Promise.all([db.operations.clear(), db.accounts.clear(), db.budgets.clear(), db.categories.clear(), db.categoryGroups.clear()]);
}

async function compte() {
  return accountService.create({ dbId: DB, name: 'Courant', type: 'courant', initialBalanceCents: 100_000, startDate: '2026-01-01' });
}

describe('validation d’une ventilation', () => {
  const parts = (...n: number[]) => n.map(amountCents => ({ categoryId: 'c', amountCents }));

  it('accepte des parts dont la somme égale le montant', () => {
    expect(validateSplits(-8700, parts(-6000, -2700))).toBeNull();
    expect(validateSplits(8700, parts(6000, 2700))).toBeNull();
  });

  it('exige au moins deux lignes', () => {
    expect(validateSplits(-100, parts(-100))).toMatch(/au moins deux/);
  });

  it('refuse une part nulle ou de sens contraire', () => {
    expect(validateSplits(-100, parts(-100, 0))).toMatch(/montant/);
    expect(validateSplits(-100, parts(-150, 50))).toMatch(/même sens/);
  });

  it('dit combien il manque ou combien il dépasse', () => {
    expect(validateSplits(-8700, parts(-6000, -2000))).toMatch(/manque 7,00 €/);
    expect(validateSplits(-8700, parts(-6000, -3000))).toMatch(/dépasse 3,00 €/);
    expect(validateSplits(8700, parts(6000, 2000))).toMatch(/manque 7,00 €/);
  });

  it('calcule le reste à ventiler, signé comme l’opération', () => {
    expect(remainingToSplit(-8700, [{ amountCents: -6000 }])).toBe(-2700);
    expect(remainingToSplit(-8700, [{ amountCents: -6000 }, { amountCents: -2700 }])).toBe(0);
  });
});

describe('parts par catégorie', () => {
  it('renvoie la catégorie unique d’une opération non ventilée', () => {
    expect(categoryParts({ categoryId: 'a', amountCents: -500 })).toEqual([{ categoryId: 'a', amountCents: -500 }]);
  });
  it('renvoie les parts d’une opération ventilée', () => {
    const op = { amountCents: -800, splits: [{ categoryId: 'a', amountCents: -500 }, { categoryId: 'b', amountCents: -300 }] };
    expect(categoryParts(op)).toEqual(op.splits);
    expect(isSplit(op)).toBe(true);
    expect(touchesCategory(op, 'b')).toBe(true);
    expect(touchesCategory(op, 'z')).toBe(false);
    expect(splitSummary(op, id => id?.toUpperCase() ?? '?')).toBe('A · B');
  });
});

describe('opérations ventilées', () => {
  beforeEach(reset);

  it('enregistre les parts avec le signe de l’opération et efface la catégorie unique', async () => {
    const a = await compte();
    const op = await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 8700,
      categoryId: 'ignoree', splits: [{ categoryId: 'alim', amountCents: 6000 }, { categoryId: 'entretien', amountCents: 2700 }],
    });
    expect(op.amountCents).toBe(-8700);
    expect(op.categoryId).toBeUndefined();
    expect(op.splits?.map(s => s.amountCents)).toEqual([-6000, -2700]);
    expect((await accountService.balances(DB))[a.id]).toBe(100_000 - 8700);   // le solde ne dépend que du montant
  });

  it('refuse une ventilation fausse et ne crée rien', async () => {
    const a = await compte();
    await expect(operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 8700,
      splits: [{ categoryId: 'alim', amountCents: 6000 }, { categoryId: 'e', amountCents: 2000 }],
    })).rejects.toThrow(/manque/);
    expect(await db.operations.count()).toBe(0);
  });

  it('refuse de ventiler un virement', async () => {
    const a = await compte();
    await expect(operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'virement', amountCents: -100,
      splits: [{ categoryId: 'a', amountCents: 50 }, { categoryId: 'b', amountCents: 50 }],
    })).rejects.toThrow(/virement/);
  });

  it('retrouve l’opération par n’importe laquelle de ses catégories', async () => {
    const a = await compte();
    await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 800,
      splits: [{ categoryId: 'alim', amountCents: 500 }, { categoryId: 'entretien', amountCents: 300 }],
    });
    await operationService.create({ dbId: DB, accountId: a.id, date: '2026-08-11', kind: 'depense', amountCents: 100, categoryId: 'alim' });
    expect(await operationService.list(DB, { categoryId: 'alim' })).toHaveLength(2);
    expect(await operationService.list(DB, { categoryId: 'entretien' })).toHaveLength(1);
    expect(await operationService.countByRef(DB, 'categoryId', 'entretien')).toBe(1);
    expect(await operationService.countByRef(DB, 'categoryId', 'alim')).toBe(2);
  });

  it('répartit une opération ventilée dans le budget de chaque catégorie', async () => {
    const a = await compte();
    const maintenant = new Date();
    const ce = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-10`;
    await operationService.create({
      dbId: DB, accountId: a.id, date: ce, kind: 'depense', amountCents: 8700,
      splits: [{ categoryId: 'alim', amountCents: 6000 }, { categoryId: 'entretien', amountCents: 2700 }],
    });
    await operationService.create({ dbId: DB, accountId: a.id, date: ce, kind: 'depense', amountCents: 1000, categoryId: 'alim' });
    expect(await budgetService.spentByCategory(DB)).toEqual({ alim: 7000, entretien: 2700 });
  });

  it('répartit aussi les bilans par catégorie, sans toucher aux totaux', async () => {
    const a = await compte();
    const g = await categoryService.createGroup(DB, 'Vie courante', 'depense');
    const alim = (await categoryService.createCategory(DB, g.id, 'Alimentation', '🛒')).id;
    await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 8700,
      splits: [{ categoryId: alim, amountCents: 6000 }, { amountCents: 2700 }],
    });
    const bilan = await reportService.build(DB, undefined, periodRange(new Date(2026, 7, 15), 'mois'));
    expect(bilan.depensesCents).toBe(8700);
    expect(bilan.byCategory.map(c => c.valueCents).sort((x, y) => x - y)).toEqual([2700, 6000]);
    expect(bilan.byCategory.find(c => c.valueCents === 2700)?.name).toBe('Sans catégorie');
    expect(bilan.byCategory.find(c => c.valueCents === 6000)?.name).toBe('Alimentation');
  });

  it('ne laisse pas modifier le montant d’une opération ventilée sans sa ventilation', async () => {
    const a = await compte();
    const op = await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 800,
      splits: [{ categoryId: 'a', amountCents: 500 }, { categoryId: 'b', amountCents: 300 }],
    });
    await expect(operationService.update(op.id, { amountCents: 900 })).rejects.toThrow(/ventilation/);
    await operationService.update(op.id, {
      amountCents: 900, splits: [{ categoryId: 'a', amountCents: 600 }, { categoryId: 'b', amountCents: 300 }],
    });
    expect((await db.operations.get(op.id))?.amountCents).toBe(-900);
  });

  it('supprime la ventilation quand on repasse à une catégorie unique', async () => {
    const a = await compte();
    const op = await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 800,
      splits: [{ categoryId: 'a', amountCents: 500 }, { categoryId: 'b', amountCents: 300 }],
    });
    await operationService.update(op.id, { splits: undefined, categoryId: 'a' });
    const apres = (await db.operations.get(op.id))!;
    expect(apres.splits).toBeUndefined();
    expect(apres.categoryId).toBe('a');
  });

  it('une modification sans rapport garde la ventilation', async () => {
    const a = await compte();
    const op = await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'depense', amountCents: 800,
      splits: [{ categoryId: 'a', amountCents: 500 }, { categoryId: 'b', amountCents: 300 }],
    });
    await operationService.update(op.id, { label: 'Courses' });
    expect((await db.operations.get(op.id))?.splits).toHaveLength(2);
  });

  it('une recette peut être ventilée', async () => {
    const a = await compte();
    const op = await operationService.create({
      dbId: DB, accountId: a.id, date: '2026-08-10', kind: 'recette', amountCents: 1000,
      splits: [{ categoryId: 'salaire', amountCents: 800 }, { categoryId: 'prime', amountCents: 200 }],
    });
    expect(op.splits?.map(s => s.amountCents)).toEqual([800, 200]);
  });
});

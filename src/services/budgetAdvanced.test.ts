// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { categoryService } from './referentialService';
import { currencyService } from './currencyService';
import { backupService } from './backupService';
import { budgetService, monthlyFromPeriod, monthsBetween, PERIOD_LABEL } from './budgetService';
import type { Database } from '../types';

let base: Database;
let compte: string;
let alim: string;
let loisirs: string;
let assurance: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base budget', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2020-01-01' })).id;
  const g = await categoryService.createGroup(base.id, 'Zz', 'depense');
  alim = (await categoryService.createCategory(base.id, g.id, 'Alimentation')).id;
  loisirs = (await categoryService.createCategory(base.id, g.id, 'Loisirs')).id;
  assurance = (await categoryService.createCategory(base.id, g.id, 'Assurance')).id;
});

const depense = (date: string, amountCents: number, categoryId?: string, over: object = {}) =>
  operationService.create({ dbId: base.id, accountId: compte, date, kind: 'depense', amountCents, categoryId, ...over });

describe('budget saisi pour une période', () => {
  it('lisse le montant sur les mois de la période et garde la saisie d’origine', async () => {
    await budgetService.setPeriodic(base.id, assurance, 120_000, 12);
    const [b] = await budgetService.list(base.id);
    expect(b).toMatchObject({ categoryId: assurance, monthlyAmountCents: 10_000, periodMonths: 12, periodAmountCents: 120_000 });
    await budgetService.setPeriodic(base.id, loisirs, 30_000, 3);
    expect((await budgetService.list(base.id)).find(x => x.categoryId === loisirs)).toMatchObject({ monthlyAmountCents: 10_000, periodMonths: 3 });
  });

  it('arrondit le lissage au centime', () => {
    expect(monthlyFromPeriod(10_000, 12)).toBe(833);
    expect(monthlyFromPeriod(10_001, 12)).toBe(833);
    expect(monthlyFromPeriod(10_006, 12)).toBe(834);
    expect(monthlyFromPeriod(10_000, 1)).toBe(10_000);
  });

  it('une période d’un mois est un budget mensuel ordinaire', async () => {
    await budgetService.setPeriodic(base.id, alim, 40_000, 1);
    const [b] = await budgetService.list(base.id);
    expect(b.monthlyAmountCents).toBe(40_000);
    expect(b.periodMonths).toBeUndefined();
  });

  it('modifie le budget existant au lieu d’en créer un second, et efface la période si on repasse au mensuel', async () => {
    await budgetService.setPeriodic(base.id, assurance, 120_000, 12);
    await budgetService.setPeriodic(base.id, assurance, 60_000, 6);
    expect(await budgetService.list(base.id)).toHaveLength(1);
    expect((await budgetService.list(base.id))[0]).toMatchObject({ monthlyAmountCents: 10_000, periodMonths: 6, periodAmountCents: 60_000 });
    await budgetService.set(base.id, assurance, 12_345);
    const [b] = await budgetService.list(base.id);
    expect(b.monthlyAmountCents).toBe(12_345);
    expect(b.periodMonths).toBeUndefined();
    expect(b.periodAmountCents).toBeUndefined();
  });

  it('refuse un montant nul, négatif, fractionnaire, une période inconnue et un lissage nul', async () => {
    await expect(budgetService.setPeriodic(base.id, alim, 0, 12)).rejects.toThrow(/supérieur à zéro/);
    await expect(budgetService.setPeriodic(base.id, alim, -5, 12)).rejects.toThrow(/supérieur à zéro/);
    await expect(budgetService.setPeriodic(base.id, alim, 10.5, 12)).rejects.toThrow(/supérieur à zéro/);
    await expect(budgetService.setPeriodic(base.id, alim, 1000, 5 as 12)).rejects.toThrow(/période/);
    await expect(budgetService.setPeriodic(base.id, alim, 5, 12)).rejects.toThrow(/trop faible/);
    expect(await budgetService.list(base.id)).toHaveLength(0);
  });

  it('le suivi du mois s’appuie sur l’équivalent mensuel', async () => {
    await budgetService.setPeriodic(base.id, assurance, 120_000, 12);
    const maintenant = new Date();
    const ce = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-10`;
    await depense(ce, 4_000, assurance);
    const [s] = await budgetService.monthlyStatus(base.id);
    expect(s).toMatchObject({ spentCents: 4_000, remainingCents: 6_000 });
    expect(s.percent).toBe(40);
  });

  it('la période suit la sauvegarde', async () => {
    await budgetService.setPeriodic(base.id, assurance, 120_000, 12);
    const copie = await backupService.export();
    await db.budgets.clear();
    await backupService.restore(copie, 'replace', false);
    expect((await budgetService.list(base.id))[0]).toMatchObject({ periodMonths: 12, periodAmountCents: 120_000 });
  });

  it('libellés de période', () => {
    expect(PERIOD_LABEL).toEqual({ 1: 'par mois', 3: 'par trimestre', 6: 'par semestre', 12: 'par an' });
  });
});

describe('mois couverts', () => {
  it.each([
    ['2026-01-01', '2026-12-31', 12], ['2026-01-15', '2026-01-20', 1], ['2025-11-01', '2026-02-28', 4], ['2026-03-01', '2026-01-01', 1],
  ])('%s → %s : %i mois', (a, b, n) => expect(monthsBetween(a, b)).toBe(n));

  it('les douze derniers mois complets s’arrêtent à la fin du mois précédent', () => {
    expect(budgetService.lastTwelveMonths(new Date(2026, 9, 23))).toEqual({ from: '2025-10-01', to: '2026-09-30' });
    expect(budgetService.lastTwelveMonths(new Date(2026, 0, 5))).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(budgetService.lastTwelveMonths(new Date(2026, 2, 31))).toEqual({ from: '2025-03-01', to: '2026-02-28' });
  });
});

describe('suggestions d’après les dépenses réelles', () => {
  const an = { from: '2025-01-01', to: '2025-12-31' };

  it('calcule la moyenne mensuelle par catégorie, arrondie au pas supérieur', async () => {
    await depense('2025-03-10', 60_000, alim);
    await depense('2025-09-10', 62_000, alim);          // 1 220 € sur 12 mois = 101,67 €
    await depense('2025-05-05', 5_000, loisirs);        // 50 € / 12 = 4,17 €
    const s = await budgetService.suggest(base.id, an);
    expect(s.map(x => x.categoryId)).toEqual([alim, loisirs]);                  // les plus lourdes d'abord
    expect(s[0]).toMatchObject({ averageCents: 10_167, suggestedCents: 10_500, months: 12, hasBudget: false });
    expect(s[1]).toMatchObject({ averageCents: 417, suggestedCents: 500 });
    expect((await budgetService.suggest(base.id, an, 1))[0].suggestedCents).toBe(10_167);
    expect((await budgetService.suggest(base.id, an, 1000))[0].suggestedCents).toBe(11_000);
  });

  it('ignore recettes, virements, opérations hors période, supprimées et sans catégorie', async () => {
    await depense('2025-03-10', 12_000, alim);
    await depense('2024-12-31', 99_999, alim);                         // hors période
    await depense('2026-01-01', 99_999, alim);                         // hors période
    await depense('2025-04-01', 99_999);                               // sans catégorie
    const supprimee = await depense('2025-05-01', 99_999, alim);
    await operationService.remove(supprimee.id);
    await operationService.create({ dbId: base.id, accountId: compte, date: '2025-06-01', kind: 'recette', amountCents: 99_999, categoryId: alim });
    const autre = (await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 0, startDate: '2020-01-01' })).id;
    await transferService.create({ dbId: base.id, fromAccountId: compte, toAccountId: autre, date: '2025-07-01', amountCents: 99_999 });
    const s = await budgetService.suggest(base.id, an);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ categoryId: alim, averageCents: 1_000 });
  });

  it('répartit une opération ventilée dans chaque catégorie', async () => {
    await depense('2025-03-10', 12_000, undefined, { splits: [{ categoryId: alim, amountCents: 7_200 }, { categoryId: loisirs, amountCents: 4_800 }] });
    const s = await budgetService.suggest(base.id, an, 1);
    expect(s.map(x => [x.categoryId, x.averageCents])).toEqual([[alim, 600], [loisirs, 400]]);
  });

  it('convertit les comptes en devise étrangère', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const us = (await accountService.create({ dbId: base.id, name: 'US', type: 'courant', initialBalanceCents: 0, startDate: '2020-01-01', currency: 'USD' })).id;
    await operationService.create({ dbId: base.id, accountId: us, date: '2025-03-10', kind: 'depense', amountCents: 24_000, categoryId: alim });
    expect((await budgetService.suggest(base.id, an, 1))[0].averageCents).toBe(1_000);   // 240 USD = 120 € ; 120 / 12
  });

  it('signale les catégories qui ont déjà un budget', async () => {
    await budgetService.set(base.id, alim, 50_000);
    await depense('2025-03-10', 12_000, alim);
    expect((await budgetService.suggest(base.id, an))[0].hasBudget).toBe(true);
  });

  it('ne propose rien sans dépense', async () => {
    expect(await budgetService.suggest(base.id, an)).toEqual([]);
  });

  it('une plage plus courte donne une moyenne sur moins de mois', async () => {
    await depense('2025-03-10', 30_000, alim);
    expect((await budgetService.suggest(base.id, { from: '2025-01-01', to: '2025-03-31' }, 1))[0]).toMatchObject({ averageCents: 10_000, months: 3 });
  });
});

describe('application des suggestions', () => {
  it('crée les budgets manquants et laisse les existants par défaut', async () => {
    await budgetService.set(base.id, alim, 50_000);
    const r = await budgetService.applySuggestions(base.id, [
      { categoryId: alim, monthlyCents: 10_000 }, { categoryId: loisirs, monthlyCents: 2_000 },
    ], false);
    expect(r).toEqual({ created: 1, replaced: 0, kept: 1 });
    const l = await budgetService.list(base.id);
    expect(l.find(b => b.categoryId === alim)?.monthlyAmountCents).toBe(50_000);
    expect(l.find(b => b.categoryId === loisirs)?.monthlyAmountCents).toBe(2_000);
  });

  it('remplace les existants sur demande, en effaçant leur période', async () => {
    await budgetService.setPeriodic(base.id, alim, 120_000, 12);
    const r = await budgetService.applySuggestions(base.id, [{ categoryId: alim, monthlyCents: 10_500 }], true);
    expect(r).toEqual({ created: 0, replaced: 1, kept: 0 });
    const [b] = await budgetService.list(base.id);
    expect(b.monthlyAmountCents).toBe(10_500);
    expect(b.periodMonths).toBeUndefined();
  });

  it('ignore les montants nuls ou invalides', async () => {
    const r = await budgetService.applySuggestions(base.id, [
      { categoryId: alim, monthlyCents: 0 }, { categoryId: loisirs, monthlyCents: -5 }, { categoryId: assurance, monthlyCents: 1.5 },
    ], true);
    expect(r).toEqual({ created: 0, replaced: 0, kept: 0 });
    expect(await budgetService.list(base.id)).toHaveLength(0);
  });

  it('remet tous les budgets à zéro', async () => {
    await budgetService.set(base.id, alim, 100); await budgetService.set(base.id, loisirs, 200);
    expect(await budgetService.reset(base.id)).toBe(2);
    expect(await budgetService.list(base.id)).toEqual([]);
  });
});

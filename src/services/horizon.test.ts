import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { scheduleService } from './scheduleService';
import { budgetService } from './budgetService';
import { buildHorizon } from './horizonService';
import { toCents } from '../utils/money';

const DB = 'test-horizon';
let accountId = '';

async function reset(soldeInitial = 1000) {
  await Promise.all([
    db.operations.clear(), db.accounts.clear(), db.schedules.clear(), db.budgets.clear(),
  ]);
  const acc = await accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(soldeInitial), startDate: '2026-01-01',
  });
  accountId = acc.id;
}

describe('trésorerie prévisionnelle sur douze mois', () => {
  beforeEach(() => reset());

  it('déroule les échéances mois après mois', async () => {
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(900), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-09-05', autoPost: false,
      holidayRule: 'exacte', label: 'Loyer',
    });
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(2000), kind: 'recette',
      periodicity: 'mensuelle', nextDate: '2026-09-28', autoPost: false,
      holidayRule: 'exacte', label: 'Salaire',
    });

    const h = await buildHorizon(DB, accountId, 3, 'metropole', '2026-09-01');
    expect(h.months).toHaveLength(3);
    expect(h.months[0].label).toBe('septembre 2026');
    expect(h.months[0].openingCents).toBe(toCents(1000));
    expect(h.months[0].scheduledCents).toBe(toCents(1100));
    expect(h.months[0].closingCents).toBe(toCents(2100));
    expect(h.months[2].closingCents).toBe(toCents(4300));
  });

  it('signale le premier passage sous zéro, à la date exacte', async () => {
    await reset(500);
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(900), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-09-05', autoPost: false,
      holidayRule: 'exacte', label: 'Loyer',
    });
    const h = await buildHorizon(DB, accountId, 6, 'metropole', '2026-09-01');
    expect(h.firstNegative).toEqual({ date: '2026-09-05', balanceCents: toCents(-400) });
  });

  it('retient le point bas du mois, et non son solde de clôture', async () => {
    // Le loyer part le 5, le salaire arrive le 28 : le compte descend bas en
    // milieu de mois alors qu'il finit au vert. C'est le creux qui déclenche
    // les frais de découvert, pas la clôture.
    await reset(1000);
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(1500), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-09-05', autoPost: false, holidayRule: 'exacte',
    });
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(2200), kind: 'recette',
      periodicity: 'mensuelle', nextDate: '2026-09-28', autoPost: false, holidayRule: 'exacte',
    });
    const h = await buildHorizon(DB, accountId, 1, 'metropole', '2026-09-01');
    expect(h.months[0].lowestCents).toBe(toCents(-500));
    expect(h.months[0].lowestDate).toBe('2026-09-05');
    expect(h.months[0].closingCents).toBe(toCents(1700));
  });

  it('n’avance pas une échéance au-delà de sa date de fin', async () => {
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-09-10', endDate: '2026-10-31',
      autoPost: false, holidayRule: 'exacte',
    });
    const h = await buildHorizon(DB, accountId, 4, 'metropole', '2026-09-01');
    expect(h.months.map(m => m.scheduledCents))
      .toEqual([toCents(-100), toCents(-100), 0, 0]);
  });

  it('n’applique pas deux fois le jour d’ancrage sur un mois court', async () => {
    await scheduleService.create({
      dbId: DB, accountId, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2027-01-31', autoPost: false, holidayRule: 'exacte',
    });
    const h = await buildHorizon(DB, accountId, 4, 'metropole', '2027-01-01');
    // Janvier, février, mars, avril : une occurrence par mois, sans saut.
    expect(h.months.map(m => m.scheduledCents)).toEqual(
      [toCents(-100), toCents(-100), toCents(-100), toCents(-100)]);
  });

  it('sépare les enveloppes budgétaires des échéances certaines', async () => {
    await reset(1000);
    await budgetService.set(DB, 'cat-courses', toCents(400));
    const h = await buildHorizon(DB, accountId, 2, 'metropole', '2026-09-01');
    // Aucune échéance : le solde « certain » ne bouge pas…
    expect(h.months.map(m => m.closingCents)).toEqual([toCents(1000), toCents(1000)]);
    // … tandis que la projection prudente consomme l'enveloppe chaque mois.
    expect(h.months.map(m => m.closingWithBudgetCents)).toEqual([toCents(600), toCents(200)]);
    expect(h.firstNegative).toBeUndefined();
  });

  it('ne prévoit que la part non consommée du budget du mois en cours', async () => {
    await reset(1000);
    await budgetService.set(DB, 'cat-courses', toCents(400));
    await db.operations.add({
      id: 'op-1', dbId: DB, accountId, date: '2026-09-03', amountCents: toCents(-250),
      kind: 'depense', categoryId: 'cat-courses', checked: false,
      createdAt: '', updatedAt: '',
    });
    const h = await buildHorizon(DB, accountId, 1, 'metropole', '2026-09-10');
    expect(h.months[0].budgetCents).toBe(toCents(150));
  });

  it('agrège tous les comptes quand aucun n’est précisé', async () => {
    await accountService.create({
      dbId: DB, name: 'Livret', type: 'epargne',
      initialBalanceCents: toCents(5000), startDate: '2026-01-01',
    });
    const h = await buildHorizon(DB, undefined, 1, 'metropole', '2026-09-01');
    expect(h.months[0].openingCents).toBe(toCents(6000));
  });
});

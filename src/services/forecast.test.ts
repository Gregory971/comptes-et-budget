import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { scheduleService } from './scheduleService';
import { budgetService } from './budgetService';
import { categoryService } from './referentialService';
import { forecastService } from './forecastService';
import { toCents } from '../utils/money';

const DB = 'test-forecast';
const AOUT = new Date(2026, 7, 15);   // ancre : août 2026

async function reset() {
  await Promise.all([
    db.operations.clear(), db.accounts.clear(), db.schedules.clear(),
    db.budgets.clear(), db.categories.clear(), db.categoryGroups.clear(),
  ]);
  return accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(2000), startDate: '2026-01-01',
  });
}

describe('projection mensuelle', () => {
  beforeEach(reset);

  it('sépare le solde réel du solde estimé', async () => {
    const [acc] = await accountService.list(DB);
    await operationService.create({
      dbId: DB, accountId: acc.id, date: '2026-08-05',
      amountCents: toCents(500), kind: 'depense', label: 'Courses',
    });
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(900), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-25',
      autoPost: false, holidayRule: 'exacte', label: 'Loyer',
    });

    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-15');
    expect(f.openingCents).toBe(toCents(2000));
    expect(f.actualCents).toBe(toCents(1500));          // 2000 − 500
    expect(f.scheduledCents).toBe(toCents(-900));
    expect(f.projectedCents).toBe(toCents(600));        // 1500 − 900
    expect(f.forecast).toHaveLength(1);
    expect(f.forecast[0].kind).toBe('echeance');
  });

  it('applique le report des jours fériés aux échéances prévues', async () => {
    const [acc] = await accountService.list(DB);
    // 15 août 2026 : samedi et Assomption → report au lundi 17.
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-15',
      autoPost: false, holidayRule: 'suivant', label: 'Assurance',
    });
    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-01');
    expect(f.forecast[0].date).toBe('2026-08-17');
    expect(f.forecast[0].shiftedFrom).toBe('2026-08-15');
    expect(f.forecast[0].shiftReason).toBeTruthy();
  });

  it('ajoute le reste à consommer des budgets, à la fin du mois', async () => {
    const [acc] = await accountService.list(DB);
    const g = await categoryService.createGroup(DB, 'Alimentation', 'depense', '🛒');
    const c = await categoryService.createCategory(DB, g.id, 'Courses');
    await operationService.create({
      dbId: DB, accountId: acc.id, date: '2026-08-05',
      amountCents: toCents(120), kind: 'depense', categoryId: c.id,
    });
    await budgetService.set(DB, c.id, toCents(400));

    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-15');
    expect(f.budgetRemainingCents).toBe(toCents(280));   // 400 − 120
    const ligne = f.forecast.find(x => x.kind === 'budget');
    expect(ligne?.date).toBe('2026-08-31');
    expect(ligne?.amountCents).toBe(toCents(-280));
    expect(f.projectedCents).toBe(toCents(1600));        // 2000 − 120 − 280
  });

  it('ne compte pas deux fois une dépense à la fois budgétée et programmée', async () => {
    const [acc] = await accountService.list(DB);
    const g = await categoryService.createGroup(DB, 'Logement', 'depense', '🏠');
    const c = await categoryService.createCategory(DB, g.id, 'Loyer');
    await budgetService.set(DB, c.id, toCents(900));
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(900), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-25', categoryId: c.id,
      autoPost: false, holidayRule: 'exacte', label: 'Loyer',
    });

    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-15');
    // Le loyer est déjà porté par l'échéance : le budget ne doit rien ajouter.
    expect(f.budgetRemainingCents).toBe(0);
    expect(f.forecast.filter(x => x.kind === 'budget')).toHaveLength(0);
    expect(f.projectedCents).toBe(toCents(1100));        // 2000 − 900
  });

  it('ignore un budget déjà dépassé', async () => {
    const [acc] = await accountService.list(DB);
    const g = await categoryService.createGroup(DB, 'Loisirs', 'depense', '🎬');
    const c = await categoryService.createCategory(DB, g.id, 'Sorties');
    await operationService.create({
      dbId: DB, accountId: acc.id, date: '2026-08-05',
      amountCents: toCents(300), kind: 'depense', categoryId: c.id,
    });
    await budgetService.set(DB, c.id, toCents(200));

    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-15');
    expect(f.budgetRemainingCents).toBe(0);
    expect(f.projectedCents).toBe(f.actualCents);
  });

  it('n’affiche pas les échéances déjà passées du mois en cours', async () => {
    const [acc] = await accountService.list(DB);
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-03',
      autoPost: false, holidayRule: 'exacte', label: 'Déjà passée',
    });
    // Au 15 août, l'échéance du 3 est derrière nous : elle relève du réel.
    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-15');
    expect(f.forecast.filter(x => x.kind === 'echeance')).toHaveLength(0);
  });

  it('projette plusieurs occurrences d’une même échéance dans le mois', async () => {
    const [acc] = await accountService.list(DB);
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(50), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-20',
      autoPost: false, holidayRule: 'exacte', label: 'Abonnement',
    });
    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-01');
    expect(f.forecast).toHaveLength(1);   // une seule occurrence tient dans août
  });

  it('s’arrête à la date de fin d’une échéance', async () => {
    const [acc] = await accountService.list(DB);
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(80), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-20', endDate: '2026-07-31',
      autoPost: false, holidayRule: 'exacte', label: 'Terminée',
    });
    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-01');
    expect(f.forecast).toHaveLength(0);
  });

  it('filtre les échéances par compte', async () => {
    const [acc] = await accountService.list(DB);
    const autre = await accountService.create({
      dbId: DB, name: 'Épargne', type: 'epargne',
      initialBalanceCents: 0, startDate: '2026-01-01',
    });
    await scheduleService.create({
      dbId: DB, accountId: autre.id, amountCents: toCents(70), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-25',
      autoPost: false, holidayRule: 'exacte', label: 'Sur l’épargne',
    });
    const surCourant = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-01');
    expect(surCourant.forecast).toHaveLength(0);

    const tousComptes = await forecastService.build(DB, undefined, AOUT, 'guadeloupe', '2026-08-01');
    expect(tousComptes.forecast).toHaveLength(1);
  });

  it('trie les prévisions par date, échéances avant estimations', async () => {
    const [acc] = await accountService.list(DB);
    const g = await categoryService.createGroup(DB, 'Divers', 'depense', '📦');
    const c = await categoryService.createCategory(DB, g.id, 'Divers');
    await budgetService.set(DB, c.id, toCents(150));
    await scheduleService.create({
      dbId: DB, accountId: acc.id, amountCents: toCents(60), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-31',
      autoPost: false, holidayRule: 'exacte', label: 'Fin de mois',
    });
    const f = await forecastService.build(DB, acc.id, AOUT, 'guadeloupe', '2026-08-01');
    // Même date (31/08) : l'échéance certaine passe avant l'estimation budgétaire.
    expect(f.forecast.map(x => x.kind)).toEqual(['echeance', 'budget']);
  });
});

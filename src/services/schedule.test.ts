import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { scheduleService, nextOccurrences, occurrenceOf } from './scheduleService';
import { toCents } from '../utils/money';
import type { Schedule } from '../types';

const DB = 'test-sched';

async function reset() {
  await Promise.all([db.operations.clear(), db.accounts.clear(), db.schedules.clear()]);
  return accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(5000), startDate: '2026-01-01',
  });
}

describe('échéances : date de fin', () => {
  beforeEach(reset);

  it('se désactive une fois la date de fin dépassée', async () => {
    const acc = await accountService.list(DB);
    const s = await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-10', endDate: '2026-09-30',
      autoPost: false, holidayRule: 'exacte', label: 'Abonnement',
    });

    await scheduleService.post(s.id, 'guadeloupe');           // août
    expect((await db.schedules.get(s.id))?.nextDate).toBe('2026-09-10');
    expect((await db.schedules.get(s.id))?.active).toBe(true);

    await scheduleService.post(s.id, 'guadeloupe');           // septembre : dernière
    const after = await db.schedules.get(s.id);
    expect(after?.nextDate).toBe('2026-10-10');               // au-delà du 30/09
    expect(after?.active).toBe(false);
    expect(await operationService.list(DB)).toHaveLength(2);
  });

  it('borne l’aperçu des prochaines occurrences', () => {
    const s = {
      nextDate: '2026-08-10', endDate: '2026-10-31',
      periodicity: 'mensuelle', holidayRule: 'exacte',
    } as Schedule;
    expect(nextOccurrences(s, 'guadeloupe', 6).map(o => o.plannedDate))
      .toEqual(['2026-08-10', '2026-09-10', '2026-10-10']);
  });

  it('sans date de fin, la programmation se poursuit', () => {
    const s = { nextDate: '2026-08-10', periodicity: 'mensuelle', holidayRule: 'exacte' } as Schedule;
    expect(nextOccurrences(s, 'metropole', 4)).toHaveLength(4);
  });
});

describe('échéances : report des jours fériés', () => {
  beforeEach(reset);

  it('comptabilise à la date reportée mais conserve la date théorique', async () => {
    const acc = await accountService.list(DB);
    // 15 août 2026 : samedi et Assomption → report au lundi 17.
    const s = await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(200), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-08-15',
      autoPost: false, holidayRule: 'suivant', label: 'Loyer',
    });

    expect(occurrenceOf((await db.schedules.get(s.id))!, 'guadeloupe').effectiveDate).toBe('2026-08-17');

    await scheduleService.post(s.id, 'guadeloupe');
    const [op] = await operationService.list(DB);
    expect(op.date).toBe('2026-08-17');                       // opération reportée

    // La prochaine échéance repart du 15, pas du 17.
    expect((await db.schedules.get(s.id))?.nextDate).toBe('2026-09-15');
    expect((await db.schedules.get(s.id))?.lastPostedDate).toBe('2026-08-17');
  });

  it('applique le calendrier du territoire choisi', async () => {
    const acc = await accountService.list(DB);
    const s = await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(50), kind: 'depense',
      periodicity: 'unique', nextDate: '2026-05-27',
      autoPost: false, holidayRule: 'suivant',
    });
    // 27 mai 2026 : férié en Guadeloupe (abolition de l'esclavage), ouvré en métropole.
    expect(occurrenceOf((await db.schedules.get(s.id))!, 'guadeloupe').effectiveDate).toBe('2026-05-28');
    expect(occurrenceOf((await db.schedules.get(s.id))!, 'metropole').effectiveDate).toBe('2026-05-27');
  });

  it('respecte la règle « date exacte »', async () => {
    const acc = await accountService.list(DB);
    const s = await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(75), kind: 'depense',
      periodicity: 'unique', nextDate: '2026-12-25',
      autoPost: false, holidayRule: 'exacte',
    });
    await scheduleService.post(s.id, 'guadeloupe');
    expect((await operationService.list(DB))[0].date).toBe('2026-12-25');
  });
});

describe('échéances : comptabilisation automatique', () => {
  beforeEach(reset);

  it('rattrape les occurrences manquées après une absence', async () => {
    const acc = await accountService.list(DB);
    await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-05-04',
      autoPost: true, holidayRule: 'exacte', label: 'Loyer',
    });

    // Application rouverte le 2 août : mai, juin et juillet sont échus.
    // L'échéance du 4 août n'est pas encore due et reste programmée.
    const posted = await scheduleService.runAutoPost(DB, 'guadeloupe', '2026-08-02');
    expect(posted).toBe(3);
    const ops = await operationService.list(DB);
    expect(ops.map(o => o.date).sort())
      .toEqual(['2026-05-04', '2026-06-04', '2026-07-04']);
    const [sched] = await scheduleService.list(DB);
    expect(sched.nextDate).toBe('2026-08-04');
    expect(sched.active).toBe(true);
  });

  it('ne touche pas aux échéances manuelles', async () => {
    const acc = await accountService.list(DB);
    await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-07-04',
      autoPost: false, holidayRule: 'exacte', label: 'Manuelle',
    });
    expect(await scheduleService.runAutoPost(DB, 'guadeloupe', '2026-08-02')).toBe(0);
    expect(await operationService.list(DB)).toHaveLength(0);
    expect(await scheduleService.pendingManual(DB, '2026-08-02')).toHaveLength(1);
  });

  it('s’arrête à la date de fin lors du rattrapage', async () => {
    const acc = await accountService.list(DB);
    await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(100), kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-05-04', endDate: '2026-06-30',
      autoPost: true, holidayRule: 'exacte',
    });
    expect(await scheduleService.runAutoPost(DB, 'guadeloupe', '2026-08-02')).toBe(2);
    expect(await operationService.list(DB)).toHaveLength(2);
  });
});

describe('échéances : champs enrichis', () => {
  beforeEach(reset);

  it('reporte référence, commentaire et rattachement sur l’opération créée', async () => {
    const acc = await accountService.list(DB);
    const s = await scheduleService.create({
      dbId: DB, accountId: acc[0].id, amountCents: toCents(300), kind: 'depense',
      periodicity: 'unique', nextDate: '2026-08-03', autoPost: false, holidayRule: 'exacte',
      label: 'Traite voiture', reference: 'PRL-4412', note: 'Crédit 48 mois',
      assetId: 'asset-1',
    });
    await scheduleService.post(s.id, 'guadeloupe');
    const [op] = await operationService.list(DB);
    expect(op.reference).toBe('PRL-4412');
    expect(op.note).toBe('Crédit 48 mois');
    expect(op.assetId).toBe('asset-1');
  });

  it('totalise les opérations rattachées à un bien', async () => {
    const acc = await accountService.list(DB);
    await operationService.create({
      dbId: DB, accountId: acc[0].id, date: '2026-08-05',
      amountCents: toCents(200), kind: 'depense', assetId: 'asset-1',
    });
    await operationService.create({
      dbId: DB, accountId: acc[0].id, date: '2026-08-06',
      amountCents: toCents(50), kind: 'depense', assetId: 'asset-1',
    });
    await operationService.create({
      dbId: DB, accountId: acc[0].id, date: '2026-08-07',
      amountCents: toCents(999), kind: 'depense',
    });
    expect(await operationService.totalForRef(DB, 'assetId', 'asset-1')).toBe(toCents(-250));
  });
});

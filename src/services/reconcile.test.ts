import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { reconcileService } from './reconcileService';
import { toCents } from '../utils/money';

const DB = 'test-rappro';
let accountId = '';

async function reset() {
  await Promise.all([db.operations.clear(), db.accounts.clear()]);
  const acc = await accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(1000), startDate: '2026-01-01',
  });
  accountId = acc.id;
}

const ajoute = (date: string, euros: number, kind: 'depense' | 'recette' = 'depense') =>
  operationService.create({ dbId: DB, accountId, date, amountCents: toCents(euros), kind });

describe('rapprochement bancaire', () => {
  beforeEach(reset);

  it('distingue le solde pointé du solde théorique', async () => {
    const a = await ajoute('2026-08-05', 100);
    await ajoute('2026-08-06', 50);
    await operationService.toggleChecked(a.id, true);

    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(s.theoreticalCents).toBe(toCents(850));   // 1000 − 100 − 50
    expect(s.checkedCents).toBe(toCents(900));       // 1000 − 100
    expect(s.pending).toHaveLength(1);
    expect(s.pendingCents).toBe(toCents(-50));
  });

  it('annonce un écart nul quand le relevé correspond', async () => {
    const a = await ajoute('2026-08-05', 100);
    await operationService.toggleChecked(a.id, true);
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(reconcileService.difference(toCents(900), s)).toBe(0);
  });

  it('chiffre exactement ce qui manque', async () => {
    // La banque annonce 880 € : 20 € prélevés que rien ne justifie dans la base.
    const a = await ajoute('2026-08-05', 100);
    await operationService.toggleChecked(a.id, true);
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(reconcileService.difference(toCents(880), s)).toBe(toCents(-20));
  });

  it('ignore ce qui suit la date du relevé', async () => {
    const a = await ajoute('2026-08-05', 100);
    await operationService.toggleChecked(a.id, true);
    const b = await ajoute('2026-09-02', 300);
    await operationService.toggleChecked(b.id, true);
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(s.checkedCents).toBe(toCents(900));
  });

  it('écarte une opération supprimée', async () => {
    const a = await ajoute('2026-08-05', 100);
    await operationService.remove(a.id);
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(s.theoreticalCents).toBe(toCents(1000));
    expect(s.pending).toHaveLength(0);
  });

  it('pointe un lot d’opérations en une fois', async () => {
    const a = await ajoute('2026-08-05', 100);
    const b = await ajoute('2026-08-06', 50);
    expect(await reconcileService.setChecked([a.id, b.id], true)).toBe(2);
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(s.pending).toHaveLength(0);
    expect(s.checkedCents).toBe(s.theoreticalCents);

    await reconcileService.setChecked([b.id], false);
    expect((await reconcileService.summary(DB, accountId, '2026-08-31')).pending).toHaveLength(1);
  });

  it('classe les opérations en attente de la plus ancienne à la plus récente', async () => {
    await ajoute('2026-08-20', 10);
    await ajoute('2026-08-02', 20);
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(s.pending.map(o => o.date)).toEqual(['2026-08-02', '2026-08-20']);
  });

  it('tient compte des virements, qui touchent bien la trésorerie', async () => {
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-10', amountCents: toCents(-200),
      kind: 'virement', transferId: 'vir-1',
    });
    const s = await reconcileService.summary(DB, accountId, '2026-08-31');
    expect(s.theoreticalCents).toBe(toCents(800));
    expect(s.pending).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { AppDB, SCHEMA_VERSION } from './db';

const NAME = 'migration-v3';

/**
 * Vérifie la migration des bases existantes (schéma v3) vers le schéma courant :
 * montants en euros flottants → centimes entiers, dates ISO horodatées → dates
 * civiles. C'est le point le plus sensible de la mise à jour : la base de
 * l'utilisateur est convertie en place, sans possibilité de retour arrière.
 */
describe('migration v3 → v6', () => {
  it('convertit montants et dates sans perte', async () => {
    // --- base au format v3, telle qu'elle existe chez l'utilisateur
    const legacy = new Dexie(NAME);
    legacy.version(1).stores({
      databases: 'id', accounts: 'id, dbId', payees: 'id, dbId',
      categoryGroups: 'id, dbId', categories: 'id, dbId, groupId',
      paymentMethods: 'id, dbId',
      operations: 'id, dbId, accountId, date, categoryId', preferences: 'id, dbId',
    });
    legacy.version(2).stores({ schedules: 'id, dbId, accountId, nextDate', budgets: 'id, dbId, categoryId' });
    legacy.version(3).stores({ assets: 'id, dbId', projects: 'id, dbId' });
    await legacy.open();

    await legacy.table('databases').add({
      id: 'b1', name: 'Perso', currency: 'EUR', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1,
    });
    await legacy.table('accounts').add({
      id: 'a1', dbId: 'b1', name: 'Courant', type: 'courant',
      initialBalance: 1500.5, startDate: '2026-01-01T00:00:00.000Z', archived: false,
    });
    await legacy.table('operations').bulkAdd([
      { id: 'o1', dbId: 'b1', accountId: 'a1', date: '2026-08-01T00:00:00.000Z', amount: -95.4, kind: 'depense', checked: false, createdAt: '2026-08-01T09:00:00.000Z' },
      { id: 'o2', dbId: 'b1', accountId: 'a1', date: '2026-08-31T00:00:00.000Z', amount: 2400, kind: 'recette', checked: true, createdAt: '2026-08-31T09:00:00.000Z' },
    ]);
    await legacy.table('schedules').add({
      id: 's1', dbId: 'b1', accountId: 'a1', amount: -39.99, kind: 'depense',
      periodicity: 'mensuelle', nextDate: '2026-09-15T00:00:00.000Z', active: true,
    });
    await legacy.table('budgets').add({ id: 'bu1', dbId: 'b1', categoryId: 'c1', monthlyAmount: 300 });
    await legacy.table('assets').add({ id: 'as1', dbId: 'b1', name: 'Voiture', type: 'vehicule', value: 8500 });
    await legacy.table('projects').add({ id: 'pr1', dbId: 'b1', name: 'Vacances', targetAmount: 2000, savedAmount: 450.75 });
    await legacy.table('payees').add({ id: 'p1', dbId: 'b1', name: 'EDF', archived: false });
    await legacy.table('categoryGroups').add({ id: 'g1', dbId: 'b1', name: 'Logement', kind: 'depense', sortOrder: 0 });
    legacy.close();

    // --- réouverture avec le schéma v4 : la migration s'exécute
    const upgraded = new AppDB(NAME);
    await upgraded.open();

    const account = await upgraded.accounts.get('a1');
    expect(account?.initialBalanceCents).toBe(150050);
    expect(account?.startDate).toBe('2026-01-01');
    expect((account as unknown as { initialBalance?: number }).initialBalance).toBeUndefined();
    expect(account?.updatedAt).toBeTruthy();

    const op1 = await upgraded.operations.get('o1');
    expect(op1?.amountCents).toBe(-9540);
    expect(op1?.date).toBe('2026-08-01');

    const op2 = await upgraded.operations.get('o2');
    expect(op2?.amountCents).toBe(240000);
    expect(op2?.date).toBe('2026-08-31');

    expect((await upgraded.schedules.get('s1'))?.amountCents).toBe(-3999);
    expect((await upgraded.schedules.get('s1'))?.nextDate).toBe('2026-09-15');
    expect((await upgraded.budgets.get('bu1'))?.monthlyAmountCents).toBe(30000);
    expect((await upgraded.assets.get('as1'))?.valueCents).toBe(850000);
    expect((await upgraded.projects.get('pr1'))?.openingSavedCents).toBe(45075);
    expect((await upgraded.categoryGroups.get('g1'))?.archived).toBe(false);
    expect((await upgraded.databases.get('b1'))?.profile).toBe('perso');
    expect((await upgraded.databases.get('b1'))?.schemaVersion).toBe(SCHEMA_VERSION);

    // v5 : les échéances existantes reçoivent les nouveaux réglages par défaut
    // (comptabilisation manuelle, report au jour ouvrable suivant), et la base
    // se voit attribuer un calendrier de jours fériés.
    const sched = await upgraded.schedules.get('s1');
    expect(sched?.autoPost).toBe(false);
    expect(sched?.holidayRule).toBe('suivant');
    expect(sched?.endDate).toBeUndefined();
    expect((await upgraded.databases.get('b1'))?.holidayRegion).toBe('metropole');

    // v6 : jour d'ancrage repris du quantième de la prochaine échéance, et
    // solde d'ouverture des projets aligné sur l'ancien « déjà épargné ».
    expect(sched?.anchorDay).toBe(Number(sched!.nextDate.slice(8, 10)));
    expect((await upgraded.projects.get('pr1'))?.openingSavedCents).toBe(45075);

    // Les index composés sont exploitables après migration.
    const aout = await upgraded.operations.where('[dbId+date]')
      .between(['b1', '2026-08-01'], ['b1', '2026-08-31'], true, true).toArray();
    expect(aout).toHaveLength(2);

    upgraded.close();
  });
});

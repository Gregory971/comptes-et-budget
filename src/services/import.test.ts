import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { payeeService } from './referentialService';
import { prepareImport, commitImport, matchPayee } from './importService';
import { toCents } from '../utils/money';
import type { StatementEntry } from '../utils/statement';

const DB = 'test-import';
let accountId = '';

async function reset() {
  await Promise.all([db.operations.clear(), db.accounts.clear(), db.payees.clear()]);
  const acc = await accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(1000), startDate: '2026-01-01',
  });
  accountId = acc.id;
}

const ligne = (date: string, label: string, euros: number, reference?: string): StatementEntry =>
  ({ date, label, amountCents: toCents(euros), reference });

describe('import d’un relevé : doublons', () => {
  beforeEach(reset);

  it('décoche une ligne déjà saisie à la main, même à quelques jours d’écart', async () => {
    // Saisie manuelle le 5, relevé daté du 7 : c'est la même opération, la
    // banque n'ayant pas la même date de comptabilisation.
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-05',
      amountCents: toCents(42.5), kind: 'depense', label: 'Carrefour',
    });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-07', 'CARREFOUR MARKET', -42.5)]);
    expect(c.duplicateOfId).toBeDefined();
    expect(c.duplicateDate).toBe('2026-08-05');
    expect(c.selected).toBe(false);
  });

  it('retient une ligne trop éloignée dans le temps', async () => {
    await operationService.create({
      dbId: DB, accountId, date: '2026-07-01',
      amountCents: toCents(42.5), kind: 'depense',
    });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-07', 'CARREFOUR', -42.5)]);
    expect(c.duplicateOfId).toBeUndefined();
    expect(c.selected).toBe(true);
  });

  it('ne fait pas absorber deux lignes identiques par une seule opération', async () => {
    // Deux cafés le même jour au même prix : une seule saisie existe, donc une
    // seule ligne est un doublon — la seconde doit être importée.
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-05', amountCents: toCents(3.2), kind: 'depense',
    });
    const cs = await prepareImport(DB, accountId, [
      ligne('2026-08-05', 'CAFE', -3.2),
      ligne('2026-08-05', 'CAFE', -3.2),
    ]);
    expect(cs.filter(c => c.duplicateOfId).length).toBe(1);
    expect(cs.filter(c => c.selected).length).toBe(1);
  });

  it('tranche par la référence quand plusieurs montants coïncident', async () => {
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-04', amountCents: toCents(50), kind: 'depense',
      reference: 'CHQ-77',
    });
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-06', amountCents: toCents(50), kind: 'depense',
      reference: 'CHQ-88',
    });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'CHEQUE', -50, 'chq-88')]);
    expect(c.duplicateDate).toBe('2026-08-06');
  });

  it('ignore une opération supprimée : elle ne bloque plus l’import', async () => {
    const op = await operationService.create({
      dbId: DB, accountId, date: '2026-08-05', amountCents: toCents(42.5), kind: 'depense',
    });
    await operationService.remove(op.id);
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'CARREFOUR', -42.5)]);
    expect(c.selected).toBe(true);
  });

  it('ne confond pas une dépense et une recette de même montant', async () => {
    await operationService.create({
      dbId: DB, accountId, date: '2026-08-05', amountCents: toCents(42.5), kind: 'recette',
    });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'ACHAT', -42.5)]);
    expect(c.duplicateOfId).toBeUndefined();
  });
});

describe('import d’un relevé : classement automatique', () => {
  beforeEach(reset);

  it('reconnaît un tiers connu dans le libellé de la banque', async () => {
    const payee = await payeeService.create(DB, 'Carrefour');
    await payeeService.update(payee.id, { defaultCategoryId: 'cat-courses' });
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'PAIEMENT CB CARREFOUR 0805', -42.5)]);
    expect(c.payeeId).toBe(payee.id);
    expect(c.categoryId).toBe('cat-courses');
  });

  it('laisse la ligne sans catégorie plutôt que d’en inventer une', async () => {
    await payeeService.create(DB, 'Carrefour');
    const [c] = await prepareImport(DB, accountId, [ligne('2026-08-05', 'BOULANGERIE DU BOURG', -4.2)]);
    expect(c.payeeId).toBeUndefined();
    expect(c.categoryId).toBeUndefined();
  });

  it('retient le nom le plus long en cas de recouvrement', () => {
    const p = (id: string, name: string) =>
      ({ id, dbId: DB, name, archived: false, updatedAt: '' });
    const payees = [p('1', 'Total'), p('2', 'Total Energies')];
    expect(matchPayee('PRLV TOTAL ENERGIES 08/26', payees)?.id).toBe('2');
  });

  it('ignore les tiers au nom trop court pour être reconnus sans risque', () => {
    const payees = [{ id: '1', dbId: DB, name: 'AB', archived: false, updatedAt: '' }];
    expect(matchPayee('FACTURE CABINET', payees)).toBeUndefined();
  });
});

describe('import d’un relevé : écriture', () => {
  beforeEach(reset);

  it('n’écrit que les lignes retenues, avec le bon signe', async () => {
    const candidats = await prepareImport(DB, accountId, [
      ligne('2026-08-05', 'ACHAT', -42.5),
      ligne('2026-08-06', 'SALAIRE', 2350),
      ligne('2026-08-07', 'A IGNORER', -9),
    ]);
    candidats[2].selected = false;

    const res = await commitImport(DB, accountId, candidats);
    expect(res).toMatchObject({ imported: 2, skipped: 1 });

    const ops = await operationService.list(DB);
    expect(ops).toHaveLength(2);
    expect(ops.find(o => o.label === 'ACHAT')?.amountCents).toBe(toCents(-42.5));
    expect(ops.find(o => o.label === 'ACHAT')?.kind).toBe('depense');
    expect(ops.find(o => o.label === 'SALAIRE')?.amountCents).toBe(toCents(2350));
    expect(ops.find(o => o.label === 'SALAIRE')?.kind).toBe('recette');
    // Le lot est traçable : chaque opération porte la même note d'import.
    expect(new Set(ops.map(o => o.note)).size).toBe(1);
  });

  it('rend le relevé rejouable : le second import ne double rien', async () => {
    const entries = [ligne('2026-08-05', 'ACHAT', -42.5), ligne('2026-08-06', 'SALAIRE', 2350)];
    await commitImport(DB, accountId, await prepareImport(DB, accountId, entries));
    const seconde = await prepareImport(DB, accountId, entries);
    expect(seconde.every(c => c.duplicateOfId && !c.selected)).toBe(true);
    await commitImport(DB, accountId, seconde);
    expect(await operationService.list(DB)).toHaveLength(2);
  });
});

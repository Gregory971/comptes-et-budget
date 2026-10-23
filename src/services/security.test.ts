// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { securityService } from './securityService';
import { currencyService } from './currencyService';
import { categoryService } from './referentialService';
import { reportService, periodRange } from './reportService';
import { backupService } from './backupService';

const DB = 'base-titres';

async function reset() {
  await Promise.all(db.tables.map(t => t.clear()));
}

async function titre(name = 'Action Alpha') {
  return securityService.create({ dbId: DB, name, symbol: 'alp' });
}

const compte = (over: object = {}) => accountService.create({
  dbId: DB, name: 'Courant', type: 'courant', initialBalanceCents: 1_000_000, startDate: '2026-01-01', ...over,
});

describe('titres', () => {
  beforeEach(reset);

  it('crée un titre, met le code en majuscules et refuse un code en double', async () => {
    const t = await titre();
    expect(t.symbol).toBe('ALP');
    await expect(securityService.create({ dbId: DB, name: 'Autre', symbol: 'ALP' })).rejects.toThrow(/déjà le code ALP/);
    await expect(securityService.create({ dbId: DB, name: '  ' })).rejects.toThrow(/nom/);
  });

  it('un titre archivé libère son code', async () => {
    const t = await titre();
    await securityService.archive(t.id);
    await securityService.create({ dbId: DB, name: 'Remplaçant', symbol: 'ALP' });
    expect((await securityService.list(DB)).map(s => s.name)).toEqual(['Remplaçant']);
    expect(await securityService.list(DB, true)).toHaveLength(2);
  });

  it('ne supprime que les titres sans mouvement', async () => {
    const t = await titre();
    await securityService.setPrice({ dbId: DB, securityId: t.id, date: '2026-01-02', price: 10 });
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10 });
    await expect(securityService.remove(t.id)).rejects.toThrow(/archivez/);
    const vide = await securityService.create({ dbId: DB, name: 'Vide' });
    await securityService.setPrice({ dbId: DB, securityId: vide.id, date: '2026-01-02', price: 1 });
    await securityService.remove(vide.id);
    expect(await db.securities.count()).toBe(1);
    expect(await db.securityPrices.where('securityId').equals(vide.id).count()).toBe(0);
  });
});

describe('mouvements', () => {
  beforeEach(reset);

  it('calcule le montant brut d’un achat et la position', async () => {
    const t = await titre();
    const a = await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50, feesCents: 150 });
    expect(a.amountCents).toBe(50_000);
    const [s] = await securityService.statuses(DB);
    expect(s.position.quantity).toBe(10);
    expect(s.position.costCents).toBe(50_150);
  });

  it('refuse une vente à découvert sans rien écrire', async () => {
    const t = await titre();
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 5, unitPrice: 10 });
    await expect(securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-02-10', type: 'vente', quantity: 6, unitPrice: 12 }))
      .rejects.toThrow(/ne détenez que 5/);
    expect(await db.securityTxs.count()).toBe(1);
  });

  it('refuse une vente antidatée avant l’achat', async () => {
    const t = await titre();
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-03-10', type: 'achat', quantity: 5, unitPrice: 10 });
    await expect(securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-02-01', type: 'vente', quantity: 1, unitPrice: 12 }))
      .rejects.toThrow(/Vente impossible/);
  });

  it('refuse un cours nul à l’achat et oriente vers l’ajustement', async () => {
    const t = await titre();
    await expect(securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 5, unitPrice: 0 }))
      .rejects.toThrow(/Ajuster les parts/);
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'ajustement', quantity: 5 });
    expect((await securityService.statuses(DB))[0].position.quantity).toBe(5);
  });

  it('refuse un titre inconnu ou d’une autre base et une date invalide', async () => {
    const t = await titre();
    await expect(securityService.addTx({ dbId: 'autre', securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 1 })).rejects.toThrow(/introuvable/);
    await expect(securityService.addTx({ dbId: DB, securityId: t.id, date: '10/01/2026', type: 'achat', quantity: 1, unitPrice: 1 })).rejects.toThrow(/date/);
  });

  it('refuse de supprimer un achat dont une vente dépend', async () => {
    const t = await titre();
    const a = await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 5, unitPrice: 10 });
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-02-10', type: 'vente', quantity: 5, unitPrice: 12 });
    await expect(securityService.removeTx(a.id)).rejects.toThrow(/Suppression impossible/);
    expect(await db.securityTxs.count()).toBe(2);
  });
});

describe('cotations et synthèse', () => {
  beforeEach(reset);

  it('utilise le dernier cours saisi et remplace celui du même jour', async () => {
    const t = await titre();
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    await securityService.setPrice({ dbId: DB, securityId: t.id, date: '2026-02-01', price: 55 });
    await securityService.setPrice({ dbId: DB, securityId: t.id, date: '2026-03-01', price: 60 });
    await securityService.setPrice({ dbId: DB, securityId: t.id, date: '2026-03-01', price: 62 });   // même jour : remplace
    expect(await securityService.prices(t.id)).toHaveLength(2);
    const [s] = await securityService.statuses(DB);
    expect(s.position.marketValueCents).toBe(62_000);
    expect(s.position.latentCents).toBe(12_000);
    expect(s.priceDate).toBe('2026-03-01');
  });

  it('sans cotation, retient le dernier cours des mouvements', async () => {
    const t = await titre();
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-02-10', type: 'achat', quantity: 10, unitPrice: 70 });
    const [s] = await securityService.statuses(DB);
    expect(s.position.lastPrice).toBe(70);
  });

  it('refuse un cours négatif ou une date invalide', async () => {
    const t = await titre();
    await expect(securityService.setPrice({ dbId: DB, securityId: t.id, date: '2026-01-10', price: -1 })).rejects.toThrow(/positif/);
    await expect(securityService.setPrice({ dbId: DB, securityId: t.id, date: 'x', price: 1 })).rejects.toThrow(/date/);
  });

  it('totalise le portefeuille', async () => {
    const a = await titre('A'); const b = await securityService.create({ dbId: DB, name: 'B' });
    await securityService.addTx({ dbId: DB, securityId: a.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    await securityService.addTx({ dbId: DB, securityId: b.id, date: '2026-01-10', type: 'achat', quantity: 2, unitPrice: 100 });
    await securityService.addTx({ dbId: DB, securityId: b.id, date: '2026-02-10', type: 'dividende', amountCents: 700 });
    await securityService.setPrice({ dbId: DB, securityId: a.id, date: '2026-03-01', price: 60 });
    await securityService.setPrice({ dbId: DB, securityId: b.id, date: '2026-03-01', price: 90 });
    expect(await securityService.totals(DB)).toEqual({
      valueCents: 60_000 + 18_000, costCents: 50_000 + 20_000, latentCents: 10_000 - 2_000,
      realizedCents: 0, dividendsCents: 700,
    });
  });
});

describe('écritures bancaires', () => {
  beforeEach(reset);

  it('un achat crée une dépense de brut + frais, ventilée pour isoler les frais', async () => {
    const c = await compte();
    const g = await categoryService.createGroup(DB, 'Placements', 'depense');
    const placements = (await categoryService.createCategory(DB, g.id, 'Achat de titres', '📈')).id;
    const frais = (await categoryService.createCategory(DB, g.id, 'Frais de courtage', '💶')).id;
    const t = await titre();
    const tx = await securityService.addTx({
      dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50, feesCents: 150,
      bank: { accountId: c.id, categoryId: placements, feesCategoryId: frais },
    });
    expect(tx.operationIds).toHaveLength(1);
    const op = (await db.operations.get(tx.operationIds![0]))!;
    expect(op.amountCents).toBe(-50_150);
    expect(op.kind).toBe('depense');
    expect(op.splits?.map(s => [s.categoryId, s.amountCents])).toEqual([[placements, -50_000], [frais, -150]]);
    expect((await accountService.balances(DB))[c.id]).toBe(1_000_000 - 50_150);
    const bilan = await reportService.build(DB, undefined, periodRange(new Date(2026, 0, 15), 'mois'));
    expect(bilan.byCategory.map(x => [x.name, x.valueCents])).toEqual([['Achat de titres', 50_000], ['Frais de courtage', 150]]);
  });

  it('un achat sans catégorie de frais reste une seule ligne', async () => {
    const c = await compte();
    const t = await titre();
    const tx = await securityService.addTx({
      dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50, feesCents: 150, bank: { accountId: c.id },
    });
    const op = (await db.operations.get(tx.operationIds![0]))!;
    expect(op.amountCents).toBe(-50_150);
    expect(op.splits).toBeUndefined();
  });

  it('une vente crédite le produit net des frais, un dividende son montant', async () => {
    const c = await compte();
    const t = await titre();
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    const v = await securityService.addTx({
      dbId: DB, securityId: t.id, date: '2026-02-10', type: 'vente', quantity: 4, unitPrice: 60, feesCents: 100, bank: { accountId: c.id },
    });
    const d = await securityService.addTx({
      dbId: DB, securityId: t.id, date: '2026-03-10', type: 'dividende', amountCents: 1_234, bank: { accountId: c.id },
    });
    expect((await db.operations.get(v.operationIds![0]))?.amountCents).toBe(24_000 - 100);
    expect((await db.operations.get(d.operationIds![0]))?.amountCents).toBe(1_234);
    expect((await accountService.balances(DB))[c.id]).toBe(1_000_000 + 23_900 + 1_234);
  });

  it('un ajustement ne touche jamais aux comptes', async () => {
    const c = await compte();
    const t = await titre();
    await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'ajustement', quantity: 5, bank: { accountId: c.id } });
    expect(await db.operations.count()).toBe(0);
  });

  it('supprimer le mouvement supprime son écriture bancaire', async () => {
    const c = await compte();
    const t = await titre();
    const tx = await securityService.addTx({ dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10, bank: { accountId: c.id } });
    await securityService.removeTx(tx.id);
    expect(await db.securityTxs.count()).toBe(0);
    expect((await db.operations.get(tx.operationIds![0]))?.deletedAt).toBeTruthy();
    expect((await accountService.balances(DB))[c.id]).toBe(1_000_000);
  });

  it('rien n’est écrit si l’écriture bancaire est refusée', async () => {
    const t = await titre();
    await db.databases.put({ id: DB, name: 'b', profile: 'perso', currency: 'EUR', createdAt: '', schemaVersion: 6, holidayRegion: 'metropole', updatedAt: '' });
    await currencyService.create({ dbId: DB, code: 'USD', name: 'Dollar', rate: 0.9 });
    const us = await compte({ name: 'US', currency: 'USD' });
    await expect(securityService.addTx({
      dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10, bank: { accountId: us.id },
    })).rejects.toThrow(/devise de la base/);
    await expect(securityService.addTx({
      dbId: DB, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10, bank: { accountId: 'inconnu' },
    })).rejects.toThrow(/introuvable/);
    expect(await db.securityTxs.count()).toBe(0);
    expect(await db.operations.count()).toBe(0);
  });
});

describe('sauvegarde', () => {
  it('titres, mouvements et cotations font l’aller-retour', async () => {
    await reset();
    const base = await (await import('./dbService')).dbService.create('Base', 'perso');
    const t = await securityService.create({ dbId: base.id, name: 'Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 2, unitPrice: 10 });
    await securityService.setPrice({ dbId: base.id, securityId: t.id, date: '2026-02-01', price: 12 });
    const copie = await backupService.export();
    expect([copie.securities?.length, copie.securityTxs?.length, copie.securityPrices?.length]).toEqual([1, 1, 1]);
    await Promise.all([db.securities.clear(), db.securityTxs.clear(), db.securityPrices.clear()]);
    await backupService.restore(copie, 'replace', false);
    const [s] = await securityService.statuses(base.id);
    expect(s.position.quantity).toBe(2);
    expect(s.position.lastPrice).toBe(12);
  });
});

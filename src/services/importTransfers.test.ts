// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { loanService } from './loanService';
import { currencyService } from './currencyService';
import { reportService, periodRange } from './reportService';
import { commitImport, prepareImport } from './importService';
import type { Database } from '../types';

let base: Database;
let courant: string;
let livret: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base virements import', 'perso');
  const mk = (name: string, over: object = {}) => accountService.create({
    dbId: base.id, name, type: 'courant', initialBalanceCents: 100_000, startDate: '2026-01-01', ...over,
  }).then(a => a.id);
  courant = await mk('Courant');
  livret = await mk('Livret', { type: 'epargne' });
});

const ligne = (date: string, amountCents: number, label = 'VIR LIVRET') => ({ date, label, amountCents });
const existante = (over: object = {}) => operationService.create({
  dbId: base.id, accountId: livret, date: '2026-08-05', kind: 'recette', amountCents: 20_000, label: 'Versement', ...over,
});
const preparer = (lignes = [ligne('2026-08-06', -20_000)]) => prepareImport(base.id, courant, lignes);

describe('repérage de l’autre moitié d’un virement', () => {
  it('propose l’opération d’un autre compte, de montant opposé, à quelques jours près', async () => {
    const op = await existante();
    const [c] = await preparer();
    expect(c.transferCandidate).toMatchObject({ operationId: op.id, accountId: livret, accountName: 'Livret', date: '2026-08-05' });
    expect(c.linkTransfer).toBeFalsy();                      // une suggestion : rien n'est lié d'office
    expect(c.selected).toBe(true);
  });

  it.each([
    ['même sens', { kind: 'depense', amountCents: 20_000 }],
    ['autre montant', { amountCents: 19_999 }],
    ['trop ancienne', { date: '2026-07-20' }],
    ['trop récente', { date: '2026-08-20' }],
  ])('ignore une opération : %s', async (_nom, over) => {
    await existante(over);
    expect((await preparer())[0].transferCandidate).toBeUndefined();
  });

  it('ignore les opérations supprimées, déjà en virement ou du même compte', async () => {
    const supprimee = await existante();
    await operationService.remove(supprimee.id);
    await existante({ kind: 'virement', amountCents: 20_000 });
    await operationService.create({ dbId: base.id, accountId: courant, date: '2026-08-05', kind: 'recette', amountCents: 20_000 });
    expect((await preparer())[0].transferCandidate).toBeUndefined();
  });

  it('ignore les comptes archivés, les prêts et les devises différentes', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const us = await accountService.create({ dbId: base.id, name: 'US', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01', currency: 'USD' });
    await operationService.create({ dbId: base.id, accountId: us.id, date: '2026-08-05', kind: 'recette', amountCents: 20_000 });
    const pret = await loanService.create({
      dbId: base.id, name: 'Prêt', loanDate: '2026-01-01', principalCents: 120_000, rateBp: 0, months: 12,
      firstPaymentDate: '2026-02-01', insuranceMonthlyCents: 0, fundingAccountId: courant, autoPost: false,
    });
    await operationService.create({ dbId: base.id, accountId: pret.id, date: '2026-08-05', kind: 'recette', amountCents: 20_000 });
    const vieux = await accountService.create({ dbId: base.id, name: 'Vieux', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    await operationService.create({ dbId: base.id, accountId: vieux.id, date: '2026-08-05', kind: 'recette', amountCents: 20_000 });
    await accountService.archive(vieux.id);
    expect((await preparer())[0].transferCandidate).toBeUndefined();
  });

  it('choisit l’opération la plus proche en date et n’utilise chaque opération qu’une fois', async () => {
    const proche = await existante({ date: '2026-08-06' });
    await existante({ date: '2026-08-03' });
    const [a, b] = await preparer([ligne('2026-08-06', -20_000), ligne('2026-08-06', -20_000)]);
    expect(a.transferCandidate?.operationId).toBe(proche.id);
    expect(b.transferCandidate?.operationId).not.toBe(proche.id);
    expect(b.transferCandidate).toBeDefined();
  });

  it('ne cherche pas de virement à une ligne déjà saisie (doublon)', async () => {
    await existante();
    await operationService.create({ dbId: base.id, accountId: courant, date: '2026-08-06', kind: 'depense', amountCents: 20_000 });
    const [c] = await preparer();
    expect(c.duplicateOfId).toBeDefined();
    expect(c.transferCandidate).toBeUndefined();
  });
});

describe('liaison à la confirmation', () => {
  it('écrit un volet de virement et convertit l’opération existante en l’autre volet', async () => {
    const cat = await existante({ categoryId: 'une-categorie' });
    const [c] = await preparer();
    const res = await commitImport(base.id, courant, [{ ...c, linkTransfer: true }]);
    expect(res).toMatchObject({ imported: 1, transfersLinked: 1 });

    const ops = await db.operations.toArray();
    const volet = ops.find(o => o.accountId === courant)!;
    const autre = ops.find(o => o.id === cat.id)!;
    expect(volet).toMatchObject({ kind: 'virement', amountCents: -20_000 });
    expect(autre).toMatchObject({ kind: 'virement', amountCents: 20_000 });
    expect(volet.transferId).toBeTruthy();
    expect(autre.transferId).toBe(volet.transferId);
    expect(autre.categoryId).toBeUndefined();               // un virement n'a pas de catégorie
    expect(ops).toHaveLength(2);                            // aucune écriture en double
  });

  it('équilibre les comptes (le virement se compense) et reste hors des bilans', async () => {
    await existante();
    // Avant : seule la moitié « crédit » du virement est saisie, le total est faussé de +200 €.
    expect(await accountService.totalBalance(base.id)).toBe(220_000);
    const [c] = await preparer();
    await commitImport(base.id, courant, [{ ...c, linkTransfer: true }]);
    // Après : les deux volets se compensent, le total retombe sur la somme des soldes initiaux.
    expect(await accountService.totalBalance(base.id)).toBe(200_000);
    const bilan = await reportService.build(base.id, undefined, periodRange(new Date(2026, 7, 15), 'mois'));
    expect(bilan.depensesCents).toBe(0);
    expect(bilan.recettesCents).toBe(0);
  });

  it('sans case cochée, importe une opération ordinaire et ne touche pas à l’autre', async () => {
    const op = await existante({ categoryId: 'une-categorie' });
    const [c] = await preparer();
    const res = await commitImport(base.id, courant, [c]);
    expect(res.transfersLinked).toBe(0);
    const ops = await db.operations.toArray();
    expect(ops.find(o => o.accountId === courant)?.kind).toBe('depense');
    expect(ops.find(o => o.id === op.id)).toMatchObject({ kind: 'recette', categoryId: 'une-categorie' });
  });

  it('retombe sur une importation ordinaire si l’autre opération a changé entre-temps', async () => {
    for (const changement of [
      (id: string) => operationService.remove(id),
      (id: string) => operationService.update(id, { amountCents: 5_000 }),
    ]) {
      await Promise.all([db.operations.clear()]);
      const op = await existante();
      const [c] = await preparer();
      await changement(op.id);
      const res = await commitImport(base.id, courant, [{ ...c, linkTransfer: true }]);
      expect(res).toMatchObject({ imported: 1, transfersLinked: 0 });
      expect((await db.operations.toArray()).find(o => o.accountId === courant)?.kind).toBe('depense');
    }
  });

  it('ne lie pas une ligne non retenue', async () => {
    await existante();
    const [c] = await preparer();
    const res = await commitImport(base.id, courant, [{ ...c, linkTransfer: true, selected: false }]);
    expect(res).toMatchObject({ imported: 0, transfersLinked: 0 });
    expect((await db.operations.toArray())[0].kind).toBe('recette');
  });

  it('n’apprend aucune règle de classement d’un virement lié', async () => {
    await existante();
    const [c] = await preparer();
    await commitImport(base.id, courant, [{ ...c, linkTransfer: true, categoryId: 'x' }]);
    expect(await db.categorizationRules.count()).toBe(0);
  });
});

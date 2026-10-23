// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { loanService } from './loanService';
import { currencyService } from './currencyService';
import { payeeService } from './referentialService';
import { assetService, projectService } from './patrimoineService';
import { reportService, periodRange } from './reportService';
import { accountEvolution, lastMonths, monthLabel, monthlySeries, topN } from './trendService';
import type { Database } from '../types';

let base: Database;
let courant: string;
let livret: string;
const ANCRE = new Date(2026, 9, 23);        // octobre 2026

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base tendances', 'perso');
  courant = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 100_000, startDate: '2020-01-01' })).id;
  livret = (await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 50_000, startDate: '2020-01-01' })).id;
});

const op = (date: string, amountCents: number, kind: 'depense' | 'recette' = 'depense', over: object = {}) =>
  operationService.create({ dbId: base.id, accountId: courant, date, kind, amountCents, ...over });

describe('mois', () => {
  it('liste les derniers mois du plus ancien au plus récent, bornes comprises', () => {
    const m = lastMonths(3, ANCRE);
    expect(m.map(x => x.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m[0]).toMatchObject({ first: '2026-08-01', last: '2026-08-31' });
    expect(m[1].last).toBe('2026-09-30');
  });
  it('traverse le changement d’année et gère février', () => {
    const m = lastMonths(4, new Date(2024, 1, 10));
    expect(m.map(x => x.key)).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
    expect(m[3].last).toBe('2024-02-29');
    expect(lastMonths(12, ANCRE)).toHaveLength(12);
  });
  it('libelle un mois en français', () => {
    expect(monthLabel('2026-03')).toBe('mars 26');
    expect(monthLabel('2025-12')).toBe('déc. 25');
  });
});

describe('recettes et dépenses mensuelles', () => {
  it('somme par mois, remplit les mois sans écriture et ignore virements et supprimées', async () => {
    await op('2026-08-05', 1_000);
    await op('2026-08-20', 500);
    await op('2026-10-02', 200_000, 'recette');
    const supprimee = await op('2026-09-10', 9_999);
    await operationService.remove(supprimee.id);
    await transferService.create({ dbId: base.id, fromAccountId: courant, toAccountId: livret, date: '2026-09-15', amountCents: 7_777 });
    const s = await monthlySeries(base.id, undefined, 3, ANCRE);
    expect(s.map(p => [p.key, p.recettesCents, p.depensesCents])).toEqual([
      ['2026-08', 0, 1_500], ['2026-09', 0, 0], ['2026-10', 200_000, 0],
    ]);
    expect(s[0].mois).toBe('août 26');
  });

  it('ignore ce qui sort de la fenêtre et filtre par compte', async () => {
    await op('2026-07-31', 5_000);                           // juste avant la fenêtre
    await op('2026-08-01', 100);
    await operationService.create({ dbId: base.id, accountId: livret, date: '2026-08-02', kind: 'depense', amountCents: 300 });
    expect((await monthlySeries(base.id, undefined, 3, ANCRE))[0].depensesCents).toBe(400);
    expect((await monthlySeries(base.id, livret, 3, ANCRE))[0].depensesCents).toBe(300);
  });

  it('additionne en devise de la base, un compte seul restant dans sa devise', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const us = (await accountService.create({ dbId: base.id, name: 'US', type: 'courant', initialBalanceCents: 0, startDate: '2020-01-01', currency: 'USD' })).id;
    await operationService.create({ dbId: base.id, accountId: us, date: '2026-10-02', kind: 'depense', amountCents: 10_000 });
    expect((await monthlySeries(base.id, undefined, 1, ANCRE))[0].depensesCents).toBe(5_000);
    expect((await monthlySeries(base.id, us, 1, ANCRE))[0].depensesCents).toBe(10_000);
  });
});

describe('évolution des comptes', () => {
  it('donne le solde de fin de chaque mois, soldes initiaux et opérations antérieures compris', async () => {
    await op('2026-06-10', 10_000);                          // avant la fenêtre : pèse sur le solde de départ
    await op('2026-09-05', 20_000);
    await op('2026-10-10', 5_000, 'recette');
    const e = await accountEvolution(base.id, undefined, 3, ANCRE);
    expect(e.keys).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(e.series.find(s => s.name === 'Courant')?.values).toEqual([90_000, 70_000, 75_000]);
    expect(e.series.find(s => s.name === 'Livret')?.values).toEqual([50_000, 50_000, 50_000]);
    expect(e.total).toEqual([140_000, 120_000, 125_000]);
  });

  it('compte une opération datée du dernier jour du mois dans ce mois', async () => {
    await op('2026-09-30', 1_000);
    const e = await accountEvolution(base.id, courant, 2, ANCRE);
    expect(e.series[0].values).toEqual([99_000, 99_000]);
  });

  it('se limite à un compte quand on le demande', async () => {
    const e = await accountEvolution(base.id, livret, 2, ANCRE);
    expect(e.series.map(s => s.name)).toEqual(['Livret']);
  });

  it('exclut les prêts et les comptes masqués, comme le solde total', async () => {
    await loanService.create({ dbId: base.id, name: 'Prêt', loanDate: '2026-01-01', principalCents: 120_000, rateBp: 0, months: 12, firstPaymentDate: '2027-01-01', insuranceMonthlyCents: 0, fundingAccountId: courant, autoPost: false });
    await accountService.create({ dbId: base.id, name: 'Caché', type: 'epargne', initialBalanceCents: 1, startDate: '2020-01-01', hidden: true });
    expect((await accountEvolution(base.id, undefined, 2, ANCRE)).series.map(s => s.name).sort()).toEqual(['Courant', 'Livret']);
  });

  it('convertit les comptes en devise étrangère dans le total, pas dans une vue d’un seul compte', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const us = (await accountService.create({ dbId: base.id, name: 'US', type: 'courant', initialBalanceCents: 20_000, startDate: '2020-01-01', currency: 'USD' })).id;
    const tous = await accountEvolution(base.id, undefined, 1, ANCRE);
    expect(tous.series.find(s => s.name === 'US')?.values).toEqual([10_000]);
    expect((await accountEvolution(base.id, us, 1, ANCRE)).series[0].values).toEqual([20_000]);
  });

  it('une base sans compte donne des séries vides', async () => {
    await db.accounts.clear();
    expect((await accountEvolution(base.id, undefined, 3, ANCRE)).series).toEqual([]);
  });
});

describe('regroupement « Autres »', () => {
  const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `T${i}`, valueCents: (n - i) * 100 }));
  it('garde les premières lignes et regroupe le reste', () => {
    const r = topN(lignes(12), 8);
    expect(r).toHaveLength(9);
    expect(r[8]).toEqual({ name: 'Autres', valueCents: (4 + 3 + 2 + 1) * 100 });
    expect(r.reduce((s, d) => s + d.valueCents, 0)).toBe(lignes(12).reduce((s, d) => s + d.valueCents, 0));
  });
  it('ne change rien sous le seuil et n’ajoute pas un « Autres » vide', () => {
    expect(topN(lignes(8), 8)).toHaveLength(8);
    expect(topN([...lignes(8), { name: 'Zéro', valueCents: 0 }], 8)).toHaveLength(8);
  });
});

describe('bilan par tiers et par projet', () => {
  const mois = periodRange(new Date(2026, 7, 15), 'mois');

  it('répartit les dépenses par tiers, avec « Sans tiers » pour les autres', async () => {
    const a = await payeeService.create(base.id, 'Carrefour');
    const b = await payeeService.create(base.id, 'EDF');
    await op('2026-08-05', 4_000, 'depense', { payeeId: a.id });
    await op('2026-08-06', 1_000, 'depense', { payeeId: a.id });
    await op('2026-08-07', 9_000, 'depense', { payeeId: b.id });
    await op('2026-08-08', 700);
    await op('2026-08-09', 99_999, 'recette', { payeeId: b.id });               // une recette n'est pas une dépense
    const r = await reportService.build(base.id, undefined, mois);
    expect(r.byPayee).toEqual([{ name: 'EDF', valueCents: 9_000 }, { name: 'Carrefour', valueCents: 5_000 }, { name: 'Sans tiers', valueCents: 700 }]);
  });

  it('répartit les dépenses rattachées à un projet ou à un bien, et ignore les autres', async () => {
    const p = await projectService.create(base.id, { name: 'Vacances', targetAmountCents: 100_000, openingSavedCents: 0 });
    const m = await assetService.create(base.id, { name: 'Appartement', type: 'immobilier', valueCents: 1 });
    await op('2026-08-05', 3_000, 'depense', { projectId: p.id });
    await op('2026-08-06', 2_000, 'depense', { assetId: m.id });
    await op('2026-08-07', 8_000);                                              // sans rattachement
    const r = await reportService.build(base.id, undefined, mois);
    expect(r.byLink).toEqual([{ name: 'Projet : Vacances', valueCents: 3_000 }, { name: 'Bien : Appartement', valueCents: 2_000 }]);
  });

  it('exclut les virements et reste cohérent avec le total des dépenses', async () => {
    await op('2026-08-05', 1_500);
    await transferService.create({ dbId: base.id, fromAccountId: courant, toAccountId: livret, date: '2026-08-06', amountCents: 50_000 });
    const r = await reportService.build(base.id, undefined, mois);
    expect(r.byPayee.reduce((s, d) => s + d.valueCents, 0)).toBe(r.depensesCents);
  });
});

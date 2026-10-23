// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { categoryService, payeeService, paymentMethodService } from './referentialService';
import { currencyService } from './currencyService';
import { exportService, type ExportScope } from './exportService';
import { DEFAULT_CSV } from '../utils/exportFormats';
import { parseStatement } from '../utils/statement';
import type { Database } from '../types';

let base: Database;
let ids: { courant: string; epargne: string; alim: string; entretien: string };

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base export', 'perso');
  const g = await categoryService.createGroup(base.id, 'Vie courante', 'depense');
  ids = {
    courant: (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id,
    epargne: (await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 0, startDate: '2026-01-01' })).id,
    alim: (await categoryService.createCategory(base.id, g.id, 'Alimentation', '🛒')).id,
    entretien: (await categoryService.createCategory(base.id, g.id, 'Entretien', '🧹')).id,
  };
});

const portee = (over: Partial<ExportScope> = {}): ExportScope => ({ dbId: base.id, splitDetail: false, includeTransfers: true, ...over });
const options = { csv: { ...DEFAULT_CSV, bom: false }, dateFormat: 'fr' as const };

describe('lignes d’export', () => {
  it('résout les noms et trie du plus ancien au plus récent', async () => {
    const payee = await payeeService.resolveByName(base.id, 'Carrefour');
    const cb = await paymentMethodService.create(base.id, 'CB');
    await operationService.create({ dbId: base.id, accountId: ids.courant, date: '2026-08-10', kind: 'depense', amountCents: 4250, categoryId: ids.alim, payeeId: payee, paymentMethodId: cb.id, label: 'Courses', reference: '12', note: 'samedi' });
    await operationService.create({ dbId: base.id, accountId: ids.courant, date: '2026-08-05', kind: 'recette', amountCents: 100_000, label: 'Salaire' });
    const rows = await exportService.rows(portee());
    expect(rows.map(r => r.date)).toEqual(['2026-08-05', '2026-08-10']);
    expect(rows[1]).toMatchObject({
      account: 'Courant', currency: 'EUR', payee: 'Carrefour', category: 'Alimentation', method: 'CB',
      reference: '12', label: 'Courses', note: 'samedi', amountCents: -4250, checked: false,
    });
  });

  it('filtre par compte et par période, bornes incluses', async () => {
    for (const [d, a] of [['2026-07-31', ids.courant], ['2026-08-01', ids.courant], ['2026-08-31', ids.epargne], ['2026-09-01', ids.courant]] as const) {
      await operationService.create({ dbId: base.id, accountId: a, date: d, kind: 'depense', amountCents: 100 });
    }
    expect((await exportService.rows(portee({ from: '2026-08-01', to: '2026-08-31' }))).map(r => r.date)).toEqual(['2026-08-01', '2026-08-31']);
    expect(await exportService.rows(portee({ accountId: ids.epargne }))).toHaveLength(1);
    expect(await exportService.rows(portee())).toHaveLength(4);
  });

  it('exclut les opérations supprimées', async () => {
    const op = await operationService.create({ dbId: base.id, accountId: ids.courant, date: '2026-08-05', kind: 'depense', amountCents: 100 });
    await operationService.remove(op.id);
    expect(await exportService.rows(portee())).toEqual([]);
  });

  it('libelle les virements et peut les exclure', async () => {
    await transferService.create({ dbId: base.id, fromAccountId: ids.courant, toAccountId: ids.epargne, date: '2026-08-05', amountCents: 5000 });
    const avec = await exportService.rows(portee());
    expect(avec.map(r => [r.account, r.category, r.amountCents])).toEqual(expect.arrayContaining([['Courant', 'Virement', -5000], ['Livret', 'Virement', 5000]]));
    expect(await exportService.rows(portee({ includeTransfers: false }))).toEqual([]);
  });

  it('exporte une opération ventilée en une ligne, ou une ligne par part', async () => {
    await operationService.create({
      dbId: base.id, accountId: ids.courant, date: '2026-08-05', kind: 'depense', amountCents: 8700, label: 'Ticket',
      splits: [{ categoryId: ids.alim, amountCents: 6000 }, { categoryId: ids.entretien, amountCents: 2700 }],
    });
    const une = await exportService.rows(portee());
    expect(une).toHaveLength(1);
    expect(une[0]).toMatchObject({ category: 'Ventilée : Alimentation · Entretien', amountCents: -8700 });

    const detail = await exportService.rows(portee({ splitDetail: true }));
    expect(detail.map(r => [r.category, r.amountCents])).toEqual([['Alimentation', -6000], ['Entretien', -2700]]);
    expect(detail.reduce((s, r) => s + r.amountCents, 0)).toBe(-8700);          // le détail retombe sur le total
    expect(new Set(detail.map(r => r.id)).size).toBe(2);                          // identifiants distincts
  });

  it('indique la devise de chaque compte, sans conversion', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const us = await accountService.create({ dbId: base.id, name: 'US', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01', currency: 'USD' });
    await operationService.create({ dbId: base.id, accountId: us.id, date: '2026-08-05', kind: 'depense', amountCents: 1000 });
    const [r] = await exportService.rows(portee());
    expect(r).toMatchObject({ currency: 'USD', amountCents: -1000 });
  });
});

describe('construction du fichier', () => {
  beforeEach(async () => {
    await operationService.create({ dbId: base.id, accountId: ids.courant, date: '2026-08-05', kind: 'depense', amountCents: 4250, categoryId: ids.alim, label: 'Courses' });
  });
  const maintenant = new Date(2026, 9, 23, 12);

  it('nomme chaque fichier d’après sa date et son format', async () => {
    const noms = await Promise.all((['csv', 'xlsx', 'qif', 'ofx'] as const).map(async f => (await exportService.build(portee(), f, options, maintenant)).name));
    expect(noms).toEqual([
      'Comptes-et-Budget_operations_2026-10-23.csv', 'Comptes-et-Budget_operations_2026-10-23.xlsx',
      'Comptes-et-Budget_operations_2026-10-23.qif', 'Comptes-et-Budget_operations_2026-10-23.ofx',
    ]);
  });

  it('écrit du texte pour CSV, QIF et OFX et des octets pour Excel, avec le nombre de lignes', async () => {
    const csv = await exportService.build(portee(), 'csv', options, maintenant);
    expect(typeof csv.data).toBe('string');
    expect(csv.count).toBe(1);
    expect(csv.data as string).toContain('05/08/2026;Courant;EUR;;Alimentation;;;Courses;;-42,50;Non');
    const xlsx = await exportService.build(portee(), 'xlsx', options, maintenant);
    expect(xlsx.data).toBeInstanceOf(Uint8Array);
    expect(Array.from((xlsx.data as Uint8Array).slice(0, 2))).toEqual([0x50, 0x4b]);   // « PK » : signature ZIP
  });

  it('un export QIF ou OFX se réimporte à l’identique', async () => {
    for (const f of ['qif', 'ofx'] as const) {
      const fichier = await exportService.build(portee(), f, options, maintenant);
      const lu = parseStatement(fichier.data as string);
      expect(lu.format).toBe(f);
      expect(lu.entries.map(e => [e.date, e.amountCents])).toEqual([['2026-08-05', -4250]]);
    }
  });
});

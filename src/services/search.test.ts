// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { categoryService, payeeService } from './referentialService';
import { scheduleService } from './scheduleService';
import { securityService } from './securityService';
import { taskService } from './taskService';
import { assetService, projectService } from './patrimoineService';
import { globalSearch, MIN_QUERY } from './searchService';
import type { Database } from '../types';

let base: Database;
let compte: string;
let alim: string;
let entretien: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base recherche', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Compte Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01', number: 'FR76 1234' })).id;
  const g = await categoryService.createGroup(base.id, 'Zz groupe', 'depense');
  alim = (await categoryService.createCategory(base.id, g.id, 'Zz Alimentation')).id;
  entretien = (await categoryService.createCategory(base.id, g.id, 'Zz Entretien')).id;
});

const op = (over: object = {}) => operationService.create({
  dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 4250, ...over,
});
const titres = async (q: string, kinds?: Parameters<typeof globalSearch>[2]) => (await globalSearch(base.id, q, kinds)).map(h => h.title);

describe('règles de recherche', () => {
  it('ne cherche pas en dessous de la longueur minimale ni sur des blancs', async () => {
    await op({ label: 'Courses' });
    expect(MIN_QUERY).toBe(2);
    expect(await globalSearch(base.id, 'c')).toEqual([]);
    expect(await globalSearch(base.id, '   ')).toEqual([]);
    expect(await globalSearch(base.id, '')).toEqual([]);
  });

  it('ignore la casse et les accents', async () => {
    await op({ label: 'Café de la Gare' });
    expect(await titres('CAFE gare')).toEqual(['Café de la Gare']);
    expect(await titres('cafÉ')).toEqual(['Café de la Gare']);
  });

  it('exige tous les mots, dans n’importe quel ordre', async () => {
    await op({ label: 'Plein carburant Total' });
    expect(await titres('total plein')).toEqual(['Plein carburant Total']);
    expect(await titres('total loyer')).toEqual([]);
  });
});

describe('opérations', () => {
  it('cherche dans le libellé, le commentaire, la référence, le tiers, la catégorie et le compte', async () => {
    const t = await payeeService.create(base.id, 'Zz Boulangerie');
    await op({ label: 'Pain', note: 'pour dimanche', reference: 'CHQ-77', payeeId: t.id, categoryId: alim });
    for (const q of ['pain', 'dimanche', 'chq-77', 'boulangerie', 'alimentation', 'courant']) {
      expect((await globalSearch(base.id, q, { kinds: ['operation'] })).length, q).toBe(1);
    }
  });

  it('trouve par montant exact, avec virgule ou point, signe ignoré', async () => {
    await op({ label: 'Courses', amountCents: 4250 });
    await op({ label: 'Autre', amountCents: 1000 });
    expect(await titres('42,50', { kinds: ['operation'] })).toEqual(['Courses']);
    expect(await titres('42.5', { kinds: ['operation'] })).toEqual(['Courses']);
    expect(await titres('-42,50', { kinds: ['operation'] })).toEqual(['Courses']);
    expect(await titres('42,51', { kinds: ['operation'] })).toEqual([]);
  });

  it('trouve par date, en JJ/MM/AAAA comme en ISO, et combine date et texte', async () => {
    await op({ label: 'Courses', date: '2026-08-05' });
    await op({ label: 'Courses', date: '2026-09-05' });
    expect((await globalSearch(base.id, '05/08/2026', { kinds: ['operation'] })).map(h => h.date)).toEqual(['2026-08-05']);
    expect((await globalSearch(base.id, '2026-09-05', { kinds: ['operation'] })).map(h => h.date)).toEqual(['2026-09-05']);
    expect((await globalSearch(base.id, 'courses 05/08/2026', { kinds: ['operation'] })).length).toBe(1);
    expect((await globalSearch(base.id, 'loyer 05/08/2026', { kinds: ['operation'] })).length).toBe(0);
  });

  it('retrouve une opération ventilée par chacune de ses catégories', async () => {
    await op({ label: 'Ticket', amountCents: 8700, splits: [{ categoryId: alim, amountCents: 6000 }, { categoryId: entretien, amountCents: 2700 }] });
    expect(await titres('entretien', { kinds: ['operation'] })).toEqual(['Ticket']);
    expect(await titres('alimentation', { kinds: ['operation'] })).toEqual(['Ticket']);
    expect((await globalSearch(base.id, 'ticket', { kinds: ['operation'] }))[0].detail).toMatch(/ventilée/);
  });

  it('trie du plus récent au plus ancien, exclut les supprimées et plafonne', async () => {
    for (let i = 1; i <= 30; i++) await op({ label: 'Café', date: `2026-08-${String(i).padStart(2, '0')}` });
    const supprimee = await op({ label: 'Café supprimé', date: '2026-09-01' });
    await operationService.remove(supprimee.id);
    const r = await globalSearch(base.id, 'café', { kinds: ['operation'] });
    expect(r).toHaveLength(25);
    expect(r[0].date).toBe('2026-08-30');
    expect(r.every(h => !h.title.includes('supprimé'))).toBe(true);
    expect(await globalSearch(base.id, 'café', { kinds: ['operation'], limit: 3 })).toHaveLength(3);
  });

  it('titre de repli : tiers, puis catégorie, et « Virement » pour un virement', async () => {
    const t = await payeeService.create(base.id, 'Zz Garage');
    await op({ payeeId: t.id });
    await op({ categoryId: entretien });
    const r = await globalSearch(base.id, 'zz', { kinds: ['operation'] });
    expect(r.map(h => h.title).sort()).toEqual(['Zz Entretien', 'Zz Garage']);
  });

  it('ne mélange pas les bases', async () => {
    const autre = await dbService.create('Autre base', 'perso');
    const c2 = (await accountService.create({ dbId: autre.id, name: 'X', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
    await operationService.create({ dbId: autre.id, accountId: c2, date: '2026-08-05', kind: 'depense', amountCents: 100, label: 'Secret' });
    expect(await globalSearch(base.id, 'secret')).toEqual([]);
  });
});

describe('autres éléments', () => {
  it('cherche comptes, tiers, catégories, titres, tâches, échéances, biens et projets', async () => {
    await payeeService.create(base.id, 'Zz Fournisseur');
    await securityService.create({ dbId: base.id, name: 'Zz Action Alpha', symbol: 'FR0001' });
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'Zz appeler le notaire', due: '2026-11-02' });
    await scheduleService.create({ dbId: base.id, accountId: compte, amountCents: 5000, kind: 'depense', periodicity: 'mensuelle', nextDate: '2026-09-01', autoPost: false, holidayRule: 'exacte', label: 'Zz Loyer' });
    await assetService.create(base.id, { name: 'Zz Appartement', type: 'immobilier', valueCents: 20_000_000 });
    await projectService.create(base.id, { name: 'Zz Vacances', targetAmountCents: 300_000, openingSavedCents: 0, deadline: '2027-07-01' });

    const r = await globalSearch(base.id, 'zz');
    expect(r.map(h => h.kind)).toEqual(expect.arrayContaining(['tiers', 'categorie', 'titre', 'tache', 'echeance', 'bien', 'projet']));
    expect(r.find(h => h.kind === 'tache')).toMatchObject({ title: 'Zz appeler le notaire', date: '2026-11-02', screen: 'accueil' });
    expect(r.find(h => h.kind === 'titre')).toMatchObject({ detail: 'FR0001', screen: 'placements' });
    expect(r.find(h => h.kind === 'echeance')).toMatchObject({ screen: 'echeances', amountCents: -5000 });
    expect(r.find(h => h.kind === 'bien')).toMatchObject({ screen: 'biens', amountCents: 20_000_000 });
    expect(r.find(h => h.kind === 'projet')?.date).toBe('2027-07-01');
    expect((await globalSearch(base.id, 'fr0001', { kinds: ['titre'] }))).toHaveLength(1);
    expect((await globalSearch(base.id, '1234', { kinds: ['compte'] }))).toHaveLength(1);       // numéro de compte
    expect((await globalSearch(base.id, '02/11/2026', { kinds: ['tache'] }))).toHaveLength(1);   // date d'une tâche
    expect((await globalSearch(base.id, '200000', { kinds: ['bien'] }))).toHaveLength(1);        // valeur d'un bien
  });

  it('regroupe les résultats par type dans un ordre stable', async () => {
    await payeeService.create(base.id, 'Zz Tiers');
    await op({ label: 'Zz opération' });
    await taskService.create({ dbId: base.id, kind: 'note', text: 'Zz note' });
    const kinds = (await globalSearch(base.id, 'zz')).map(h => h.kind);
    const premiereDe = (k: string) => kinds.indexOf(k as never);
    expect(premiereDe('operation')).toBeLessThan(premiereDe('tiers'));
    expect(premiereDe('tiers')).toBeLessThan(premiereDe('categorie'));
    expect(premiereDe('categorie')).toBeLessThan(premiereDe('tache'));
  });

  it('limite la recherche aux types demandés', async () => {
    await payeeService.create(base.id, 'Zz Tiers');
    await op({ label: 'Zz opération' });
    expect((await globalSearch(base.id, 'zz', { kinds: ['tiers'] })).every(h => h.kind === 'tiers')).toBe(true);
  });
});

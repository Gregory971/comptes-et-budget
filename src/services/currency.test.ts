// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { budgetService } from './budgetService';
import { reportService, periodRange } from './reportService';
import { buildHorizon } from './horizonService';
import { forecastService } from './forecastService';
import { scheduleService } from './scheduleService';
import { loanService } from './loanService';
import { backupService } from './backupService';
import { convert, convertOperations, currencyService, rateOfAccount, validateCurrency } from './currencyService';
import { formatMoney } from '../utils/money';
import type { Database } from '../types';

let base: Database;

async function reset() {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base devises', 'perso');
}

const compte = (name: string, over: object = {}) => accountService.create({
  dbId: base.id, name, type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01', ...over,
});

describe('conversion', () => {
  it('arrondit au centime le plus proche', () => {
    expect(convert(1000, 0.92)).toBe(920);
    expect(convert(333, 0.92)).toBe(306);          // 306,36
    expect(convert(-333, 0.92)).toBe(-306);
    expect(convert(1234, 1)).toBe(1234);
  });

  it('formate dans la devise demandée', () => {
    expect(formatMoney(123456, 'EUR')).toMatch(/1\s234,56\s€/);
    expect(formatMoney(123456, 'USD')).toMatch(/1\s234,56\s/);
    expect(formatMoney(123456, 'USD')).not.toMatch(/€/);
    expect(formatMoney(5000, 'ZZZ9')).toMatch(/50,00 ZZZ9/);   // code inconnu : repli lisible
  });
});

describe('validation d’une devise', () => {
  const ok = { code: 'USD', name: 'Dollar', rate: 0.92 };
  it('accepte une devise correcte', () => expect(validateCurrency(ok, 'EUR')).toBeNull());
  it.each([
    [{ ...ok, code: 'usd' }, /trois lettres/],
    [{ ...ok, code: 'US' }, /trois lettres/],
    [{ ...ok, code: 'EUR' }, /déjà la devise/],
    [{ ...ok, name: '  ' }, /nom/],
    [{ ...ok, rate: 0 }, /taux/],
    [{ ...ok, rate: -1 }, /taux/],
    [{ ...ok, rate: NaN }, /taux/],
    [{ ...ok, rate: 2_000_000 }, /invraisemblable/],
  ])('refuse %j', (entree, motif) => expect(validateCurrency(entree, 'EUR')).toMatch(motif));
});

describe('gestion des devises', () => {
  beforeEach(reset);

  it('crée, met en majuscules et refuse les doublons', async () => {
    const c = await currencyService.create({ dbId: base.id, code: ' usd ', name: 'Dollar', rate: 0.92 });
    expect(c.code).toBe('USD');
    await expect(currencyService.create({ dbId: base.id, code: 'USD', name: 'Autre', rate: 1 })).rejects.toThrow(/existe déjà/);
    await expect(currencyService.create({ dbId: base.id, code: 'EUR', name: 'Euro', rate: 1 })).rejects.toThrow(/déjà la devise/);
  });

  it('met à jour le taux et refuse un taux invalide', async () => {
    const c = await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.92 });
    await currencyService.update(c.id, { rate: 0.95 });
    expect((await db.currencies.get(c.id))?.rate).toBe(0.95);
    await expect(currencyService.update(c.id, { rate: 0 })).rejects.toThrow(/taux/);
  });

  it('refuse de supprimer une devise utilisée par un compte', async () => {
    const c = await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.92 });
    const a = await compte('Compte US', { currency: 'USD' });
    await expect(currencyService.remove(c.id)).rejects.toThrow(/Compte US/);
    await accountService.update(a.id, { currency: undefined });
    await currencyService.remove(c.id);
    expect(await db.currencies.count()).toBe(0);
  });

  it('donne le taux de chaque compte, 1 pour la devise de la base ou une devise inconnue', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.92 });
    const eur = await compte('Euro');
    const usd = await compte('Dollar', { currency: 'USD' });
    const inconnu = await compte('Inconnu', { currency: 'JPY' });
    const r = await currencyService.rates(base.id);
    expect(r[eur.id]).toBe(1);
    expect(r[usd.id]).toBe(0.92);
    expect(r[inconnu.id]).toBe(1);
    expect(rateOfAccount({ currency: 'USD' }, await currencyService.list(base.id))).toBe(0.92);
  });
});

describe('agrégats en devise de la base', () => {
  beforeEach(async () => {
    await reset();
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
  });

  it('le solde total convertit chaque compte à son taux, les soldes restent natifs', async () => {
    const eur = await compte('Euro', { initialBalanceCents: 100_000 });
    const usd = await compte('Dollar', { initialBalanceCents: 100_000, currency: 'USD' });
    const soldes = await accountService.balances(base.id);
    expect(soldes[usd.id]).toBe(100_000);                        // natif : 1 000,00 USD
    expect(await accountService.totalBalance(base.id)).toBe(100_000 + 50_000);
    expect(eur.id).toBeTruthy();
  });

  it('les bilans mélangeant les comptes sont en devise de la base, un compte seul reste natif', async () => {
    const eur = await compte('Euro');
    const usd = await compte('Dollar', { currency: 'USD' });
    await operationService.create({ dbId: base.id, accountId: eur.id, date: '2026-08-10', kind: 'depense', amountCents: 1000 });
    await operationService.create({ dbId: base.id, accountId: usd.id, date: '2026-08-11', kind: 'depense', amountCents: 1000 });
    const mois = periodRange(new Date(2026, 7, 15), 'mois');
    expect((await reportService.build(base.id, undefined, mois)).depensesCents).toBe(1000 + 500);
    expect((await reportService.build(base.id, usd.id, mois)).depensesCents).toBe(1000);
    expect((await reportService.build(base.id, eur.id, mois)).depensesCents).toBe(1000);
  });

  it('les budgets comptent les dépenses d’un compte étranger converties, ventilation comprise', async () => {
    const usd = await compte('Dollar', { currency: 'USD' });
    const maintenant = new Date();
    const ce = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-10`;
    await operationService.create({ dbId: base.id, accountId: usd.id, date: ce, kind: 'depense', amountCents: 1000, categoryId: 'a' });
    await operationService.create({
      dbId: base.id, accountId: usd.id, date: ce, kind: 'depense', amountCents: 2000,
      splits: [{ categoryId: 'a', amountCents: 1500 }, { categoryId: 'b', amountCents: 500 }],
    });
    expect(await budgetService.spentByCategory(base.id)).toEqual({ a: 500 + 750, b: 250 });
  });

  it('convertOperations ne touche pas aux opérations de la devise de la base', async () => {
    const eur = await compte('Euro');
    const usd = await compte('Dollar', { currency: 'USD' });
    const o1 = await operationService.create({ dbId: base.id, accountId: eur.id, date: '2026-08-10', kind: 'depense', amountCents: 1000 });
    const o2 = await operationService.create({ dbId: base.id, accountId: usd.id, date: '2026-08-10', kind: 'depense', amountCents: 1000 });
    const [c1, c2] = convertOperations([o1, o2], await currencyService.rates(base.id));
    expect(c1).toBe(o1);
    expect(c2.amountCents).toBe(-500);
    expect(o2.amountCents).toBe(-1000);               // l'original n'est pas modifié
  });

  it('les prévisions et l’horizon convertissent les échéances d’un compte étranger', async () => {
    const eur = await compte('Euro', { initialBalanceCents: 100_000 });
    const usd = await compte('Dollar', { initialBalanceCents: 100_000, currency: 'USD' });
    const prochain = new Date(); prochain.setDate(prochain.getDate() + 1);
    const date = `${prochain.getFullYear()}-${String(prochain.getMonth() + 1).padStart(2, '0')}-${String(prochain.getDate()).padStart(2, '0')}`;
    await scheduleService.create({
      dbId: base.id, accountId: usd.id, amountCents: -10_000, kind: 'depense', periodicity: 'unique',
      nextDate: date, autoPost: false, holidayRule: 'exacte',
    });

    const tous = await buildHorizon(base.id, undefined, 2, 'metropole');
    expect(tous.months[0].openingCents).toBe(150_000);               // 1 000 € + 1 000 USD × 0,5
    expect(tous.months[0].scheduledCents).toBe(-5_000);              // −100 USD → −50 €
    const seul = await buildHorizon(base.id, usd.id, 2, 'metropole');
    expect(seul.months[0].openingCents).toBe(100_000);               // natif
    expect(seul.months[0].scheduledCents).toBe(-10_000);

    const prev = await forecastService.build(base.id, undefined, new Date(), 'metropole');
    expect(prev.forecast.find(f => f.kind === 'echeance')?.amountCents).toBe(-5_000);
    expect(eur.id).toBeTruthy();
  });
});

describe('virements entre devises', () => {
  beforeEach(async () => {
    await reset();
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
  });

  it('exige le montant reçu quand les devises diffèrent', async () => {
    const eur = await compte('Euro', { initialBalanceCents: 100_000 });
    const usd = await compte('Dollar', { currency: 'USD' });
    await expect(transferService.create({
      dbId: base.id, fromAccountId: eur.id, toAccountId: usd.id, date: '2026-08-10', amountCents: 10_000,
    })).rejects.toThrow(/montant reçu/);
    expect(await db.operations.count()).toBe(0);
  });

  it('débite le montant émis et crédite le montant reçu, chacun dans sa devise', async () => {
    const eur = await compte('Euro', { initialBalanceCents: 100_000 });
    const usd = await compte('Dollar', { currency: 'USD' });
    const { debit, credit } = await transferService.create({
      dbId: base.id, fromAccountId: eur.id, toAccountId: usd.id, date: '2026-08-10',
      amountCents: 10_000, receivedAmountCents: 21_000,
    });
    expect(debit.amountCents).toBe(-10_000);
    expect(credit.amountCents).toBe(21_000);
    expect(debit.transferId).toBe(credit.transferId);
    const soldes = await accountService.balances(base.id);
    expect(soldes[eur.id]).toBe(90_000);
    expect(soldes[usd.id]).toBe(21_000);
  });

  it('ignore le montant reçu entre deux comptes de même devise', async () => {
    const a = await compte('A', { initialBalanceCents: 50_000 });
    const b = await compte('B');
    const { credit } = await transferService.create({
      dbId: base.id, fromAccountId: a.id, toAccountId: b.id, date: '2026-08-10',
      amountCents: 10_000, receivedAmountCents: 99_999,
    });
    expect(credit.amountCents).toBe(10_000);
  });
});

describe('prêts et devises, sauvegarde', () => {
  beforeEach(async () => {
    await reset();
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
  });

  it('un prêt ne peut pas être payé depuis un compte en devise étrangère', async () => {
    const usd = await compte('Dollar', { currency: 'USD' });
    await expect(loanService.create({
      dbId: base.id, name: 'Prêt', loanDate: '2026-01-01', principalCents: 100_000, rateBp: 0, months: 10,
      firstPaymentDate: '2026-02-01', insuranceMonthlyCents: 0, fundingAccountId: usd.id, autoPost: false,
    })).rejects.toThrow(/devise de la base/);
  });

  it('les devises et la devise des comptes font l’aller-retour d’une sauvegarde', async () => {
    await compte('Dollar', { currency: 'USD' });
    const copie = await backupService.export();
    expect(copie.currencies?.map(c => c.code)).toEqual(['USD']);
    await db.currencies.clear();
    await db.accounts.clear();
    await backupService.restore(copie, 'replace', false);
    expect((await db.currencies.toArray()).map(c => c.code)).toEqual(['USD']);
    expect((await db.accounts.toArray())[0].currency).toBe('USD');
  });

  it('une sauvegarde d’avant les devises ne vide pas celles qui existent', async () => {
    const copie = await backupService.export();
    delete copie.currencies;
    await backupService.restore(copie, 'replace', false);
    expect(await db.currencies.count()).toBe(1);
  });
});

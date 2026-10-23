import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { loanService, type NewLoanInput } from './loanService';
import { reportService, periodRange } from './reportService';
import { toCents } from '../utils/money';

const DB = 'base-prets';

async function reset() {
  await Promise.all([db.operations.clear(), db.accounts.clear(), db.categories.clear(), db.categoryGroups.clear()]);
}

async function courant(solde = 1_000_000) {
  return accountService.create({ dbId: DB, name: 'Courant', type: 'courant', initialBalanceCents: solde, startDate: '2026-01-01' });
}

const entree = (fundingAccountId: string, over: Partial<NewLoanInput> = {}): NewLoanInput => ({
  dbId: DB, name: 'Maison', loanDate: '2026-01-20',
  principalCents: 120_000, rateBp: 0, months: 12,
  firstPaymentDate: '2026-02-05', insuranceMonthlyCents: 500,
  fundingAccountId, autoPost: false, ...over,
});

describe('création d’un prêt', () => {
  beforeEach(reset);

  it('crée un compte de type prêt dont le solde est la dette', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id));
    expect(p.type).toBe('pret');
    expect(p.initialBalanceCents).toBe(-120_000);
    expect(p.loan?.postedCount).toBe(0);
    expect((await accountService.balances(DB))[p.id]).toBe(-120_000);
  });

  it('tient compte des mensualités déjà remboursées avant le suivi', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id, { alreadyPaid: 4 }));
    expect(p.initialBalanceCents).toBe(-80_000);       // 120 000 − 4 × 10 000
    expect(p.loan?.postedCount).toBe(4);
    expect(await db.operations.count()).toBe(0);        // aucune écriture rétroactive
  });

  it('refuse un prêt déjà entièrement remboursé', async () => {
    const c = await courant();
    await expect(loanService.create(entree(c.id, { alreadyPaid: 12 }))).rejects.toThrow(/déjà remboursées/);
  });

  it('refuse des conditions invalides et un compte de financement inconnu ou de type prêt', async () => {
    const c = await courant();
    await expect(loanService.create(entree(c.id, { months: 0 }))).rejects.toThrow(/durée/);
    await expect(loanService.create(entree('inconnu'))).rejects.toThrow(/introuvable/);
    const p = await loanService.create(entree(c.id));
    await expect(loanService.create(entree(p.id))).rejects.toThrow(/autre prêt/);
  });
});

describe('comptabilisation des mensualités', () => {
  beforeEach(reset);

  it('écrit le capital en virement, intérêts et assurance en dépense, puis avance le compteur', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id));
    expect(await loanService.postDue(p.id, '2026-02-10')).toBe(1);

    const ops = await db.operations.toArray();
    expect(ops).toHaveLength(3);
    const debit = ops.find(o => o.kind === 'virement' && o.accountId === c.id)!;
    const credit = ops.find(o => o.kind === 'virement' && o.accountId === p.id)!;
    const cout = ops.find(o => o.kind === 'depense')!;
    expect(debit.amountCents).toBe(-10_000);
    expect(credit.amountCents).toBe(10_000);
    expect(debit.transferId).toBe(credit.transferId);
    expect(cout.amountCents).toBe(-500);                  // assurance seule : taux nul
    expect(cout.accountId).toBe(c.id);
    expect((await db.accounts.get(p.id))?.loan?.postedCount).toBe(1);

    const soldes = await accountService.balances(DB);
    expect(soldes[p.id]).toBe(-110_000);                  // la dette baisse du capital
    expect(soldes[c.id]).toBe(1_000_000 - 10_000 - 500);  // le compte courant paie capital + assurance
  });

  it('ne comptabilise jamais deux fois la même mensualité', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id));
    expect(await loanService.postDue(p.id, '2026-04-10')).toBe(3);
    expect(await loanService.postDue(p.id, '2026-04-10')).toBe(0);
    const [a, b] = await Promise.all([loanService.postDue(p.id, '2026-05-10'), loanService.postDue(p.id, '2026-05-10')]);
    expect(a + b).toBe(1);
    expect((await db.accounts.get(p.id))?.loan?.postedCount).toBe(4);
  });

  it('ne touche à rien avant la première échéance', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id));
    expect(await loanService.postDue(p.id, '2026-02-04')).toBe(0);
    expect(await db.operations.count()).toBe(0);
  });

  it('solde le prêt après la dernière mensualité', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id));
    expect(await loanService.postDue(p.id, '2030-01-01')).toBe(12);
    expect((await accountService.balances(DB))[p.id]).toBe(0);
    expect(loanService.summary((await db.accounts.get(p.id))!, '2030-01-01')?.next).toBeUndefined();
  });

  it('reprend après les mensualités déjà remboursées avant le suivi', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id, { alreadyPaid: 10 }));
    expect(await loanService.postDue(p.id, '2030-01-01')).toBe(2);
    expect((await accountService.balances(DB))[p.id]).toBe(0);
  });

  it('range les intérêts dans la catégorie choisie et ne compte pas le capital comme une dépense', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id, { rateBp: 480, interestCategoryId: 'cat-credit' }));
    await loanService.postDue(p.id, '2026-02-10');
    const cout = (await db.operations.toArray()).find(o => o.kind === 'depense')!;
    expect(cout.categoryId).toBe('cat-credit');
    expect(cout.amountCents).toBeLessThan(0);
    const bilan = await reportService.build(DB, undefined, periodRange(new Date(2026, 1, 15), 'mois'));
    expect(bilan.depensesCents).toBe(-cout.amountCents);  // le virement de capital est exclu
  });

  it('comptabilise automatiquement seulement les prêts qui le demandent', async () => {
    const c = await courant();
    const auto = await loanService.create(entree(c.id, { name: 'Auto', autoPost: true }));
    const manuel = await loanService.create(entree(c.id, { name: 'Manuel', autoPost: false }));
    expect(await loanService.runAutoPost(DB, '2026-03-10')).toBe(2);
    expect((await db.accounts.get(auto.id))?.loan?.postedCount).toBe(2);
    expect((await db.accounts.get(manuel.id))?.loan?.postedCount).toBe(0);
  });

  it('ignore un prêt archivé', async () => {
    const c = await courant();
    const p = await loanService.create(entree(c.id, { autoPost: true }));
    await accountService.archive(p.id);
    expect(await loanService.runAutoPost(DB, '2030-01-01')).toBe(0);
    expect(await loanService.postDue(p.id, '2030-01-01')).toBe(0);
  });
});

describe('prêts, masquage et tri des comptes', () => {
  beforeEach(reset);

  it('le prêt n’entre pas dans le solde total, qui reste de la trésorerie', async () => {
    const c = await courant(500_000);
    await loanService.create(entree(c.id));
    expect(await accountService.totalBalance(DB)).toBe(500_000);
  });

  it('un compte masqué disparaît des listes et du solde total, sans être archivé', async () => {
    const a = await courant(100_000);
    const b = await accountService.create({ dbId: DB, name: 'Caché', type: 'epargne', initialBalanceCents: toCents(50), startDate: '2026-01-01', hidden: true });
    expect((await accountService.list(DB)).map(x => x.id)).toEqual([a.id]);
    expect((await accountService.list(DB, true)).map(x => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(await accountService.totalBalance(DB)).toBe(100_000);
  });

  it('classe les favoris en tête, puis par groupe, puis par nom', async () => {
    const mk = (name: string, extra: object) => accountService.create({
      dbId: DB, name, type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01', ...extra });
    await mk('Zèbre', { favorite: true });
    await mk('Alpha', {});
    await mk('Livret', { group: 'Épargne' });
    await mk('Courant B', { group: 'Banque B' });
    await mk('Beta', {});
    expect((await accountService.list(DB)).map(a => a.name))
      .toEqual(['Zèbre', 'Courant B', 'Livret', 'Alpha', 'Beta']);
  });
});

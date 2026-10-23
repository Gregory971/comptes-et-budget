// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CurrenciesTab, parseRateInput } from './CurrenciesTab';
import { ComptesScreen } from './ComptesScreen';
import { OperationsScreen } from './OperationsScreen';
import { TransferForm } from '../components/TransferForm';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { currencyService } from '../services/currencyService';
import { operationService } from '../services/operationService';
import type { Account, Database } from '../types';

let base: Database;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base devises UI', 'perso');
});

afterEach(cleanup);

const compte = (name: string, over: object = {}) => accountService.create({
  dbId: base.id, name, type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01', ...over,
});
const saisir = (el: HTMLElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };

describe('lecture d’un taux', () => {
  it.each([['0,92', 0.92], ['0.92', 0.92], [' 1 234,5 ', 1234.5], ['2', 2]])('lit %s', (t, n) => expect(parseRateInput(t)).toBe(n));
  it.each(['', 'abc', '1,2,3', '-1'])('refuse %j', t => expect(parseRateInput(t)).toBeNaN());
});

describe('Préférences → Devises', () => {
  it('ajoute une devise et l’affiche avec son taux', async () => {
    render(<CurrenciesTab database={base} />);
    saisir(screen.getByLabelText('Code'), 'usd');
    saisir(screen.getByLabelText('Nom'), 'Dollar américain');
    saisir(screen.getByLabelText(/1 unité = … EUR/), '0,92');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText('Dollar américain')).toBeTruthy();
    expect((await db.currencies.toArray())[0]).toMatchObject({ code: 'USD', rate: 0.92 });
  });

  it('affiche l’erreur d’une devise invalide', async () => {
    render(<CurrenciesTab database={base} />);
    saisir(screen.getByLabelText('Code'), 'EUR');
    saisir(screen.getByLabelText('Nom'), 'Euro');
    saisir(screen.getByLabelText(/1 unité/), '1');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/déjà la devise de la base/);
    expect(await db.currencies.count()).toBe(0);
  });

  it('modifie le taux', async () => {
    const c = await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.92 });
    render(<CurrenciesTab database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier le taux' }));
    saisir(screen.getByLabelText('Taux de USD'), '0,95');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => expect((await db.currencies.get(c.id))?.rate).toBe(0.95));
  });

  it('refuse de supprimer une devise utilisée et le dit', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.92 });
    await compte('Compte US', { currency: 'USD' });
    render(<CurrenciesTab database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer la devise USD' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Compte US/);
    expect(await db.currencies.count()).toBe(1);
  });
});

describe('comptes en devise', () => {
  it('crée un compte en dollars et affiche son solde dans sa devise avec l’équivalent en euros', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    await compte('Courant');
    render(<ComptesScreen database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau compte' }));
    const dialog = await screen.findByRole('dialog');
    saisir(within(dialog).getByLabelText('Nom'), 'Compte US');
    await waitFor(() => expect(within(dialog).getByLabelText('Devise')).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText('Devise'), { target: { value: 'USD' } });
    saisir(within(dialog).getByLabelText('Solde initial (USD)'), '1000');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await db.accounts.toArray()).find(a => a.name === 'Compte US')?.currency).toBe('USD');
    // Solde natif dans la devise du compte, équivalent en euros au taux enregistré.
    const carte = (await screen.findAllByText(/Compte US/)).map(e => e.closest('.acc')).find(Boolean) as HTMLElement;
    expect(carte.textContent).toMatch(/1\s000,00/);
    expect(carte.textContent).toMatch(/≈\s*500,00\s*€/);
  });

  it('la devise d’un compte existant ne se change plus', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    await compte('Compte US', { currency: 'USD' });
    render(<ComptesScreen database={base} />);
    const ligne = (await screen.findAllByText(/Compte US/)).map(e => e.closest('tr')).find(Boolean) as HTMLElement;
    fireEvent.click(within(ligne).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Devise') as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('virement entre devises', () => {
  async function deuxComptes(): Promise<[Account, Account]> {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const eur = await compte('Euro', { initialBalanceCents: 100_000 });
    const usd = await compte('Dollar', { currency: 'USD' });
    return [eur, usd];
  }

  it('demande le montant reçu et l’enregistre', async () => {
    const [eur, usd] = await deuxComptes();
    let fini = false;
    render(<TransferForm dbId={base.id} accounts={[eur, usd]} onDone={() => { fini = true; }} />);
    saisir(screen.getByLabelText('Montant (€)'), '100');
    const recu = await screen.findByLabelText('Montant reçu (USD)');

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le virement' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/montant reçu/);
    expect(await db.operations.count()).toBe(0);

    saisir(recu, '210');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le virement' }));
    await waitFor(() => expect(fini).toBe(true));
    const ops = await db.operations.toArray();
    expect(ops.find(o => o.accountId === eur.id)?.amountCents).toBe(-10_000);
    expect(ops.find(o => o.accountId === usd.id)?.amountCents).toBe(21_000);
  });

  it('ne demande rien entre deux comptes de même devise', async () => {
    const a = await compte('A', { initialBalanceCents: 100_000 });
    const b = await compte('B');
    render(<TransferForm dbId={base.id} accounts={[a, b]} onDone={() => {}} />);
    expect(screen.queryByLabelText(/Montant reçu/)).toBeNull();
  });
});

describe('écran Opérations en devises', () => {
  it('« Tous les comptes » cumule en devise de la base et signale la devise des lignes étrangères', async () => {
    await currencyService.create({ dbId: base.id, code: 'USD', name: 'Dollar', rate: 0.5 });
    const eur = await compte('Euro');
    const usd = await compte('Dollar', { currency: 'USD' });
    const maintenant = new Date();
    const ce = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-01`;
    await operationService.create({ dbId: base.id, accountId: eur.id, date: ce, kind: 'recette', amountCents: 10_000, label: 'Salaire' });
    await operationService.create({ dbId: base.id, accountId: usd.id, date: ce, kind: 'recette', amountCents: 10_000, label: 'Remboursement US' });

    render(<OperationsScreen database={base} />);
    const ligne = (await screen.findByText('Remboursement US')).closest('tr') as HTMLElement;
    // Montant natif (100,00 USD) mais cumul en euros : 100 € + 50 € = 150 €.
    expect(ligne.textContent).toMatch(/100,00/);
    expect(ligne.textContent).toMatch(/USD/);
    await waitFor(() => expect(document.body.textContent).toMatch(/150,00 − 0,00 = 150,00/));
    const ligneEuro = (await screen.findByText('Salaire')).closest('tr') as HTMLElement;
    expect(ligneEuro.textContent).not.toMatch(/USD/);
  });
});

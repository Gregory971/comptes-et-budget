// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ComptesScreen } from './ComptesScreen';
import { parseRate } from '../components/LoanModals';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { categoryService } from '../services/referentialService';
import { loanService } from '../services/loanService';
import type { Database } from '../types';

let database: Database;
let courantId: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  database = await dbService.create('Base prêts', 'perso');
  courantId = (await accountService.create({
    dbId: database.id, name: 'Courant', type: 'courant', initialBalanceCents: 500_000, startDate: '2026-01-01',
  })).id;
  const g = await categoryService.createGroup(database.id, 'Banque', 'depense');
  await categoryService.createCategory(database.id, g.id, 'Crédit', '🏦');
});

afterEach(cleanup);

/** Le bouton reste inactif tant que les comptes ne sont pas chargés. */
async function ouvrirAssistantPret() {
  const bouton = await screen.findByRole('button', { name: '+ Nouveau prêt' });
  await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(bouton);
  return screen.findByRole('dialog');
}

describe('saisie du taux', () => {
  it.each([['3,5', 350], ['3.50', 350], ['0', 0], [' 4,125 % ', 413], ['12', 1200]])('lit %s', (texte, bp) => {
    expect(parseRate(texte)).toBe(bp);
  });
  it.each(['', 'abc', '3,5,2', '-1'])('refuse %j', texte => {
    expect(parseRate(texte)).toBeNaN();
  });
});

describe('écran Comptes — prêts', () => {
  it('crée un prêt depuis l’assistant, avec aperçu de la mensualité', async () => {
    render(<ComptesScreen database={database} />);
    const dialog = await ouvrirAssistantPret();
    fireEvent.change(within(dialog).getByLabelText('Montant emprunté (€)'), { target: { value: '100000' } });
    fireEvent.blur(within(dialog).getByLabelText('Montant emprunté (€)'));
    fireEvent.change(within(dialog).getByLabelText('Taux annuel (%)'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Durée (mensualités)'), { target: { value: '240' } });

    // 100 000 € à 3 % sur 20 ans : 554,60 € par mois.
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toMatch(/554,60/));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer le prêt' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const prets = await loanService.list(database.id);
    expect(prets).toHaveLength(1);
    expect(prets[0].initialBalanceCents).toBe(-10_000_000);
    expect(prets[0].loan?.fundingAccountId).toBe(courantId);
    expect(await screen.findByText(/0 % remboursé/)).toBeTruthy();
  });

  it('refuse un montant manquant avec un message', async () => {
    render(<ComptesScreen database={database} />);
    const dialog = await ouvrirAssistantPret();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer le prêt' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/montant/i);
    expect(await loanService.list(database.id)).toHaveLength(0);
  });

  it('propose de comptabiliser les mensualités échues puis met à jour la dette', async () => {
    await loanService.create({
      dbId: database.id, name: 'Voiture', loanDate: '2025-01-10',
      principalCents: 120_000, rateBp: 0, months: 12, firstPaymentDate: '2025-02-05',
      insuranceMonthlyCents: 0, fundingAccountId: courantId, autoPost: false,
    });
    render(<ComptesScreen database={database} />);

    const bouton = await screen.findByRole('button', { name: /Comptabiliser \(\d+\)/ });
    fireEvent.click(bouton);
    expect((await screen.findByRole('status')).textContent).toMatch(/mensualité\(s\) comptabilisée\(s\)/);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Comptabiliser \(/ })).toBeNull());
    expect((await db.accounts.toArray()).find(a => a.type === 'pret')?.loan?.postedCount).toBeGreaterThan(0);
  });

  it('affiche le tableau d’amortissement', async () => {
    const p = await loanService.create({
      dbId: database.id, name: 'Maison', loanDate: '2026-01-10',
      principalCents: 120_000, rateBp: 0, months: 12, firstPaymentDate: '2099-02-05',
      insuranceMonthlyCents: 0, fundingAccountId: courantId, autoPost: false,
    });
    render(<ComptesScreen database={database} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tableau d’amortissement' }));
    const dialog = await screen.findByRole('dialog', { name: /Maison/ });
    expect(within(dialog).getAllByRole('row')).toHaveLength(13);   // en-tête + 12 mensualités
    expect(p.id).toBeTruthy();
  });

  it('le prêt est hors du solde des comptes affichés et le compte masqué disparaît des cartes', async () => {
    await loanService.create({
      dbId: database.id, name: 'Maison', loanDate: '2026-01-10',
      principalCents: 120_000, rateBp: 0, months: 12, firstPaymentDate: '2099-02-05',
      insuranceMonthlyCents: 0, fundingAccountId: courantId, autoPost: false,
    });
    await accountService.create({
      dbId: database.id, name: 'Livret secret', type: 'epargne', initialBalanceCents: 100, startDate: '2026-01-01', hidden: true,
    });
    render(<ComptesScreen database={database} />);
    await screen.findByText('Livret secret');                       // visible dans le tableau de gestion, avec sa pastille
    expect(screen.getByText('Masqué')).toBeTruthy();
    expect(document.querySelectorAll('.acc-grid .acc')).toHaveLength(1);   // seule la carte du compte courant
  });
});

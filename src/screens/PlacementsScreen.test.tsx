// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlacementsScreen } from './PlacementsScreen';
import { parseDecimal } from '../components/SecurityModals';
import { Layout } from '../components/Layout';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { securityService } from '../services/securityService';
import type { Database } from '../types';

let base: Database;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base placements UI', 'perso');
  await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 1_000_000, startDate: '2026-01-01' });
});

afterEach(cleanup);

const saisir = (el: HTMLElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };

async function ouvrirDetail(nom: string) {
  const ligne = (await screen.findByText(nom)).closest('tr') as HTMLElement;
  fireEvent.click(within(ligne).getByRole('button', { name: 'Détail' }));
  return screen.findByRole('dialog', { name: nom });
}

describe('lecture d’un décimal', () => {
  it.each([['12,5', 12.5], ['0.25', 0.25], [' 1 234,56 ', 1234.56], ['-3', -3], ['7', 7]])('lit %s', (t, n) => expect(parseDecimal(t)).toBe(n));
  it.each(['', 'abc', '1,2,3', '--1', '1e3'])('refuse %j', t => expect(parseDecimal(t)).toBeNaN());
});

describe('écran Placements', () => {
  it('est dans la navigation', () => {
    render(<Layout><div /></Layout>);
    expect(screen.getByRole('button', { name: /Placements/ })).toBeTruthy();
  });

  it('crée un titre depuis l’écran', async () => {
    render(<PlacementsScreen database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau titre' }));
    const dialog = await screen.findByRole('dialog');
    saisir(within(dialog).getByLabelText('Désignation'), 'Action Alpha');
    saisir(within(dialog).getByLabelText(/ISIN/), 'fr0001');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Action Alpha')).toBeTruthy();
    expect((await securityService.list(base.id))[0].symbol).toBe('FR0001');
  });

  it('refuse un titre sans nom avec un message', async () => {
    render(<PlacementsScreen database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau titre' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/nom du titre/);
  });

  it('achète, actualise le cours et affiche les plus-values', async () => {
    await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    render(<PlacementsScreen database={base} />);
    const detail = await ouvrirDetail('Action Alpha');

    fireEvent.click(within(detail).getByRole('button', { name: 'Acheter' }));
    const achat = await screen.findByRole('dialog', { name: /Acheter/ });
    saisir(within(achat).getByLabelText('Quantité (parts)'), '10');
    saisir(within(achat).getByLabelText('Cours unitaire (€)'), '50');
    expect(within(achat).getByRole('status').textContent).toMatch(/500,00/);
    fireEvent.click(within(achat).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Acheter/ })).toBeNull());

    fireEvent.click(within(detail).getByRole('button', { name: 'Actualiser le cours' }));
    const cours = await screen.findByRole('dialog', { name: /Actualiser/ });
    saisir(within(cours).getByLabelText('Cours (€)'), '62,5');
    fireEvent.click(within(cours).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(detail.textContent).toMatch(/Valeur : 625,00/));
    expect(detail.textContent).toMatch(/\+125,00/);
    expect(detail.textContent).toMatch(/Quantité : 10/);
  });

  it('refuse une vente supérieure aux parts détenues', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 5, unitPrice: 10 });
    render(<PlacementsScreen database={base} />);
    const detail = await ouvrirDetail('Action Alpha');
    fireEvent.click(within(detail).getByRole('button', { name: 'Vendre' }));
    const vente = await screen.findByRole('dialog', { name: /Vendre/ });
    saisir(within(vente).getByLabelText('Quantité (parts)'), '9');
    saisir(within(vente).getByLabelText('Cours unitaire (€)'), '12');
    fireEvent.click(within(vente).getByRole('button', { name: 'Enregistrer' }));
    expect((await within(vente).findByRole('alert')).textContent).toMatch(/ne détenez que 5/);
    expect(await db.securityTxs.count()).toBe(1);
  });

  it('enregistre un achat dans un compte avec ses frais ventilés', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    render(<PlacementsScreen database={base} />);
    const detail = await ouvrirDetail('Action Alpha');
    fireEvent.click(within(detail).getByRole('button', { name: 'Acheter' }));
    const achat = await screen.findByRole('dialog', { name: /Acheter/ });
    saisir(within(achat).getByLabelText('Quantité (parts)'), '2');
    saisir(within(achat).getByLabelText('Cours unitaire (€)'), '100');
    saisir(within(achat).getByLabelText('Frais (€)'), '1,5');
    // Les comptes se chargent après le premier rendu : on attend que l'option existe avant de la choisir.
    await waitFor(() => expect(within(achat).getByRole('option', { name: 'Courant' })).toBeTruthy());
    const compte = (await accountService.list(base.id))[0];
    fireEvent.change(within(achat).getByLabelText('Compte'), { target: { value: compte.id } });
    fireEvent.click(within(achat).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(async () => expect(await db.securityTxs.count()).toBe(1));
    const tx = (await db.securityTxs.toArray())[0];
    expect(tx.amountCents).toBe(20_000);
    expect(tx.feesCents).toBe(150);
    expect((await db.operations.get(tx.operationIds![0]))?.amountCents).toBe(-20_150);
    expect(t.id).toBe(tx.securityId);
  });

  it('supprime un mouvement et son écriture bancaire', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    const compte = (await accountService.list(base.id))[0];
    const tx = await securityService.addTx({
      dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10, bank: { accountId: compte.id },
    });
    render(<PlacementsScreen database={base} />);
    const detail = await ouvrirDetail('Action Alpha');
    fireEvent.click(await within(detail).findByRole('button', { name: /Supprimer le mouvement/ }));
    const confirmation = await screen.findByRole('dialog', { name: 'Supprimer le mouvement' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Supprimer' }));
    await waitFor(async () => expect(await db.securityTxs.count()).toBe(0));
    expect((await db.operations.get(tx.operationIds![0]))?.deletedAt).toBeTruthy();
  });

  it('affiche un dividende et l’ajoute aux gains', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10 });
    render(<PlacementsScreen database={base} />);
    const detail = await ouvrirDetail('Action Alpha');
    fireEvent.click(within(detail).getByRole('button', { name: 'Dividende' }));
    const dialog = await screen.findByRole('dialog', { name: /dividende/ });
    saisir(within(dialog).getByLabelText('Montant perçu (€)'), '3,20');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(detail.textContent).toMatch(/Dividendes : 3,20/));
  });

  it('importe un fichier de cotations et signale les lignes ignorées', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    render(<PlacementsScreen database={base} />);
    const detail = await ouvrirDetail('Action Alpha');
    const fichier = new File(['Date;Cours\n25/10/2026;62,5\nhier;60\n'], 'cotations.csv', { type: 'text/csv' });
    fireEvent.change(within(detail).getByLabelText('Fichier de cotations'), { target: { files: [fichier] } });
    await waitFor(() => expect(detail.textContent).toMatch(/1 cotation\(s\) importée\(s\)/));
    expect(detail.textContent).toMatch(/Ligne 3 ignorée : date illisible/);
    await waitFor(() => expect(detail.textContent).toMatch(/Valeur : 625,00/));
  });

  it('un titre archivé disparaît du total mais reste consultable', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 1, unitPrice: 10 });
    await securityService.archive(t.id);
    render(<PlacementsScreen database={base} />);
    await screen.findByText('Aucun titre. Ajoutez-en un, puis saisissez vos achats : le prix de revient et les plus-values se calculent seuls.');
    fireEvent.click(screen.getByLabelText('Afficher les archivés'));
    expect(await screen.findByText('Action Alpha')).toBeTruthy();
    expect(screen.getByText('archivé')).toBeTruthy();
  });
});

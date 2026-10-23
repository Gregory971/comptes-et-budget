// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Layout } from './Layout';
import { OperationsScreen } from '../screens/OperationsScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import { taskService } from '../services/taskService';
import { useStore } from '../store/useStore';
import type { Database } from '../types';

let base: Database;
let compte: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base recherche UI', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
  useStore.setState({ activeDbId: base.id, screen: 'accueil', pendingFocus: undefined });
});

afterEach(cleanup);

const ouvrir = async () => {
  render(<Layout><div /></Layout>);
  // Le bouton n'apparaît qu'une fois la base active chargée.
  fireEvent.click(await screen.findByRole('button', { name: /Rechercher/ }));
  return screen.findByRole('dialog', { name: 'Rechercher' });
};
const saisir = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

describe('recherche globale', () => {
  it('s’ouvre par le bouton de la barre latérale', async () => {
    const d = await ouvrir();
    expect(d.textContent).toMatch(/Tapez au moins 2 caractères/);
  });

  it('s’ouvre par Ctrl+K depuis n’importe où', async () => {
    render(<Layout><div /></Layout>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Rechercher' })).toBeTruthy();
  });

  it('s’ouvre aussi par ⌘K', async () => {
    render(<Layout><div /></Layout>);
    fireEvent.keyDown(document, { key: 'K', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Rechercher' })).toBeTruthy();
  });

  it('affiche les résultats groupés et leur nombre', async () => {
    await operationService.create({ dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 4250, label: 'Zz Courses' });
    await taskService.create({ dbId: base.id, kind: 'note', text: 'Zz note perso' });
    const d = await ouvrir();
    saisir(within(d).getByRole('searchbox'), 'zz');
    await waitFor(() => expect(within(d).getByRole('status').textContent).toMatch(/2 résultats/));
    expect(within(d).getByRole('region', { name: 'Opérations' })).toBeTruthy();
    expect(within(d).getByRole('region', { name: 'Tâches et notes' })).toBeTruthy();
    expect(within(d).getByText('Zz Courses')).toBeTruthy();
  });

  it('dit quand il n’y a aucun résultat, et se vide quand la saisie redevient trop courte', async () => {
    const d = await ouvrir();
    const champ = within(d).getByRole('searchbox');
    saisir(champ, 'introuvable');
    await waitFor(() => expect(within(d).getByRole('status').textContent).toMatch(/Aucun résultat/));
    saisir(champ, 'i');
    expect(within(d).getByRole('status').textContent).toMatch(/Tapez au moins 2/);
  });

  it('limite la recherche à un type', async () => {
    await operationService.create({ dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 100, label: 'Zz opération' });
    await taskService.create({ dbId: base.id, kind: 'note', text: 'Zz note' });
    const d = await ouvrir();
    fireEvent.change(within(d).getByLabelText('Dans'), { target: { value: 'tache' } });
    saisir(within(d).getByRole('searchbox'), 'zz');
    await waitFor(() => expect(within(d).getByRole('status').textContent).toMatch(/1 résultat\./));
    expect(within(d).queryByRole('region', { name: 'Opérations' })).toBeNull();
  });

  it('un résultat d’opération ouvre l’écran Opérations, au bon mois et déjà filtré', async () => {
    await operationService.create({ dbId: base.id, accountId: compte, date: '2025-03-12', kind: 'depense', amountCents: 9900, label: 'Zz Vieille facture' });
    await operationService.create({ dbId: base.id, accountId: compte, date: '2025-03-14', kind: 'depense', amountCents: 100, label: 'Autre ligne' });
    const d = await ouvrir();
    saisir(within(d).getByRole('searchbox'), 'vieille facture');
    fireEvent.click(await within(d).findByText('Zz Vieille facture'));

    expect(useStore.getState().screen).toBe('operations');
    expect(useStore.getState().pendingFocus).toEqual({ search: 'vieille facture', date: '2025-03-12' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechercher' })).toBeNull());

    cleanup();
    render(<OperationsScreen database={base} />);
    expect(await screen.findByText('Zz Vieille facture')).toBeTruthy();                  // mars 2025 affiché
    expect(screen.queryByText('Autre ligne')).toBeNull();                                  // filtre déjà posé
    expect((screen.getByLabelText('Rechercher une opération') as HTMLInputElement).value).toBe('vieille facture');
    expect(document.body.textContent).toMatch(/mars 2025/i);
    expect(useStore.getState().pendingFocus).toBeUndefined();                              // consommé
  });

  it('un résultat d’un autre type ouvre l’écran correspondant', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'Zz appeler le notaire' });
    const d = await ouvrir();
    saisir(within(d).getByRole('searchbox'), 'notaire');
    fireEvent.click(await within(d).findByText('Zz appeler le notaire'));
    expect(useStore.getState().screen).toBe('accueil');
    expect(useStore.getState().pendingFocus).toBeUndefined();
  });

  it('ne garde que la réponse de la dernière frappe', async () => {
    await operationService.create({ dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 100, label: 'Alpha' });
    await operationService.create({ dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 100, label: 'Bravo' });
    const d = await ouvrir();
    const champ = within(d).getByRole('searchbox');
    saisir(champ, 'alpha');
    saisir(champ, 'bravo');
    await waitFor(() => expect(within(d).getByText('Bravo')).toBeTruthy());
    expect(within(d).queryByText('Alpha')).toBeNull();
  });
});

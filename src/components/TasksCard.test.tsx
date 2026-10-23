// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksCard } from './TasksCard';
import { HomeScreen } from '../screens/HomeScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { taskService } from '../services/taskService';
import type { Database } from '../types';

let base: Database;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base tâches UI', 'perso');
});

afterEach(cleanup);

const saisir = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

describe('carte Tâches, notes, rappels', () => {
  it('ajoute une tâche avec une date et l’affiche', async () => {
    render(<TasksCard dbId={base.id} />);
    saisir(screen.getByLabelText('Texte'), 'Envoyer l’attestation');
    saisir(screen.getByLabelText('Avant le'), '2099-03-01');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText(/Envoyer l’attestation/)).toBeTruthy();
    expect((screen.getByLabelText('Texte') as HTMLInputElement).value).toBe('');
    expect((await db.tasks.toArray())[0]).toMatchObject({ kind: 'tache', due: '2099-03-01' });
  });

  it('exige une date pour un rappel et le dit', async () => {
    render(<TasksCard dbId={base.id} />);
    saisir(screen.getByLabelText('Type'), 'rappel');
    saisir(screen.getByLabelText('Texte'), 'Renouveler la carte');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/besoin d’une date/);
    expect(await db.tasks.count()).toBe(0);
  });

  it('une note n’a pas de champ de date', () => {
    render(<TasksCard dbId={base.id} />);
    saisir(screen.getByLabelText('Type'), 'note');
    expect(screen.queryByLabelText('Avant le')).toBeNull();
    expect(screen.queryByLabelText('Date du rappel')).toBeNull();
  });

  it('signale les retards, par le texte et pas seulement par la couleur', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'Vieille tâche', due: '2020-01-01' });
    render(<TasksCard dbId={base.id} />);
    await screen.findByText(/Vieille tâche/);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 à faire · 1 en retard/));
    expect(screen.getByText(/En retard :/)).toBeTruthy();
  });

  it('coche une tâche, la raye, puis supprime les terminées', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'À cocher' });
    render(<TasksCard dbId={base.id} />);
    fireEvent.click(await screen.findByLabelText('Terminer : À cocher'));
    await waitFor(() => expect(screen.getByLabelText('Rouvrir : À cocher')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/0 à faire/);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer les 1 terminée(s)' }));
    await waitFor(async () => expect(await db.tasks.count()).toBe(0));
  });

  it('modifie le texte d’une tâche', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'Avant' });
    render(<TasksCard dbId={base.id} />);
    fireEvent.click(await screen.findByLabelText('Modifier : Avant'));
    const champ = screen.getAllByLabelText('Texte').find(e => (e as HTMLInputElement).value === 'Avant') as HTMLInputElement;
    saisir(champ, 'Après');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => expect((await db.tasks.toArray())[0].text).toBe('Après'));
  });

  it('une note ne se coche pas et se supprime', async () => {
    await taskService.create({ dbId: base.id, kind: 'note', text: 'Code du portail 1234' });
    render(<TasksCard dbId={base.id} />);
    await screen.findByText(/Code du portail 1234/);
    expect(screen.queryByLabelText(/Terminer : Code du portail/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Supprimer : Code du portail 1234'));
    await waitFor(async () => expect(await db.tasks.count()).toBe(0));
  });

  it('s’affiche sur le tableau de bord', async () => {
    await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' });
    render(<HomeScreen database={base} />);
    expect(await screen.findByText('Tâches, notes, rappels')).toBeTruthy();
  });
});

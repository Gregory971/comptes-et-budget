// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OperationForm } from './OperationForm';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { categoryService } from '../services/referentialService';
import type { Account, Database } from '../types';
import type { OperationInput } from '../services/operationService';

let database: Database;
let compte: Account;
let ids: { alim: string; entretien: string };

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  database = await dbService.create('Base ventilation', 'perso');
  compte = await accountService.create({
    dbId: database.id, name: 'Courant', type: 'courant', initialBalanceCents: 100_000, startDate: '2026-01-01',
  });
  const g = await categoryService.createGroup(database.id, 'Vie courante', 'depense');
  ids = {
    alim: (await categoryService.createCategory(database.id, g.id, 'Alimentation', '🛒')).id,
    entretien: (await categoryService.createCategory(database.id, g.id, 'Entretien', '🧹')).id,
  };
});

afterEach(cleanup);

function monter(onSubmit = vi.fn(), initial?: Parameters<typeof OperationForm>[0]['initial']) {
  render(<OperationForm dbId={database.id} accounts={[compte]} submitLabel="Enregistrer"
    initial={initial} onSubmit={onSubmit} />);
  return onSubmit;
}

const montant = () => screen.getByLabelText('Combien — montant (€)') as HTMLInputElement;
const saisir = (el: HTMLElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };

describe('ventilation dans le formulaire d’opération', () => {
  it('ventile un montant sur deux catégories et transmet les parts', async () => {
    const onSubmit = monter();
    saisir(montant(), '87');
    fireEvent.click(await screen.findByRole('button', { name: 'Ventiler sur plusieurs catégories' }));

    const groupe = await screen.findByRole('group', { name: 'Ventilation par catégorie' });
    expect(within(groupe).getByRole('status').textContent).toMatch(/Reste à ventiler : 87,00/);

    await waitFor(() => expect(within(groupe).getByLabelText('Catégorie de la ligne 1')).toBeTruthy());
    fireEvent.change(within(groupe).getByLabelText('Catégorie de la ligne 1'), { target: { value: ids.alim } });
    saisir(within(groupe).getByLabelText('Montant de la ligne 1'), '60');
    expect(within(groupe).getByRole('status').textContent).toMatch(/Reste à ventiler : 27,00/);

    fireEvent.change(within(groupe).getByLabelText('Catégorie de la ligne 2'), { target: { value: ids.entretien } });
    fireEvent.click(within(groupe).getByRole('button', { name: 'Reporter sur la dernière ligne' }));
    expect(within(groupe).getByRole('status').textContent).toMatch(/Ventilation complète/);

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const envoi = onSubmit.mock.calls[0][0] as Omit<OperationInput, 'dbId'>;
    expect(envoi.amountCents).toBe(8700);
    expect(envoi.categoryId).toBeUndefined();
    expect(envoi.splits).toEqual([
      { categoryId: ids.alim, amountCents: 6000 },
      { categoryId: ids.entretien, amountCents: 2700 },
    ]);
  });

  it('refuse l’enregistrement tant que la ventilation ne tombe pas juste', async () => {
    const onSubmit = monter();
    saisir(montant(), '87');
    fireEvent.click(await screen.findByRole('button', { name: 'Ventiler sur plusieurs catégories' }));
    const groupe = await screen.findByRole('group', { name: 'Ventilation par catégorie' });
    saisir(within(groupe).getByLabelText('Montant de la ligne 1'), '60');
    saisir(within(groupe).getByLabelText('Montant de la ligne 2'), '20');

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/manque 7,00 €/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('signale un dépassement', async () => {
    monter();
    saisir(montant(), '10');
    fireEvent.click(await screen.findByRole('button', { name: 'Ventiler sur plusieurs catégories' }));
    const groupe = await screen.findByRole('group', { name: 'Ventilation par catégorie' });
    saisir(within(groupe).getByLabelText('Montant de la ligne 1'), '8');
    saisir(within(groupe).getByLabelText('Montant de la ligne 2'), '5');
    expect(within(groupe).getByRole('status').textContent).toMatch(/Dépassement de 3,00/);
  });

  it('exige un montant valide sur chaque ligne', async () => {
    const onSubmit = monter();
    saisir(montant(), '10');
    fireEvent.click(await screen.findByRole('button', { name: 'Ventiler sur plusieurs catégories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/chaque ligne/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('garde au moins deux lignes', async () => {
    monter();
    saisir(montant(), '10');
    fireEvent.click(await screen.findByRole('button', { name: 'Ventiler sur plusieurs catégories' }));
    const groupe = await screen.findByRole('group', { name: 'Ventilation par catégorie' });
    expect((within(groupe).getByRole('button', { name: 'Retirer la ligne 1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(groupe).getByRole('button', { name: '+ Ajouter une ligne' }));
    expect((within(groupe).getByRole('button', { name: 'Retirer la ligne 1' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(groupe).getAllByLabelText(/Montant de la ligne/)).toHaveLength(3);
  });

  it('rouvre une opération ventilée avec ses lignes et revient à une catégorie unique', async () => {
    const onSubmit = monter(vi.fn(), {
      kind: 'depense', amountCents: -8700, accountId: compte.id,
      splits: [{ categoryId: ids.alim, amountCents: -6000 }, { categoryId: ids.entretien, amountCents: -2700 }],
    });
    const groupe = await screen.findByRole('group', { name: 'Ventilation par catégorie' });
    expect((within(groupe).getByLabelText('Montant de la ligne 1') as HTMLInputElement).value).toBe('60.00');
    expect(within(groupe).getByRole('status').textContent).toMatch(/Ventilation complète/);

    fireEvent.click(screen.getByRole('button', { name: 'Revenir à une catégorie' }));
    expect(screen.queryByRole('group', { name: 'Ventilation par catégorie' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const envoi = onSubmit.mock.calls[0][0] as Omit<OperationInput, 'dbId'>;
    expect(envoi.splits).toBeUndefined();
    expect(envoi.categoryId).toBe(ids.alim);
  });
});

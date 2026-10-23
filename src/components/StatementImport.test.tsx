// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StatementImport } from './StatementImport';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import type { Account, Database } from '../types';

let base: Database;
let comptes: Account[];

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base import UI', 'perso');
  comptes = [
    await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 100_000, startDate: '2026-01-01' }),
    await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 100_000, startDate: '2026-01-01' }),
  ];
});

afterEach(cleanup);

const NL = String.fromCharCode(10);
const fichier = (nom: string, ...lignes: string[]) => new File([lignes.join(NL) + NL], nom, { type: 'text/plain' });

async function importer(f: File) {
  const { container } = render(<StatementImport dbId={base.id} accounts={comptes} />);
  fireEvent.change(container.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [f] } });
  return screen.findByRole('dialog', { name: /Relevé/ });
}

describe('import d’un relevé QIF', () => {
  it('lit le fichier, annonce le format et importe les lignes retenues', async () => {
    const dialog = await importer(fichier('releve.qif', '!Type:Bank', 'D25/10/2026', 'T-42,50', 'PCarrefour', 'MCourses', '^', 'D26/10/2026', 'T1500,00', 'PEmployeur', '^'));
    // La fenêtre s'ouvre avant que les lignes soient confrontées à la base : on attend qu'elles soient là.
    await waitFor(() => expect(dialog.textContent).toMatch(/2 ligne\(s\) lue\(s\)/));
    expect(dialog.textContent).toMatch(/Format QIF/);
    expect(within(dialog).getByText(/Carrefour — Courses/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Importer 2 opération(s)' }));
    await screen.findByText(/2 opération\(s\) importée\(s\)/);
    const ops = await db.operations.toArray();
    expect(ops.map(o => [o.date, o.amountCents]).sort()).toEqual([['2026-10-25', -4250], ['2026-10-26', 150_000]]);
  });

  it('accepte un fichier QIF dans le sélecteur', () => {
    const { container } = render(<StatementImport dbId={base.id} accounts={comptes} />);
    expect((container.querySelector('input[type=file]') as HTMLInputElement).accept).toMatch(/\.qif/);
  });
});

describe('liaison d’un virement à l’import', () => {
  async function avecCandidat() {
    await operationService.create({ dbId: base.id, accountId: comptes[1].id, date: '2026-10-24', kind: 'recette', amountCents: 20_000, label: 'Versement' });
    return importer(fichier('releve.qif', '!Type:Bank', 'D25/10/2026', 'T-200,00', 'PVIR LIVRET', '^'));
  }

  it('propose le virement probable sans le lier d’office', async () => {
    const dialog = await avecCandidat();
    const case_ = await within(dialog).findByLabelText(/Lier la ligne du .* en virement avec Livret/);
    expect((case_ as HTMLInputElement).checked).toBe(false);
    expect(dialog.textContent).toMatch(/Virement probable vers « Livret »/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importer 1 opération(s)' }));
    await screen.findByText(/1 opération\(s\) importée\(s\)/);
    expect((await db.operations.toArray()).every(o => o.kind !== 'virement')).toBe(true);
  });

  it('lie les deux opérations quand la case est cochée', async () => {
    const dialog = await avecCandidat();
    fireEvent.click(await within(dialog).findByLabelText(/Lier la ligne du .* en virement avec Livret/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importer 1 opération(s)' }));
    await screen.findByText(/1 virement\(s\) lié\(s\) à une opération existante/);
    const ops = await db.operations.toArray();
    expect(ops).toHaveLength(2);
    expect(ops.every(o => o.kind === 'virement')).toBe(true);
    expect(new Set(ops.map(o => o.transferId)).size).toBe(1);
  });

  it('ne propose rien sans opération correspondante', async () => {
    const dialog = await importer(fichier('releve.qif', '!Type:Bank', 'D25/10/2026', 'T-200,00', 'PVIR', '^'));
    await waitFor(() => expect(dialog.textContent).toMatch(/1 ligne\(s\) lue\(s\)/));
    expect(within(dialog).queryByLabelText(/Lier la ligne/)).toBeNull();
  });
});

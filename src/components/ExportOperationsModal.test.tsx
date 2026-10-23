// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExportOperationsModal } from './ExportOperationsModal';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import type { Account, Database } from '../types';

let base: Database;
let comptes: Account[];
let blobs: Blob[];

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base export UI', 'perso');
  comptes = [
    await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' }),
    await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 0, startDate: '2026-01-01' }),
  ];
  for (const [date, a] of [['2026-08-05', 0], ['2026-08-20', 0], ['2026-09-02', 1]] as const) {
    await operationService.create({ dbId: base.id, accountId: comptes[a].id, date, kind: 'depense', amountCents: 1000, label: `Op ${date}` });
  }
  // jsdom n'implémente pas les URL d'objet : on capte ce qui serait téléchargé.
  blobs = [];
  URL.createObjectURL = (b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const monter = (over: Partial<Parameters<typeof ExportOperationsModal>[0]> = {}) =>
  render(<ExportOperationsModal dbId={base.id} accounts={comptes} from="2026-08-01" to="2026-08-31" onClose={() => {}} {...over} />);

const lireBlob = (b: Blob) => new Promise<string>(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });

describe('fenêtre d’export des opérations', () => {
  it('annonce combien d’opérations seront exportées, selon la période et le compte', async () => {
    monter();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 opération\(s\) seront exportées/));
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: 'tout' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/3 opération\(s\)/));
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: comptes[1].id } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 opération\(s\)/));
  });

  it('propose le compte affiché à l’écran', async () => {
    monter({ accountId: comptes[1].id, from: '2026-09-01', to: '2026-09-30' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/1 opération\(s\)/));
    expect((screen.getByLabelText('Compte') as HTMLSelectElement).value).toBe(comptes[1].id);
  });

  it('télécharge un CSV avec les options choisies', async () => {
    monter();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 opération/));
    fireEvent.change(screen.getByLabelText('Séparateur de colonnes'), { target: { value: ',' } });
    fireEvent.change(screen.getByLabelText('Séparateur des décimales'), { target: { value: '.' } });
    fireEvent.change(screen.getByLabelText('Format des dates'), { target: { value: 'iso' } });
    fireEvent.click(screen.getByLabelText('Avec l’en-tête des colonnes'));
    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    const texte = (await lireBlob(blobs[0])).replace('\uFEFF', '');
    expect(texte.split('\r\n').filter(Boolean)).toEqual([
      '2026-08-05,Courant,EUR,,,,,Op 2026-08-05,,-10.00,Non',
      '2026-08-20,Courant,EUR,,,,,Op 2026-08-20,,-10.00,Non',
    ]);
    expect((await screen.findByRole('status')).textContent).toMatch(/2 opération\(s\) exportée\(s\) dans « Comptes-et-Budget_operations_.*\.csv »/);
  });

  it('masque les options CSV pour un autre format et télécharge un classeur Excel', async () => {
    monter();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'xlsx' } });
    expect(screen.queryByLabelText('Séparateur de colonnes')).toBeNull();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 opération/));
    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(blobs[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(blobs[0].size).toBeGreaterThan(500);
  });

  it('n’offre pas le détail de ventilation pour QIF et OFX, qui n’ont qu’une catégorie', () => {
    monter();
    expect(screen.getByLabelText(/Détailler les opérations ventilées/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'qif' } });
    expect(screen.queryByLabelText(/Détailler les opérations ventilées/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'ofx' } });
    expect(screen.queryByLabelText('Format des dates')).toBeNull();
  });

  it('désactive l’export quand il n’y a rien à exporter', async () => {
    monter({ from: '2030-01-01', to: '2030-01-31' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Aucune opération à exporter/));
    expect((screen.getByRole('button', { name: 'Exporter' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' })).toBeTruthy();
  });
});

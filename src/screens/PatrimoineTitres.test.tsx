// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BiensScreen } from './BiensScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { assetService } from '../services/patrimoineService';
import { securityService } from '../services/securityService';
import type { Database } from '../types';

let base: Database;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base patrimoine', 'perso');
});

afterEach(cleanup);

describe('patrimoine et portefeuille de titres', () => {
  it('ajoute la valeur du portefeuille au patrimoine total et à sa répartition', async () => {
    await assetService.create(base.id, { name: 'Appartement', type: 'immobilier', valueCents: 20_000_000 });
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    await securityService.setPrice({ dbId: base.id, securityId: t.id, date: '2026-02-01', price: 60 });
    render(<BiensScreen database={base} />);
    await waitFor(() => expect(document.querySelector('.patri-val')?.textContent).toMatch(/200\s600,00/));       // 200 000 + 600
    expect(await screen.findByText('Portefeuille de titres')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Portefeuille de titres 0 %/ })).toBeTruthy();                        // 600 / 200 600 ≈ 0 %
  });

  it('sans titre, le patrimoine ne change pas et aucune ligne de portefeuille n’apparaît', async () => {
    await assetService.create(base.id, { name: 'Voiture', type: 'vehicule', valueCents: 1_000_000 });
    render(<BiensScreen database={base} />);
    await waitFor(() => expect(document.querySelector('.patri-val')?.textContent).toMatch(/10\s000,00/));
    expect(screen.queryByText('Portefeuille de titres')).toBeNull();
  });

  it('un titre archivé n’entre pas dans le patrimoine', async () => {
    const t = await securityService.create({ dbId: base.id, name: 'Action Alpha' });
    await securityService.addTx({ dbId: base.id, securityId: t.id, date: '2026-01-10', type: 'achat', quantity: 10, unitPrice: 50 });
    await securityService.archive(t.id);
    render(<BiensScreen database={base} />);
    await waitFor(() => expect(document.querySelector('.patri-val')?.textContent).toMatch(/^0,00/));
    expect(screen.queryByText('Portefeuille de titres')).toBeNull();
  });
});

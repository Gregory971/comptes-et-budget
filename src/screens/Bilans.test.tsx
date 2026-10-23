// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BilansScreen } from './BilansScreen';
import { MultiLineChart } from '../components/Charts';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import { payeeService } from '../services/referentialService';
import { projectService } from '../services/patrimoineService';
import type { Account, Database } from '../types';

let base: Database;
let comptes: Account[];

const aujourdhui = new Date();
const ce = (jour: number) => `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base bilans UI', 'perso');
  comptes = [
    await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 100_000, startDate: '2020-01-01' }),
    await accountService.create({ dbId: base.id, name: 'Livret', type: 'epargne', initialBalanceCents: 50_000, startDate: '2020-01-01' }),
  ];
});

afterEach(cleanup);

describe('écran Bilans — nouveaux graphiques', () => {
  it('affiche les dépenses par tiers et par projet, et l’évolution sur douze mois', async () => {
    const t = await payeeService.create(base.id, 'Zz Carrefour');
    const p = await projectService.create(base.id, { name: 'Zz Vacances', targetAmountCents: 100_000, openingSavedCents: 0 });
    await operationService.create({ dbId: base.id, accountId: comptes[0].id, date: ce(1), kind: 'depense', amountCents: 4_000, payeeId: t.id, projectId: p.id });
    render(<BilansScreen database={base} />);

    expect(await screen.findByText('Dépenses par tiers')).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Répartition des dépenses par tiers, total 40,00/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Répartition des dépenses par projet ou bien, total 40,00/ })).toBeTruthy();
    expect(screen.getAllByText(/Zz Carrefour/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Projet : Zz Vacances/).length).toBeGreaterThan(0);

    expect(await screen.findByText('Recettes et dépenses sur 12 mois')).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Évolution du solde des comptes/ })).toBeTruthy();
  });

  it('dit quand aucune dépense n’est rattachée à un projet ou à un bien', async () => {
    await operationService.create({ dbId: base.id, accountId: comptes[0].id, date: ce(1), kind: 'depense', amountCents: 4_000 });
    render(<BilansScreen database={base} />);
    expect(await screen.findByText(/Aucune dépense rattachée à un projet ou à un bien/)).toBeTruthy();
  });

  it('l’évolution des comptes liste chaque compte avec son dernier solde et le total', async () => {
    render(<BilansScreen database={base} />);
    const carte = (await screen.findByText('Évolution des comptes sur 12 mois')).closest('.card') as HTMLElement;
    await waitFor(() => expect(within(carte).getByText('Courant')).toBeTruthy());
    expect(within(carte).getByText('Livret')).toBeTruthy();
    expect(within(carte).getByText('Total')).toBeTruthy();
    expect(carte.textContent).toMatch(/1\s500,00/);       // total 1 000 + 500
  });

  it('se limite au compte choisi, sans courbe de total', async () => {
    render(<BilansScreen database={base} />);
    await screen.findByText('Évolution des comptes sur 12 mois');
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: comptes[1].id } });
    const carte = screen.getByText('Évolution des comptes sur 12 mois').closest('.card') as HTMLElement;
    await waitFor(() => expect(within(carte).queryByText('Courant')).toBeNull());
    expect(within(carte).getByText('Livret')).toBeTruthy();
    expect(within(carte).queryByText('Total')).toBeNull();
  });
});

describe('graphique multi-courbes', () => {
  const series = [
    { id: 'a', name: 'Courant', values: [1_000, 2_000, 1_500] },
    { id: 'b', name: 'Livret', values: [500, 500, 700] },
  ];

  it('trace une courbe par série, avec légende et titre accessible résumant départ et arrivée', () => {
    const { container } = render(<MultiLineChart labels={['août 26', 'sept. 26', 'oct. 26']} series={series} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    const titre = screen.getByRole('img').querySelector('title')!.textContent!;
    expect(titre).toMatch(/de août 26 à oct\. 26/);
    expect(titre).toMatch(/Courant : de 10,00\s€ à 15,00\s€/);
    expect(titre).toMatch(/Livret : de 5,00\s€ à 7,00\s€/);
    expect(screen.getByText('Courant')).toBeTruthy();
  });

  it('ajoute le total en pointillé quand on le fournit', () => {
    const { container } = render(<MultiLineChart labels={['a', 'b', 'c']} series={series} totalLabel={{ name: 'Total', values: [1_500, 2_500, 2_200] }} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
    expect(container.querySelector('polyline[stroke-dasharray]')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('gère les soldes négatifs (la ligne zéro reste dans le cadre) et l’absence de données', () => {
    const { container, rerender } = render(<MultiLineChart labels={['a', 'b']} series={[{ id: 'a', name: 'À découvert', values: [-500, -200] }]} />);
    const ys = [...container.querySelectorAll('polyline')[0].getAttribute('points')!.split(' ')].map(p => Number(p.split(',')[1]));
    expect(ys.every(y => y >= 0 && y <= 240)).toBe(true);
    rerender(<MultiLineChart labels={[]} series={[]} />);
    expect(screen.getByText(/Aucune donnée/)).toBeTruthy();
  });

  it('n’affiche qu’une étiquette de mois sur deux quand il y en a beaucoup', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const { container } = render(<MultiLineChart labels={labels} series={[{ id: 'a', name: 'A', values: labels.map((_, i) => i * 100) }]} />);
    const textes = [...container.querySelectorAll('svg > text')].map(t => t.textContent).filter(t => t?.startsWith('m'));
    expect(textes).toHaveLength(6);
  });
});

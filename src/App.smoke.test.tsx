// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { db } from './services/db';
import { dbService } from './services/dbService';
import { accountService } from './services/accountService';
import { operationService } from './services/operationService';
import { payeeService } from './services/referentialService';
import { scheduleService } from './services/scheduleService';
import { forecastService } from './services/forecastService';
import { formatEur } from './utils/money';
import { transferService } from './services/transferService';
import { useStore } from './store/useStore';
import { toCents } from './utils/money';

/**
 * Test de fumée : monte l'application complète sur une base réelle
 * (IndexedDB simulé) et vérifie que l'accueil affiche les bons montants.
 */
describe('application', () => {
  afterEach(cleanup);
  beforeAll(async () => {
    const base = await dbService.create('Base de test', 'perso');
    const courant = await accountService.create({
      dbId: base.id, name: 'Compte courant', type: 'courant',
      initialBalanceCents: toCents(1000), startDate: '2026-01-01',
    });
    const epargne = await accountService.create({
      dbId: base.id, name: 'Livret A', type: 'epargne',
      initialBalanceCents: toCents(5000), startDate: '2026-01-01',
    });
    await operationService.create({
      dbId: base.id, accountId: courant.id, date: '2026-08-01',
      amountCents: toCents(250.5), kind: 'depense', label: 'Courses du mois',
    });
    await transferService.create({
      dbId: base.id, fromAccountId: courant.id, toAccountId: epargne.id,
      date: '2026-08-02', amountCents: toCents(100),
    });
    useStore.setState({ activeDbId: base.id, screen: 'accueil' });
  });

  it('affiche l’accueil avec les soldes attendus', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeTruthy());

    const normalise = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');
    // 1000 − 250,50 − 100 (virement émis) = 649,50
    await waitFor(() => {
      // Le solde total est porté par un indicateur du tableau de bord
      // (kpi-val), ceux des comptes par les cartes du bas (acc-val).
      const soldes = screen.getAllByText((_, el) => {
        const c = el?.className?.toString() ?? '';
        return c.includes('kpi-val') || c.includes('acc-val');
      }).map(el => normalise(el.textContent ?? ''));
      // Total : 649,50 + 5100 = 5749,50
      expect(soldes.some(t => t.includes('5 749,50'))).toBe(true);
      expect(soldes.some(t => t.includes('649,50'))).toBe(true);
      expect(soldes.some(t => t.includes('5 100,00'))).toBe(true);
    });

    expect(screen.getByText('Courses du mois')).toBeTruthy();
  });

  it('n’affiche pas l’assistant de premier démarrage', () => {
    render(<App />);
    expect(screen.queryByText('Bienvenue 👋')).toBeNull();
  });

  it('conserve la base active après changement d’écran', async () => {
    useStore.setState({ screen: 'bilans' });
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('Bilans').length).toBeGreaterThan(0));
    await waitFor(() => {
      // Le virement ne doit apparaître ni en recette ni en dépense.
      const cards = document.querySelectorAll('.card');
      const texte = Array.from(cards).map(c => c.textContent ?? '').join(' ')
        .replace(/[\u00A0\u202F]/g, ' ');
      expect(texte).toContain('250,50');
      expect(texte).not.toContain('100,00 €');
    });
    useStore.setState({ screen: 'accueil' });
  });
});

describe('saisie d’une opération avec un nouveau tiers', () => {
  afterEach(cleanup);

  it('crée le tiers et le rattache à l’opération enregistrée', async () => {
    // Régression : le tiers étant créé de façon asynchrone, un clic direct sur
    // « Enregistrer » enregistrait l'opération sans tiers rattaché.
    useStore.setState({ screen: 'comptabiliser' });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Comptabiliser' })).toBeTruthy());

    // Les comptes arrivent de façon asynchrone : on attend que le sélecteur soit
    // alimenté, ce qui vérifie au passage l'adoption automatique du premier compte.
    await waitFor(() =>
      expect(document.querySelectorAll('#op-acc option').length).toBeGreaterThan(0));
    expect((document.querySelector('#op-acc') as HTMLSelectElement).value).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Combien/), { target: { value: '42,50' } });
    fireEvent.change(screen.getByLabelText('Qui — tiers'), { target: { value: 'Boulangerie Milou' } });
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Pain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const dbId = useStore.getState().activeDbId!;
    let saved: Awaited<ReturnType<typeof operationService.list>>[number] | undefined;
    await waitFor(async () => {
      saved = (await operationService.list(dbId)).find(o => o.label === 'Pain');
      expect(saved).toBeTruthy();
    });
    expect(saved!.amountCents).toBe(-4250);
    expect(saved!.payeeId).toBeTruthy();   // le tiers est bien rattaché

    const payees = await payeeService.list(dbId);
    const tiers = payees.find(p => p.id === saved!.payeeId);
    expect(tiers?.name).toBe('Boulangerie Milou');

    useStore.setState({ screen: 'accueil' });
  });
});

describe('écran Opérations — bascule Réel / Prévisionnel', () => {
  afterEach(cleanup);

  it('affiche le solde estimé une fois le prévisionnel activé', async () => {
    const dbId = useStore.getState().activeDbId!;
    const [acc] = await accountService.list(dbId);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fin = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-28`;

    await scheduleService.create({
      dbId, accountId: acc.id, amountCents: toCents(300), kind: 'depense',
      periodicity: 'mensuelle', nextDate: fin,
      autoPost: false, holidayRule: 'exacte', label: 'Loyer prévisionnel',
    });

    useStore.setState({ screen: 'operations' });
    render(<App />);

    // Mode réel : aucune ligne prévisionnelle.
    await waitFor(() => expect(document.querySelector('.opstable tbody tr')).toBeTruthy());
    expect(document.querySelectorAll('tr.prevu')).toHaveLength(0);
    expect(document.querySelector('.forecast-bar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Prévisionnel' }));

    await waitFor(() => expect(document.querySelector('.forecast-bar')).toBeTruthy());
    expect(document.querySelectorAll('tr.prevu').length).toBeGreaterThan(0);
    expect(screen.getByText('Loyer prévisionnel')).toBeTruthy();

    // Le bandeau reprend bien le calcul du service.
    const attendu = await forecastService.build(dbId, undefined, new Date(), 'guadeloupe');
    const bandeau = (document.querySelector('.forecast-bar') as HTMLElement).textContent ?? '';
    const normalise = (t: string) => t.replace(/[\u00A0\u202F]/g, ' ');
    expect(normalise(bandeau)).toContain(normalise(formatEur(attendu.projectedCents)));
    expect(attendu.scheduledCents).toBe(toCents(-300));

    useStore.setState({ screen: 'accueil' });
  });
});

afterAll(() => db.close());

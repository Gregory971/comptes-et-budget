// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BudgetAlertBanner, BudgetAlertSettings, BudgetNavBadge, alertMessage } from './BudgetAlerts';
import { Layout } from './Layout';
import { HomeScreen } from '../screens/HomeScreen';
import { BudgetScreen } from '../screens/BudgetScreen';
import { PreferencesScreen } from '../screens/PreferencesScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import { categoryService } from '../services/referentialService';
import { budgetService } from '../services/budgetService';
import { budgetAlertService } from '../services/budgetAlertService';
import { useStore } from '../store/useStore';
import { today } from '../utils/date';
import type { Database } from '../types';

/** Un jour du mois COURANT : les alertes portent sur le mois en cours. */
const CE_MOIS = `${today().slice(0, 8)}10`;

let database: Database;
let cat: { courses: string; loisirs: string; sante: string };

async function depense(categoryId: string, amountCents: number) {
  const [account] = await accountService.list(database.id);
  await operationService.create({
    dbId: database.id, accountId: account.id, date: CE_MOIS, amountCents, kind: 'depense', categoryId,
  });
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  database = await dbService.create('Base alertes', 'perso');
  await accountService.create({
    dbId: database.id, name: 'Courant', type: 'courant', initialBalanceCents: 500000, startDate: '2026-01-01',
  });
  const g = await categoryService.createGroup(database.id, 'Vie courante', 'depense');
  cat = {
    courses: (await categoryService.createCategory(database.id, g.id, 'Courses', '🛒')).id,
    loisirs: (await categoryService.createCategory(database.id, g.id, 'Loisirs', '🎬')).id,
    sante: (await categoryService.createCategory(database.id, g.id, 'Santé', '💊')).id,
  };
  useStore.setState({ activeDbId: database.id, screen: 'accueil' });
});

afterEach(cleanup);

describe('bandeau du tableau de bord', () => {
  it('ne montre rien quand aucun budget n’est proche de son plafond', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 5000);
    render(<HomeScreen database={database} />);
    await screen.findByRole('heading', { name: 'Tableau de bord' });
    // Laisse le temps à la requête d’alertes de répondre avant de conclure à l’absence.
    await new Promise(r => setTimeout(r, 60));
    expect(screen.queryByRole('region', { name: /budget/i })).toBeNull();
  });

  it('liste les catégories concernées, dépassements d’abord, avec le montant en euros', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await budgetService.set(database.id, cat.loisirs, 10000);
    await budgetService.set(database.id, cat.sante, 10000);
    await depense(cat.courses, 8500);   // attention : reste 15,00 €
    await depense(cat.loisirs, 12500);  // dépassé de 25,00 €
    await depense(cat.sante, 2000);     // rien

    render(<HomeScreen database={database} />);
    const region = await screen.findByRole('region', { name: 'Budget dépassé' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    // Le niveau est écrit en toutes lettres, pas seulement signalé par la couleur.
    expect(items[0].textContent).toContain('Dépassé');
    expect(items[0].textContent).toContain('Loisirs');
    expect(items[0].textContent).toMatch(/dépassement de 25,00/);
    expect(items[1].textContent).toContain('Attention');
    expect(items[1].textContent).toContain('Courses');
    expect(items[1].textContent).toMatch(/85 % du budget utilisé/);
    expect(items[1].textContent).toMatch(/il reste 15,00/);
    expect(region.textContent).not.toContain('Santé');
  });

  it('annonce un résumé aux lecteurs d’écran', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await budgetService.set(database.id, cat.loisirs, 10000);
    await depense(cat.courses, 9000);
    await depense(cat.loisirs, 10100);
    render(<BudgetAlertBanner dbId={database.id} />);
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('2 alertes de budget, dont 1 dépassement');
  });

  it('le titre reste « bientôt atteint » tant que rien n’est dépassé', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 10000); // exactement 100 % : budget atteint, pas dépassé
    render(<BudgetAlertBanner dbId={database.id} />);
    const region = await screen.findByRole('region', { name: 'Budget bientôt atteint' });
    expect(region.textContent).toContain('Attention');
    expect(region.textContent).toMatch(/il reste 0,00/);
  });

  it('le lien « Voir le budget » ouvre l’écran Budget', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 9000);
    render(<BudgetAlertBanner dbId={database.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Voir le budget' }));
    expect(useStore.getState().screen).toBe('budget');
  });

  it('« Masquer pour ce mois » retire l’alerte, sans toucher aux autres', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await budgetService.set(database.id, cat.loisirs, 10000);
    await depense(cat.courses, 9000);
    await depense(cat.loisirs, 9500);
    render(<BudgetAlertBanner dbId={database.id} />);
    const region = await screen.findByRole('region');
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Masquer pour ce mois l’alerte Courses' }));
    await waitFor(() => expect(within(screen.getByRole('region')).getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByRole('region').textContent).toContain('Loisirs');

    fireEvent.click(screen.getByRole('button', { name: 'Masquer pour ce mois l’alerte Loisirs' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('disparaît quand les alertes sont désactivées', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 15000);
    render(<BudgetAlertBanner dbId={database.id} />);
    await screen.findByRole('region');
    await budgetAlertService.setEnabled(false);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('nomme une catégorie supprimée plutôt que d’afficher un blanc', async () => {
    await budgetService.set(database.id, 'categorie-disparue', 1000);
    await depense('categorie-disparue', 2000);
    render(<BudgetAlertBanner dbId={database.id} />);
    const region = await screen.findByRole('region');
    expect(region.textContent).toContain('Catégorie supprimée');
  });
});

describe('alertMessage', () => {
  const base = { categoryId: 'c', budgetCents: 10000, spentCents: 0, remainingCents: 0, overCents: 0, percent: 0 };
  it('n’affiche pas 100 % tant que le budget n’est pas atteint', () => {
    const msg = alertMessage({ ...base, level: 'attention', spentCents: 9960, remainingCents: 40, percent: 99.6 });
    expect(msg).toContain('99 %');
  });
});

describe('pastille de la barre latérale', () => {
  const montee = () => render(<Layout><p>contenu</p></Layout>);

  it('n’apparaît pas sans alerte', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 1000);
    montee();
    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    await new Promise(r => setTimeout(r, 60));
    expect(within(nav).getByRole('button', { name: 'Budget' })).toBeTruthy();
  });

  it('compte les alertes et le dit en texte sur le bouton Budget', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await budgetService.set(database.id, cat.loisirs, 10000);
    await depense(cat.courses, 8200);
    await depense(cat.loisirs, 10300);
    montee();
    const bouton = await screen.findByRole('button', { name: /^Budget, 2 alertes de budget, dont 1 dépassement$/ });
    expect(bouton.querySelector('.nav-alert')?.textContent).toBe('2');
    expect(bouton.querySelector('.nav-alert')?.classList.contains('depasse')).toBe(true);
    // Les autres entrées ne portent aucune pastille.
    expect(document.querySelectorAll('.nav-alert')).toHaveLength(1);
  });

  it('reste orange (attention) tant que rien n’est dépassé', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 8000);
    montee();
    const bouton = await screen.findByRole('button', { name: /^Budget, 1 alerte de budget$/ });
    expect(bouton.querySelector('.nav-alert')?.classList.contains('attention')).toBe(true);
  });

  it('BudgetNavBadge ne rend rien sans alerte', async () => {
    const { container } = render(<BudgetNavBadge dbId={database.id} />);
    await new Promise(r => setTimeout(r, 60));
    expect(container.textContent).toBe('');
  });
});

describe('écran Budget', () => {
  it('distingue « budget atteint » (attention) de « budget dépassé » et expose la valeur réelle', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await budgetService.set(database.id, cat.loisirs, 10000);
    await budgetService.set(database.id, cat.sante, 10000);
    await depense(cat.courses, 10000);  // 100 % pile
    await depense(cat.loisirs, 12500);  // 125 %
    await depense(cat.sante, 3000);     // 30 %
    render(<BudgetScreen database={database} />);

    const pile = await screen.findByRole('progressbar', { name: 'Consommation du budget Courses' });
    expect(pile.getAttribute('aria-valuetext')).toBe('100 % du budget');
    expect(pile.closest('.bud')?.textContent).toContain('Attention');
    expect(pile.closest('.bud')?.textContent).toMatch(/reste 0,00/);

    const trop = screen.getByRole('progressbar', { name: 'Consommation du budget Loisirs' });
    expect(trop.getAttribute('aria-valuenow')).toBe('100'); // la barre reste plafonnée
    expect(trop.getAttribute('aria-valuetext')).toBe('125 % du budget, dépassé');
    expect(trop.closest('.bud')?.classList.contains('depasse')).toBe(true);
    expect(trop.closest('.bud')?.textContent).toContain('Dépassé');
    expect(trop.closest('.bud')?.textContent).toMatch(/Budget dépassé de 25,00/);

    const calme = screen.getByRole('progressbar', { name: 'Consommation du budget Santé' });
    expect(calme.closest('.bud')?.className).toBe('bud');
    expect(calme.closest('.bud')?.textContent).not.toMatch(/Attention|Dépassé/);
  });

  it('suit le seuil choisi dans les Préférences', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 7500);
    render(<BudgetScreen database={database} />);
    const barre = await screen.findByRole('progressbar', { name: 'Consommation du budget Courses' });
    expect(barre.closest('.bud')?.textContent).not.toContain('Attention');

    await budgetAlertService.setThreshold(70);
    await waitFor(() => expect(
      screen.getByRole('progressbar', { name: 'Consommation du budget Courses' })
        .closest('.bud')?.textContent).toContain('Attention'));
  });

  it('garde les états visibles même si les alertes sont désactivées', async () => {
    await budgetAlertService.setEnabled(false);
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 15000);
    render(<BudgetScreen database={database} />);
    const barre = await screen.findByRole('progressbar', { name: 'Consommation du budget Courses' });
    expect(barre.closest('.bud')?.textContent).toContain('Dépassé');
  });
});

describe('réglages dans les Préférences', () => {
  it('propose les alertes activées à 80 % par défaut', async () => {
    render(<BudgetAlertSettings dbId={database.id} />);
    const case_ = screen.getByRole('checkbox', { name: 'Activer les alertes de budget' }) as HTMLInputElement;
    expect(case_.checked).toBe(true);
    const seuil = screen.getByRole('group', { name: 'Seuil d’attention' });
    expect(within(seuil).getByRole('button', { name: '80 %' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(seuil).getByRole('button', { name: '70 %' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('enregistre le seuil dans la table settings', async () => {
    render(<BudgetAlertSettings dbId={database.id} />);
    fireEvent.click(screen.getByRole('button', { name: '90 %' }));
    await waitFor(() => expect(
      screen.getByRole('button', { name: '90 %' }).getAttribute('aria-pressed')).toBe('true'));
    expect((await db.settings.get('budgetAlerts.threshold'))?.value).toBe(90);
  });

  it('désactive les alertes et grise le choix du seuil', async () => {
    render(<BudgetAlertSettings dbId={database.id} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Activer les alertes de budget' }));
    await waitFor(() => expect(
      (screen.getByRole('button', { name: '70 %' }) as HTMLButtonElement).disabled).toBe(true));
    expect((await db.settings.get('budgetAlerts.enabled'))?.value).toBe(false);
  });

  it('permet de réafficher les alertes masquées', async () => {
    await budgetService.set(database.id, cat.courses, 10000);
    await depense(cat.courses, 9000);
    render(<><BudgetAlertBanner dbId={database.id} /><BudgetAlertSettings dbId={database.id} /></>);
    expect(screen.queryByRole('button', { name: /Réafficher/ })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Masquer pour ce mois l’alerte Courses' }));
    const reafficher = await screen.findByRole('button', { name: 'Réafficher l’alerte masquée ce mois-ci' });
    expect(screen.queryByRole('region')).toBeNull();

    fireEvent.click(reafficher);
    await screen.findByRole('region');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Réafficher/ })).toBeNull());
  });

  it('apparaît dans l’onglet Général des Préférences', async () => {
    render(<PreferencesScreen database={database} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Général' }));
    expect(await screen.findByRole('checkbox', { name: 'Activer les alertes de budget' })).toBeTruthy();
  });
});

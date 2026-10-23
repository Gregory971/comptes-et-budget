// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BudgetScreen } from './BudgetScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import { categoryService } from '../services/referentialService';
import { budgetService } from '../services/budgetService';
import type { Database } from '../types';

let base: Database;
let compte: string;
let cats: { alim: string; loisirs: string; assurance: string };

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base budget UI', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2020-01-01' })).id;
  const g = await categoryService.createGroup(base.id, 'Zz groupe', 'depense');
  cats = {
    alim: (await categoryService.createCategory(base.id, g.id, 'Zz Alimentation')).id,
    loisirs: (await categoryService.createCategory(base.id, g.id, 'Zz Loisirs')).id,
    assurance: (await categoryService.createCategory(base.id, g.id, 'Zz Assurance')).id,
  };
});

afterEach(cleanup);

const saisir = (el: HTMLElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };
const option = async (label: string, texte: string) => {
  const sel = screen.getByLabelText(label) as HTMLSelectElement;
  await waitFor(() => expect(within(sel).getByRole('option', { name: new RegExp(texte) })).toBeTruthy());
  return (within(sel).getByRole('option', { name: new RegExp(texte) }) as HTMLOptionElement).value;
};

describe('écran Budget — périodes', () => {
  it('définit un budget annuel et annonce son lissage mensuel', async () => {
    render(<BudgetScreen database={base} />);
    fireEvent.change(screen.getByLabelText('Catégorie de dépense'), { target: { value: await option('Catégorie de dépense', 'Zz Assurance') } });
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '12' } });
    saisir(screen.getByLabelText('Montant du budget (€)'), '1200');
    expect(screen.getByRole('status').textContent).toMatch(/Soit 100,00\s€ par mois/);
    fireEvent.click(screen.getByRole('button', { name: 'Définir' }));
    await waitFor(async () => expect((await budgetService.list(base.id))[0]).toMatchObject({ monthlyAmountCents: 10_000, periodMonths: 12 }));
    expect(await screen.findByText(/Budget de 1\s200,00\s€ par an, lissé sur le mois/)).toBeTruthy();
  });

  it('refuse un montant manquant avec un message', async () => {
    render(<BudgetScreen database={base} />);
    fireEvent.change(screen.getByLabelText('Catégorie de dépense'), { target: { value: await option('Catégorie de dépense', 'Zz Alimentation') } });
    fireEvent.click(screen.getByRole('button', { name: 'Définir' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/supérieur à zéro/);
  });

  it('modifie un budget en reprenant sa saisie d’origine', async () => {
    await budgetService.setPeriodic(base.id, cats.assurance, 120_000, 12);
    render(<BudgetScreen database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier le budget Zz Assurance' }));
    expect((screen.getByLabelText('Montant du budget (€)') as HTMLInputElement).value).toBe('1200.00');
    expect((screen.getByLabelText('Période') as HTMLSelectElement).value).toBe('12');
    expect((screen.getByLabelText('Catégorie de dépense') as HTMLSelectElement).value).toBe(cats.assurance);
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '6' } });
    saisir(screen.getByLabelText('Montant du budget (€)'), '600');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => expect((await budgetService.list(base.id))[0]).toMatchObject({ monthlyAmountCents: 10_000, periodMonths: 6, periodAmountCents: 60_000 }));
    expect(await budgetService.list(base.id)).toHaveLength(1);
  });

  it('annule une modification sans rien enregistrer', async () => {
    await budgetService.set(base.id, cats.alim, 30_000);
    render(<BudgetScreen database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier le budget Zz Alimentation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('button', { name: 'Définir' })).toBeTruthy();
    expect((await budgetService.list(base.id))[0].monthlyAmountCents).toBe(30_000);
  });
});

describe('assistant d’initialisation', () => {
  beforeEach(async () => {
    const an = new Date().getFullYear() - 1;
    await operationService.create({ dbId: base.id, accountId: compte, date: `${an}-03-10`, kind: 'depense', amountCents: 120_000, categoryId: cats.alim });
    await operationService.create({ dbId: base.id, accountId: compte, date: `${an}-06-10`, kind: 'depense', amountCents: 24_000, categoryId: cats.loisirs });
  });

  const ouvrir = async () => {
    render(<BudgetScreen database={base} />);
    fireEvent.click(await screen.findByRole('button', { name: /Initialiser d’après les dépenses/ }));
    const d = await screen.findByRole('dialog', { name: /Initialiser le budget/ });
    fireEvent.change(within(d).getByLabelText('Période observée'), { target: { value: 'annee' } });
    return d;
  };

  it('propose la moyenne mensuelle de l’année précédente, arrondie à 5 € au supérieur', async () => {
    const d = await ouvrir();
    await waitFor(() => expect(within(d).getByLabelText('Budget proposé pour Zz Alimentation')).toBeTruthy());
    expect((within(d).getByLabelText('Budget proposé pour Zz Alimentation') as HTMLInputElement).value).toBe('100.00');   // 1 200 / 12
    expect((within(d).getByLabelText('Budget proposé pour Zz Loisirs') as HTMLInputElement).value).toBe('20.00');          // 240 / 12 = 20, déjà un multiple de 5
  });

  it('applique les budgets retenus et annonce le résultat', async () => {
    const d = await ouvrir();
    await waitFor(() => expect(within(d).getByLabelText('Budget proposé pour Zz Alimentation')).toBeTruthy());
    fireEvent.click(within(d).getByLabelText('Retenir Zz Loisirs'));                       // décoché : ne sera pas appliqué
    fireEvent.click(within(d).getByRole('button', { name: 'Appliquer' }));
    await waitFor(async () => expect((await budgetService.list(base.id)).map(b => b.categoryId)).toEqual([cats.alim]));
    expect(await screen.findByText(/1 budget\(s\) créé\(s\)/)).toBeTruthy();
  });

  it('un montant modifié à la main est celui qui est appliqué', async () => {
    const d = await ouvrir();
    await waitFor(() => expect(within(d).getByLabelText('Budget proposé pour Zz Alimentation')).toBeTruthy());
    saisir(within(d).getByLabelText('Budget proposé pour Zz Alimentation'), '250');
    fireEvent.click(within(d).getByRole('button', { name: 'Appliquer' }));
    await waitFor(async () => expect((await budgetService.list(base.id)).find(b => b.categoryId === cats.alim)?.monthlyAmountCents).toBe(25_000));
  });

  it('conserve un budget existant, sauf en mode « remplacer »', async () => {
    await budgetService.set(base.id, cats.alim, 99_900);
    const d = await ouvrir();
    await waitFor(() => expect(within(d).getByLabelText('Retenir Zz Alimentation')).toBeTruthy());
    expect((within(d).getByLabelText('Retenir Zz Alimentation') as HTMLInputElement).disabled).toBe(true);
    expect(d.textContent).toMatch(/déjà un budget/);
    fireEvent.click(within(d).getByRole('button', { name: 'Appliquer' }));
    await waitFor(async () => expect((await budgetService.list(base.id)).length).toBe(2));
    expect((await budgetService.list(base.id)).find(b => b.categoryId === cats.alim)?.monthlyAmountCents).toBe(99_900);
  });

  it('remplace les budgets existants quand on le demande', async () => {
    await budgetService.set(base.id, cats.alim, 99_900);
    const d = await ouvrir();
    await waitFor(() => expect(within(d).getByLabelText('Retenir Zz Alimentation')).toBeTruthy());
    fireEvent.click(within(d).getByLabelText(/Remplacer aussi les budgets déjà définis/));
    expect(d.textContent).toMatch(/sera remplacé/);
    fireEvent.click(within(d).getByRole('button', { name: 'Appliquer' }));
    await waitFor(async () => expect((await budgetService.list(base.id)).find(b => b.categoryId === cats.alim)?.monthlyAmountCents).toBe(10_000));
  });

  it('exige une période valide pour une plage libre', async () => {
    const d = await ouvrir();
    fireEvent.change(within(d).getByLabelText('Période observée'), { target: { value: 'perso' } });
    expect(d.textContent).toMatch(/Choisissez une période/);
    expect((within(d).getByRole('button', { name: 'Appliquer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('remet tous les budgets à zéro après confirmation', async () => {
    await budgetService.set(base.id, cats.alim, 100); await budgetService.set(base.id, cats.loisirs, 200);
    const d = await ouvrir();
    fireEvent.click(within(d).getByRole('button', { name: 'Remettre tous les budgets à zéro' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Remettre le budget à zéro' })).getByRole('button', { name: 'Tout supprimer' }));
    await waitFor(async () => expect(await budgetService.list(base.id)).toHaveLength(0));
    expect(await screen.findByText(/2 budget\(s\) supprimé\(s\)/)).toBeTruthy();
  });

  it('dit quand il n’y a rien à proposer', async () => {
    await db.operations.clear();
    const d = await ouvrir();
    await waitFor(() => expect(d.textContent).toMatch(/Aucune dépense catégorisée sur cette période/));
    expect((within(d).getByRole('button', { name: 'Appliquer' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

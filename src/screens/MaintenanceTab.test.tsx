// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MaintenanceTab } from './MaintenanceTab';
import { PreferencesScreen } from './PreferencesScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService } from '../services/operationService';
import { categoryService, payeeService } from '../services/referentialService';
import type { Database } from '../types';

let base: Database;
let compte: string;
let cats: { alim: string; courses: string; salaire: string };

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base maintenance UI', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
  const gd = await categoryService.createGroup(base.id, 'Zz dépenses', 'depense');
  const gr = await categoryService.createGroup(base.id, 'Zz revenus', 'recette');
  cats = {
    alim: (await categoryService.createCategory(base.id, gd.id, 'Zz Alimentation')).id,
    courses: (await categoryService.createCategory(base.id, gd.id, 'Zz Courses')).id,
    salaire: (await categoryService.createCategory(base.id, gr.id, 'Zz Salaire')).id,
  };
});

afterEach(cleanup);

const op = (over: object = {}) => operationService.create({
  dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 1000, ...over,
});
const choisir = (label: string, valeur: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: valeur } });
const optionDe = async (select: string, texte: string) => {
  const el = screen.getByLabelText(select) as HTMLSelectElement;
  await waitFor(() => expect(within(el).getByRole('option', { name: texte })).toBeTruthy());
  return (within(el).getByRole('option', { name: texte }) as HTMLOptionElement).value;
};

describe('onglet Maintenance', () => {
  it('est dans les Préférences', () => {
    render(<PreferencesScreen database={base} />);
    expect(screen.getByRole('tab', { name: 'Maintenance' })).toBeTruthy();
  });

  it('fusionne deux catégories après confirmation et annonce le résultat', async () => {
    await op({ categoryId: cats.courses }); await op({ categoryId: cats.courses });
    render(<MaintenanceTab database={base} />);
    choisir('À supprimer (remplacé par le suivant)', await optionDe('À supprimer (remplacé par le suivant)', 'Zz Courses'));
    await waitFor(() => expect(document.body.textContent).toMatch(/« Zz Courses » est utilisé par 2 opérations/));
    choisir('À conserver', await optionDe('À conserver', 'Zz Alimentation'));
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fusionner' });
    expect(dialog.textContent).toMatch(/Remplacer « Zz Courses » par « Zz Alimentation »/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fusionner' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Fusion faite : 2 opérations modifiées/));
    expect(await db.categories.get(cats.courses)).toBeUndefined();
    expect((await db.operations.toArray()).every(o => o.categoryId === cats.alim)).toBe(true);
  });

  it('n’active la fusion qu’avec deux éléments et signale un refus', async () => {
    render(<MaintenanceTab database={base} />);
    expect((screen.getByRole('button', { name: 'Fusionner' }) as HTMLButtonElement).disabled).toBe(true);
    choisir('À supprimer (remplacé par le suivant)', await optionDe('À supprimer (remplacé par le suivant)', 'Zz Courses'));
    choisir('À conserver', await optionDe('À conserver', 'Zz Salaire'));
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Fusionner' })).getByRole('button', { name: 'Fusionner' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/dépense avec une catégorie de recette/);
    expect(await db.categories.get(cats.courses)).toBeDefined();
  });

  it('fusionne des tiers', async () => {
    const a = await payeeService.create(base.id, 'Zz Carrefour');
    const b = await payeeService.create(base.id, 'Zz Carrefour Market');
    await op({ payeeId: b.id });
    render(<MaintenanceTab database={base} />);
    choisir('Élément', 'payees');
    choisir('À supprimer (remplacé par le suivant)', await optionDe('À supprimer (remplacé par le suivant)', 'Zz Carrefour Market'));
    choisir('À conserver', await optionDe('À conserver', 'Zz Carrefour'));
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Fusionner' })).getByRole('button', { name: 'Fusionner' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Fusion faite : 1 opération modifiée/));
    expect((await db.operations.toArray())[0].payeeId).toBe(a.id);
  });

  it('archive les tiers inutilisés depuis une date', async () => {
    const vieux = await payeeService.create(base.id, 'Zz Vieux');
    await op({ payeeId: vieux.id, date: '2018-01-01' });
    render(<MaintenanceTab database={base} />);
    fireEvent.change(screen.getByLabelText('Sans opération depuis le'), { target: { value: '2026-01-01' } });
    const bouton = await screen.findByRole('button', { name: /Archiver \d+ tiers/ });
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(bouton);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Archiver les tiers' })).getByRole('button', { name: 'Archiver' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/tiers archivés?\./));
    expect((await db.payees.get(vieux.id))?.archived).toBe(true);
  });

  it('remplace en masse après un aperçu chiffré', async () => {
    await op({ categoryId: cats.courses }); await op({ categoryId: cats.courses }); await op({ categoryId: cats.alim });
    render(<MaintenanceTab database={base} />);
    choisir('Remplacer', await optionDe('Remplacer', 'Zz Courses'));
    choisir('Par', await optionDe('Par', 'Zz Alimentation'));
    await waitFor(() => expect(document.body.textContent).toMatch(/2 opérations seront modifiées/));
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remplacer en masse' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remplacer' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/2 opérations modifiées\./));
    expect((await db.operations.toArray()).every(o => o.categoryId === cats.alim)).toBe(true);
  });

  it('refuse de remplacer une valeur par elle-même', async () => {
    render(<MaintenanceTab database={base} />);
    expect(document.body.textContent).toMatch(/Choisissez deux valeurs différentes/);
    expect((screen.getByRole('button', { name: 'Remplacer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ne supprime en masse qu’après avoir tapé le mot de confirmation, en gardant les opérations pointées', async () => {
    const pointee = await op({ categoryId: cats.alim });
    await operationService.toggleChecked(pointee.id, true);
    await op({ categoryId: cats.alim }); await op({ categoryId: cats.courses });
    render(<MaintenanceTab database={base} />);
    choisir('Catégorie', await optionDe('Catégorie', 'Zz Alimentation'));
    await waitFor(() => expect(document.body.textContent).toMatch(/1 opération sera supprimée/));
    const bouton = screen.getByRole('button', { name: 'Supprimer' }) as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Pour confirmer, tapez SUPPRIMER/), { target: { value: 'supprimer' } });
    expect(bouton.disabled).toBe(true);                    // la casse compte
    fireEvent.change(screen.getByLabelText(/Pour confirmer, tapez SUPPRIMER/), { target: { value: 'SUPPRIMER' } });
    expect(bouton.disabled).toBe(false);
    fireEvent.click(bouton);
    await waitFor(() => expect(document.body.textContent).toMatch(/1 opération supprimée\./));
    expect((await operationService.list(base.id)).map(o => o.id).sort()).toHaveLength(2);
    expect((await operationService.list(base.id)).some(o => o.id === pointee.id)).toBe(true);
  });

  it('avertit quand aucun critère ne limite la suppression', async () => {
    await op({});
    render(<MaintenanceTab database={base} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Aucun critère : TOUTES les opérations sont visées/));
  });
});

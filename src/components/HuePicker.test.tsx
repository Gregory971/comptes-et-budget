// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HuePicker } from './HuePicker';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { categoryService } from '../services/referentialService';

afterEach(cleanup);

describe('HuePicker', () => {
  it('propose « Automatique » par défaut et renvoie la teinte choisie', () => {
    const change = vi.fn();
    render(<HuePicker label="Couleur de Loyer" onChange={change} />);
    const choix = screen.getByLabelText('Couleur de Loyer') as HTMLSelectElement;
    expect(choix.value).toBe('');
    fireEvent.change(choix, { target: { value: '150' } });
    expect(change).toHaveBeenCalledWith(150);
  });

  it('revient à la teinte automatique en renvoyant undefined', () => {
    const change = vi.fn();
    render(<HuePicker value={250} label="Couleur" onChange={change} />);
    fireEvent.change(screen.getByLabelText('Couleur'), { target: { value: '' } });
    expect(change).toHaveBeenCalledWith(undefined);
  });
});

describe('teinte d’une catégorie', () => {
  it('se conserve puis s’efface pour revenir à la teinte du nom', async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    const base = await dbService.create('Teintes', 'perso');
    const g = await categoryService.createGroup(base.id, 'Maison', 'depense');
    const c = await categoryService.createCategory(base.id, g.id, 'Loyer');
    await categoryService.updateCategory(c.id, { hue: 150 });
    expect((await db.categories.get(c.id))?.hue).toBe(150);
    await categoryService.updateCategory(c.id, { hue: undefined });
    expect((await db.categories.get(c.id))?.hue).toBeUndefined();
  });
});

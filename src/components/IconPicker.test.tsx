// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { IconPicker } from './IconPicker';

/**
 * Le champ icône n'existait qu'à la création d'un groupe, sous forme de zone de
 * texte : il fallait connaître le raccourci du système pour composer un emoji, et
 * les catégories créées à la main n'en recevaient aucune. Ces tests fixent le
 * contrat du sélecteur qui les remplace — y compris le retrait d'une icône, seul
 * moyen de revenir en arrière une fois qu'on en a posé une.
 */
describe('sélecteur d’icône', () => {
  afterEach(cleanup);

  const ouvrir = (props: Partial<Parameters<typeof IconPicker>[0]> = {}) => {
    const onChange = vi.fn();
    render(<IconPicker value={props.value} onChange={props.onChange ?? onChange} />);
    fireEvent.click(screen.getByRole('button'));
    return onChange;
  };

  it('affiche l’icône courante sur le bouton', () => {
    render(<IconPicker value="🏠" onChange={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toBe('🏠');
  });

  it('signale à quoi sert le bouton quand aucune icône n’est posée', () => {
    render(<IconPicker value={undefined} onChange={vi.fn()} label="Icône du groupe" />);
    // Le bouton n'affiche qu'un « + » : sans nom accessible, il serait muet.
    expect(screen.getByRole('button', { name: /aucune/i })).toBeTruthy();
  });

  it('retourne l’emoji choisi dans la palette et referme', () => {
    const onChange = ouvrir();
    fireEvent.click(screen.getByRole('button', { name: 'Transport : 🚗' }));
    expect(onChange).toHaveBeenCalledWith('🚗');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('accepte un emoji absent de la palette', () => {
    const onChange = ouvrir();
    fireEvent.change(screen.getByLabelText('Autre emoji'), { target: { value: '🦜' } });
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser' }));
    expect(onChange).toHaveBeenCalledWith('🦜');
  });

  it('refuse de valider une saisie libre vide', () => {
    ouvrir();
    const utiliser = screen.getByRole('button', { name: 'Utiliser' }) as HTMLButtonElement;
    expect(utiliser.disabled).toBe(true);
  });

  it('permet de retirer l’icône', () => {
    const onChange = ouvrir({ value: '🏠' });
    fireEvent.click(screen.getByRole('button', { name: 'Aucune icône' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('marque l’icône déjà sélectionnée', () => {
    ouvrir({ value: '🚗' });
    const choisi = screen.getByRole('button', { name: 'Transport : 🚗' });
    expect(choisi.getAttribute('aria-pressed')).toBe('true');
  });

  it('ne propose aucun emoji en double', () => {
    ouvrir();
    const dialog = screen.getByRole('dialog');
    // Un même emoji présent dans deux thèmes rendrait « déjà sélectionné »
    // ambigu, et la recherche visuelle plus confuse.
    const emojis = within(dialog).getAllByRole('button')
      .map(b => b.textContent ?? '')
      .filter(t => t.length > 0 && t.length <= 4);
    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it('annule sans rien changer', () => {
    const onChange = ouvrir({ value: '🏠' });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

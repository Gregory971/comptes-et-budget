// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OpenedBackup } from './OpenedBackup';
import { ImportButton } from './ImportButton';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { backupService } from '../services/backupService';
import { encryptText } from '../services/cryptoService';
import { fauxPont } from '../utils/fauxPont';

let contenu: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  const base = await dbService.create('Base ouverte', 'perso');
  await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 1000, startDate: '2026-01-01' });
  contenu = JSON.stringify(await backupService.export());
  delete window.comptesBudget;
  // La copie de sécurité préalable passe par un téléchargement : on le neutralise.
  vi.spyOn(backupService, 'download').mockResolvedValue('copie.cbjson');
});

afterEach(() => { cleanup(); delete window.comptesBudget; vi.restoreAllMocks(); });

describe('sauvegarde ouverte par double-clic', () => {
  it('ne fait rien dans un navigateur', () => {
    const { container } = render(<OpenedBackup />);
    expect(container.innerHTML).toBe('');
  });

  it('ne montre rien quand aucune sauvegarde n’a été ouverte', async () => {
    window.comptesBudget = fauxPont();
    render(<OpenedBackup />);
    await waitFor(() => expect(window.comptesBudget!.takePendingBackup).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('présente la confirmation d’import habituelle avec le contenu du fichier', async () => {
    window.comptesBudget = fauxPont({ takePendingBackup: vi.fn().mockResolvedValue({ name: 'Ma base_2026-10-23.cbjson', content: contenu }) });
    render(<OpenedBackup />);
    const d = await screen.findByRole('dialog', { name: 'Confirmer l’import' });
    expect(d.textContent).toMatch(/Base ouverte/);
    expect(d.textContent).toMatch(/1 compte\(s\)/);
    expect(d.textContent).toMatch(/Cette base existe déjà/);                  // fusion ou remplacement : jamais d'écrasement silencieux
    expect(within(d).getByRole('button', { name: 'Importer' })).toBeTruthy();
  });

  it('n’importe rien tant que l’utilisateur n’a pas confirmé, et annuler laisse la base intacte', async () => {
    const restaurer = vi.spyOn(backupService, 'restore');
    window.comptesBudget = fauxPont({ takePendingBackup: vi.fn().mockResolvedValue({ name: 'a.cbjson', content: contenu }) });
    render(<OpenedBackup />);
    const d = await screen.findByRole('dialog', { name: 'Confirmer l’import' });
    expect(restaurer).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(restaurer).not.toHaveBeenCalled();
  });

  it('importe après confirmation', async () => {
    const restaurer = vi.spyOn(backupService, 'restore').mockResolvedValue();
    window.comptesBudget = fauxPont({ takePendingBackup: vi.fn().mockResolvedValue({ name: 'a.cbjson', content: contenu }) });
    render(<OpenedBackup />);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Confirmer l’import' })).getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(restaurer).toHaveBeenCalledTimes(1));
    expect(restaurer.mock.calls[0][1]).toBe('merge');                           // fusion par défaut
    expect(await screen.findByText('Sauvegarde fusionnée.')).toBeTruthy();
  });

  it('demande la phrase secrète d’une sauvegarde chiffrée', async () => {
    const chiffre = await encryptText(contenu, 'phrase de passe');
    window.comptesBudget = fauxPont({ takePendingBackup: vi.fn().mockResolvedValue({ name: 'a.cbjson', content: chiffre }) });
    render(<OpenedBackup />);
    const d = await screen.findByRole('dialog', { name: 'Sauvegarde chiffrée' });
    fireEvent.change(within(d).getByLabelText('Phrase secrète'), { target: { value: 'phrase de passe' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByRole('dialog', { name: 'Confirmer l’import' })).toBeTruthy();
  });

  it('refuse un fichier qui n’est pas une sauvegarde, en le disant', async () => {
    window.comptesBudget = fauxPont({ takePendingBackup: vi.fn().mockResolvedValue({ name: 'faux.cbjson', content: '{"bonjour":1}' }) });
    render(<OpenedBackup />);
    const d = await screen.findByRole('dialog', { name: 'Import impossible' });
    expect(within(d).getByRole('alert').textContent?.length).toBeGreaterThan(5);
  });

  it('prend en charge un second double-clic pendant que l’application tourne', async () => {
    let rappel: () => void = () => {};
    const desabonner = vi.fn();
    const take = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ name: 'b.cbjson', content: contenu });
    window.comptesBudget = fauxPont({ takePendingBackup: take, onBackupOpened: vi.fn().mockImplementation((cb: () => void) => { rappel = cb; return desabonner; }) });
    const { unmount } = render(<OpenedBackup />);
    await waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { rappel(); });
    expect(await screen.findByRole('dialog', { name: 'Confirmer l’import' })).toBeTruthy();
    unmount();
    expect(desabonner).toHaveBeenCalled();                                      // pas d'écouteur qui traîne
  });
});

describe('import par fichier fourni de l’extérieur', () => {
  it('le bouton reste affiché par défaut et se masque sur demande', () => {
    const { rerender } = render(<ImportButton />);
    expect(screen.getByRole('button', { name: /Importer/ })).toBeTruthy();
    rerender(<ImportButton hideButton />);
    expect(screen.queryByRole('button', { name: /Importer/ })).toBeNull();
  });

  it('prévient l’appelant dès que le fichier est pris en charge', async () => {
    const pris = vi.fn();
    render(<ImportButton hideButton externalFile={new File([contenu], 'a.cbjson')} onExternalHandled={pris} />);
    await waitFor(() => expect(pris).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('dialog', { name: 'Confirmer l’import' })).toBeTruthy();
  });
});

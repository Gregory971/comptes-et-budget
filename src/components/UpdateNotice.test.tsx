// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  options: undefined as unknown,
  updateSW: vi.fn(async (_reload?: boolean) => {}),
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (o: unknown) => { mocks.options = o; return mocks.updateSW; },
}));

import { OFFLINE_NOTICE_MS, UpdateNotice } from './UpdateNotice';
import { LockGate } from './LockGate';
import { Modal } from './Modal';
import { startPwaUpdates, usePwaUpdate } from '../services/pwaUpdate';
import { useAuth } from '../store/useAuth';

type Options = { onNeedRefresh: () => void; onOfflineReady: () => void };
const opts = () => mocks.options as Options;

const CONTENU = 'CONTENU DE L’APPLICATION';

beforeEach(() => {
  usePwaUpdate.setState({
    needRefresh: false, refreshDismissed: false, offlineReady: false, applying: false, error: null,
  });
  useAuth.setState({ status: 'unlocked', guarded: false, email: '', idleMinutes: 15 });
  mocks.updateSW.mockClear();
  startPwaUpdates();
});
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.innerHTML = ''; });

const nouvelleVersion = () => act(() => { opts().onNeedRefresh(); });
const recharger = () => fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));

describe('notice de mise à jour', () => {
  it('ne montre rien tant qu’aucune version n’attend', () => {
    const { container } = render(<UpdateNotice />);
    expect(container.textContent).toBe('');
  });

  it('annonce « Nouvelle version disponible » avec un bouton Recharger', () => {
    render(<UpdateNotice />);
    nouvelleVersion();
    expect(screen.getByRole('status').textContent).toContain('Nouvelle version disponible');
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeTruthy();
  });

  it('recharge aussitôt quand rien n’est en cours de saisie', () => {
    render(<UpdateNotice />);
    nouvelleVersion();
    recharger();
    expect(mocks.updateSW).toHaveBeenCalledWith(true);
  });

  it('« Plus tard » masque la notice sans recharger', () => {
    render(<UpdateNotice />);
    nouvelleVersion();
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByText(/Nouvelle version disponible/)).toBeNull();
    expect(mocks.updateSW).not.toHaveBeenCalled();
  });

  describe('saisie en cours', () => {
    it('demande confirmation quand une fenêtre est ouverte, sans recharger', () => {
      render(<><Modal title="Nouvelle opération" onClose={() => {}}><input aria-label="Montant" /></Modal><UpdateNotice /></>);
      nouvelleVersion();
      recharger();
      expect(screen.getByRole('alert').textContent).toMatch(/recharger maintenant l’abandonnerait/);
      expect(mocks.updateSW).not.toHaveBeenCalled();
    });

    it('demande confirmation quand un champ est rempli', () => {
      render(<><input aria-label="Libellé" /><UpdateNotice /></>);
      fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Courses' } });
      nouvelleVersion();
      recharger();
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(mocks.updateSW).not.toHaveBeenCalled();
    });

    it('« Revenir » annule sans rien perdre', () => {
      render(<><input aria-label="Libellé" /><UpdateNotice /></>);
      const champ = screen.getByLabelText('Libellé') as HTMLInputElement;
      fireEvent.change(champ, { target: { value: 'Courses' } });
      nouvelleVersion();
      recharger();
      fireEvent.click(screen.getByRole('button', { name: 'Revenir' }));
      expect(screen.getByRole('status')).toBeTruthy();
      expect(champ.value).toBe('Courses');
      expect(mocks.updateSW).not.toHaveBeenCalled();
    });

    it('« Recharger quand même » ne recharge qu’après cette confirmation explicite', () => {
      render(<><input aria-label="Libellé" /><UpdateNotice /></>);
      fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Courses' } });
      nouvelleVersion();
      recharger();
      expect(mocks.updateSW).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Recharger quand même' }));
      expect(mocks.updateSW).toHaveBeenCalledWith(true);
    });

    it('recharge sans confirmation une fois la saisie vidée', () => {
      render(<><input aria-label="Libellé" /><UpdateNotice /></>);
      const champ = screen.getByLabelText('Libellé');
      fireEvent.change(champ, { target: { value: 'Courses' } });
      fireEvent.change(champ, { target: { value: '' } });
      nouvelleVersion();
      recharger();
      expect(mocks.updateSW).toHaveBeenCalledWith(true);
    });
  });

  describe('verrou d’accès', () => {
    // La session n'est jamais persistée : on part d'un état « verrouillé » réel.
    const verrouille = () => useAuth.setState({
      status: 'locked', guarded: true, email: '', idleMinutes: 15,
    });

    it('s’affiche sur l’écran de connexion sans monter l’application', async () => {
      verrouille();
      render(<><LockGate><p>{CONTENU}</p></LockGate><UpdateNotice /></>);
      await screen.findByLabelText('Adresse électronique');
      nouvelleVersion();
      expect(screen.getByText(/Nouvelle version disponible/)).toBeTruthy();
      expect(screen.queryByText(CONTENU)).toBeNull();
      recharger();
      expect(mocks.updateSW).toHaveBeenCalledWith(true);
      // Recharger ne donne aucun accès : le contenu reste absent.
      expect(screen.queryByText(CONTENU)).toBeNull();
      expect(useAuth.getState().status).toBe('locked');
    });

    it('protège l’adresse déjà saisie sur l’écran de connexion', async () => {
      verrouille();
      render(<><LockGate><p>{CONTENU}</p></LockGate><UpdateNotice /></>);
      fireEvent.change(await screen.findByLabelText('Adresse électronique'), { target: { value: 'moi@example.com' } });
      nouvelleVersion();
      recharger();
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(mocks.updateSW).not.toHaveBeenCalled();
    });

    it('reste affichée quand le verrouillage démonte l’application', () => {
      render(<><LockGate><p>{CONTENU}</p></LockGate><UpdateNotice /></>);
      useAuth.setState({ status: 'unlocked', guarded: true });
      nouvelleVersion();
      expect(screen.getByText(CONTENU)).toBeTruthy();
      // Prévient que l'accès sera redemandé.
      expect(screen.getByRole('status').textContent).toMatch(/redemandera votre accès/);
      act(() => { useAuth.getState().lock(); });
      expect(screen.queryByText(CONTENU)).toBeNull();
      expect(screen.getByText(/Nouvelle version disponible/)).toBeTruthy();
    });
  });

  describe('prêt hors ligne', () => {
    it('annonce « Application prête hors ligne » puis se retire seule', () => {
      vi.useFakeTimers();
      render(<UpdateNotice />);
      act(() => { opts().onOfflineReady(); });
      expect(screen.getByText('Application prête hors ligne.')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(OFFLINE_NOTICE_MS); });
      expect(screen.queryByText('Application prête hors ligne.')).toBeNull();
    });

    it('peut être fermée à la main', () => {
      render(<UpdateNotice />);
      act(() => { opts().onOfflineReady(); });
      fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
      expect(screen.queryByText('Application prête hors ligne.')).toBeNull();
    });

    it('cède la place à l’annonce de mise à jour', () => {
      render(<UpdateNotice />);
      act(() => { opts().onOfflineReady(); });
      nouvelleVersion();
      expect(screen.queryByText('Application prête hors ligne.')).toBeNull();
      expect(screen.getByText(/Nouvelle version disponible/)).toBeTruthy();
    });
  });
});

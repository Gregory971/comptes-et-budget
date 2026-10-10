// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Options = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (url: string, registration: unknown) => void;
  onRegisterError?: (e: unknown) => void;
};

// Le module virtuel n'existe que dans une construction avec vite-plugin-pwa :
// on le remplace par un faux qui capture les options et expose `updateSW`.
const mocks = vi.hoisted(() => ({
  options: undefined as unknown,
  updateSW: vi.fn(async (_reload?: boolean) => {}),
  registerSW: vi.fn(),
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (o: unknown) => {
    mocks.options = o;
    mocks.registerSW(o);
    return mocks.updateSW;
  },
}));

import { CHECK_INTERVAL_MS, startPwaUpdates, usePwaUpdate } from './pwaUpdate';

const opts = () => mocks.options as Options;

const initial = {
  needRefresh: false, refreshDismissed: false, offlineReady: false, applying: false, error: null,
};

beforeEach(() => {
  usePwaUpdate.setState(initial);
  mocks.updateSW.mockClear();
  mocks.updateSW.mockImplementation(async () => {});
  mocks.registerSW.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('mises à jour de l’application (service worker)', () => {
  it('enregistre le service worker dès le lancement', () => {
    startPwaUpdates();
    expect(mocks.registerSW).toHaveBeenCalledTimes(1);
    expect(opts().immediate).toBe(true);
  });

  it('annonce une nouvelle version quand le navigateur en a une en attente', () => {
    startPwaUpdates();
    expect(usePwaUpdate.getState().needRefresh).toBe(false);
    opts().onNeedRefresh!();
    expect(usePwaUpdate.getState().needRefresh).toBe(true);
  });

  it('annonce que l’application est prête hors ligne', () => {
    startPwaUpdates();
    opts().onOfflineReady!();
    expect(usePwaUpdate.getState().offlineReady).toBe(true);
    usePwaUpdate.getState().dismissOffline();
    expect(usePwaUpdate.getState().offlineReady).toBe(false);
  });

  it('« Plus tard » masque la notice, mais une version plus récente la fait revenir', () => {
    startPwaUpdates();
    opts().onNeedRefresh!();
    usePwaUpdate.getState().dismissRefresh();
    expect(usePwaUpdate.getState().refreshDismissed).toBe(true);
    opts().onNeedRefresh!();
    expect(usePwaUpdate.getState().refreshDismissed).toBe(false);
  });

  it('applique la mise à jour en demandant le rechargement de la page', async () => {
    startPwaUpdates();
    opts().onNeedRefresh!();
    await usePwaUpdate.getState().apply();
    expect(mocks.updateSW).toHaveBeenCalledWith(true);
  });

  it('rend la main avec un message si l’activation échoue', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateSW.mockRejectedValueOnce(new Error('échec'));
    startPwaUpdates();
    await usePwaUpdate.getState().apply();
    const s = usePwaUpdate.getState();
    expect(s.applying).toBe(false);
    expect(s.error).toMatch(/rechargement a échoué/i);
  });

  it('journalise une erreur d’enregistrement sans planter', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    startPwaUpdates();
    opts().onRegisterError!(new Error('refusé'));
    expect(err).toHaveBeenCalled();
  });

  describe('recherche périodique', () => {
    const registration = () => ({ update: vi.fn(async () => {}) });

    it('interroge le service worker chaque heure, par le navigateur et non par la page', () => {
      vi.useFakeTimers();
      // connect-src 'none' : la page ne doit émettre AUCUNE requête réseau.
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const reg = registration();
      startPwaUpdates();
      opts().onRegisteredSW!('/sw.js', reg);
      expect(reg.update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      expect(reg.update).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      expect(reg.update).toHaveBeenCalledTimes(2);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('ne cherche pas hors ligne', () => {
      vi.useFakeTimers();
      const reg = registration();
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      startPwaUpdates();
      opts().onRegisteredSW!('/sw.js', reg);
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      expect(reg.update).not.toHaveBeenCalled();
    });

    it('supporte un enregistrement absent', () => {
      startPwaUpdates();
      expect(() => opts().onRegisteredSW!('/sw.js', undefined)).not.toThrow();
    });
  });
});

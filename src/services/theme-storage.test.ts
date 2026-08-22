// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { applyTheme, readTheme, resolvedTheme, writeTheme } from './themeService';
import { ensurePersistentStorage, formatBytes, storageStatus } from './storageService';

describe('thème d’affichage', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.mode;
  });

  it('retient le réglage du système par défaut', () => {
    expect(readTheme()).toBe('systeme');
    applyTheme('systeme');
    // Aucun attribut posé : la requête média prefers-color-scheme décide.
    expect(document.documentElement.dataset.mode).toBeUndefined();
  });

  it('pose et retire l’attribut selon le réglage', () => {
    writeTheme('sombre');
    expect(document.documentElement.dataset.mode).toBe('sombre');
    expect(readTheme()).toBe('sombre');

    writeTheme('clair');
    expect(document.documentElement.dataset.mode).toBe('clair');

    writeTheme('systeme');
    expect(document.documentElement.dataset.mode).toBeUndefined();
  });

  it('ignore une valeur illisible plutôt que de casser l’affichage', () => {
    localStorage.setItem('cb_theme', 'fluo');
    expect(readTheme()).toBe('systeme');
  });

  it('résout « systeme » d’après la préférence du navigateur', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') }));
    expect(resolvedTheme('systeme')).toBe('sombre');
    expect(resolvedTheme('clair')).toBe('clair');
    vi.unstubAllGlobals();
  });
});

describe('persistance du stockage', () => {
  afterEach(() => vi.unstubAllGlobals());

  const withStorage = (impl: Partial<StorageManager>) =>
    vi.stubGlobal('navigator', { storage: impl });

  it('ne redemande rien quand la base est déjà persistante', async () => {
    const persist = vi.fn();
    withStorage({
      persisted: async () => true,
      persist,
      estimate: async () => ({ usage: 2048, quota: 1024 * 1024 }),
    });
    const out = await ensurePersistentStorage();
    expect(out.state).toBe('persistant');
    expect(out.usageBytes).toBe(2048);
    expect(persist).not.toHaveBeenCalled();
  });

  it('demande la persistance lorsqu’elle n’est pas acquise', async () => {
    const persist = vi.fn(async () => true);
    withStorage({ persisted: async () => false, persist, estimate: async () => ({}) });
    expect((await ensurePersistentStorage()).state).toBe('persistant');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('signale un stockage temporaire après un refus', async () => {
    withStorage({ persisted: async () => false, persist: async () => false, estimate: async () => ({}) });
    expect((await ensurePersistentStorage()).state).toBe('temporaire');
  });

  it('reste silencieux sur un navigateur sans Storage API', async () => {
    vi.stubGlobal('navigator', {});
    expect((await ensurePersistentStorage()).state).toBe('indisponible');
    expect((await storageStatus()).state).toBe('indisponible');
  });

  it('ne demande rien depuis la simple lecture d’état', async () => {
    const persist = vi.fn();
    withStorage({ persisted: async () => false, persist, estimate: async () => ({}) });
    expect((await storageStatus()).state).toBe('temporaire');
    expect(persist).not.toHaveBeenCalled();
  });

  it('affiche les tailles en unités lisibles', () => {
    expect(formatBytes(0)).toBe('0 o');
    expect(formatBytes(1536)).toBe('1,5 ko');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 Mo');
    expect(formatBytes(undefined)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { NAVIGATE_FALLBACK_DENYLIST, workboxOptions } from './pwa';

describe('service worker et passerelle OneDrive', () => {
  const o = workboxOptions('/comptes-et-budget/');

  it('laisse le retour de connexion Microsoft atteindre la passerelle', () => {
    // Le cas exact qui a échoué en conditions réelles : sans exclusion, le
    // service worker répondait index.html à cette URL, et la connexion
    // échouait en silence.
    const retour = '/comptes-et-budget/onedrive.html?code=M.C560_abc&state=xyz';
    expect(o.navigateFallbackDenylist.some(r => r.test(retour))).toBe(true);
  });

  it('couvre la passerelle avec ou sans paramètres', () => {
    for (const u of ['/onedrive.html', '/onedrive.html?code=1', '/comptes-et-budget/onedrive.html#connect']) {
      expect(NAVIGATE_FALLBACK_DENYLIST.some(r => r.test(u))).toBe(true);
    }
  });

  it('laisse l’application profiter du repli hors ligne', () => {
    // L'exclusion ne doit pas déborder : la navigation vers une route de
    // l'application doit continuer d'être servie depuis le cache.
    for (const u of ['/comptes-et-budget/', '/comptes-et-budget/index.html', '/']) {
      expect(NAVIGATE_FALLBACK_DENYLIST.some(r => r.test(u))).toBe(false);
    }
    expect(o.navigateFallback).toBe('/comptes-et-budget/index.html');
  });
});

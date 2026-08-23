import { describe, expect, it } from 'vitest';
import {
  accountFromIdToken, authorizeUrl, codeExchangeBody, parseCallback,
  readTokenResponse, refreshBody, SCOPES, tokenUrl,
} from './pkce';
import { childrenUrl, deleteUrl, MAX_SIMPLE_UPLOAD, readChildren, readError, uploadUrl } from './graph';
import { isAnswer, isConnectEvent, isOrder, NS } from './protocol';

describe('URL de connexion Microsoft', () => {
  const url = authorizeUrl({
    clientId: 'client-1', redirectUri: 'https://exemple.test/onedrive.html',
    state: 'etat-1', challenge: 'defi-1',
  });
  const q = new URL(url).searchParams;

  it('demande le flux à code d’autorisation avec PKCE', () => {
    expect(url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?')).toBe(true);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge')).toBe('defi-1');
    expect(q.get('code_challenge_method')).toBe('S256');
  });

  it('ne demande que le dossier de l’application', () => {
    // Le jour où quelqu'un élargirait la portée à Files.ReadWrite, il verrait
    // tout le OneDrive : ce test est là pour que ce choix soit délibéré.
    expect(SCOPES).toContain('Files.ReadWrite.AppFolder');
    expect(SCOPES.join(' ')).not.toMatch(/Files\.ReadWrite(?!\.AppFolder)/);
    expect(q.get('scope')).toBe(SCOPES.join(' '));
  });

  it('reprend exactement l’URI de redirection déclarée', () => {
    expect(q.get('redirect_uri')).toBe('https://exemple.test/onedrive.html');
    expect(q.get('state')).toBe('etat-1');
  });
});

describe('retour de Microsoft', () => {
  it('lit le code d’autorisation', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
  });

  it('rapporte un refus de consentement tel quel', () => {
    const r = parseCallback('?error=access_denied&error_description=L%27utilisateur+a+refus%C3%A9');
    expect(r.code).toBeUndefined();
    expect(r.error).toBe('access_denied — L\'utilisateur a refusé');
  });

  it('ne voit ni code ni erreur sur une URL vide', () => {
    expect(parseCallback('')).toEqual({});
  });
});

describe('échange et rafraîchissement des jetons', () => {
  it('envoie le vérificateur, jamais un secret', () => {
    const body = new URLSearchParams(codeExchangeBody({
      clientId: 'c', redirectUri: 'r', code: 'code-1', verifier: 'verif-1',
    }));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('verif-1');
    expect(body.get('client_secret')).toBeNull();
  });

  it('rafraîchit sans redemander de connexion', () => {
    const body = new URLSearchParams(refreshBody({ clientId: 'c', refreshToken: 'r-1' }));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r-1');
    expect(tokenUrl()).toMatch(/\/oauth2\/v2\.0\/token$/);
  });

  it('garde une marge avant l’expiration', () => {
    const t = readTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, 1_000_000);
    expect(t.accessToken).toBe('a');
    expect(t.refreshToken).toBe('r');
    // 3600 s annoncées, 60 s de marge : le jeton est considéré périmé plus tôt.
    expect(t.expiresAt).toBe(1_000_000 + 3540 * 1000);
  });

  it('remonte l’erreur du service au lieu d’un jeton vide', () => {
    expect(() => readTokenResponse(
      { error: 'invalid_grant', error_description: 'AADSTS70008 : expiré\nTrace…' }, 0))
      .toThrow(/AADSTS70008/);
    expect(() => readTokenResponse({}, 0)).toThrow(/Réponse inattendue/);
  });

  it('lit le compte dans le jeton d’identité, sans le vérifier', () => {
    const payload = btoa(JSON.stringify({ preferred_username: 'gregory@exemple.test' }))
      .replace(/\+/g, '-').replace(/\//g, '_');
    expect(accountFromIdToken(`entete.${payload}.signature`)).toBe('gregory@exemple.test');
    expect(accountFromIdToken('n’importe quoi')).toBeUndefined();
    expect(accountFromIdToken(undefined)).toBeUndefined();
  });
});

describe('appels Graph', () => {
  it('vise le dossier d’application et rien d’autre', () => {
    for (const u of [uploadUrl('a.cbjson'), childrenUrl(), deleteUrl('a.cbjson')]) {
      expect(u.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot')).toBe(true);
    }
  });

  it('échappe les noms de fichiers', () => {
    expect(uploadUrl('Mes comptes 2026.cbjson'))
      .toContain('approot:/Mes%20comptes%202026.cbjson:/content');
  });

  it('lit la liste des sauvegardes distantes', () => {
    const files = readChildren({
      value: [
        { name: 'a.cbjson', size: 120, lastModifiedDateTime: '2026-08-23T10:00:00Z' },
        { name: 'b.cbjson' },
        { taille: 3 },
      ],
    });
    expect(files).toEqual([
      { name: 'a.cbjson', size: 120, modifiedAt: '2026-08-23T10:00:00Z' },
      { name: 'b.cbjson', size: 0, modifiedAt: '' },
    ]);
    expect(readChildren({})).toEqual([]);
  });

  it('traduit les erreurs en phrases utiles', () => {
    expect(readError(401, {})).toMatch(/expirée/);
    expect(readError(507, {})).toMatch(/Espace insuffisant/);
    expect(readError(400, { error: { message: 'Nom invalide\nTrace' } })).toBe('Nom invalide');
    expect(readError(418, {})).toBe('Erreur OneDrive (code 418).');
  });

  it('connaît la limite de l’envoi simple', () => {
    expect(MAX_SIMPLE_UPLOAD).toBe(4 * 1024 * 1024);
  });
});

describe('protocole entre l’application et la passerelle', () => {
  it('n’accepte que ses propres messages', () => {
    expect(isOrder({ ns: NS, id: '1', type: 'upload' })).toBe(true);
    expect(isOrder({ ns: 'autre', id: '1', type: 'upload' })).toBe(false);
    expect(isOrder({ id: '1', type: 'upload' })).toBe(false);
    expect(isOrder(null)).toBe(false);
    expect(isOrder('upload')).toBe(false);
  });

  it('distingue réponses et événements spontanés', () => {
    expect(isAnswer({ ns: NS, id: '1', ok: true, result: 1 })).toBe(true);
    expect(isAnswer({ ns: NS, id: '1' })).toBe(false);
    expect(isConnectEvent({ ns: NS, event: 'connected' })).toBe(true);
    expect(isConnectEvent({ ns: NS, id: '1', ok: true })).toBe(false);
  });
});

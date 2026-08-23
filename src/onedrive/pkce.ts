// OAuth 2.0, code d'autorisation avec PKCE (RFC 7636).
//
// Une application monopage ne peut garder aucun secret : son code est public.
// PKCE remplace le secret par une preuve à usage unique — un « vérificateur »
// tiré au hasard, dont seul le condensé (« défi ») circule sur l'URL de
// connexion. Un code d'autorisation intercepté est inutilisable sans le
// vérificateur, resté dans la fenêtre qui a lancé la connexion.

/** Autorité Microsoft : « common » accepte comptes personnels et professionnels. */
export const AUTHORITY = 'https://login.microsoftonline.com/common';

/**
 * Portées demandées. `Files.ReadWrite.AppFolder` limite l'accès à un dossier
 * créé pour l'application : le reste du OneDrive lui reste invisible.
 * `offline_access` obtient le jeton de rafraîchissement, sans lequel il
 * faudrait se reconnecter à chaque envoi.
 */
export const SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access', 'openid', 'profile'];

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const o of a) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Chaîne aléatoire sûre, utilisée comme vérificateur et comme état. */
export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Défi PKCE : condensé SHA-256 du vérificateur, en base64url. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}

/** URL de la page de connexion Microsoft. */
export function authorizeUrl(p: AuthorizeParams): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: 'code',
    redirect_uri: p.redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTHORITY}/oauth2/v2.0/authorize?${q}`;
}

export const tokenUrl = (): string => `${AUTHORITY}/oauth2/v2.0/token`;

/** Corps de la demande d'échange « code → jetons ». */
export function codeExchangeBody(p: {
  clientId: string; redirectUri: string; code: string; verifier: string;
}): string {
  return new URLSearchParams({
    client_id: p.clientId,
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
    scope: SCOPES.join(' '),
  }).toString();
}

/** Corps de la demande de rafraîchissement. */
export function refreshBody(p: { clientId: string; refreshToken: string }): string {
  return new URLSearchParams({
    client_id: p.clientId,
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    scope: SCOPES.join(' '),
  }).toString();
}

export interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Lit la réponse de Microsoft sur l'URL de retour.
 * Un refus de consentement revient en `error`, pas en exception : il doit être
 * affiché tel quel plutôt que présenté comme une panne.
 */
export function parseCallback(search: string): CallbackResult {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const error = q.get('error');
  if (error) {
    const detail = q.get('error_description');
    return { error: detail ? `${error} — ${detail}` : error };
  }
  const code = q.get('code');
  return code ? { code, state: q.get('state') ?? undefined } : {};
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Instant d'expiration, en millisecondes depuis l'époque. */
  expiresAt: number;
}

/** Interprète la réponse du point de terminaison de jetons. */
export function readTokenResponse(json: unknown, now: number): TokenSet {
  const r = json as Record<string, unknown>;
  if (typeof r?.error === 'string') {
    const d = typeof r.error_description === 'string' ? r.error_description : r.error;
    throw new Error(String(d).split('\n')[0]);
  }
  if (typeof r?.access_token !== 'string') {
    throw new Error('Réponse inattendue du service d’authentification Microsoft.');
  }
  const seconds = typeof r.expires_in === 'number' ? r.expires_in : 3600;
  return {
    accessToken: r.access_token,
    refreshToken: typeof r.refresh_token === 'string' ? r.refresh_token : undefined,
    // Marge de 60 s : un jeton qui expire pendant l'envoi le ferait échouer.
    expiresAt: now + (seconds - 60) * 1000,
  };
}

/** Nom du compte, lu dans le jeton d'identité — affichage seul. */
export function accountFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const part = idToken.split('.')[1];
  if (!part) return undefined;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const c = json as Record<string, unknown>;
    for (const clef of ['preferred_username', 'email', 'name']) {
      if (typeof c[clef] === 'string') return c[clef] as string;
    }
  } catch {
    // Jeton illisible : l'affichage se passera du nom de compte.
  }
  return undefined;
}

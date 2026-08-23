// Passerelle OneDrive — SEUL document de l'application autorisé à joindre le
// réseau.
//
// Le document principal porte « connect-src 'none' » : ni fetch, ni WebSocket,
// ni balise de mesure ne peuvent en sortir, et cela reste vrai après cette
// version. Cette page-ci, servie depuis la même origine mais avec sa propre
// politique de sécurité, n'autorise que login.microsoftonline.com,
// graph.microsoft.com et les hôtes de téléchargement de OneDrive. Elle ne
// contient aucune logique de comptes : elle reçoit un contenu déjà sérialisé,
// l'envoie, et rapporte le résultat.
//
// Deux emplois du même fichier :
//  · fenêtre surgissante, pour la connexion — Microsoft interdit l'affichage
//    de sa page de connexion dans une iframe (X-Frame-Options) ;
//  · iframe masquée, pour les envois suivants, sans aucune interaction.

import {
  accountFromIdToken, authorizeUrl, challengeOf, codeExchangeBody, parseCallback,
  randomString, readTokenResponse, refreshBody, tokenUrl, type TokenSet,
} from './pkce';
import {
  childrenUrl, contentUrl, MAX_SIMPLE_UPLOAD, readChildren, readError, uploadUrl,
} from './graph';
import { NS, isOrder, type Answer, type ConnectEvent, type Order } from './protocol';

const CLE_REFRESH = 'cb-onedrive-refresh';
const CLE_COMPTE = 'cb-onedrive-account';
const CLE_VERIF = 'cb-onedrive-verifier';
const CLE_ETAT = 'cb-onedrive-state';
const CLE_CLIENT = 'cb-onedrive-client';

/** URI de redirection : cette page même, sans paramètre ni ancre. */
const redirectUri = (): string => location.origin + location.pathname;

const dire = (texte: string) => {
  const el = document.getElementById('etat');
  if (el) el.textContent = texte;
};

/* ------------------------------------------------------------------ jetons */

/** Jeton d'accès : gardé en mémoire seulement, jamais écrit sur le disque. */
let jeton: TokenSet | undefined;

const lireRefresh = () => localStorage.getItem(CLE_REFRESH) ?? undefined;

function retenir(t: TokenSet, compte?: string) {
  jeton = t;
  if (t.refreshToken) localStorage.setItem(CLE_REFRESH, t.refreshToken);
  if (compte) localStorage.setItem(CLE_COMPTE, compte);
}

function oublier() {
  jeton = undefined;
  for (const c of [CLE_REFRESH, CLE_COMPTE]) localStorage.removeItem(c);
}

async function poster(body: string): Promise<unknown> {
  const r = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return r.json();
}

/**
 * Jeton d'accès valide, rafraîchi si besoin.
 * Un jeton de rafraîchissement refusé est effacé : mieux vaut redemander une
 * connexion qu'échouer indéfiniment avec un jeton mort.
 */
async function jetonValide(clientId: string): Promise<string> {
  if (jeton && jeton.expiresAt > Date.now()) return jeton.accessToken;
  const refresh = lireRefresh();
  if (!refresh) throw new Error('Aucun compte Microsoft connecté.');
  const brut = await poster(refreshBody({ clientId, refreshToken: refresh }));
  let t: TokenSet;
  try {
    t = readTokenResponse(brut, Date.now());
  } catch (e) {
    // Jeton de rafraîchissement mort (révoqué, expiré, mot de passe changé) :
    // l'effacer force une reconnexion propre au lieu d'échouer indéfiniment.
    // Le message d'origine — souvent un code AADSTS explicite — est conservé.
    oublier();
    throw e;
  }
  retenir(t);
  return t.accessToken;
}

/* ------------------------------------------------------------------- Graph */

async function appel(clientId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const acces = await jetonValide(clientId);
  const r = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${acces}` },
  });
  if (!r.ok) {
    let corps: unknown = {};
    try { corps = await r.json(); } catch { /* réponse sans corps JSON */ }
    throw new Error(readError(r.status, corps));
  }
  return r;
}

async function executer(ordre: Order): Promise<unknown> {
  const clientId = ordre.clientId ?? localStorage.getItem(CLE_CLIENT) ?? '';

  switch (ordre.type) {
    case 'status':
      return {
        connected: Boolean(lireRefresh()),
        account: localStorage.getItem(CLE_COMPTE) ?? undefined,
      };

    case 'upload': {
      const contenu = ordre.payload ?? '';
      const taille = new Blob([contenu]).size;
      if (taille > MAX_SIMPLE_UPLOAD) {
        throw new Error(
          `Sauvegarde trop volumineuse pour un envoi simple (${Math.round(taille / 1024)} ko, limite 4 Mo).`);
      }
      await appel(clientId, uploadUrl(ordre.name ?? 'sauvegarde.cbjson'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: contenu,
      });
      return { name: ordre.name, size: taille };
    }

    case 'list':
      return readChildren(await (await appel(clientId, childrenUrl())).json());

    case 'download':
      return (await appel(clientId, contentUrl(ordre.payload ?? ''))).text();

    case 'disconnect':
      oublier();
      return { connected: false };
  }
}

/* --------------------------------------------------------------- connexion */

/** Ouvre la page de connexion Microsoft dans CETTE fenêtre (la surgissante). */
async function demarrerConnexion(clientId: string) {
  const verifier = randomString();
  const etat = randomString(16);
  sessionStorage.setItem(CLE_VERIF, verifier);
  sessionStorage.setItem(CLE_ETAT, etat);
  localStorage.setItem(CLE_CLIENT, clientId);
  dire('Ouverture de la connexion Microsoft…');
  location.assign(authorizeUrl({
    clientId, redirectUri: redirectUri(), state: etat, challenge: await challengeOf(verifier),
  }));
}

/** Termine la connexion au retour de Microsoft, puis referme la fenêtre. */
async function terminerConnexion() {
  const prevenir = (m: ConnectEvent) => {
    try {
      window.opener?.postMessage(m, location.origin);
    } catch {
      // Fenêtre parente fermée entre-temps : l'état reste lisible au prochain
      // démarrage, la connexion n'est pas perdue pour autant.
    }
  };

  const retour = parseCallback(location.search);
  const attendu = sessionStorage.getItem(CLE_ETAT);
  const verifier = sessionStorage.getItem(CLE_VERIF);
  sessionStorage.removeItem(CLE_ETAT);
  sessionStorage.removeItem(CLE_VERIF);

  try {
    if (retour.error) throw new Error(retour.error);
    if (!retour.code) throw new Error('Réponse de Microsoft sans code d’autorisation.');
    // L'état protège d'une réponse forgée : sans lui, une URL fabriquée
    // pourrait faire échanger un code choisi par un tiers.
    if (!attendu || retour.state !== attendu) throw new Error('Réponse de Microsoft inattendue (état invalide).');
    if (!verifier) throw new Error('Vérificateur PKCE introuvable : relancez la connexion.');

    const clientId = localStorage.getItem(CLE_CLIENT) ?? '';
    const brut = await poster(codeExchangeBody({
      clientId, redirectUri: redirectUri(), code: retour.code, verifier,
    })) as Record<string, unknown>;
    const t = readTokenResponse(brut, Date.now());
    const compte = accountFromIdToken(typeof brut.id_token === 'string' ? brut.id_token : undefined);
    retenir(t, compte);

    dire('Compte Microsoft connecté. Cette fenêtre peut être fermée.');
    prevenir({ ns: NS, event: 'connected', account: compte });
  } catch (e) {
    dire(`Connexion impossible : ${(e as Error).message}`);
    prevenir({ ns: NS, event: 'connect-failed', error: (e as Error).message });
    return; // fenêtre laissée ouverte : le message d'erreur doit rester lisible
  }
  setTimeout(() => window.close(), 1200);
}

/* ------------------------------------------------------------- aiguillage */

function ecouterLesOrdres() {
  dire('Passerelle prête.');
  window.addEventListener('message', async (e: MessageEvent) => {
    // Deux vérifications indispensables : l'origine (aucun autre site ne peut
    // commander la passerelle) et la présence du marqueur de protocole.
    if (e.origin !== location.origin || !isOrder(e.data)) return;
    const ordre = e.data;
    const repondre = (a: Answer) => (e.source as Window | null)?.postMessage(a, location.origin);
    try {
      repondre({ ns: NS, id: ordre.id, ok: true, result: await executer(ordre) });
    } catch (err) {
      repondre({ ns: NS, id: ordre.id, ok: false, error: (err as Error).message });
    }
  });
  // L'application attend ce signal avant d'envoyer quoi que ce soit : une
  // iframe qui n'a pas fini de charger perdrait silencieusement les ordres.
  try {
    if (window.parent !== window) {
      window.parent.postMessage({ ns: NS, event: 'ready' } as ConnectEvent, location.origin);
    }
  } catch { /* pas de parent accessible : page ouverte seule */ }
}

async function demarrer() {
  if (location.search.includes('code=') || location.search.includes('error=')) {
    await terminerConnexion();
    return;
  }
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const clientId = hash.get('client');
  if (hash.has('connect') && clientId) {
    await demarrerConnexion(clientId);
    return;
  }
  ecouterLesOrdres();
}

void demarrer();

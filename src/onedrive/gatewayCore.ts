// Cœur de la passerelle OneDrive : toute la logique, sans aucun accès direct au
// navigateur.
//
// `gateway.ts` est la colle (DOM, fenêtres, postMessage) ; ce fichier-ci reçoit
// ses dépendances — `fetch`, stockages, horloge, attente — et peut donc être
// éprouvé de bout en bout contre un faux serveur Graph, sans réseau.
//
// Ce que le cœur garantit :
//  · jeton d'accès gardé en mémoire seulement, rafraîchi à l'expiration ou sur
//    401, une seule demande de rafraîchissement à la fois ;
//  · jeton de rafraîchissement effacé UNIQUEMENT s'il est définitivement mort
//    (invalid_grant…), jamais sur une panne passagère ;
//  · reprise sur 429 / 502 / 503 / 504 en respectant Retry-After, bornée ;
//  · panne réseau traduite en phrase, jamais « Failed to fetch » ;
//  · rotation des copies datées après chaque envoi réussi.

import {
  accountFromIdToken, authorizeUrl, challengeOf, codeExchangeBody, FATAL_TOKEN_ERRORS,
  parseCallback, randomString, readTokenResponse, refreshBody, TokenError, tokenUrl,
  type TokenSet,
} from './pkce';
import {
  childrenUrl, contentUrl, deleteUrl, MAX_SIMPLE_UPLOAD, nextLinkOf, parseRetryAfter,
  readChildren, readError, RETRYABLE, staleCopies, uploadUrl, type RemoteFile,
} from './graph';
import type { Order, UploadResult } from './protocol';

export const CLE_REFRESH = 'cb-onedrive-refresh';
export const CLE_COMPTE = 'cb-onedrive-account';
export const CLE_VERIF = 'cb-onedrive-verifier';
export const CLE_ETAT = 'cb-onedrive-state';
export const CLE_CLIENT = 'cb-onedrive-client';

/** Nombre de reprises après une réponse 429 / 502 / 503 / 504. */
export const MAX_REPRISES = 3;
/** Attente maximale acceptée entre deux tentatives : au-delà, on rend la main. */
export const ATTENTE_MAX_MS = 30_000;
/** Attente par défaut quand Microsoft n'indique pas de Retry-After. */
const RECUL_MS = [1000, 2000, 4000];
/** Garde-fou de la pagination : 10 pages de 200 éléments. */
const PAGES_MAX = 10;

/** Réponse d'erreur de Graph ; le statut permet de distinguer un 404 attendu. */
export class GraphError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GatewayDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Stockage durable (jeton de rafraîchissement, compte). */
  local: StorageLike;
  /** Stockage de la fenêtre de connexion (vérificateur PKCE, état). */
  session: StorageLike;
  /** URI de redirection : la page de la passerelle, sans paramètre ni ancre. */
  redirectUri: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type Route =
  | { kind: 'complete' }
  | { kind: 'connect'; clientId: string }
  | { kind: 'listen' };

/** Que doit faire la page selon l'adresse par laquelle elle a été ouverte ? */
export function routeOf(search: string, hash: string): Route {
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  if (q.has('code') || q.has('error')) return { kind: 'complete' };
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const clientId = h.get('client');
  if (h.has('connect') && clientId) return { kind: 'connect', clientId };
  return { kind: 'listen' };
}

const NETWORK_MESSAGE =
  'Impossible de joindre Microsoft : vérifiez la connexion Internet (hors connexion ?), puis réessayez.';

export function createGatewayCore(deps: GatewayDeps) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  /* ------------------------------------------------------------- réseau */

  /** `fetch` dont l'échec (hors connexion, DNS, CSP) devient une phrase lisible. */
  async function reseau(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await deps.fetch(url, init);
    } catch {
      throw new Error(NETWORK_MESSAGE);
    }
  }

  /**
   * Rejoue une requête tant que Microsoft répond « réessayez plus tard »
   * (429, 502, 503, 504), en respectant Retry-After. Toutes les requêtes de la
   * passerelle sont idempotentes (GET, PUT d'un même contenu, DELETE, POST de
   * jeton) : les rejouer est sans danger.
   */
  async function avecReprises(requete: () => Promise<Response>): Promise<Response> {
    for (let essai = 0; ; essai++) {
      const r = await requete();
      if (!RETRYABLE.has(r.status) || essai >= MAX_REPRISES) return r;
      const demande = parseRetryAfter(r.headers.get('Retry-After'), now());
      const attente = demande ?? RECUL_MS[Math.min(essai, RECUL_MS.length - 1)];
      if (attente > ATTENTE_MAX_MS) {
        throw new Error(
          `OneDrive demande d’attendre ${Math.ceil(attente / 1000)} s avant de réessayer : réessayez plus tard.`);
      }
      await sleep(attente);
    }
  }

  async function lireJson(r: Response): Promise<unknown> {
    try { return await r.json(); } catch { return {}; }
  }

  /* -------------------------------------------------------------- jetons */

  /** Jeton d'accès : gardé en mémoire seulement, jamais écrit sur le disque. */
  let jeton: TokenSet | undefined;
  let rafraichissement: Promise<string> | undefined;

  const lireRefresh = () => deps.local.getItem(CLE_REFRESH) ?? undefined;

  function retenir(t: TokenSet, compte?: string) {
    jeton = t;
    if (t.refreshToken) deps.local.setItem(CLE_REFRESH, t.refreshToken);
    if (compte) deps.local.setItem(CLE_COMPTE, compte);
  }

  function oublier() {
    jeton = undefined;
    for (const c of [CLE_REFRESH, CLE_COMPTE]) deps.local.removeItem(c);
  }

  async function poster(body: string): Promise<unknown> {
    const r = await avecReprises(() => reseau(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }));
    let json: unknown;
    try {
      json = await r.json();
    } catch {
      // Page d'erreur HTML d'une passerelle intermédiaire, par exemple.
      throw new TokenError(r.ok
        ? 'Réponse inattendue du service d’authentification Microsoft.'
        : `Le service d’authentification Microsoft est momentanément indisponible (code ${r.status}).`);
    }
    return json;
  }

  async function rafraichir(clientId: string): Promise<string> {
    const refresh = lireRefresh();
    if (!refresh) throw new Error('Aucun compte Microsoft connecté.');
    try {
      const t = readTokenResponse(await poster(refreshBody({ clientId, refreshToken: refresh })), now());
      retenir(t);
      return t.accessToken;
    } catch (e) {
      // Le jeton n'est effacé que s'il est DÉFINITIVEMENT mort (révoqué, expiré,
      // mot de passe changé) : on force alors une reconnexion propre. Une panne
      // passagère — service occupé, réponse illisible — ne doit surtout pas
      // déconnecter l'utilisateur, qui n'aurait rien fait de mal.
      if (e instanceof TokenError && e.code && FATAL_TOKEN_ERRORS.has(e.code)) oublier();
      throw e;
    }
  }

  /**
   * Jeton d'accès valide. Les demandes simultanées partagent un seul
   * rafraîchissement : Microsoft fait tourner le jeton de rafraîchissement, et
   * deux demandes concurrentes avec le même jeton s'écraseraient mutuellement.
   */
  function jetonValide(clientId: string): Promise<string> {
    if (jeton && jeton.expiresAt > now()) return Promise.resolve(jeton.accessToken);
    rafraichissement ??= rafraichir(clientId).finally(() => { rafraichissement = undefined; });
    return rafraichissement;
  }

  /* --------------------------------------------------------------- Graph */

  /**
   * Appel Graph authentifié. Sur 401 alors que le jeton se croyait valide
   * (révoqué, horloge décalée), un rafraîchissement et UNE nouvelle tentative
   * ont lieu avant d'abandonner.
   */
  async function appel(clientId: string, url: string, init: RequestInit = {}): Promise<Response> {
    let renouvele = false;
    for (;;) {
      const acces = await jetonValide(clientId);
      const r = await avecReprises(() => reseau(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${acces}` },
      }));
      if (r.status === 401 && !renouvele) {
        renouvele = true;
        jeton = undefined;
        continue;
      }
      if (!r.ok) throw new GraphError(r.status, readError(r.status, await lireJson(r)));
      return r;
    }
  }

  /** Tous les fichiers du dossier d'application, pages suivantes comprises. */
  async function lister(clientId: string): Promise<RemoteFile[]> {
    const fichiers: RemoteFile[] = [];
    let url: string | undefined = childrenUrl();
    try {
      for (let page = 0; url && page < PAGES_MAX; page++) {
        const json = await (await appel(clientId, url)).json();
        fichiers.push(...readChildren(json));
        url = nextLinkOf(json);
      }
    } catch (e) {
      // Dossier d'application pas encore créé : aucune sauvegarde, sans erreur.
      if (e instanceof GraphError && e.status === 404) return [];
      throw e;
    }
    return fichiers;
  }

  /** Supprime les copies datées excédentaires ; ne lève jamais. */
  async function faireTourner(clientId: string, ecrit: string, keep: number): Promise<Pick<UploadResult, 'pruned' | 'pruneError'>> {
    const pruned: string[] = [];
    try {
      const vieux = staleCopies((await lister(clientId)).map(f => f.name), ecrit, keep);
      for (const nom of vieux) {
        try {
          await appel(clientId, deleteUrl(nom), { method: 'DELETE' });
          pruned.push(nom);
        } catch (e) {
          // Déjà supprimé ailleurs : le résultat voulu est atteint.
          if (!(e instanceof GraphError && e.status === 404)) throw e;
        }
      }
      return { pruned };
    } catch (e) {
      // Un dossier encombré vaut mieux qu'une sauvegarde déclarée en échec :
      // le fichier du jour est déjà parti, l'incident est seulement rapporté.
      return { pruned, pruneError: (e as Error).message };
    }
  }

  /* ------------------------------------------------------------- ordres */

  async function executer(ordre: Order): Promise<unknown> {
    const clientId = ordre.clientId ?? deps.local.getItem(CLE_CLIENT) ?? '';

    switch (ordre.type) {
      case 'status':
        return {
          connected: Boolean(lireRefresh()),
          account: deps.local.getItem(CLE_COMPTE) ?? undefined,
        };

      case 'upload': {
        const contenu = ordre.payload ?? '';
        const nom = ordre.name ?? 'sauvegarde.cbjson';
        const taille = new TextEncoder().encode(contenu).length;
        if (taille > MAX_SIMPLE_UPLOAD) {
          throw new Error(
            `Sauvegarde trop volumineuse pour un envoi simple (${Math.round(taille / 1024 / 1024)} Mo, limite ${MAX_SIMPLE_UPLOAD / 1024 / 1024} Mo).`);
        }
        await appel(clientId, uploadUrl(nom), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: contenu,
        });
        const rotation = ordre.keep ? await faireTourner(clientId, nom, ordre.keep) : { pruned: [] };
        return { name: nom, size: taille, ...rotation } satisfies UploadResult;
      }

      case 'list':
        return lister(clientId);

      case 'download':
        if (!ordre.payload) throw new Error('Nom de sauvegarde manquant.');
        return (await appel(clientId, contentUrl(ordre.payload))).text();

      case 'disconnect':
        oublier();
        return { connected: false };
    }
  }

  /* ----------------------------------------------------------- connexion */

  /** Prépare la connexion et renvoie l'adresse de la page de Microsoft. */
  async function commencerConnexion(clientId: string): Promise<string> {
    const verifier = randomString();
    const etat = randomString(16);
    deps.session.setItem(CLE_VERIF, verifier);
    deps.session.setItem(CLE_ETAT, etat);
    deps.local.setItem(CLE_CLIENT, clientId);
    return authorizeUrl({
      clientId, redirectUri: deps.redirectUri(), state: etat, challenge: await challengeOf(verifier),
    });
  }

  /** Termine la connexion au retour de Microsoft ; lève l'erreur à afficher. */
  async function terminerConnexion(search: string): Promise<{ account?: string }> {
    const retour = parseCallback(search);
    const attendu = deps.session.getItem(CLE_ETAT);
    const verifier = deps.session.getItem(CLE_VERIF);
    deps.session.removeItem(CLE_ETAT);
    deps.session.removeItem(CLE_VERIF);

    if (retour.error) throw new Error(retour.error);
    if (!retour.code) throw new Error('Réponse de Microsoft sans code d’autorisation.');
    // L'état protège d'une réponse forgée : sans lui, une URL fabriquée
    // pourrait faire échanger un code choisi par un tiers.
    if (!attendu || retour.state !== attendu) throw new Error('Réponse de Microsoft inattendue (état invalide).');
    if (!verifier) throw new Error('Vérificateur PKCE introuvable : relancez la connexion.');

    const clientId = deps.local.getItem(CLE_CLIENT) ?? '';
    const brut = await poster(codeExchangeBody({
      clientId, redirectUri: deps.redirectUri(), code: retour.code, verifier,
    })) as Record<string, unknown>;
    const t = readTokenResponse(brut, now());
    const compte = accountFromIdToken(typeof brut.id_token === 'string' ? brut.id_token : undefined);
    retenir(t, compte);
    return { account: compte };
  }

  return { executer, commencerConnexion, terminerConnexion };
}

export type GatewayCore = ReturnType<typeof createGatewayCore>;

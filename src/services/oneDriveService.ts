// Sauvegarde vers OneDrive par l'API Microsoft Graph.
//
// L'application ne joint jamais le réseau elle-même : elle confie ses ordres à
// la passerelle `onedrive.html`, chargée dans une iframe masquée et seule
// autorisée à sortir (voir src/utils/csp.ts). Ce service est le porte-voix de
// l'application vers cette passerelle — il ne connaît ni jeton, ni identifiant
// de connexion : ceux-ci restent dans la passerelle.
//
// La connexion initiale passe obligatoirement par une fenêtre surgissante :
// Microsoft refuse d'afficher sa page de connexion dans une iframe.

import { db, stamp } from './db';
import { backupService } from './backupService';
import { safeBaseName } from './autoBackupService';
import { toYmd } from '../utils/date';
import { NS, isAnswer, isConnectEvent, type Order, type RemoteFile } from '../onedrive/protocol';

/** Application inscrite le 22/08/2026 dans l'annuaire personnel « Gregory ».
 *  Un identifiant client d'application monopage est public par conception ;
 *  il reste modifiable pour qui déploierait sa propre copie. */
export const DEFAULT_CLIENT_ID = 'd7f0e348-6055-4bd2-b1a1-607972607ba3';

const ACTIVE = 'oneDriveEnabled';
const CLIENT = 'oneDriveClientId';
const LAST_RUN = 'oneDriveLastRun';
const LAST_ERROR = 'oneDriveLastError';
const ACCOUNT = 'oneDriveAccount';

/** Délai au-delà duquel un ordre sans réponse est considéré perdu. */
export const TIMEOUT_MS = 30_000;

/**
 * Le fichier autonome (file://) ne peut pas servir de passerelle : une URI de
 * redirection OAuth doit être une adresse http(s) déclarée à l'avance.
 */
export const isSupported = (): boolean =>
  typeof location !== 'undefined' && location.protocol !== 'file:';

export const gatewayUrl = (): string =>
  new URL('onedrive.html', document.baseURI).href;

/* --------------------------------------------------------------- réglages */

async function get<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}
const set = (key: string, value: unknown) =>
  db.settings.put({ key, value, updatedAt: stamp() });

export interface OneDriveStatus {
  supported: boolean;
  /** L'utilisateur a explicitement activé la fonction. */
  enabled: boolean;
  clientId: string;
  /** Un compte Microsoft est connecté dans la passerelle. */
  connected: boolean;
  account?: string;
  lastRunAt?: string;
  lastError?: string;
}

/* ------------------------------------------------------- dialogue passerelle */

interface Attente {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  minuteur: ReturnType<typeof setTimeout>;
}

/**
 * Client de la passerelle : appariement ordre / réponse par identifiant.
 *
 * `target` est fourni à l'appel plutôt qu'au constructeur : l'iframe peut être
 * recréée entre deux ordres sans que le client ait à être reconstruit. La
 * classe ne touche pas au DOM, ce qui la rend vérifiable sans navigateur.
 */
export class GatewayClient {
  private attentes = new Map<string, Attente>();
  private compteur = 0;

  constructor(
    private readonly target: () => Window | null,
    private readonly timeoutMs = TIMEOUT_MS,
    private readonly origin = () => location.origin,
  ) {}

  /** À brancher sur l'événement `message` de la fenêtre. */
  handleMessage = (e: MessageEvent): void => {
    if (e.origin !== this.origin()) return;
    if (isAnswer(e.data)) {
      const a = this.attentes.get(e.data.id);
      if (!a) return;
      clearTimeout(a.minuteur);
      this.attentes.delete(e.data.id);
      if (e.data.ok) a.resolve(e.data.result);
      else a.reject(new Error(e.data.error));
    }
  };

  send(order: Omit<Order, 'ns' | 'id'>): Promise<unknown> {
    const cible = this.target();
    if (!cible) return Promise.reject(new Error('Passerelle OneDrive indisponible.'));
    const id = `o${++this.compteur}`;
    return new Promise((resolve, reject) => {
      const minuteur = setTimeout(() => {
        this.attentes.delete(id);
        reject(new Error('La passerelle OneDrive n’a pas répondu.'));
      }, this.timeoutMs);
      this.attentes.set(id, { resolve, reject, minuteur });
      cible.postMessage({ ...order, ns: NS, id } satisfies Order, this.origin());
    });
  }

  /** Nombre d'ordres encore en attente — utilisé par les tests. */
  get enCours(): number { return this.attentes.size; }
}

/* ------------------------------------------------------------- iframe */

let cadre: HTMLIFrameElement | undefined;
let prete: Promise<void> | undefined;
let client: GatewayClient | undefined;

function clientCourant(): GatewayClient {
  if (!client) {
    client = new GatewayClient(() => cadre?.contentWindow ?? null);
    window.addEventListener('message', client.handleMessage);
  }
  return client;
}

/** Charge la passerelle si besoin, et attend son signal de disponibilité. */
async function passerelle(): Promise<GatewayClient> {
  if (!isSupported()) throw new Error('OneDrive n’est pas disponible depuis un fichier ouvert localement.');
  clientCourant();
  if (!cadre) {
    cadre = document.createElement('iframe');
    cadre.title = 'Passerelle OneDrive';
    cadre.setAttribute('aria-hidden', 'true');
    cadre.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px';
    prete = new Promise<void>((resolve, reject) => {
      const minuteur = setTimeout(() => reject(new Error('Passerelle OneDrive : chargement trop long.')), TIMEOUT_MS);
      const surMessage = (e: MessageEvent) => {
        if (e.origin === location.origin && isConnectEvent(e.data) && e.data.event === 'ready') {
          clearTimeout(minuteur);
          window.removeEventListener('message', surMessage);
          resolve();
        }
      };
      window.addEventListener('message', surMessage);
    });
    cadre.src = gatewayUrl();
    document.body.appendChild(cadre);
  }
  await prete;
  return clientCourant();
}

/* ------------------------------------------------------------------ API */

export const oneDriveService = {
  /**
   * État lu localement, sans jamais charger la passerelle : l'écran des
   * préférences doit s'afficher immédiatement, même si la passerelle met du
   * temps à répondre ou reste injoignable. Le champ `connected` reflète alors
   * la dernière connexion connue ; `probe()` va chercher l'état réel.
   */
  async status(): Promise<OneDriveStatus> {
    const account = await get<string>(ACCOUNT);
    return {
      supported: isSupported(),
      enabled: (await get<boolean>(ACTIVE)) ?? false,
      clientId: (await get<string>(CLIENT)) ?? DEFAULT_CLIENT_ID,
      connected: Boolean(account),
      account,
      lastRunAt: await get<string>(LAST_RUN),
      lastError: await get<string>(LAST_ERROR),
    };
  },

  /**
   * Interroge la passerelle sur l'état réel de la connexion Microsoft.
   * Charge l'iframe au passage : à n'appeler que si la fonction est activée.
   */
  async probe(): Promise<OneDriveStatus> {
    const base = await this.status();
    if (!base.enabled || !base.supported) return base;
    try {
      const r = await (await passerelle()).send({ type: 'status', clientId: base.clientId }) as
        { connected: boolean; account?: string };
      if (r.account) await set(ACCOUNT, r.account);
      if (!r.connected) await db.settings.delete(ACCOUNT);
      return { ...base, connected: r.connected, account: r.account ?? base.account };
    } catch (e) {
      // Passerelle injoignable : l'état local reste affichable, l'échec est dit.
      return { ...base, lastError: (e as Error).message };
    }
  },

  /** Active la fonction : à partir d'ici seulement, l'iframe est chargée. */
  async enable(clientId: string): Promise<void> {
    await set(CLIENT, clientId.trim() || DEFAULT_CLIENT_ID);
    await set(ACTIVE, true);
  },

  async disable(): Promise<void> {
    await set(ACTIVE, false);
    await db.settings.delete(LAST_ERROR);
  },

  /**
   * Ouvre la fenêtre de connexion Microsoft. Doit être appelée depuis un clic :
   * les navigateurs bloquent toute fenêtre surgissante non sollicitée.
   */
  async connect(): Promise<{ account?: string }> {
    const clientId = (await get<string>(CLIENT)) ?? DEFAULT_CLIENT_ID;
    const url = `${gatewayUrl()}#connect&client=${encodeURIComponent(clientId)}`;
    const popup = window.open(url, 'comptes-budget-onedrive', 'width=520,height=680');
    if (!popup) throw new Error('Fenêtre de connexion bloquée par le navigateur : autorisez-la puis réessayez.');

    return new Promise((resolve, reject) => {
      const minuteur = setTimeout(() => {
        window.removeEventListener('message', surMessage);
        reject(new Error('Connexion Microsoft abandonnée.'));
      }, 5 * 60_000);
      const surMessage = async (e: MessageEvent) => {
        if (e.origin !== location.origin || !isConnectEvent(e.data)) return;
        if (e.data.event === 'ready') return;
        clearTimeout(minuteur);
        window.removeEventListener('message', surMessage);
        if (e.data.event === 'connected') {
          if (e.data.account) await set(ACCOUNT, e.data.account);
          await db.settings.delete(LAST_ERROR);
          resolve({ account: e.data.account });
        } else {
          reject(new Error(e.data.error ?? 'Connexion refusée.'));
        }
      };
      window.addEventListener('message', surMessage);
    });
  },

  async disconnect(): Promise<void> {
    try {
      await (await passerelle()).send({ type: 'disconnect' });
    } finally {
      await db.settings.delete(ACCOUNT);
      await db.settings.delete(LAST_RUN);
    }
  },

  /** Nom du fichier déposé dans le dossier d'application, daté du jour. */
  fileName: (baseName: string, at = new Date()): string =>
    `${safeBaseName(baseName)}_${toYmd(at)}.cbjson`,

  /** Envoie la sauvegarde de la base active. */
  async send(baseName: string): Promise<{ name: string }> {
    const clientId = (await get<string>(CLIENT)) ?? DEFAULT_CLIENT_ID;
    const name = this.fileName(baseName);
    try {
      await (await passerelle()).send({
        type: 'upload', name, clientId, payload: await backupService.serialize(),
      });
      await set(LAST_RUN, stamp());
      await db.settings.delete(LAST_ERROR);
      return { name };
    } catch (e) {
      await set(LAST_ERROR, (e as Error).message);
      throw e;
    }
  },

  /** Sauvegardes présentes dans le dossier d'application. */
  async list(): Promise<RemoteFile[]> {
    const clientId = (await get<string>(CLIENT)) ?? DEFAULT_CLIENT_ID;
    return (await (await passerelle()).send({ type: 'list', clientId })) as RemoteFile[];
  },

  /** Récupère le contenu d'une sauvegarde distante, sans rien écrire. */
  async fetchBackup(name: string): Promise<string> {
    const clientId = (await get<string>(CLIENT)) ?? DEFAULT_CLIENT_ID;
    return (await (await passerelle()).send({ type: 'download', clientId, payload: name })) as string;
  },
};

// @vitest-environment jsdom
// Intégration de bout en bout, côté APPLICATION : le service OneDrive réel, son
// client de passerelle réel, la vraie passerelle (gatewayCore) et un FAUX
// Microsoft. Seuls l'iframe et le réseau sont simulés.
//
// Ce que cela prouve : que toute la chaîne application → passerelle → Graph
// fonctionne contre un serveur qui applique les règles d'OAuth et de Graph.
// Ce que cela NE prouve PAS : le comportement du vrai OneDrive.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  DEFAULT_CLIENT_ID, GRAPH_TIMEOUT_MS, oneDriveService, TIMEOUT_MS,
} from './oneDriveService';
import { db } from './db';
import { dbService } from './dbService';
import { backupService } from './backupService';
import { CONNECT_CHANNEL, NS, isOrder } from '../onedrive/protocol';
import { CLIENT, monde, type Monde } from '../onedrive/testing/monde';
import { json } from '../onedrive/testing/fakeGraph';

let w: Monde;
let ready = true;
let ouvertures: string[];

/** Fausse fenêtre de la passerelle : exécute les ordres avec le vrai cœur. */
const fenetrePasserelle = {
  postMessage(msg: unknown) {
    if (!isOrder(msg)) return;
    void w.core.executer(msg).then(
      result => window.dispatchEvent(new MessageEvent('message', {
        origin: location.origin, data: { ns: NS, id: msg.id, ok: true, result },
      })),
      (err: Error) => window.dispatchEvent(new MessageEvent('message', {
        origin: location.origin, data: { ns: NS, id: msg.id, ok: false, error: err.message },
      })),
    );
  },
} as unknown as Window;

const iframes = () => document.querySelectorAll('iframe').length;

beforeEach(async () => {
  w = monde();
  ready = true;
  ouvertures = [];
  await db.settings.clear();
  await db.databases.clear();
  await db.payees.clear();
  await oneDriveService.enable(CLIENT);

  // L'iframe n'a pas de réseau en test : elle « charge » en annonçant sa disponibilité.
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(fenetrePasserelle);
  const ajouter = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
    const r = ajouter(node);
    if (node instanceof HTMLIFrameElement && ready) {
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        origin: location.origin, data: { ns: NS, event: 'ready' },
      })));
    }
    return r;
  }) as typeof document.body.appendChild);
  vi.spyOn(window, 'open').mockImplementation(((url: string) => {
    ouvertures.push(url);
    return {} as Window;
  }) as typeof window.open);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Simule la fenêtre surgissante : la passerelle termine la connexion et prévient l'application. */
async function jouerLaFenetreDeConnexion(): Promise<string | undefined> {
  const url = await w.core.commencerConnexion(CLIENT);
  const { account } = await w.core.terminerConnexion(w.ms.authorize(url));
  window.dispatchEvent(new MessageEvent('message', {
    origin: location.origin, data: { ns: NS, event: 'connected', account },
  }));
  return account;
}

async function seConnecter() {
  return seConnecterAvec(oneDriveService);
}

async function seConnecterAvec(service: typeof oneDriveService) {
  ouvertures.length = 0;
  const p = service.connect();
  await vi.waitFor(() => expect(ouvertures).toHaveLength(1));
  await jouerLaFenetreDeConnexion();
  return p;
}

describe('connexion depuis l’application', () => {
  it('ouvre la fenêtre de connexion avec l’identifiant client, puis retient le compte', async () => {
    const r = await seConnecter();
    expect(r.account).toBe('gregory@exemple.test');
    expect(ouvertures[0]).toMatch(/onedrive\.html#connect&client=client-de-test$/);

    const s = await oneDriveService.status();
    expect(s).toMatchObject({ enabled: true, connected: true, account: 'gregory@exemple.test' });
    expect((await oneDriveService.probe()).connected).toBe(true);
  });

  it.skipIf(typeof BroadcastChannel === 'undefined')(
    'reçoit aussi l’avis de connexion par le canal de diffusion (lien d’ouverture coupé)', async () => {
      const p = oneDriveService.connect();
      await vi.waitFor(() => expect(ouvertures).toHaveLength(1));
      const url = await w.core.commencerConnexion(CLIENT);
      await w.core.terminerConnexion(w.ms.authorize(url));
      const canal = new BroadcastChannel(CONNECT_CHANNEL);
      canal.postMessage({ ns: NS, event: 'connected', account: 'via-canal@exemple.test' });
      canal.close();
      expect((await p).account).toBe('via-canal@exemple.test');
    });

  it('rapporte l’échec de connexion remonté par la fenêtre', async () => {
    const p = oneDriveService.connect();
    await vi.waitFor(() => expect(ouvertures).toHaveLength(1));
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin, data: { ns: NS, event: 'connect-failed', error: 'access_denied — refusé' },
    }));
    await expect(p).rejects.toThrow(/access_denied/);
  });

  it('ignore un avis de connexion venu d’une autre origine', async () => {
    const p = oneDriveService.connect();
    const verdict = expect(p).rejects.toThrow(/refus légitime/);
    await vi.waitFor(() => expect(ouvertures).toHaveLength(1));
    // Un site tiers prétend que la connexion a réussi : l'application doit l'ignorer.
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://attaquant.test', data: { ns: NS, event: 'connected', account: 'pirate' },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin, data: { ns: NS, event: 'connect-failed', error: 'refus légitime' },
    }));
    await verdict;
    expect((await oneDriveService.status()).account).toBeUndefined();
  });

  it('dit que la fenêtre a été bloquée par le navigateur', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(oneDriveService.connect()).rejects.toThrow(/bloquée/);
  });
});

describe('sauvegarde, copies datées, liste, restauration', () => {
  it('envoie la vraie sauvegarde, la liste, puis la restaure après perte des données locales', async () => {
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    await backupService.seedDemo(base.id);
    const avant = await db.payees.where('dbId').equals(base.id).count();
    expect(avant).toBeGreaterThan(0);

    const r = await oneDriveService.send(base.name);
    expect(r.name).toBe(oneDriveService.fileName(base.name));
    expect(r.pruned).toEqual([]);
    expect(w.ms.files.has(r.name)).toBe(true);
    expect((await oneDriveService.status()).lastRunAt).toBeTruthy();

    // Perte des données locales, puis restauration depuis OneDrive.
    await db.payees.where('dbId').equals(base.id).delete();
    expect(await db.payees.where('dbId').equals(base.id).count()).toBe(0);

    const liste = await oneDriveService.list();
    expect(liste.map(f => f.name)).toEqual([r.name]);
    const texte = await oneDriveService.fetchBackup(liste[0].name);
    const { backup, summary } = await backupService.inspect(texte);
    expect(summary.databaseName).toBe('Mes comptes');
    await backupService.restore(backup, 'replace', false);
    expect(await db.payees.where('dbId').equals(base.id).count()).toBe(avant);
  });

  it('applique la rotation à 10 copies à chaque envoi', async () => {
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    for (let n = 1; n <= 12; n++) {
      w.ms.files.set(`Mes_comptes_2026-01-${String(n).padStart(2, '0')}.cbjson`, { content: '{}', modifiedAt: 0 });
    }
    w.ms.files.set('notes.txt', { content: 'à moi', modifiedAt: 0 });
    w.ms.folderExists = true;

    const r = await oneDriveService.send(base.name);
    const copies = [...w.ms.files.keys()].filter(n => /^Mes_comptes_\d{4}-/.test(n));
    expect(copies).toHaveLength(10);
    expect(r.pruned).toHaveLength(3);
    expect(w.ms.files.has('notes.txt')).toBe(true);
    expect(w.ms.files.has(r.name)).toBe(true);
  });

  it('un 429 avec Retry-After est absorbé de bout en bout', async () => {
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    w.ms.inject(r => r.method === 'PUT', () => json(429, { error: { message: 'x' } }, { 'Retry-After': '5' }));
    const r = await oneDriveService.send(base.name);
    expect(w.attentes).toEqual([5000]);
    expect(w.ms.files.has(r.name)).toBe(true);
    expect((await oneDriveService.status()).lastError).toBeUndefined();
  });

  it('retient la dernière erreur lisible quand OneDrive refuse', async () => {
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    w.ms.inject(r => r.method === 'PUT', () => json(507, { error: { code: 'quotaLimitReached', message: 'Insufficient' } }));
    await expect(oneDriveService.send(base.name)).rejects.toThrow(/Espace insuffisant/);
    expect((await oneDriveService.status()).lastError).toMatch(/Espace insuffisant/);
  });

  it('après 24 h (application monopage), le dit, puis la relecture de l’état propose de se reconnecter', async () => {
    w.ms.refreshLifetimeMs = 24 * 3600 * 1000;
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    w.ms.tick(25 * 3600 * 1000);
    await expect(oneDriveService.send(base.name)).rejects.toThrow(/24 h.*reconnectez-vous/);

    // Ce que fait l'écran après un échec : relire l'état réel auprès de la passerelle.
    const etat = await oneDriveService.probe();
    expect(etat.connected).toBe(false);
    expect((await oneDriveService.status()).connected).toBe(false);

    // Une nouvelle connexion rétablit l'envoi.
    w.ms.refreshLifetimeMs = Number.POSITIVE_INFINITY;
    await seConnecter();
    await oneDriveService.send(base.name);
    expect(w.ms.files.size).toBe(1);
  });

  it('laisse à la passerelle le temps d’attendre une limitation avant de la désavouer', () => {
    expect(GRAPH_TIMEOUT_MS).toBeGreaterThanOrEqual(3 * 30_000);
    expect(TIMEOUT_MS).toBeLessThan(GRAPH_TIMEOUT_MS);
  });
});

describe('hors connexion et passerelle injoignable', () => {
  it('annonce tout de suite le hors-ligne, sans attendre 30 s, et le retient', async () => {
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    const nav = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(oneDriveService.send(base.name)).rejects.toThrow(/hors connexion/);
    expect((await oneDriveService.status()).lastError).toMatch(/hors connexion/);
    nav.mockReturnValue(true);
    await oneDriveService.send(base.name);
    expect((await oneDriveService.status()).lastError).toBeUndefined();
  });

  it('une coupure pendant l’envoi donne une phrase lisible puis se rétablit sans reconnexion', async () => {
    await seConnecter();
    const base = await dbService.create('Mes comptes');
    w.ms.offline = true;
    await expect(oneDriveService.send(base.name)).rejects.toThrow(/Impossible de joindre Microsoft/);
    w.ms.offline = false;
    await oneDriveService.send(base.name);
    expect(w.ms.files.size).toBe(1);
  });

  it('se remet d’un chargement raté de la passerelle au lieu de rester bloqué', async () => {
    // Instance neuve du service : aucune passerelle encore chargée.
    vi.resetModules();
    const neuf = (await import('./oneDriveService')).oneDriveService;
    await neuf.enable(CLIENT);
    await seConnecterAvec(neuf);
    const avant = iframes();

    // Cet essai-ci : l'iframe ne signale jamais sa disponibilité.
    // (Seuls setTimeout/clearTimeout sont simulés : IndexedDB, lui, reste réel.)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ready = false;
    const echec = expect(neuf.list()).rejects.toThrow(/chargement trop long/);
    await vi.waitFor(() => expect(iframes()).toBe(avant + 1));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);
    await echec;
    vi.useRealTimers();
    // Le cadre raté est retiré…
    expect(iframes()).toBe(avant);
    // … et l'essai suivant repart d'une passerelle neuve, pas d'une promesse déjà rejetée.
    ready = true;
    expect(await neuf.list()).toEqual([]);
    expect(iframes()).toBe(avant + 1);
  });
});

describe('déconnexion', () => {
  it('délie le compte et vide l’état local', async () => {
    await seConnecter();
    await oneDriveService.disconnect();
    expect(await oneDriveService.status()).toMatchObject({ connected: false, account: undefined, lastRunAt: undefined });
    expect((await oneDriveService.probe()).connected).toBe(false);
    await expect(oneDriveService.list()).rejects.toThrow(/Aucun compte Microsoft connecté/);
  });

  it('ne prétend pas avoir déconnecté le compte si la passerelle est injoignable', async () => {
    await seConnecter();
    const nav = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(oneDriveService.disconnect()).rejects.toThrow(/hors connexion/);
    // Le jeton est toujours dans la passerelle : l'état affiché doit le rester aussi.
    expect((await oneDriveService.status()).connected).toBe(true);
    nav.mockReturnValue(true);
    await oneDriveService.disconnect();
    expect((await oneDriveService.status()).connected).toBe(false);
  });
});

describe('réglages par défaut', () => {
  it('reste éteint et sans compte tant qu’on ne l’a pas demandé', async () => {
    await db.settings.clear();
    expect(await oneDriveService.status()).toMatchObject({
      enabled: false, connected: false, clientId: DEFAULT_CLIENT_ID,
    });
  });
});

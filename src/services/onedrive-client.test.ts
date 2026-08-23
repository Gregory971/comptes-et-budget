// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { GatewayClient, oneDriveService, DEFAULT_CLIENT_ID, TIMEOUT_MS } from './oneDriveService';
import { NS, type Order } from '../onedrive/protocol';
import { db } from './db';

/** Fausse passerelle : répond aux ordres comme le ferait l'iframe. */
function fausseePasserelle(repondre: (o: Order) => { ok: boolean; result?: unknown; error?: string }) {
  const recus: Order[] = [];
  const fenetre = {
    postMessage: (msg: Order) => {
      recus.push(msg);
      const r = repondre(msg);
      // La réponse revient par l'événement `message` de la fenêtre courante.
      window.dispatchEvent(new MessageEvent('message', {
        origin: location.origin,
        data: r.ok
          ? { ns: NS, id: msg.id, ok: true, result: r.result }
          : { ns: NS, id: msg.id, ok: false, error: r.error },
      }));
    },
  } as unknown as Window;
  return { fenetre, recus };
}

describe('dialogue avec la passerelle OneDrive', () => {
  it('apparie chaque réponse à son ordre', async () => {
    const { fenetre, recus } = fausseePasserelle(o => ({ ok: true, result: `vu:${o.type}` }));
    const client = new GatewayClient(() => fenetre);
    window.addEventListener('message', client.handleMessage);

    expect(await client.send({ type: 'status' })).toBe('vu:status');
    expect(await client.send({ type: 'list' })).toBe('vu:list');
    expect(recus.map(o => o.ns)).toEqual([NS, NS]);
    expect(recus[0].id).not.toBe(recus[1].id);
    expect(client.enCours).toBe(0);
    window.removeEventListener('message', client.handleMessage);
  });

  it('transmet l’erreur de la passerelle telle quelle', async () => {
    const { fenetre } = fausseePasserelle(() => ({ ok: false, error: 'Espace insuffisant sur OneDrive.' }));
    const client = new GatewayClient(() => fenetre);
    window.addEventListener('message', client.handleMessage);
    await expect(client.send({ type: 'upload' })).rejects.toThrow('Espace insuffisant sur OneDrive.');
    window.removeEventListener('message', client.handleMessage);
  });

  it('ignore un message venu d’une autre origine', async () => {
    vi.useFakeTimers();
    const fenetre = { postMessage: () => {} } as unknown as Window;
    const client = new GatewayClient(() => fenetre, 1000);
    window.addEventListener('message', client.handleMessage);
    // L'attente du rejet est posée AVANT d'avancer l'horloge : sans cela, le
    // rejet survient pendant un tour de boucle où personne ne l'écoute.
    const attente = expect(client.send({ type: 'status' })).rejects.toThrow(/n’a pas répondu/);
    // Une réponse forgée par un autre site ne doit rien débloquer.
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://attaquant.test',
      data: { ns: NS, id: 'o1', ok: true, result: 'usurpé' },
    }));
    await vi.advanceTimersByTimeAsync(1100);
    await attente;
    vi.useRealTimers();
    window.removeEventListener('message', client.handleMessage);
  });

  it('abandonne un ordre resté sans réponse', async () => {
    vi.useFakeTimers();
    const client = new GatewayClient(() => ({ postMessage: () => {} } as unknown as Window), 500);
    const attente = expect(client.send({ type: 'upload' })).rejects.toThrow(/n’a pas répondu/);
    await vi.advanceTimersByTimeAsync(600);
    await attente;
    expect(client.enCours).toBe(0);
    vi.useRealTimers();
  });

  it('refuse d’envoyer sans passerelle chargée', async () => {
    const client = new GatewayClient(() => null);
    await expect(client.send({ type: 'status' })).rejects.toThrow(/indisponible/);
  });

  it('laisse un délai suffisant pour un envoi réel', () => {
    expect(TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });
});

describe('réglages OneDrive', () => {
  beforeEach(() => db.settings.clear());

  it('est désactivé tant que l’utilisateur ne l’a pas demandé', async () => {
    const s = await oneDriveService.status();
    expect(s.enabled).toBe(false);
    expect(s.connected).toBe(false);
    // L'identifiant de l'application inscrite sert de valeur par défaut.
    expect(s.clientId).toBe(DEFAULT_CLIENT_ID);
  });

  it('retient l’activation et un identifiant client personnalisé', async () => {
    await oneDriveService.enable('  autre-client  ');
    const s = await oneDriveService.status();
    expect(s.enabled).toBe(true);
    expect(s.clientId).toBe('autre-client');

    await oneDriveService.disable();
    expect((await oneDriveService.status()).enabled).toBe(false);
  });

  it('retombe sur l’identifiant par défaut si le champ est vidé', async () => {
    await oneDriveService.enable('   ');
    expect((await oneDriveService.status()).clientId).toBe(DEFAULT_CLIENT_ID);
  });

  it('nomme les sauvegardes distantes par base et par jour', () => {
    expect(oneDriveService.fileName('Mes comptes', new Date(2026, 7, 23)))
      .toBe('Mes_comptes_2026-08-23.cbjson');
  });
});

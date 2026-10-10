// Banc d'essai commun aux tests d'intégration OneDrive : un faux Microsoft, une
// passerelle (le vrai cœur, sans le DOM) branchée dessus, et des stockages en
// mémoire. Aucune requête réelle ne part jamais d'ici.

import { createGatewayCore, type StorageLike } from '../gatewayCore';
import { NS, type Order, type UploadResult } from '../protocol';
import { FakeMicrosoft } from './fakeGraph';

export const CLIENT = 'client-de-test';
export const REDIRECT = 'https://gregory971.github.io/comptes-et-budget/onedrive.html';

export function memoire(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
  };
}

export function monde() {
  const ms = new FakeMicrosoft(CLIENT);
  const attentes: number[] = [];
  const local = memoire();
  const session = memoire();
  const core = createGatewayCore({
    fetch: ms.fetch,
    local, session,
    redirectUri: () => REDIRECT,
    now: () => ms.clock,
    // Attente simulée : on note la durée et on fait avancer l'horloge.
    sleep: async d => { attentes.push(d); ms.tick(d); },
  });
  let n = 0;
  const ordre = (o: Partial<Order> & Pick<Order, 'type'>): Order => ({ ns: NS, id: `t${++n}`, clientId: CLIENT, ...o });
  return {
    ms, core, local, session, attentes,
    ordre,
    /** Connexion complète : page de Microsoft jouée par le faux serveur. */
    async connecter(): Promise<{ account?: string }> {
      const url = await core.commencerConnexion(CLIENT);
      return core.terminerConnexion(ms.authorize(url));
    },
    envoyer: (name: string, payload: string, keep = 10) =>
      core.executer(ordre({ type: 'upload', name, payload, keep })) as Promise<UploadResult>,
    lister: () => core.executer(ordre({ type: 'list' })) as Promise<{ name: string; size: number; modifiedAt: string }[]>,
    telecharger: (name: string) => core.executer(ordre({ type: 'download', payload: name })) as Promise<string>,
    etat: () => core.executer(ordre({ type: 'status' })) as Promise<{ connected: boolean; account?: string }>,
    deconnecter: () => core.executer(ordre({ type: 'disconnect' })),
  };
}

export type Monde = ReturnType<typeof monde>;

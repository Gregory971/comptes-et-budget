// Protocole d'échange entre l'application et la passerelle OneDrive.
//
// L'application ne parle jamais au réseau : elle envoie des ORDRES à la
// passerelle (document séparé, seul autorisé à joindre Microsoft) et en reçoit
// des RÉPONSES. Tout passe par postMessage, entre deux documents de même
// origine ; l'origine et la fenêtre émettrice sont vérifiées des deux côtés.

/** Marqueur des messages : écarte tout ce qui vient d'un autre script. */
export const NS = 'comptes-budget/onedrive/1';

export type OrderType = 'status' | 'upload' | 'list' | 'download' | 'disconnect';

export interface Order {
  ns: typeof NS;
  id: string;
  type: OrderType;
  /** Contenu de la sauvegarde (upload) ou nom du fichier (download). */
  payload?: string;
  /** Nom du fichier à écrire (upload). */
  name?: string;
  /** Identifiant d'application, transmis à chaque ordre : la passerelle ne
   *  conserve aucun réglage propre. */
  clientId?: string;
}

export interface RemoteFile {
  name: string;
  size: number;
  /** Horodatage ISO de dernière modification, tel que Graph le renvoie. */
  modifiedAt: string;
}

export interface GatewayStatus {
  connected: boolean;
  /** Compte Microsoft connecté, à afficher — jamais un jeton. */
  account?: string;
}

export type Answer =
  | { ns: typeof NS; id: string; ok: true; result: unknown }
  | { ns: typeof NS; id: string; ok: false; error: string };

/**
 * Événement spontané de la passerelle vers l'application :
 *  · `ready`          — l'iframe est chargée et prête à recevoir des ordres ;
 *  · `connected`      — la fenêtre de connexion a obtenu les jetons ;
 *  · `connect-failed` — la connexion a échoué ou a été refusée.
 */
export interface ConnectEvent {
  ns: typeof NS;
  event: 'ready' | 'connected' | 'connect-failed';
  account?: string;
  error?: string;
}

export const isOrder = (v: unknown): v is Order =>
  typeof v === 'object' && v !== null && (v as Order).ns === NS
  && typeof (v as Order).id === 'string' && typeof (v as Order).type === 'string';

export const isAnswer = (v: unknown): v is Answer =>
  typeof v === 'object' && v !== null && (v as Answer).ns === NS
  && typeof (v as Answer).id === 'string' && typeof (v as Answer).ok === 'boolean';

export const isConnectEvent = (v: unknown): v is ConnectEvent =>
  typeof v === 'object' && v !== null && (v as ConnectEvent).ns === NS
  && typeof (v as ConnectEvent).event === 'string';

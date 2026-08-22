/**
 * Persistance du stockage local.
 *
 * Toute la base vit dans IndexedDB. Sans demande explicite, le navigateur la
 * range en stockage « best-effort » : il peut la supprimer sous pression
 * disque, et WebKit efface d'office les données d'un site resté sept jours
 * sans visite. Pour une application qui n'a pas de serveur, l'éviction
 * équivaut à la perte des comptes.
 *
 * navigator.storage.persist() demande le classement « persistant », qui met la
 * base à l'abri de l'éviction automatique — l'utilisateur reste seul à pouvoir
 * l'effacer. Chromium répond sans invite, d'après l'usage du site ; Firefox
 * pose une question à l'utilisateur.
 *
 * Références : MDN, « Storage quotas and eviction criteria » ;
 * web.dev, « Persistent storage » ; WebKit, « Updates to Storage Policy ».
 */

export type PersistenceState =
  | 'persistant'    // à l'abri de l'éviction automatique
  | 'temporaire'    // stockage best-effort : éviction possible
  | 'indisponible'; // navigateur sans Storage API

export interface StorageStatus {
  state: PersistenceState;
  /** Octets occupés, si le navigateur les communique. */
  usageBytes?: number;
  /** Quota accordé à l'origine, si le navigateur le communique. */
  quotaBytes?: number;
}

const api = (): StorageManager | undefined =>
  typeof navigator !== 'undefined' ? navigator.storage : undefined;

/** Occupation et quota, sans rien demander ni modifier. */
export async function storageEstimate(): Promise<Pick<StorageStatus, 'usageBytes' | 'quotaBytes'>> {
  const s = api();
  if (!s || typeof s.estimate !== 'function') return {};
  try {
    const { usage, quota } = await s.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return {};
  }
}

/** État courant, sans déclencher de demande. */
export async function storageStatus(): Promise<StorageStatus> {
  const s = api();
  if (!s || typeof s.persisted !== 'function') return { state: 'indisponible' };
  try {
    const persisted = await s.persisted();
    return { state: persisted ? 'persistant' : 'temporaire', ...(await storageEstimate()) };
  } catch {
    return { state: 'indisponible' };
  }
}

/**
 * Demande le stockage persistant si la base ne l'est pas déjà.
 * Appelée une fois au lancement : une demande déjà accordée n'est pas
 * renouvelée, et un refus n'est pas insisté — l'écran Préférences permet de
 * la relancer à la main.
 */
export async function ensurePersistentStorage(): Promise<StorageStatus> {
  const s = api();
  if (!s || typeof s.persisted !== 'function' || typeof s.persist !== 'function') {
    return { state: 'indisponible' };
  }
  try {
    if (await s.persisted()) return { state: 'persistant', ...(await storageEstimate()) };
    const granted = await s.persist();
    return { state: granted ? 'persistant' : 'temporaire', ...(await storageEstimate()) };
  } catch {
    return { state: 'indisponible' };
  }
}

/** Taille lisible — « 4,2 Mo » plutôt que 4 404 019. */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—';
  const units = ['o', 'ko', 'Mo', 'Go'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

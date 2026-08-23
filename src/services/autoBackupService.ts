// Sauvegarde automatique vers un fichier ou un dossier choisi une fois pour toutes.
//
// L'export manuel repose sur une discipline : celle d'y penser. La File System
// Access API permet de désigner une destination une seule fois — typiquement
// dans le dossier synchronisé de OneDrive ou de Google Drive — et d'y réécrire
// la sauvegarde ensuite sans nouvelle boîte de dialogue. Le client de
// synchronisation fait le reste : c'est LUI qui parle au nuage, l'application
// se contentant d'écrire un fichier local. La politique de sécurité
// (connect-src 'none') reste donc intacte, et la sauvegarde profite du service
// que l'utilisateur a déjà installé plutôt que d'un compte de plus.
//
// Deux destinations possibles :
//  · un FICHIER, réécrit à chaque fois — une seule version, celle du nuage
//    servant d'historique (OneDrive conserve les versions précédentes) ;
//  · un DOSSIER, où l'application dépose un fichier daté par jour et ne garde
//    que les plus récents. Préférable : une base corrompue ou vidée par erreur
//    n'écrase pas la seule copie valide.
//
// Trois limites assumées, dites telles quelles dans l'interface :
//  · l'API n'existe que sur les navigateurs Chromium (Chrome, Edge, Opera) ;
//    ailleurs, l'application se rabat sur un rappel d'export daté ;
//  · le navigateur ne communique jamais le chemin complet de la destination :
//    l'application affiche le nom retenu, sans pouvoir affirmer qu'il s'agit
//    bien d'un dossier OneDrive ;
//  · le fichier est écrit EN CLAIR. Chiffrer supposerait de retenir la phrase
//    secrète entre deux sessions, donc de l'écrire quelque part — ce qui
//    reviendrait à ranger la clé sous le paillasson. Pour une destination
//    synchronisée, l'export manuel chiffré reste la bonne réponse.

import { db, stamp } from './db';
import { backupService } from './backupService';
import { toYmd } from '../utils/date';

const HANDLE = 'autoBackupHandle';
const KIND = 'autoBackupKind';
const BASENAME = 'autoBackupBaseName';
const LAST_RUN = 'autoBackupLastRun';
const LAST_MANUAL = 'lastManualExport';
const LAST_ERROR = 'autoBackupLastError';

/** Nombre de sauvegardes datées conservées dans un dossier. */
export const KEEP_COPIES = 10;

export type TargetKind = 'fichier' | 'dossier';

interface Writable { write(data: string): Promise<void>; close(): Promise<void> }

/** Sous-ensemble de la File System Access API réellement utilisé. */
interface FsHandle {
  name: string;
  kind?: 'file' | 'directory';
  createWritable?(): Promise<Writable>;
  getFileHandle?(name: string, o?: { create?: boolean }): Promise<FsHandle>;
  removeEntry?(name: string): Promise<void>;
  keys?(): AsyncIterable<string>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
}

type Picker = (options?: unknown) => Promise<FsHandle>;

const global = () => globalThis as unknown as {
  showSaveFilePicker?: Picker; showDirectoryPicker?: Picker;
};

export const isSupported = (): boolean => typeof global().showSaveFilePicker === 'function';
export const supportsFolder = (): boolean => typeof global().showDirectoryPicker === 'function';

async function get<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}
const set = (key: string, value: unknown) =>
  db.settings.put({ key, value, updatedAt: stamp() });

/**
 * Handle de la destination, conservé aussi en mémoire.
 *
 * IndexedDB sait ranger un FileSystemHandle, mais c'est une faveur du
 * navigateur : tout objet qui n'est pas clonable structurellement échouerait à
 * l'écriture. Le cache mémoire garantit que la sauvegarde automatique
 * fonctionne pour la session en cours même si la persistance du handle échoue.
 */
let cache: FsHandle | undefined;

async function handleCourant(): Promise<FsHandle | undefined> {
  return cache ?? (cache = await get<FsHandle>(HANDLE));
}

export interface AutoBackupStatus {
  supported: boolean;
  folderSupported: boolean;
  /** Une destination a été désignée. */
  configured: boolean;
  kind?: TargetKind;
  /** Nom du fichier ou du dossier retenu (le chemin complet reste inconnu). */
  targetName?: string;
  lastRunAt?: string;
  /** Nom du dernier fichier écrit — utile en mode dossier, où il est daté. */
  lastFileName?: string;
  lastManualExportAt?: string;
  lastError?: string;
}

export async function status(): Promise<AutoBackupStatus> {
  const handle = await handleCourant();
  return {
    supported: isSupported(),
    folderSupported: supportsFolder(),
    configured: Boolean(handle),
    kind: await get<TargetKind>(KIND),
    targetName: handle?.name,
    lastRunAt: await get<string>(LAST_RUN),
    lastFileName: await get<string>('autoBackupLastFileName'),
    lastManualExportAt: await get<string>(LAST_MANUAL),
    lastError: await get<string>(LAST_ERROR),
  };
}

/** Mémorise la date du dernier export manuel, pour le rappel. */
export const noteManualExport = () => set(LAST_MANUAL, stamp());

/** Nom de base des sauvegardes datées, dérivé du nom de la base. */
export const safeBaseName = (name: string): string =>
  (name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'Comptes');

async function retiens(handle: FsHandle, kind: TargetKind, baseName: string) {
  cache = handle;
  try {
    await set(HANDLE, handle);
  } catch {
    // Handle non persistable : la sauvegarde vaut pour la session en cours, et
    // la destination sera redemandée à la prochaine ouverture.
  }
  await set(KIND, kind);
  await set(BASENAME, baseName);
  await db.settings.delete(LAST_ERROR);
}

/** Désigne un FICHIER, réécrit à chaque sauvegarde. */
export async function chooseFile(baseName: string): Promise<AutoBackupStatus> {
  const picker = global().showSaveFilePicker;
  if (!picker) throw new Error('Ce navigateur ne permet pas d’écrire directement dans un fichier.');
  const handle = await picker({
    suggestedName: `${safeBaseName(baseName)}.cbjson`,
    types: [{ description: 'Sauvegarde Comptes & Budget', accept: { 'application/json': ['.cbjson'] } }],
  });
  await retiens(handle, 'fichier', safeBaseName(baseName));
  return run();
}

/**
 * Désigne un DOSSIER — celui de OneDrive ou de Google Drive, par exemple.
 * L'application y dépose un fichier daté par jour et ne conserve que les
 * KEEP_COPIES plus récents.
 */
export async function chooseFolder(baseName: string): Promise<AutoBackupStatus> {
  const picker = global().showDirectoryPicker;
  if (!picker) throw new Error('Ce navigateur ne permet pas de choisir un dossier.');
  const handle = await picker({ mode: 'readwrite', id: 'comptes-budget-sauvegardes' });
  await retiens(handle, 'dossier', safeBaseName(baseName));
  return run();
}

/** Oublie la destination : la sauvegarde automatique s'arrête. */
export async function forgetFile(): Promise<void> {
  cache = undefined;
  await db.settings.delete(HANDLE);
  await db.settings.delete(KIND);
  await db.settings.delete(LAST_ERROR);
}

async function autorise(handle: FsHandle): Promise<void> {
  const etat = await handle.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
  if (etat === 'granted') return;
  const accorde = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'denied';
  if (accorde !== 'granted') throw new Error('Autorisation d’écriture refusée.');
}

/**
 * Purge des copies datées : ne restent que les KEEP_COPIES plus récentes.
 *
 * Le tri est lexicographique sur un nom qui finit par une date « AAAA-MM-JJ » :
 * l'ordre alphabétique y vaut l'ordre chronologique. Un échec de suppression
 * n'interrompt pas la sauvegarde — mieux vaut un dossier encombré qu'une
 * sauvegarde manquée.
 */
async function purge(dossier: FsHandle, baseName: string): Promise<void> {
  if (!dossier.keys || !dossier.removeEntry) return;
  const motif = new RegExp(`^${baseName}_\\d{4}-\\d{2}-\\d{2}\\.cbjson$`);
  const noms: string[] = [];
  for await (const nom of dossier.keys()) if (motif.test(nom)) noms.push(nom);
  noms.sort().reverse();
  for (const vieux of noms.slice(KEEP_COPIES)) {
    try {
      await dossier.removeEntry(vieux);
    } catch {
      // Fichier verrouillé par la synchronisation : on le laissera au prochain tour.
    }
  }
}

/**
 * Écrit la sauvegarde dans la destination désignée.
 *
 * L'autorisation d'écriture est révoquée à chaque redémarrage du navigateur :
 * elle est redemandée ici, et l'échec est enregistré plutôt que masqué — une
 * sauvegarde que l'on croit faite est pire que pas de sauvegarde du tout.
 */
export async function run(): Promise<AutoBackupStatus> {
  const handle = await handleCourant();
  if (!handle) return status();
  try {
    await autorise(handle);
    const kind = await get<TargetKind>(KIND) ?? (handle.kind === 'directory' ? 'dossier' : 'fichier');
    const baseName = await get<string>(BASENAME) ?? 'Comptes';
    const contenu = await backupService.serialize();

    let nomEcrit = handle.name;
    if (kind === 'dossier') {
      if (!handle.getFileHandle) throw new Error('Dossier illisible.');
      nomEcrit = `${baseName}_${toYmd(new Date())}.cbjson`;
      const fichier = await handle.getFileHandle(nomEcrit, { create: true });
      const w = await fichier.createWritable!();
      await w.write(contenu);
      await w.close();
      await purge(handle, baseName);
    } else {
      if (!handle.createWritable) throw new Error('Fichier illisible.');
      const w = await handle.createWritable();
      await w.write(contenu);
      await w.close();
    }

    await set(LAST_RUN, stamp());
    await set('autoBackupLastFileName', nomEcrit);
    await db.settings.delete(LAST_ERROR);
  } catch (e) {
    await set(LAST_ERROR, (e as Error).message);
  }
  return status();
}

/** Nombre de jours depuis la dernière sauvegarde, automatique ou manuelle. */
export function daysSince(iso?: string, now = new Date()): number | undefined {
  if (!iso) return undefined;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return undefined;
  return Math.floor((now.getTime() - d) / 86_400_000);
}

/** Seuil au-delà duquel l'application rappelle d'exporter. */
export const REMINDER_DAYS = 14;

/** Faut-il rappeler à l'utilisateur d'exporter sa base ? */
export function needsReminder(s: AutoBackupStatus, now = new Date()): boolean {
  if (s.configured && !s.lastError) {
    const j = daysSince(s.lastRunAt, now);
    return j === undefined || j >= REMINDER_DAYS;
  }
  const j = daysSince(s.lastManualExportAt, now);
  return j === undefined || j >= REMINDER_DAYS;
}

// Sauvegarde automatique vers un fichier choisi une fois pour toutes.
//
// L'export manuel repose sur une discipline : celle d'y penser. La File System
// Access API permet de désigner un fichier une seule fois — typiquement dans
// « Google Drive pour ordinateur » — et d'y réécrire la sauvegarde ensuite sans
// nouvelle boîte de dialogue. Le handle est conservé dans IndexedDB, seul
// endroit où il survit à la fermeture de l'onglet.
//
// Deux limites assumées, dites telles quelles dans l'interface :
//  · l'API n'existe que sur les navigateurs Chromium (Chrome, Edge, Opera) ;
//    ailleurs, l'application se rabat sur un rappel d'export daté ;
//  · le fichier est écrit EN CLAIR. Chiffrer supposerait de retenir la phrase
//    secrète entre deux sessions, donc de l'écrire quelque part — ce qui
//    reviendrait à ranger la clé sous le paillasson. Pour un dossier
//    synchronisé, l'export manuel chiffré reste la bonne réponse.

import { db, stamp } from './db';
import { backupService } from './backupService';

const HANDLE = 'autoBackupHandle';
const LAST_RUN = 'autoBackupLastRun';
const LAST_MANUAL = 'lastManualExport';

/** Sous-ensemble de la File System Access API réellement utilisé. */
interface FileHandle {
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
}

type Picker = (options: unknown) => Promise<FileHandle>;

export const isSupported = (): boolean =>
  typeof globalThis === 'object' && 'showSaveFilePicker' in globalThis;

async function get<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}
const set = (key: string, value: unknown) =>
  db.settings.put({ key, value, updatedAt: stamp() });

/**
 * Handle du fichier, conservé aussi en mémoire.
 *
 * IndexedDB sait ranger un FileSystemFileHandle, mais c'est une faveur du
 * navigateur : tout objet qui n'est pas clonable structurellement échouerait à
 * l'écriture. Le cache mémoire garantit que la sauvegarde automatique
 * fonctionne pour la session en cours même si la persistance du handle échoue.
 */
let cache: FileHandle | undefined;

async function handleCourant(): Promise<FileHandle | undefined> {
  return cache ?? (cache = await get<FileHandle>(HANDLE));
}

export interface AutoBackupStatus {
  supported: boolean;
  /** Un fichier a été désigné et reste accessible. */
  configured: boolean;
  fileName?: string;
  lastRunAt?: string;
  lastManualExportAt?: string;
  lastError?: string;
}

export async function status(): Promise<AutoBackupStatus> {
  const handle = await handleCourant();
  return {
    supported: isSupported(),
    configured: Boolean(handle),
    fileName: handle?.name,
    lastRunAt: await get<string>(LAST_RUN),
    lastManualExportAt: await get<string>(LAST_MANUAL),
    lastError: await get<string>('autoBackupLastError'),
  };
}

/** Mémorise la date du dernier export manuel, pour le rappel. */
export const noteManualExport = () => set(LAST_MANUAL, stamp());

/** Désigne le fichier de sauvegarde. Ouvre le sélecteur du système. */
export async function chooseFile(suggestedName: string): Promise<AutoBackupStatus> {
  if (!isSupported()) throw new Error('Ce navigateur ne permet pas d’écrire directement dans un fichier.');
  const picker = (globalThis as unknown as { showSaveFilePicker: Picker }).showSaveFilePicker;
  const handle = await picker({
    suggestedName,
    types: [{ description: 'Sauvegarde Comptes & Budget', accept: { 'application/json': ['.cbjson'] } }],
  });
  cache = handle;
  try {
    await set(HANDLE, handle);
  } catch {
    // Handle non persistable : la sauvegarde automatique vaut pour la session,
    // et le fichier sera redemandé à la prochaine ouverture.
  }
  await db.settings.delete('autoBackupLastError');
  return run();
}

/** Oublie le fichier : la sauvegarde automatique s'arrête. */
export async function forgetFile(): Promise<void> {
  cache = undefined;
  await db.settings.delete(HANDLE);
  await db.settings.delete('autoBackupLastError');
}

/**
 * Réécrit la sauvegarde dans le fichier désigné.
 *
 * L'autorisation d'écriture est révoquée à chaque redémarrage du navigateur :
 * elle est redemandée ici, et l'échec est enregistré plutôt que masqué — une
 * sauvegarde que l'on croit faite est pire que pas de sauvegarde du tout.
 */
export async function run(): Promise<AutoBackupStatus> {
  const handle = await handleCourant();
  if (!handle) return status();
  try {
    const etat = await handle.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
    if (etat !== 'granted') {
      const accorde = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'denied';
      if (accorde !== 'granted') throw new Error('Autorisation d’écriture refusée.');
    }
    const writable = await handle.createWritable();
    await writable.write(await backupService.serialize());
    await writable.close();
    await set(LAST_RUN, stamp());
    await db.settings.delete('autoBackupLastError');
  } catch (e) {
    await set('autoBackupLastError', (e as Error).message);
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

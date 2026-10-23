import { documentKind } from './documents';

/**
 * Pont exposé par l'édition bureau (desktop/preload.cjs) ; absent dans le navigateur.
 * La page ne sait rien faire de plus que ces actions.
 */
export interface DesktopBridge {
  desktop: true;
  /** Boîte « Ouvrir » : chemin choisi, ou null si l'utilisateur annule. */
  pickFile: () => Promise<string | null>;
  openPath: (path: string) => Promise<{ ok: boolean; error?: string }>;
  /** Dossier des sauvegardes automatiques de cet ordinateur, ou null s'il n'est pas choisi. */
  backupFolder: () => Promise<string | null>;
  /** Boîte « Choisir un dossier » ; renvoie le dossier retenu, ou null (annulé ou inutilisable). */
  chooseBackupFolder: () => Promise<string | null>;
  forgetBackupFolder: () => Promise<boolean>;
  /** Écrit `nom` (forme « base_AAAA-MM-JJ.cbjson ») dans ce dossier et garde les 10 plus récentes. */
  writeBackup: (name: string, content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Sauvegarde .cbjson ouverte depuis l'explorateur (double-clic), remise une seule fois. */
  takePendingBackup: () => Promise<{ name: string; content: string } | null>;
  /** Prévenu d'un nouveau double-clic pendant que l'application tourne ; renvoie la fonction qui se désabonne. */
  onBackupOpened: (callback: () => void) => () => void;
}

declare global {
  interface Window { comptesBudget?: DesktopBridge }
}

export const getBridge = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.comptesBudget;

/**
 * Ouvre un document lié. Un lien https s'ouvre dans le navigateur (sans transmettre
 * la page d'origine) ; un fichier local ne s'ouvre que dans l'édition bureau, qui
 * revérifie le chemin de son côté.
 */
export async function openDocument(path: string): Promise<{ ok: boolean; error?: string }> {
  const kind = documentKind(path);
  if (kind === 'lien') {
    if (!/^https:\/\//i.test(path.trim())) return { ok: false, error: 'Seuls les liens https:// s’ouvrent depuis l’application.' };
    window.open(path.trim(), '_blank', 'noopener,noreferrer');
    return { ok: true };
  }
  if (kind === 'fichier') {
    const bridge = getBridge();
    if (!bridge) return { ok: false, error: 'L’ouverture d’un fichier local n’est possible que dans l’édition bureau : ouvrez-le depuis votre explorateur.' };
    try {
      return await bridge.openPath(path.trim());
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: false, error: 'Ce document n’est ni un lien https ni un chemin complet.' };
}

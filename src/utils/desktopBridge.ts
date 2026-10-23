import { documentKind } from './documents';

/**
 * Pont exposé par l'édition bureau (desktop/preload.cjs) ; absent dans le navigateur.
 * La page ne sait rien faire de plus que ces deux actions.
 */
export interface DesktopBridge {
  desktop: true;
  /** Boîte « Ouvrir » : chemin choisi, ou null si l'utilisateur annule. */
  pickFile: () => Promise<string | null>;
  openPath: (path: string) => Promise<{ ok: boolean; error?: string }>;
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

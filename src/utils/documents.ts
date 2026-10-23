// Documents liés à une opération : un nom et un chemin (ou un lien), jamais le fichier.
//
// Le fichier lui-même n'entre pas dans la base : on retient où le retrouver, comme le
// fait un classeur de factures. Deux conséquences assumées : la base reste légère et
// la sauvegarde ne grossit pas, mais déplacer un fichier casse le lien — d'où l'outil
// « Organiser les liens » (Préférences → Maintenance).
//
// Ouvrir un document n'est possible que pour un lien https (dans le navigateur) ou,
// dans l'édition bureau, pour un fichier ordinaire : la règle est celle de
// desktop/openPolicy.cjs, que le processus principal applique de son côté.

import type { DocumentLink } from '../types';

export const MAX_DOCUMENTS = 10;
export const MAX_LABEL = 60;
export const MAX_PATH = 500;

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const UNC_PATH = /^\\\\[^\\/]+[\\/][^\\/]+/;
const POSIX_PATH = /^\/[^/]/;

export type DocumentKind = 'lien' | 'fichier';

/** Lien web (http ou https), chemin complet, ou rien de reconnu. */
export function documentKind(path: string): DocumentKind | null {
  const p = path.trim();
  if (/^https?:\/\//i.test(p)) return 'lien';
  if (WINDOWS_PATH.test(p) || UNC_PATH.test(p) || POSIX_PATH.test(p)) return 'fichier';
  return null;
}

/** Nom à afficher pour un chemin ou un lien : le dernier élément, sans paramètres de requête. */
export function baseName(path: string): string {
  const p = path.trim().replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1) || path.trim();
}

/** Message d'erreur d'un document saisi, ou null s'il est acceptable. */
export function validateDocument(d: DocumentLink): string | null {
  const label = d.label.trim(), path = d.path.trim();
  if (!path) return 'Indiquez le chemin ou le lien du document.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(path) || /[\u0000-\u001f]/.test(label)) return 'Le nom ou le chemin contient un caractère interdit.';
  if (path.length > MAX_PATH) return `Le chemin est limité à ${MAX_PATH} caractères.`;
  if (label.length > MAX_LABEL) return `Le nom est limité à ${MAX_LABEL} caractères.`;
  const kind = documentKind(path);
  if (!kind) return 'Indiquez un lien commençant par https:// ou le chemin complet du fichier (ex. C:\\Documents\\facture.pdf).';
  if (kind === 'lien') {
    try {
      const u = new URL(path);
      if (u.protocol !== 'https:') return 'Seuls les liens https:// sont acceptés.';
    } catch {
      return 'Ce lien n’est pas valide.';
    }
  }
  return null;
}

/** Nettoie et contrôle une liste de documents ; lève une erreur lisible sinon. */
export function normalizeDocuments(docs: DocumentLink[] | undefined): DocumentLink[] | undefined {
  if (!docs || docs.length === 0) return undefined;
  if (docs.length > MAX_DOCUMENTS) throw new Error(`Une opération accepte ${MAX_DOCUMENTS} documents au plus.`);
  return docs.map(d => {
    const problem = validateDocument(d);
    if (problem) throw new Error(problem);
    const path = d.path.trim();
    return { label: d.label.trim() || baseName(path), path };
  });
}

/**
 * Remplace le début d'un chemin (changement de disque ou de dossier). Les deux
 * séparateurs sont équivalents et la casse est ignorée, comme sous Windows ; le
 * reste du chemin garde ses séparateurs d'origine. Renvoie null si le chemin ne
 * commence pas par `from`, ou si la coupure tomberait au milieu d'un nom de dossier.
 */
export function replacePathPrefix(path: string, from: string, to: string): string | null {
  const f = from.trim().replace(/[\\/]+$/, '');
  if (!f) return null;
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  if (!norm(path).startsWith(norm(f))) return null;
  const rest = path.slice(f.length);
  if (rest !== '' && !/^[\\/]/.test(rest)) return null;     // « C:\Doc » ne doit pas toucher « C:\Documents »
  return to.trim().replace(/[\\/]+$/, '') + rest;
}

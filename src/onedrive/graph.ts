// Appels Microsoft Graph limités au dossier d'application.
//
// `special/approot` désigne un dossier créé par OneDrive pour cette
// application seule (Applications/Comptes et Budget). La portée
// Files.ReadWrite.AppFolder ne donne accès à rien d'autre : même compromise,
// l'application ne peut ni lire ni modifier le reste du OneDrive.

const HOST = 'https://graph.microsoft.com/';
const ROOT = `${HOST}v1.0/me/drive/special/approot`;

/**
 * Taille au-delà de laquelle l'envoi simple (un seul PUT) n'est plus permis.
 * La documentation Graph (« Upload small files ») donne 250 Mo ; ce plafond
 * valait 4 Mo dans une version précédente de ce fichier, ce qui refusait sans
 * raison une sauvegarde de quelques mégaoctets. Une session d'envoi fractionné
 * n'est volontairement pas implémentée : son adresse d'envoi pointe vers un
 * hôte que la politique de sécurité de la passerelle n'autorise pas.
 */
export const MAX_SIMPLE_UPLOAD = 250 * 1024 * 1024;

const encodePath = (name: string) => encodeURIComponent(name).replace(/'/g, '%27');

export const uploadUrl = (name: string): string =>
  `${ROOT}:/${encodePath(name)}:/content`;

export const contentUrl = (name: string): string =>
  `${ROOT}:/${encodePath(name)}:/content`;

export const childrenUrl = (): string =>
  `${ROOT}/children?$select=name,size,lastModifiedDateTime,folder&$top=200&$orderby=name desc`;

export const deleteUrl = (name: string): string =>
  `${ROOT}:/${encodePath(name)}`;

export interface RemoteFile {
  name: string;
  size: number;
  modifiedAt: string;
}

/** Lit la liste des enfants du dossier d'application (les sous-dossiers sont ignorés). */
export function readChildren(json: unknown): RemoteFile[] {
  const value = (json as { value?: unknown })?.value;
  if (!Array.isArray(value)) return [];
  return value
    .map(v => v as Record<string, unknown>)
    .filter(v => typeof v.name === 'string' && !v.folder)
    .map(v => ({
      name: v.name as string,
      size: typeof v.size === 'number' ? v.size : 0,
      modifiedAt: typeof v.lastModifiedDateTime === 'string' ? v.lastModifiedDateTime : '',
    }));
}

/**
 * Page suivante d'une liste paginée (`@odata.nextLink`).
 * Le jeton d'accès accompagne cette requête : l'adresse n'est suivie que si
 * elle reste chez Graph, jamais vers un hôte désigné par la réponse.
 */
export function nextLinkOf(json: unknown): string | undefined {
  const lien = (json as Record<string, unknown>)?.['@odata.nextLink'];
  return typeof lien === 'string' && lien.startsWith(HOST) ? lien : undefined;
}

/** Statuts après lesquels une nouvelle tentative a un sens (limitation, panne passagère). */
export const RETRYABLE = new Set([429, 502, 503, 504]);

/** Délai demandé par `Retry-After` (secondes ou date HTTP), en millisecondes. */
export function parseRetryAfter(header: string | null | undefined, now: number): number | undefined {
  if (!header) return undefined;
  const v = header.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Message d'erreur lisible à partir d'une réponse Graph.
 * Les codes d'erreur (stables) priment sur les messages de Graph, qui sont en
 * anglais et changent ; à défaut, le code HTTP fait foi.
 */
export function readError(status: number, json: unknown): string {
  const err = (json as { error?: { code?: unknown; message?: unknown; innerError?: { code?: unknown } } })?.error;
  const inner = typeof err?.innerError?.code === 'string' ? err.innerError.code : '';
  if (inner === 'serviceReadOnly') {
    return 'OneDrive refuse toute écriture pour ce compte (service en lecture seule côté Microsoft).';
  }
  if (status === 401) return 'Connexion Microsoft expirée : reconnectez-vous.';
  if (status === 403) return 'Accès refusé par OneDrive pour ce dossier.';
  if (status === 404) return 'Fichier introuvable dans le dossier de l’application.';
  if (status === 409) return 'Conflit dans OneDrive (fichier verrouillé ou déjà en cours d’écriture) : réessayez dans un instant.';
  if (status === 413) return 'Sauvegarde trop volumineuse pour OneDrive.';
  if (status === 423) return 'Fichier verrouillé dans OneDrive : réessayez dans un instant.';
  if (status === 429) return 'OneDrive limite temporairement les requêtes : réessayez dans quelques minutes.';
  if (status === 507) return 'Espace insuffisant sur OneDrive.';
  if (status >= 500) return `OneDrive est momentanément indisponible (code ${status}) : réessayez plus tard.`;
  const message = err?.message;
  if (typeof message === 'string' && message.trim()) return message.split('\n')[0];
  return `Erreur OneDrive (code ${status}).`;
}

/* ------------------------------------------------------------- rotation */

/** Copies datées d'une même base : « <base>_AAAA-MM-JJ.cbjson ». */
const COPIE = /^(.+)_(\d{4}-\d{2}-\d{2})\.cbjson$/;

/**
 * Noms à supprimer pour ne garder que les `keep` copies les plus récentes de la
 * base du fichier qui vient d'être écrit.
 *
 * Ne touche qu'aux fichiers de la MÊME base et de la forme exacte « base_date »
 * (jamais un fichier étranger déposé dans le dossier), et ne propose jamais de
 * supprimer le fichier qu'on vient d'écrire, même si l'horloge a reculé.
 */
export function staleCopies(names: string[], justWritten: string, keep: number): string[] {
  const base = COPIE.exec(justWritten)?.[1];
  if (!base || keep < 1) return [];
  // Le fichier écrit compte parmi les copies même si la liste, lue juste après,
  // ne le montre pas encore (cohérence différée côté OneDrive).
  const copies = [...new Set([...names, justWritten])]
    .filter(n => COPIE.exec(n)?.[1] === base)
    .sort()
    .reverse(); // la date finissant le nom, l'ordre alphabétique est chronologique
  return copies.slice(keep).filter(n => n !== justWritten);
}

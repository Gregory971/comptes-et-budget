// Appels Microsoft Graph limités au dossier d'application.
//
// `special/approot` désigne un dossier créé par OneDrive pour cette
// application seule (Applications/Comptes et Budget). La portée
// Files.ReadWrite.AppFolder ne donne accès à rien d'autre : même compromise,
// l'application ne peut ni lire ni modifier le reste du OneDrive.

const ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';

/** Taille au-delà de laquelle Graph exige une session d'envoi fractionné. */
export const MAX_SIMPLE_UPLOAD = 4 * 1024 * 1024;

const encodePath = (name: string) => encodeURIComponent(name).replace(/'/g, '%27');

export const uploadUrl = (name: string): string =>
  `${ROOT}:/${encodePath(name)}:/content`;

export const contentUrl = (name: string): string =>
  `${ROOT}:/${encodePath(name)}:/content`;

export const childrenUrl = (): string =>
  `${ROOT}/children?$select=name,size,lastModifiedDateTime&$top=200&$orderby=name desc`;

export const deleteUrl = (name: string): string =>
  `${ROOT}:/${encodePath(name)}`;

export interface RemoteFile {
  name: string;
  size: number;
  modifiedAt: string;
}

/** Lit la liste des enfants du dossier d'application. */
export function readChildren(json: unknown): RemoteFile[] {
  const value = (json as { value?: unknown })?.value;
  if (!Array.isArray(value)) return [];
  return value
    .map(v => v as Record<string, unknown>)
    .filter(v => typeof v.name === 'string')
    .map(v => ({
      name: v.name as string,
      size: typeof v.size === 'number' ? v.size : 0,
      modifiedAt: typeof v.lastModifiedDateTime === 'string' ? v.lastModifiedDateTime : '',
    }));
}

/**
 * Message d'erreur lisible à partir d'une réponse Graph.
 * Graph répond en JSON structuré ; à défaut, le code HTTP fait foi.
 */
export function readError(status: number, json: unknown): string {
  const message = ((json as { error?: { message?: unknown } })?.error?.message);
  if (typeof message === 'string' && message.trim()) return message.split('\n')[0];
  if (status === 401) return 'Connexion Microsoft expirée : reconnectez-vous.';
  if (status === 403) return 'Accès refusé par OneDrive pour ce dossier.';
  if (status === 404) return 'Fichier introuvable dans le dossier de l’application.';
  if (status === 507) return 'Espace insuffisant sur OneDrive.';
  return `Erreur OneDrive (code ${status}).`;
}

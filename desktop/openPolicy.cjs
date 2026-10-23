// Politique d'ouverture des documents liés aux opérations — partagée par le
// processus principal d'Electron et par les tests.
//
// Un document lié est un CHEMIN ou un LIEN saisi par l'utilisateur, jamais un
// fichier copié dans la base. Ouvrir un chemin revient à lancer une action du
// système : on ne le fait donc que pour un fichier ordinaire qui existe, et jamais
// pour un programme ou un script, même rangé dans un dossier de documents. La même
// règle sert côté page (src/utils/documents.ts) pour décider d'afficher « Ouvrir ».

'use strict';

const path = require('node:path');

/** Extensions que le système exécute ou interprète : refusées à l'ouverture. */
const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'lnk', 'url', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe',
  'js', 'jse', 'jar', 'wsf', 'wsh', 'reg', 'cpl', 'hta', 'dll', 'sys', 'appx', 'msix', 'app', 'command',
  'sh', 'bash', 'zsh', 'py', 'pl', 'rb', 'gadget', 'application', 'chm', 'inf', 'ws', 'sct',
]);

const MAX_PATH = 500;

/** Chemin Windows absolu (C:\ ou C:/), partage réseau (\\hote\partage) ou chemin POSIX absolu. */
function isAbsoluteFilePath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(p) || /^\/[^/]/.test(p);
}

/** Lien web que l'on accepte d'ouvrir : https seulement (jamais http, file, javascript, data…). */
function isOpenableUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

/** Extension en minuscules, sans point ; vide s'il n'y en a pas. Les points finaux (« a.exe. ») sont ignorés : Windows les retire. */
function extensionOf(p) {
  const nom = path.win32.basename(String(p)).replace(/[. ]+$/, '');
  const i = nom.lastIndexOf('.');
  return i > 0 ? nom.slice(i + 1).toLowerCase() : '';
}

/**
 * Raison pour laquelle un chemin ne doit pas être ouvert, ou null s'il peut l'être.
 * Vérification SYNTAXIQUE ; l'existence du fichier est contrôlée par l'appelant.
 */
function refusalForPath(p) {
  if (typeof p !== 'string' || p.length === 0) return 'Chemin vide.';
  if (p.length > MAX_PATH) return 'Chemin trop long.';
  if (/[\u0000-\u001f]/.test(p)) return 'Caractère interdit dans le chemin.';
  if (!isAbsoluteFilePath(p)) return 'Seul un chemin complet peut être ouvert.';
  if (/(^|[\\/])\.\.([\\/]|$)/.test(p)) return 'Un chemin ne peut pas remonter dans l’arborescence.';
  // Flux de données alternatifs NTFS (« fichier.pdf:flux ») : un autre moyen de cacher un exécutable.
  if (/^[A-Za-z]:/.test(p) ? p.slice(2).includes(':') : p.includes(':')) return 'Chemin invalide.';
  const ext = extensionOf(p);
  if (EXECUTABLE_EXTENSIONS.has(ext)) return `Les fichiers « .${ext} » ne s’ouvrent pas depuis l’application : ce sont des programmes.`;
  return null;
}

module.exports = { EXECUTABLE_EXTENSIONS, MAX_PATH, isAbsoluteFilePath, isOpenableUrl, extensionOf, refusalForPath };

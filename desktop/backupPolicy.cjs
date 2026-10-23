// Règles de la sauvegarde automatique de l'édition bureau — partagées avec les tests.
//
// Le processus principal écrit dans UN dossier que l'utilisateur a choisi, et nulle
// part ailleurs. La page ne fournit qu'un NOM de fichier et un contenu : le nom est
// contraint à la forme que l'application produit elle-même (base_AAAA-MM-JJ.cbjson),
// de sorte qu'aucun chemin, aucune extension de programme et aucun nom spécial de
// Windows (CON, NUL…) ne puisse passer.

'use strict';

/** Nombre de copies datées conservées dans le dossier. */
const KEEP_COPIES = 10;

/** Taille maximale acceptée pour une sauvegarde (en caractères). */
const MAX_BYTES = 250 * 1024 * 1024;

const NOM = /^([A-Za-z0-9_-]{1,80})_(\d{4})-(\d{2})-(\d{2})\.cbjson$/;
const RESERVES = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9']);

/** Nom de fichier de sauvegarde valide : « Base_2026-10-23.cbjson », date réelle comprise. */
function parseBackupName(name) {
  if (typeof name !== 'string') return null;
  const m = NOM.exec(name);
  if (!m) return null;
  const [, base, y, mo, d] = m;
  if (RESERVES.has(base.toLowerCase())) return null;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return { base, date: `${y}-${mo}-${d}` };
}

/**
 * Fichiers à supprimer pour ne garder que les `keep` copies les plus récentes du MÊME
 * nom de base. Les autres fichiers du dossier — les sauvegardes d'une autre base, ou
 * n'importe quel document de l'utilisateur — ne sont jamais candidats.
 */
function filesToPrune(files, base, keep = KEEP_COPIES) {
  const ours = files
    .map(f => ({ f, p: parseBackupName(f) }))
    .filter(x => x.p && x.p.base === base)
    .sort((a, b) => b.p.date.localeCompare(a.p.date));
  return ours.slice(keep).map(x => x.f);
}

/**
 * Fichier .cbjson passé en argument (double-clic dans l'explorateur, « Ouvrir avec ») :
 * le premier argument qui est un chemin ABSOLU se terminant par « .cbjson ». Les options
 * (« --remote-debugging-port=… ») et tout le reste sont ignorés. Vérification syntaxique ;
 * l'existence et la taille du fichier sont contrôlées par l'appelant.
 */
function backupArgFrom(argv) {
  if (!Array.isArray(argv)) return null;
  for (const a of argv) {
    if (typeof a !== 'string' || a.startsWith('--') || a.length > 500) continue;
    if (!/\.cbjson$/i.test(a)) continue;
    if (/^[A-Za-z]:[\\/]/.test(a) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(a) || /^\/[^/]/.test(a)) {
      if (/[\u0000-\u001f]/.test(a) || /(^|[\\/])\.\.([\\/]|$)/.test(a)) continue;
      return a;
    }
  }
  return null;
}

module.exports = { KEEP_COPIES, MAX_BYTES, parseBackupName, filesToPrune, backupArgFrom };

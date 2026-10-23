// Lecture d'un fichier de cotations : une date et un cours par ligne.
//
// Les historiques proposés par les sites financiers n'ont pas de format commun :
// « Date;Clôture », « Date,Open,High,Low,Close,Adj Close,Volume », « 25/10/2026;52,3456 »…
// Les colonnes sont déduites de l'en-tête, à défaut de la première date et du
// premier nombre. Un cours n'est pas un montant : il garde ses décimales, d'où un
// lecteur à part (parseAmount arrondit au centime et lit « 52,3456 » de travers).

import { detectSeparator, parseDate, splitCsvLine } from './statement';
import type { Ymd } from './date';

/** Cours en euros par part : « 52,3456 », « 1 234,5 », « 1.234,5678 », « 52.3456 ». null si illisible. */
export function parsePrice(raw: string): number | null {
  let s = raw.trim().replace(/[\s  ]/g, '').replace(/(EUR|€)/gi, '');
  if (!s || !/^\d[\d.,]*$/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Les deux symboles : le dernier est la décimale, l'autre sépare les milliers.
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lastComma > -1 || lastDot > -1) {
    const sep = lastComma > -1 ? ',' : '.';
    // Plusieurs occurrences du même symbole : ce sont des milliers (« 1.234.567 »).
    s = s.split(sep).length > 2 ? s.split(sep).join('') : s.replace(sep, '.');
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface PriceEntry { date: Ymd; price: number }

export interface PriceFile { entries: PriceEntry[]; warnings: string[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const MAX_WARNINGS = 15;

export function parsePriceFile(text: string): PriceFile {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { entries: [], warnings: ['Le fichier est vide.'] };

  const sep = detectSeparator(lines);
  const rows = lines.map(l => splitCsvLine(l, sep));
  if (Math.max(...rows.map(r => r.length)) < 2) {
    return { entries: [], warnings: ['Le fichier doit avoir deux colonnes au moins : la date et le cours.'] };
  }

  // Une première ligne sans aucune date est un en-tête.
  const hasHeader = !rows[0].some(c => parseDate(c) !== null);
  const header = hasHeader ? rows[0].map(norm) : null;
  const data = hasHeader ? rows.slice(1) : rows;
  const col = (i: number) => data.map(r => r[i] ?? '');

  const width = Math.max(...rows.map(r => r.length));
  const firstCol = (ok: (i: number) => boolean) => Array.from({ length: width }, (_, i) => i).find(ok) ?? -1;

  let dateCol = header ? header.findIndex(h => /^date/.test(h)) : -1;
  if (dateCol < 0) dateCol = firstCol(i => col(i).some(v => parseDate(v) !== null));

  let priceCol = -1;
  if (header) {
    // « Close » avant « Adj Close » : le cours brut, pas le cours ajusté des dividendes.
    priceCol = header.findIndex((h, i) => i !== dateCol && /^(cloture|close|dernier|last|cours|prix|price|valeur)$/.test(h));
    if (priceCol < 0) priceCol = header.findIndex((h, i) => i !== dateCol && /(cloture|close|dernier|cours|prix|price|valeur)/.test(h) && !/adj|ajust/.test(h));
  }
  if (priceCol < 0) priceCol = firstCol(i => i !== dateCol && col(i).some(v => parsePrice(v) !== null));

  if (dateCol < 0 || priceCol < 0) {
    return { entries: [], warnings: ['Colonnes introuvables : le fichier doit contenir une date et un cours.'] };
  }

  const byDate = new Map<Ymd, number>();
  const warnings: string[] = [];
  let bad = 0;
  data.forEach((r, i) => {
    const ligne = i + 1 + (hasHeader ? 1 : 0);
    const date = parseDate(r[dateCol] ?? '');
    const price = parsePrice(r[priceCol] ?? '');
    if (!date || price === null) {
      bad++;
      if (warnings.length < MAX_WARNINGS) warnings.push(`Ligne ${ligne} ignorée : ${!date ? 'date' : 'cours'} illisible.`);
      return;
    }
    byDate.set(date, price);   // deux cours le même jour : le dernier du fichier l'emporte
  });
  if (bad > warnings.length) warnings.push(`… et ${bad - warnings.length} autre(s) ligne(s) ignorée(s).`);
  if (byDate.size === 0 && warnings.length === 0) warnings.push('Aucune cotation trouvée dans le fichier.');

  return {
    entries: [...byDate.entries()].map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
  };
}

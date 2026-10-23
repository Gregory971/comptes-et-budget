// Lecture d'un relevé bancaire — CSV, OFX/QFX ou QIF.
//
// Rien ne sort de l'appareil : le fichier est lu par le navigateur et analysé
// ici même. Aucune requête réseau n'est possible (connect-src 'none').
//
// Les banques françaises n'exportent pas deux fichiers identiques : séparateur
// point-virgule ou virgule, montant en une colonne signée ou en deux colonnes
// débit/crédit, date en JJ/MM/AAAA ou AAAA-MM-JJ, décimale en virgule, espaces
// insécables dans les milliers. Le format est donc DÉDUIT du contenu plutôt que
// demandé à l'utilisateur, et tout ce qui reste illisible est signalé ligne à
// ligne au lieu d'être avalé en silence.

import { ymd, type Ymd } from './date';
import type { Cents } from './money';

export interface StatementEntry {
  /** Date civile de l'opération. */
  date: Ymd;
  /** Libellé tel que la banque l'écrit. */
  label: string;
  /** Montant signé, en centimes : négatif pour un débit. */
  amountCents: Cents;
  /** Référence portée par le relevé (FITID, numéro de chèque). */
  reference?: string;
}

export interface StatementParse {
  format: 'csv' | 'ofx' | 'qif';
  entries: StatementEntry[];
  /** Lignes écartées, avec leur motif — jamais d'échec silencieux. */
  warnings: string[];
  /** Colonnes retenues (CSV), pour affichage dans la fenêtre de confirmation. */
  mapping?: { date: string; label: string; amount: string };
}

/* ------------------------------------------------------------------ nombres */

/**
 * Montant d'un relevé, en centimes.
 *
 * Accepte « 1 234,56 », « 1.234,56 », « 1,234.56 », « -42.50 », « 42,50- »
 * (signe suffixé, usage de certains exports) et « (42,50) » (parenthèses).
 * Le séparateur décimal est le DERNIER symbole rencontré : c'est le seul
 * critère qui distingue « 1.234,56 » de « 1,234.56 » sans connaître la banque.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim()
    .replace(/[\s\u00a0\u202f]/g, '')   // espaces, y compris insécables
    .replace(/(EUR|€)/gi, '');
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const sep = Math.max(lastComma, lastDot);
  let entier = s, decimales = '';
  if (sep > -1) {
    const tail = s.slice(sep + 1);
    // Trois chiffres après le séparateur : c'est un séparateur de milliers
    // (« 1.234 »), pas une décimale.
    if (/^\d{1,2}$/.test(tail)) { entier = s.slice(0, sep); decimales = tail; }
  }
  entier = entier.replace(/[.,]/g, '');
  if (!/^\d*$/.test(entier) || (entier === '' && decimales === '')) return null;
  const cents = Number(entier || '0') * 100 + Number(decimales.padEnd(2, '0') || '0');
  return negative ? -cents : cents;
}

/* -------------------------------------------------------------------- dates */

/** Date d'un relevé : JJ/MM/AAAA, JJ-MM-AA, AAAA-MM-JJ, JJ.MM.AAAA, AAAAMMJJ. */
export function parseDate(raw: string): Ymd | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) return build(+iso[1], +iso[2], +iso[3]);

  const fr = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (fr) {
    const y = fr[3].length === 2 ? 2000 + Number(fr[3]) : Number(fr[3]);
    return build(y, +fr[2], +fr[1]);
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) return build(+compact[1], +compact[2], +compact[3]);

  return null;
}

function build(y: number, m: number, d: number): Ymd | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  return ymd(y, m - 1, d);
}

/* ---------------------------------------------------------------------- CSV */

/** Découpe une ligne CSV en respectant les guillemets et les doublements. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

const SEPARATORS = [';', ',', '\t', '|'];

/** Séparateur le plus régulier sur les premières lignes. */
export function detectSeparator(lines: string[]): string {
  let best = ';', bestScore = -1;
  for (const sep of SEPARATORS) {
    const counts = lines.slice(0, 8).map(l => splitCsvLine(l, sep).length);
    const min = Math.min(...counts);
    if (min < 2) continue;
    // Régularité d'abord, largeur ensuite : un séparateur qui découpe toutes
    // les lignes en autant de colonnes est le bon.
    const score = counts.every(c => c === counts[0]) ? 100 + min : min;
    if (score > bestScore) { bestScore = score; best = sep; }
  }
  return best;
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const HEADER = {
  date: /^(date|date operation|date d.?operation|date de valeur|date comptable|valeur)/,
  label: /(libell|description|nature|motif|detail|intitul|operation|memo)/,
  amount: /(montant|amount|somme)/,
  debit: /(debit|retrait|depense)/,
  credit: /(credit|depot|recette|versement)/,
  reference: /(reference|ref\.|numero|no\.|cheque|piece)/,
};

interface Mapping {
  date: number; label: number; amount: number; debit: number; credit: number; reference: number;
}

/** Rattache chaque rôle à une colonne, d'après l'en-tête puis d'après le contenu. */
function mapColumns(header: string[] | null, sample: string[][]): Mapping | null {
  const m: Mapping = { date: -1, label: -1, amount: -1, debit: -1, credit: -1, reference: -1 };

  if (header) {
    header.forEach((h, i) => {
      const n = norm(h);
      if (m.date < 0 && HEADER.date.test(n)) m.date = i;
      else if (m.debit < 0 && HEADER.debit.test(n)) m.debit = i;
      else if (m.credit < 0 && HEADER.credit.test(n)) m.credit = i;
      else if (m.amount < 0 && HEADER.amount.test(n)) m.amount = i;
      else if (m.label < 0 && HEADER.label.test(n)) m.label = i;
      else if (m.reference < 0 && HEADER.reference.test(n)) m.reference = i;
    });
  }

  const width = Math.max(...sample.map(r => r.length), header?.length ?? 0);
  const colonne = (i: number) => sample.map(r => r[i] ?? '');

  // Colonnes déduites du contenu : indispensable pour les exports sans en-tête.
  if (m.date < 0) {
    for (let i = 0; i < width; i++) {
      const vals = colonne(i).filter(v => v !== '');
      if (vals.length && vals.every(v => parseDate(v) !== null)) { m.date = i; break; }
    }
  }
  if (m.amount < 0 && m.debit < 0 && m.credit < 0) {
    for (let i = width - 1; i >= 0; i--) {
      if (i === m.date) continue;
      const vals = colonne(i).filter(v => v !== '');
      if (vals.length && vals.every(v => parseAmount(v) !== null)) { m.amount = i; break; }
    }
  }
  if (m.label < 0) {
    let best = -1, bestLen = 0;
    for (let i = 0; i < width; i++) {
      if (i === m.date || i === m.amount || i === m.debit || i === m.credit) continue;
      const len = colonne(i).reduce((s, v) => s + v.length, 0);
      if (len > bestLen) { bestLen = len; best = i; }
    }
    m.label = best;
  }

  if (m.date < 0) return null;
  if (m.amount < 0 && m.debit < 0 && m.credit < 0) return null;
  return m;
}

function parseCsv(text: string): StatementParse {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const warnings: string[] = [];
  if (lines.length === 0) return { format: 'csv', entries: [], warnings: ['Fichier vide.'] };

  const sep = detectSeparator(lines);
  const rows = lines.map(l => splitCsvLine(l, sep));

  // En-tête : première ligne sans date exploitable alors que les suivantes en
  // ont une. Certains exports posent aussi des lignes de titre avant l'en-tête.
  let start = 0;
  while (start < rows.length - 1 && !rows[start].some(c => parseDate(c) !== null)
    && !rows[start + 1].some(c => parseDate(c) !== null)) start++;
  const headerRow = rows[start].some(c => parseDate(c) !== null) ? null : rows[start];
  const body = rows.slice(headerRow ? start + 1 : start);

  const m = mapColumns(headerRow, body.slice(0, 12));
  if (!m) {
    return {
      format: 'csv', entries: [],
      warnings: ['Colonnes non reconnues : il faut au minimum une colonne de date et une colonne de montant.'],
    };
  }

  const entries: StatementEntry[] = [];
  body.forEach((r, i) => {
    const ligne = i + (headerRow ? 2 : 1) + start;
    const date = parseDate(r[m.date] ?? '');
    if (!date) { warnings.push(`Ligne ${ligne} ignorée : date illisible (« ${r[m.date] ?? ''} »).`); return; }

    let cents: number | null = null;
    if (m.amount >= 0) cents = parseAmount(r[m.amount] ?? '');
    if (cents === null && (m.debit >= 0 || m.credit >= 0)) {
      const d = m.debit >= 0 ? parseAmount(r[m.debit] ?? '') : null;
      const c = m.credit >= 0 ? parseAmount(r[m.credit] ?? '') : null;
      if (d !== null && d !== 0) cents = -Math.abs(d);
      else if (c !== null && c !== 0) cents = Math.abs(c);
    }
    if (cents === null) { warnings.push(`Ligne ${ligne} ignorée : montant illisible.`); return; }
    if (cents === 0) { warnings.push(`Ligne ${ligne} ignorée : montant nul.`); return; }

    entries.push({
      date,
      label: (m.label >= 0 ? r[m.label] ?? '' : '').replace(/\s+/g, ' ').trim(),
      amountCents: cents,
      reference: m.reference >= 0 ? (r[m.reference] || undefined) : undefined,
    });
  });

  const nom = (i: number) => (headerRow?.[i] ?? `colonne ${i + 1}`);
  return {
    format: 'csv', entries, warnings,
    mapping: {
      date: nom(m.date),
      label: m.label >= 0 ? nom(m.label) : '—',
      amount: m.amount >= 0 ? nom(m.amount) : `${nom(m.debit)} / ${nom(m.credit)}`,
    },
  };
}

/* ---------------------------------------------------------------------- OFX */

/** Valeur d'une balise OFX, en SGML (v1, sans fermeture) comme en XML (v2). */
function ofxTag(bloc: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i');
  const m = re.exec(bloc);
  const v = m?.[1]?.trim();
  return v ? v : undefined;
}

function parseOfx(text: string): StatementParse {
  const warnings: string[] = [];
  const blocs = text.split(/<STMTTRN>/i).slice(1);
  const entries: StatementEntry[] = [];

  blocs.forEach((brut, i) => {
    const bloc = brut.split(/<\/STMTTRN>/i)[0];
    const date = parseDate((ofxTag(bloc, 'DTPOSTED') ?? '').slice(0, 8));
    const cents = parseAmount(ofxTag(bloc, 'TRNAMT') ?? '');
    if (!date || cents === null) {
      warnings.push(`Opération ${i + 1} ignorée : date ou montant illisible.`);
      return;
    }
    const name = ofxTag(bloc, 'NAME');
    const memo = ofxTag(bloc, 'MEMO');
    entries.push({
      date, amountCents: cents,
      label: [name, memo].filter(Boolean).join(' — ').trim(),
      reference: ofxTag(bloc, 'CHECKNUM') ?? ofxTag(bloc, 'FITID'),
    });
  });

  if (entries.length === 0 && warnings.length === 0) {
    warnings.push('Aucune opération trouvée dans le fichier OFX.');
  }
  return { format: 'ofx', entries, warnings };
}

/* ---------------------------------------------------------------------- QIF */

/**
 * QIF (Quicken) : des enregistrements de lignes « une lettre + une valeur »,
 * terminés par « ^ ». D date, T montant (U en variante), P bénéficiaire,
 * M mémo, N numéro de chèque ; L (catégorie), les lignes de ventilation S/E/$
 * et les en-têtes « !… » sont ignorés — le montant T est déjà le total.
 *
 * Le format ne dit pas l'ordre des dates. On le déduit du fichier : un premier
 * champ supérieur à 12 est forcément un jour (JJ/MM), un second supérieur à 12
 * forcément un jour (MM/JJ). Si rien ne tranche, on lit jour/mois — l'usage
 * français — et on le dit.
 */
/** Date QIF : deux champs et une année sur 2 ou 4 chiffres ; l'apostrophe est celle de Quicken (« 5'26 »). */
const QIF_DATE = /^(\d{1,2})[/.'-](\d{1,2})[/.'-](\d{2}|\d{4})$/;

function qifDate(compact: string, monthFirst: boolean): Ymd | null {
  const m = QIF_DATE.exec(compact);
  if (!m) return parseDate(compact);
  const y = m[3].length === 2 ? (Number(m[3]) < 70 ? 2000 : 1900) + Number(m[3]) : Number(m[3]);
  return monthFirst ? build(y, +m[1], +m[2]) : build(y, +m[2], +m[1]);
}

function parseQif(text: string): StatementParse {
  const warnings: string[] = [];
  const records: { d?: string; t?: string; p?: string; m?: string; n?: string; line: number }[] = [];
  let cur: (typeof records)[number] = { line: 0 };
  let started = false;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line === '^') {
      if (started) records.push(cur);
      cur = { line: i + 2 }; started = false;
      return;
    }
    if (line.startsWith('!')) return;
    if (!started) { cur = { ...cur, line: i + 1 }; started = true; }
    const v = line.slice(1).trim();
    switch (line[0].toUpperCase()) {
      case 'D': cur.d = v; break;
      case 'T': case 'U': if (cur.t === undefined) cur.t = v; break;
      case 'P': cur.p = v; break;
      case 'M': cur.m = v; break;
      case 'N': cur.n = v; break;
      default: break;
    }
  });
  if (started) records.push(cur);

  // Ordre des dates, d'après l'ensemble du fichier.
  const parts = records.map(r => QIF_DATE.exec((r.d ?? '').replace(/\s/g, '')));
  const anyFirstOver12 = parts.some(m => m && +m[1] > 12);
  const anySecondOver12 = parts.some(m => m && +m[2] > 12);
  const monthFirst = !anyFirstOver12 && anySecondOver12;
  if (!anyFirstOver12 && !anySecondOver12 && parts.some(Boolean)) {
    warnings.push('Les dates du fichier QIF sont ambiguës : lues en jour/mois/année. Vérifiez-les avant d’importer.');
  }

  const entries: StatementEntry[] = [];
  records.forEach((r, i) => {
    const where = `Enregistrement ${i + 1} (ligne ${r.line})`;
    const compact = (r.d ?? '').replace(/\s/g, '');
    const date = qifDate(compact, monthFirst);
    if (!date) { warnings.push(`${where} : date illisible (« ${r.d ?? ''} »).`); return; }
    const amount = r.t === undefined ? null : parseAmount(r.t);
    if (amount === null) { warnings.push(`${where} : montant illisible (« ${r.t ?? ''} »).`); return; }
    const label = [r.p, r.m].filter((x, k, a) => x && a.indexOf(x) === k).join(' — ') || '(sans libellé)';
    entries.push({ date, label, amountCents: amount, ...(r.n ? { reference: r.n } : {}) });
  });

  if (entries.length === 0 && warnings.length === 0) warnings.push('Aucune opération trouvée dans le fichier QIF.');
  return { format: 'qif', entries, warnings };
}

/* ------------------------------------------------------------------- entrée */

/** Analyse un relevé, format déduit du contenu. */
export function parseStatement(text: string): StatementParse {
  const head = text.slice(0, 4000);
  if (/<OFX>|<STMTTRN>|OFXHEADER/i.test(head)) return parseOfx(text);
  if (/^\s*!Type:/im.test(head) || /^\s*!Account/im.test(head)) return parseQif(text);
  return parseCsv(text);
}

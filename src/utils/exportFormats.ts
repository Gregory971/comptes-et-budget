// Écriture des fichiers d'échange : CSV, Excel (.xlsx), QIF et OFX.
//
// Fonctions pures : elles prennent des lignes déjà résolues (noms de compte, de
// tiers, de catégorie…) et rendent du texte ou des octets. Aucune dépendance.

import type { Ymd } from './date';
import type { Cents } from './money';

export interface ExportRow {
  date: Ymd;
  account: string;
  /** Code de la devise du compte (EUR…). */
  currency: string;
  payee: string;
  category: string;
  method: string;
  reference: string;
  label: string;
  note: string;
  /** Signé, en centimes : négatif pour une dépense. */
  amountCents: Cents;
  checked: boolean;
  /** Identifiant stable de l'opération, repris comme FITID en OFX. */
  id: string;
}

export type DateFormat = 'fr' | 'iso';

export interface CsvOptions {
  separator: ';' | ',' | '\t';
  decimal: ',' | '.';
  dateFormat: DateFormat;
  header: boolean;
  /** Octet d'ordre (BOM) UTF-8 : Excel s'en sert pour reconnaître les accents. */
  bom: boolean;
}

export const DEFAULT_CSV: CsvOptions = { separator: ';', decimal: ',', dateFormat: 'fr', header: true, bom: true };

export const COLUMNS = [
  'Date', 'Compte', 'Devise', 'Tiers', 'Catégorie', 'Mode de paiement', 'Référence', 'Libellé', 'Commentaire', 'Montant', 'Pointé',
] as const;

/** « 2026-10-25 » → « 25/10/2026 » ou inchangé. */
export const formatDate = (d: Ymd, f: DateFormat): string => (f === 'iso' ? d : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);

/** Montant en texte, deux décimales exactes, sans séparateur de milliers. */
export function amountText(cents: Cents, decimal: ',' | '.'): string {
  const abs = Math.abs(cents);
  const s = `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return decimal === ',' ? s.replace('.', ',') : s;
}

/**
 * Protection contre l'injection de formules : un tableur exécute une cellule qui
 * commence par = + - @ (ou tabulation / retour chariot). Un libellé bancaire est
 * une donnée venue de l'extérieur — « =HYPERLINK(… » y est possible. On préfixe
 * d'une apostrophe, que le tableur masque et traite comme du texte.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvField(value: string, sep: string): string {
  return /["\r\n]/.test(value) || value.includes(sep) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: ExportRow[], options: CsvOptions = DEFAULT_CSV): string {
  const { separator: sep } = options;
  const lines: string[] = [];
  if (options.header) lines.push(COLUMNS.map(c => csvField(c, sep)).join(sep));
  for (const r of rows) {
    const text = (v: string) => csvField(neutralizeFormula(v), sep);
    lines.push([
      formatDate(r.date, options.dateFormat), text(r.account), r.currency, text(r.payee), text(r.category),
      text(r.method), text(r.reference), text(r.label), text(r.note),
      amountText(r.amountCents, options.decimal),   // un nombre n'est pas une formule : pas de préfixe
      r.checked ? 'Oui' : 'Non',
    ].map((v, i) => (i === 9 || i === 0 ? csvField(v, sep) : v)).join(sep));
  }
  return (options.bom ? '\uFEFF' : '') + lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

/* ---------------------------------------------------------------------- QIF */

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** QIF : un bloc par compte, dates JJ/MM/AAAA (usage français). */
export function toQif(rows: ExportRow[], dateFormat: DateFormat = 'fr'): string {
  const out: string[] = [];
  const byAccount = new Map<string, ExportRow[]>();
  for (const r of rows) byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), r]);
  for (const [account, list] of byAccount) {
    out.push('!Account', `N${oneLine(account)}`, 'TBank', '^', '!Type:Bank');
    for (const r of list) {
      out.push(`D${dateFormat === 'iso' ? r.date : formatDate(r.date, 'fr')}`, `T${amountText(r.amountCents, '.')}`);
      if (r.payee) out.push(`P${oneLine(r.payee)}`);
      const memo = [r.label, r.note].filter(Boolean).map(oneLine).join(' — ');
      if (memo) out.push(`M${memo}`);
      if (r.reference) out.push(`N${oneLine(r.reference)}`);
      if (r.category) out.push(`L${oneLine(r.category)}`);
      if (r.checked) out.push('CX');
      out.push('^');
    }
  }
  return out.join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------------- OFX */

const xmlEscape = (s: string) => oneLine(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** OFX 1.x (SGML) : relevé de tous les comptes, un FITID stable par opération. */
export function toOfx(rows: ExportRow[], now: Date = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
  const byAccount = new Map<string, ExportRow[]>();
  for (const r of rows) byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), r]);

  const body: string[] = [];
  let n = 0;
  for (const [account, list] of byAccount) {
    n++;
    const dates = list.map(r => r.date).sort();
    const compact = (d: Ymd) => d.replace(/-/g, '');
    body.push(
      '<STMTTRNRS>', `<TRNUID>${n}`, '<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
      '<STMTRS>', `<CURDEF>${list[0].currency || 'EUR'}`,
      `<BANKACCTFROM><BANKID>COMPTES<ACCTID>${xmlEscape(account)}<ACCTTYPE>CHECKING</BANKACCTFROM>`,
      '<BANKTRANLIST>', `<DTSTART>${compact(dates[0])}`, `<DTEND>${compact(dates[dates.length - 1])}`,
    );
    for (const r of list) {
      body.push(
        '<STMTTRN>', `<TRNTYPE>${r.amountCents < 0 ? 'DEBIT' : 'CREDIT'}`, `<DTPOSTED>${compact(r.date)}`,
        `<TRNAMT>${amountText(r.amountCents, '.')}`, `<FITID>${xmlEscape(r.id)}`,
        `<NAME>${xmlEscape(r.payee || r.label || r.category || 'Opération').slice(0, 32)}`,
      );
      const memo = [r.label, r.note].filter(Boolean).join(' — ');
      if (memo) body.push(`<MEMO>${xmlEscape(memo).slice(0, 255)}`);
      if (r.reference) body.push(`<CHECKNUM>${xmlEscape(r.reference)}`);
      body.push('</STMTTRN>');
    }
    body.push('</BANKTRANLIST>', '</STMTRS>', '</STMTTRNRS>');
  }

  return [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:UTF-8', 'CHARSET:NONE',
    'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>', `<DTSERVER>${stamp}`, '<LANGUAGE>FRA</SONRS></SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1>', ...body, '</BANKMSGSRSV1>', '</OFX>',
  ].join('\r\n') + '\r\n';
}

/* --------------------------------------------------------------------- XLSX */

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Archive ZIP « stockée » (sans compression) : suffisante pour un classeur de quelques milliers de lignes. */
export function zipStore(files: { name: string; data: Uint8Array }[], date: Date = new Date()): Uint8Array {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }

  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Caractères de contrôle interdits en XML 1.0.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Lettre(s) de colonne : 0 → A, 25 → Z, 26 → AA. */
export const columnName = (i: number): string => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** Classeur .xlsx d'une seule feuille : textes en chaînes, montants en vrais nombres au format 0,00. */
export function toXlsx(rows: ExportRow[], dateFormat: DateFormat = 'fr', sheetName = 'Opérations'): Uint8Array {
  // Une cellule « inlineStr » est toujours du texte pour le tableur : aucune formule à neutraliser ici.
  const text = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const header = `<row r="1">${COLUMNS.map((c, i) => `<c r="${columnName(i)}1" t="inlineStr" s="1"><is><t>${xml(c)}</t></is></c>`).join('')}</row>`;
  const body = rows.map((r, k) => {
    const n = k + 2;
    const cells = [
      text(`A${n}`, formatDate(r.date, dateFormat)), text(`B${n}`, r.account), text(`C${n}`, r.currency), text(`D${n}`, r.payee),
      text(`E${n}`, r.category), text(`F${n}`, r.method), text(`G${n}`, r.reference), text(`H${n}`, r.label), text(`I${n}`, r.note),
      `<c r="J${n}" s="2"><v>${amountText(r.amountCents, '.')}</v></c>`,
      text(`K${n}`, r.checked ? 'Oui' : 'Non'),
    ];
    return `<row r="${n}">${cells.join('')}</row>`;
  }).join('');

  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="5" width="22" customWidth="1"/><col min="6" max="7" width="16" customWidth="1"/><col min="8" max="9" width="34" customWidth="1"/><col min="10" max="10" width="14" customWidth="1"/></cols><sheetData>${header}${body}</sheetData></worksheet>`],
  ] as const;

  return zipStore(files.map(([name, content]) => ({ name, data: enc.encode(content) })));
}

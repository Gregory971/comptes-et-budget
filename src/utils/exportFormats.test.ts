import { describe, expect, it } from 'vitest';
import {
  amountText, columnName, crc32, formatDate, neutralizeFormula, toCsv, toOfx, toQif, toXlsx, zipStore,
  DEFAULT_CSV, type ExportRow,
} from './exportFormats';
import { parseStatement } from './statement';

let n = 0;
const ligne = (over: Partial<ExportRow> = {}): ExportRow => ({
  date: '2026-08-05', account: 'Courant', currency: 'EUR', payee: 'Carrefour', category: 'Alimentation', method: 'CB',
  reference: '', label: 'Courses', note: '', amountCents: -4250, checked: false, id: `op-${++n}`, ...over,
});

describe('formats de base', () => {
  it('écrit les montants avec deux décimales exactes', () => {
    expect(amountText(-4250, ',')).toBe('-42,50');
    expect(amountText(5, '.')).toBe('0.05');
    expect(amountText(-5, '.')).toBe('-0.05');
    expect(amountText(123456789, ',')).toBe('1234567,89');
    expect(amountText(0, ',')).toBe('0,00');
  });

  it('écrit les dates à la française ou en ISO', () => {
    expect(formatDate('2026-08-05', 'fr')).toBe('05/08/2026');
    expect(formatDate('2026-08-05', 'iso')).toBe('2026-08-05');
  });

  it('nomme les colonnes de feuille', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

describe('CSV', () => {
  it('écrit l’en-tête, le BOM et les lignes en CRLF', () => {
    const csv = toCsv([ligne()]);
    expect(csv.startsWith('\uFEFFDate;Compte;Devise;')).toBe(true);
    const lignes = csv.trim().split('\r\n');
    expect(lignes).toHaveLength(2);
    expect(lignes[1]).toBe('05/08/2026;Courant;EUR;Carrefour;Alimentation;CB;;Courses;;-42,50;Non');
  });

  it('s’adapte aux options', () => {
    const csv = toCsv([ligne({ checked: true })], { separator: ',', decimal: '.', dateFormat: 'iso', header: false, bom: false });
    expect(csv).toBe('2026-08-05,Courant,EUR,Carrefour,Alimentation,CB,,Courses,,-42.50,Oui\r\n');
  });

  it('met entre guillemets ce qui contient le séparateur, des guillemets ou un saut de ligne', () => {
    const csv = toCsv([ligne({ label: 'a;b', note: 'dit "oui"\nok' })], { ...DEFAULT_CSV, header: false, bom: false });
    expect(csv).toContain('"a;b"');
    expect(csv).toContain('"dit ""oui""\nok"');
  });

  it('met le montant entre guillemets quand décimale et séparateur sont la virgule', () => {
    const csv = toCsv([ligne()], { ...DEFAULT_CSV, separator: ',', header: false, bom: false });
    expect(csv).toContain('"-42,50"');
  });

  it('neutralise les formules venues d’un libellé bancaire, pas les montants négatifs', () => {
    const csv = toCsv([ligne({ label: '=HYPERLINK("http://x","clic")', payee: '+33 1', note: '@SUM(A1)', category: '-cmd' })],
      { ...DEFAULT_CSV, header: false, bom: false });
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csv).toContain(";'+33 1;");
    expect(csv).toContain(";'@SUM(A1);");
    expect(csv).toContain(";'-cmd;");
    expect(csv).toContain(';-42,50;');
    expect(neutralizeFormula('Salaire')).toBe('Salaire');
    expect(neutralizeFormula('\tx')).toBe("'\tx");
  });

  it('un classeur sans ligne reste un fichier valide', () => {
    expect(toCsv([], { ...DEFAULT_CSV, bom: false }).trim().split('\r\n')).toHaveLength(1);
    expect(toCsv([], { ...DEFAULT_CSV, header: false, bom: false })).toBe('');
  });

  it('se relit avec l’analyseur de relevés', () => {
    const rows = [ligne({ label: 'Courses' }), ligne({ date: '2026-08-07', amountCents: 150_000, label: 'Salaire', payee: 'Employeur' })];
    const lu = parseStatement(toCsv(rows).replace('\uFEFF', ''));
    expect(lu.entries.map(e => [e.date, e.amountCents])).toEqual([['2026-08-05', -4250], ['2026-08-07', 150_000]]);
  });
});

describe('QIF', () => {
  const rows = [
    ligne({ label: 'Courses', note: 'du samedi', reference: '1234', checked: true }),
    ligne({ date: '2026-08-07', amountCents: 150_000, label: 'Salaire', payee: 'Employeur', account: 'Épargne', category: '' }),
  ];

  it('écrit un bloc par compte avec montant à point décimal', () => {
    const q = toQif(rows);
    expect(q).toContain('!Account\r\nNCourant\r\nTBank\r\n^\r\n!Type:Bank');
    expect(q).toContain('NÉpargne');
    expect(q).toContain('D05/08/2026\r\nT-42.50\r\nPCarrefour\r\nMCourses — du samedi\r\nN1234\r\nLAlimentation\r\nCX\r\n^');
    expect(q).toContain('T1500.00');
  });

  it('se relit avec l’analyseur de relevés', () => {
    const lu = parseStatement(toQif(rows));
    expect(lu.format).toBe('qif');
    expect(lu.entries).toEqual([
      { date: '2026-08-05', label: 'Carrefour — Courses — du samedi', amountCents: -4250, reference: '1234' },
      { date: '2026-08-07', label: 'Employeur — Salaire', amountCents: 150_000 },
    ]);
  });

  it('écrit une seule ligne par champ, même avec des sauts de ligne dans le libellé', () => {
    const q = toQif([ligne({ label: 'a\nb', payee: 'x\r\ny' })]);
    expect(q).toContain('Px y');
    expect(q).toContain('Ma b');
  });
});

describe('OFX', () => {
  const rows = [
    ligne({ id: 'a1', label: 'Courses', reference: '77' }),
    ligne({ id: 'a2', date: '2026-08-07', amountCents: 150_000, label: 'Salaire', payee: 'Employeur & Cie' }),
  ];

  it('écrit les transactions avec sens, date compacte et identifiant stable', () => {
    const o = toOfx(rows, new Date(Date.UTC(2026, 7, 10, 12, 0, 0)));
    expect(o.startsWith('OFXHEADER:100')).toBe(true);
    expect(o).toContain('<DTSERVER>20260810120000');
    expect(o).toContain('<TRNTYPE>DEBIT\r\n<DTPOSTED>20260805\r\n<TRNAMT>-42.50\r\n<FITID>a1');
    expect(o).toContain('<TRNTYPE>CREDIT');
    expect(o).toContain('<NAME>Employeur &amp; Cie');
    expect(o).toContain('<CHECKNUM>77');
  });

  it('se relit avec l’analyseur de relevés', () => {
    const lu = parseStatement(toOfx(rows));
    expect(lu.format).toBe('ofx');
    expect(lu.entries.map(e => [e.date, e.amountCents])).toEqual([['2026-08-05', -4250], ['2026-08-07', 150_000]]);
    // Le numéro de chèque l'emporte sur l'identifiant de transaction ; à défaut, le FITID sert de référence.
    expect(lu.entries.map(e => e.reference)).toEqual(['77', 'a2']);
  });

  it('tronque le nom à 32 caractères, limite du format', () => {
    const o = toOfx([ligne({ payee: 'x'.repeat(80) })]);
    expect(o).toMatch(/<NAME>x{32}\r\n/);
  });
});

/** Lecteur ZIP minimal (méthode « stockée »), pour vérifier ce que zipStore écrit. */
function lireZip(octets: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const fin = octets.length - 22;
  expect(dv.getUint32(fin, true)).toBe(0x06054b50);
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const out: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < total; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const taille = dv.getUint32(p + 24, true);
    const nom = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(octets.subarray(p + 46, p + 46 + nom));
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    out.push({ name, data: octets.subarray(debut, debut + taille), crc });
    p += 46 + nom;
  }
  return out;
}

describe('archive ZIP et classeur Excel', () => {
  it('calcule le CRC-32 de référence', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('écrit une archive relisible dont les sommes de contrôle concordent', () => {
    const z = lireZip(zipStore([
      { name: 'a.txt', data: new TextEncoder().encode('bonjour') },
      { name: 'dossier/é.txt', data: new TextEncoder().encode('été') },
    ]));
    expect(z.map(f => f.name)).toEqual(['a.txt', 'dossier/é.txt']);
    expect(new TextDecoder().decode(z[1].data)).toBe('été');
    for (const f of z) expect(crc32(f.data)).toBe(f.crc);
  });

  it('écrit un classeur avec ses parties obligatoires et de vrais nombres', () => {
    const z = lireZip(toXlsx([ligne({ label: 'A & <B>', amountCents: -4250 }), ligne({ amountCents: 150_000 })]));
    expect(z.map(f => f.name)).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    ]);
    const feuille = new TextDecoder().decode(z[5].data);
    expect(feuille).toContain('A &amp; &lt;B&gt;');
    expect(feuille).toContain('<c r="J2" s="2"><v>-42.50</v></c>');
    expect(feuille).toContain('<c r="J3" s="2"><v>1500.00</v></c>');
    expect(feuille).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">05/08/2026</t></is></c>');
    expect(new TextDecoder().decode(z[2].data)).toContain('name="Opérations"');
    for (const f of z) expect(crc32(f.data)).toBe(f.crc);
  });

  it('ne neutralise pas les textes d’un classeur et supprime les caractères interdits en XML', () => {
    const z = lireZip(toXlsx([ligne({ label: '=2+2', note: 'a\u0001b' })]));
    const feuille = new TextDecoder().decode(z[5].data);
    expect(feuille).toContain('>=2+2<');
    expect(feuille).toContain('>ab<');
  });
});

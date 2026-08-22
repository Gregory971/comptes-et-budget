import { describe, expect, it } from 'vitest';
import { detectSeparator, parseAmount, parseDate, parseStatement, splitCsvLine } from './statement';

describe('montants d’un relevé', () => {
  it('lit les écritures françaises et anglo-saxonnes', () => {
    expect(parseAmount('42,50')).toBe(4250);
    expect(parseAmount('42.50')).toBe(4250);
    expect(parseAmount('1 234,56')).toBe(123456);
    expect(parseAmount('1 234,56')).toBe(123456);   // espace insécable
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('1 234')).toBe(123400);
  });

  it('reconnaît toutes les formes de négatif', () => {
    expect(parseAmount('-42,50')).toBe(-4250);
    expect(parseAmount('42,50-')).toBe(-4250);
    expect(parseAmount('(42,50)')).toBe(-4250);
  });

  it('accepte la devise collée au montant', () => {
    expect(parseAmount('42,50 €')).toBe(4250);
    expect(parseAmount('42.50EUR')).toBe(4250);
  });

  it('refuse ce qui n’est pas un montant', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('VIREMENT')).toBeNull();
    expect(parseAmount('12,3,4,5x')).toBeNull();
  });
});

describe('dates d’un relevé', () => {
  it('lit les formats courants des banques', () => {
    expect(parseDate('05/08/2026')).toBe('2026-08-05');
    expect(parseDate('05-08-26')).toBe('2026-08-05');
    expect(parseDate('2026-08-05')).toBe('2026-08-05');
    expect(parseDate('05.08.2026')).toBe('2026-08-05');
    expect(parseDate('20260805')).toBe('2026-08-05');
  });

  it('écarte les valeurs impossibles', () => {
    expect(parseDate('32/08/2026')).toBeNull();
    expect(parseDate('05/13/2026')).toBeNull();
    expect(parseDate('libellé')).toBeNull();
  });
});

describe('découpage CSV', () => {
  it('respecte les guillemets et les séparateurs internes', () => {
    expect(splitCsvLine('05/08/2026;"CARREFOUR; MARKET";-42,50', ';'))
      .toEqual(['05/08/2026', 'CARREFOUR; MARKET', '-42,50']);
  });

  it('gère les guillemets doublés', () => {
    expect(splitCsvLine('a;"il a dit ""oui""";b', ';'))
      .toEqual(['a', 'il a dit "oui"', 'b']);
  });

  it('choisit le séparateur qui découpe régulièrement', () => {
    expect(detectSeparator(['a;b;c', 'd;e;f'])).toBe(';');
    expect(detectSeparator(['a,b,c', 'd,e,f'])).toBe(',');
    expect(detectSeparator(['a\tb\tc', 'd\te\tf'])).toBe('\t');
  });
});

describe('relevé CSV', () => {
  it('lit un export à colonne de montant signée', () => {
    const csv = [
      'Date;Libellé;Montant;Devise',
      '05/08/2026;PAIEMENT CB CARREFOUR;-42,50;EUR',
      '06/08/2026;VIREMENT SALAIRE;2 350,00;EUR',
    ].join('\n');
    const r = parseStatement(csv);
    expect(r.format).toBe('csv');
    expect(r.warnings).toEqual([]);
    expect(r.entries).toEqual([
      { date: '2026-08-05', label: 'PAIEMENT CB CARREFOUR', amountCents: -4250, reference: undefined },
      { date: '2026-08-06', label: 'VIREMENT SALAIRE', amountCents: 235000, reference: undefined },
    ]);
    expect(r.mapping?.amount).toBe('Montant');
  });

  it('lit un export à colonnes débit et crédit séparées', () => {
    const csv = [
      'Date opération;Libellé;Débit;Crédit',
      '05/08/2026;EDF PRELEVEMENT;89,90;',
      '10/08/2026;REMBOURSEMENT;;15,00',
    ].join('\n');
    const r = parseStatement(csv);
    expect(r.entries.map(e => e.amountCents)).toEqual([-8990, 1500]);
  });

  it('se passe d’en-tête', () => {
    const csv = '05/08/2026;RETRAIT DAB;-60,00\n06/08/2026;SNCF;-38,20';
    const r = parseStatement(csv);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].label).toBe('RETRAIT DAB');
  });

  it('saute les lignes de titre placées avant l’en-tête', () => {
    const csv = [
      'Relevé de compte n° 0123456',
      'Solde au 01/08/2026;1 200,00',
      'Date;Libellé;Montant',
      '05/08/2026;ACHAT;-12,00',
    ].join('\n');
    const r = parseStatement(csv);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].amountCents).toBe(-1200);
  });

  it('signale chaque ligne écartée au lieu de la perdre en silence', () => {
    const csv = 'Date;Libellé;Montant\n05/08/2026;OK;-10,00\nsans date;CASSÉ;-10,00\n07/08/2026;NUL;0,00';
    const r = parseStatement(csv);
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain('date illisible');
    expect(r.warnings[1]).toContain('montant nul');
  });

  it('refuse un fichier sans colonne exploitable', () => {
    const r = parseStatement('Nom;Prénom\nDupont;Jean');
    expect(r.entries).toEqual([]);
    expect(r.warnings[0]).toContain('Colonnes non reconnues');
  });
});

describe('relevé OFX', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260805120000[-4:AST]<TRNAMT>-42.50
<FITID>2026080501<NAME>CARREFOUR MARKET<MEMO>PAIEMENT CB</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260806<TRNAMT>2350.00
<FITID>2026080602<NAME>SALAIRE</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it('lit les opérations, quel que soit le fuseau porté par la date', () => {
    const r = parseStatement(ofx);
    expect(r.format).toBe('ofx');
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toEqual({
      date: '2026-08-05', label: 'CARREFOUR MARKET — PAIEMENT CB',
      amountCents: -4250, reference: '2026080501',
    });
    expect(r.entries[1].amountCents).toBe(235000);
  });

  it('préfère le numéro de chèque au FITID quand il existe', () => {
    const avecCheque = ofx.replace('<FITID>2026080501', '<CHECKNUM>0000123\n<FITID>2026080501');
    expect(parseStatement(avecCheque).entries[0].reference).toBe('0000123');
  });
});

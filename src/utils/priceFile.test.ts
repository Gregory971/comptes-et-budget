import { describe, expect, it } from 'vitest';
import { parsePrice, parsePriceFile } from './priceFile';

describe('cours', () => {
  it.each([
    ['52,3456', 52.3456], ['52.3456', 52.3456], ['1 234,5', 1234.5], ['1.234,5678', 1234.5678], ['1,234.5678', 1234.5678],
    ['1.234.567', 1234567], ['0', 0], ['12', 12], ['  45,10 € ', 45.1], ['45.10 EUR', 45.1], ['1\u00a0234,56', 1234.56],
  ])('lit %s', (texte, n) => expect(parsePrice(texte)).toBe(n));

  it.each(['', 'abc', '-5', '1,2,x', '12/05/2026', '2026-10-25', '--'])('refuse %j', t => expect(parsePrice(t)).toBeNull());
});

describe('fichier de cotations', () => {
  it('lit un fichier simple date;cours', () => {
    const r = parsePriceFile('25/10/2026;52,3456\n26/10/2026;53,00\n');
    expect(r.entries).toEqual([{ date: '2026-10-25', price: 52.3456 }, { date: '2026-10-26', price: 53 }]);
    expect(r.warnings).toEqual([]);
  });

  it('lit un en-tête français et choisit la colonne Clôture', () => {
    const r = parsePriceFile('Date;Ouverture;Plus haut;Plus bas;Clôture;Volume\n25/10/2026;50,1;55,2;49,9;52,3;1200\n');
    expect(r.entries).toEqual([{ date: '2026-10-25', price: 52.3 }]);
  });

  it('lit un export Yahoo : Close et non Adj Close', () => {
    const r = parsePriceFile('Date,Open,High,Low,Close,Adj Close,Volume\n2026-10-25,50.1,55.2,49.9,52.3,51.9,1200\n2026-10-26,52,56,51,54.25,53.8,900\n');
    expect(r.entries).toEqual([{ date: '2026-10-25', price: 52.3 }, { date: '2026-10-26', price: 54.25 }]);
  });

  it('retient le cours ajusté faute de cours brut', () => {
    const r = parsePriceFile('Date,Open,Adj Close\n2026-10-25,50.1,51.9\n');
    expect(r.entries[0].price).toBe(50.1);        // le premier nombre, l'ajusté étant écarté du choix par nom
  });

  it('trie par date, accepte un BOM et garde le dernier cours d’un même jour', () => {
    const r = parsePriceFile('\uFEFF27/10/2026;3\n25/10/2026;1\n25/10/2026;2\n');
    expect(r.entries).toEqual([{ date: '2026-10-25', price: 2 }, { date: '2026-10-27', price: 3 }]);
  });

  it('signale les lignes illisibles sans les avaler en silence', () => {
    const r = parsePriceFile('Date;Cours\n25/10/2026;52\nhier;53\n27/10/2026;abc\n');
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toEqual(['Ligne 3 ignorée : date illisible.', 'Ligne 4 ignorée : cours illisible.']);
  });

  it('plafonne la liste des avertissements', () => {
    const lignes = Array.from({ length: 40 }, (_, i) => `bad${i};x`).join('\n');
    const r = parsePriceFile(`Date;Cours\n25/10/2026;1\n${lignes}`);
    expect(r.warnings).toHaveLength(16);
    expect(r.warnings[15]).toMatch(/25 autre\(s\)/);
  });

  it('refuse un fichier vide, à une colonne ou sans cours', () => {
    expect(parsePriceFile('').warnings[0]).toMatch(/vide/);
    expect(parsePriceFile('25/10/2026\n26/10/2026\n').warnings[0]).toMatch(/deux colonnes/);
    expect(parsePriceFile('25/10/2026;abc\n').warnings[0]).toMatch(/introuvables/);
    expect(parsePriceFile('Date;Cours\n').warnings[0]).toMatch(/Aucune cotation/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseStatement } from './statement';

const qif = (...records: string[][]) =>
  ['!Type:Bank', ...records.flatMap(r => [...r, '^'])].join('\r\n') + '\r\n';

describe('lecture d’un QIF', () => {
  it('reconnaît le format et lit date, montant, bénéficiaire, mémo et numéro', () => {
    const r = parseStatement(qif(['D25/10/2026', 'T-42,50', 'PCarrefour', 'MCourses', 'N1234']));
    expect(r.format).toBe('qif');
    expect(r.entries).toEqual([{ date: '2026-10-25', label: 'Carrefour — Courses', amountCents: -4250, reference: '1234' }]);
    expect(r.warnings).toEqual([]);
  });

  it('lit les montants à virgule ou à point, avec milliers', () => {
    const r = parseStatement(qif(['D25/10/2026', 'T-1,234.56', 'Pa'], ['D26/10/2026', 'T1 234,56', 'Pb'], ['D27/10/2026', 'U-5.00', 'Pc']));
    expect(r.entries.map(e => e.amountCents)).toEqual([-123_456, 123_456, -500]);
  });

  it('déduit jour/mois quand un premier champ dépasse 12', () => {
    const r = parseStatement(qif(['D13/02/2026', 'T-1', 'Pa'], ['D02/03/2026', 'T-1', 'Pb']));
    expect(r.entries.map(e => e.date)).toEqual(['2026-02-13', '2026-03-02']);
    expect(r.warnings).toEqual([]);
  });

  it('déduit mois/jour quand un second champ dépasse 12', () => {
    const r = parseStatement(qif(['D02/13/2026', 'T-1', 'Pa'], ['D03/02/2026', 'T-1', 'Pb']));
    expect(r.entries.map(e => e.date)).toEqual(['2026-02-13', '2026-03-02']);
  });

  it('lit jour/mois et prévient quand rien ne tranche', () => {
    const r = parseStatement(qif(['D02/03/2026', 'T-1', 'Pa']));
    expect(r.entries[0].date).toBe('2026-03-02');
    expect(r.warnings.join(' ')).toMatch(/ambiguës/);
  });

  it('lit les années sur deux chiffres, l’apostrophe de Quicken et les dates ISO', () => {
    const r = parseStatement(qif(['D25/10/26', 'T-1', 'Pa'], ['D25/10\'26', 'T-1', 'Pb'], ['D2026-10-25', 'T-1', 'Pc'], ['D25/10/99', 'T-1', 'Pd']));
    expect(r.entries.map(e => e.date)).toEqual(['2026-10-25', '2026-10-25', '2026-10-25', '1999-10-25']);
  });

  it('ignore catégorie, ventilation et en-têtes de compte, sans perdre le total', () => {
    const texte = [
      '!Account', 'NCourant', 'TBank', '^', '!Type:Bank',
      'D25/10/2026', 'T-87,00', 'PLeclerc', 'LAlimentation', 'SAlimentation', '$-60,00', 'SEntretien', '$-27,00', '^',
    ].join('\n');
    const r = parseStatement(texte);
    expect(r.entries).toEqual([{ date: '2026-10-25', label: 'Leclerc', amountCents: -8700 }]);
  });

  it('signale les enregistrements illisibles sans rien avaler en silence', () => {
    const r = parseStatement(qif(['D25/10/2026', 'T-1', 'Pbon'], ['Dnimporte', 'T-1', 'Pa'], ['D26/10/2026', 'Tabc', 'Pb'], ['D27/10/2026', 'Pc']));
    expect(r.entries.map(e => e.label)).toEqual(['bon']);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join('\n')).toMatch(/date illisible/);
    expect(r.warnings.join('\n')).toMatch(/montant illisible/);
  });

  it('donne un libellé par défaut et accepte un dernier enregistrement sans ^ final', () => {
    const r = parseStatement('!Type:Bank\nD25/10/2026\nT-1,00\n^\nD26/10/2026\nT-2,00\nPFin');
    expect(r.entries.map(e => [e.label, e.amountCents])).toEqual([['(sans libellé)', -100], ['Fin', -200]]);
  });

  it('n’affiche pas deux fois un mémo identique au bénéficiaire', () => {
    expect(parseStatement(qif(['D25/10/2026', 'T-1', 'PEDF', 'MEDF'])).entries[0].label).toBe('EDF');
  });

  it('un fichier vide de toute opération le dit', () => {
    expect(parseStatement('!Type:Bank\n').warnings.join(' ')).toMatch(/Aucune opération/);
  });

  it('ne confond pas un CSV avec un QIF', () => {
    expect(parseStatement('Date;Libellé;Montant\n25/10/2026;Café;-2,50\n').format).toBe('csv');
  });
});

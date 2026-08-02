import { describe, expect, it } from 'vitest';
import {
  addMonths, addYears, formatFr, lastDayOfMonth, monthKey, monthRange,
  normalizeYmd, toYmd, ymd,
} from './date';

describe('dates civiles', () => {
  it('formate une date locale sans passer par UTC', () => {
    // Minuit local un 1er août : toISOString() aurait renvoyé le 31 juillet
    // en zone UTC positive. toYmd lit le fuseau local, donc jamais de décalage.
    expect(toYmd(new Date(2026, 7, 1, 0, 0, 0))).toBe('2026-08-01');
    expect(toYmd(new Date(2026, 7, 1, 23, 59, 59))).toBe('2026-08-01');
  });

  it('ordonne chronologiquement par comparaison de chaînes', () => {
    expect('2026-01-09' < '2026-01-10').toBe(true);
    expect('2025-12-31' < '2026-01-01').toBe(true);
    expect('2026-08-01' >= '2026-08-01').toBe(true);
  });

  it('reprend les anciennes valeurs ISO horodatées', () => {
    expect(normalizeYmd('2026-08-01T00:00:00.000Z')).toBe('2026-08-01');
    expect(normalizeYmd('2026-08-01')).toBe('2026-08-01');
  });

  it('borne un mois complet, y compris février bissextile', () => {
    expect(monthRange(2026, 7)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(monthRange(2026, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(2024, 1)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('inclut le premier et le dernier jour du mois dans ses bornes', () => {
    // Régression P1 : en zone UTC négative, l'opération du 1er sortait du relevé.
    const { from, to } = monthRange(2026, 7);
    const premier = '2026-08-01', dernier = '2026-08-31', suivant = '2026-09-01';
    expect(premier >= from && premier <= to).toBe(true);
    expect(dernier >= from && dernier <= to).toBe(true);
    expect(suivant >= from && suivant <= to).toBe(false);
  });

  it('décale les mois en bornant au dernier jour', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('décale les années, 29 février compris', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2026-06-10', 1)).toBe('2027-06-10');
  });

  it('expose les utilitaires d’affichage', () => {
    expect(formatFr('2026-08-01')).toBe('01/08/2026');
    expect(monthKey('2026-08-01')).toBe('2026-08');
    expect(ymd(2026, 0, 5)).toBe('2026-01-05');
    expect(lastDayOfMonth(2026, 1)).toBe(28);
  });
});

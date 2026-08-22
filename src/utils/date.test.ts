import { describe, expect, it } from 'vitest';
import {
  addMonths, addMonthsAnchored, addYears, addYearsAnchored, dayOfMonth,
  formatFr, lastDayOfMonth, monthKey, monthRange, normalizeYmd, toYmd, ymd,
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

describe('jour d’ancrage', () => {
  it('revient au quantième d’origine après un mois court', () => {
    // Sans ancrage, l'enchaînement 31/01 → 28/02 → 28/03 fixait définitivement
    // le prélèvement au 28 : la date dérivait dès le premier mois court.
    expect(addMonthsAnchored('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonthsAnchored('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsAnchored('2026-03-31', 1, 31)).toBe('2026-04-30');
    expect(addMonthsAnchored('2026-04-30', 1, 31)).toBe('2026-05-31');
  });

  it('traite le 30 comme le 31, chacun selon son ancrage', () => {
    expect(addMonthsAnchored('2026-01-30', 1, 30)).toBe('2026-02-28');
    expect(addMonthsAnchored('2026-02-28', 1, 30)).toBe('2026-03-30');
  });

  it('franchit l’année et le trimestre sans perdre l’ancrage', () => {
    expect(addMonthsAnchored('2026-11-30', 1, 31)).toBe('2026-12-31');
    expect(addMonthsAnchored('2026-12-31', 1, 31)).toBe('2027-01-31');
    expect(addMonthsAnchored('2026-11-30', 3, 31)).toBe('2027-02-28');
  });

  it('rétablit le 29 février d’une année bissextile', () => {
    expect(addYearsAnchored('2028-02-29', 1, 29)).toBe('2029-02-28');
    expect(addYearsAnchored('2029-02-28', 1, 29)).toBe('2030-02-28');
    expect(addYearsAnchored('2031-02-28', 1, 29)).toBe('2032-02-29');
  });

  it('lit le quantième d’une date civile', () => {
    expect(dayOfMonth('2026-08-01')).toBe(1);
    expect(dayOfMonth('2026-08-31')).toBe(31);
  });
});

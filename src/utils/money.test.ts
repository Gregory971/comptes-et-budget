import { describe, expect, it } from 'vitest';
import { centsToInput, formatEur, parseEuro, toCents, toEuros } from './money';

describe('montants en centimes', () => {
  it('accepte la virgule décimale française', () => {
    expect(parseEuro('12,50')).toBe(1250);
    expect(parseEuro('12.50')).toBe(1250);
    expect(parseEuro('1\u202F234,56')).toBe(123456);
    expect(parseEuro('1 234,56')).toBe(123456);
    expect(parseEuro('0,01')).toBe(1);
    expect(parseEuro('-12,50')).toBe(-1250);
  });

  it('rejette explicitement une saisie invalide au lieu de renvoyer NaN', () => {
    expect(parseEuro('')).toBeNull();
    expect(parseEuro('abc')).toBeNull();
    expect(parseEuro('12,3,4')).toBeNull();
    expect(parseEuro('-')).toBeNull();
  });

  it('additionne sans erreur de virgule flottante', () => {
    // 0.1 + 0.2 !== 0.3 en flottant ; en centimes, l'addition est exacte.
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
    const centimes = Array.from({ length: 100 }, () => toCents(0.07));
    expect(centimes.reduce((s, c) => s + c, 0)).toBe(700);
  });

  it('convertit dans les deux sens', () => {
    expect(toCents(95.4)).toBe(9540);
    expect(toEuros(9540)).toBe(95.4);
    expect(centsToInput(9540)).toBe('95.40');
  });

  it('formate en euros français', () => {
    const normalise = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');
    expect(normalise(formatEur(123456))).toBe('1 234,56 €');
    expect(normalise(formatEur(0))).toBe('0,00 €');
  });
});

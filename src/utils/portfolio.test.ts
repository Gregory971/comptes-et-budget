import { describe, expect, it } from 'vitest';
import { computePosition, grossCents, sortTxs, validateTxs } from './portfolio';
import type { SecurityTx } from '../types';

let n = 0;
const tx = (over: Partial<SecurityTx> & Pick<SecurityTx, 'type' | 'date'>): SecurityTx => ({
  id: `t${++n}`, dbId: 'd', securityId: 's', quantity: 0, unitPrice: 0, feesCents: 0, amountCents: 0,
  createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`, updatedAt: '', ...over,
});
const achat = (date: string, quantity: number, unitPrice: number, feesCents = 0) =>
  tx({ type: 'achat', date, quantity, unitPrice, feesCents, amountCents: grossCents(quantity, unitPrice) });
const vente = (date: string, quantity: number, unitPrice: number, feesCents = 0) =>
  tx({ type: 'vente', date, quantity, unitPrice, feesCents, amountCents: grossCents(quantity, unitPrice) });
const dividende = (date: string, amountCents: number) => tx({ type: 'dividende', date, amountCents });
const ajustement = (date: string, quantity: number) => tx({ type: 'ajustement', date, quantity });

describe('montant brut', () => {
  it('arrondit au centime sans dérive de flottant', () => {
    expect(grossCents(10, 12.5)).toBe(12_500);
    expect(grossCents(3, 0.1)).toBe(30);               // 0,1 × 3 = 0,30000000000000004
    expect(grossCents(0.5, 33.333)).toBe(1_667);        // 16,6665 → 16,67
    expect(grossCents(1.005, 1)).toBe(101);             // l'écueil classique du .5
  });
});

describe('position', () => {
  it('un achat unique : coût = cours × quantité + frais, PRU frais compris', () => {
    const p = computePosition([achat('2026-01-10', 10, 50, 150)]);
    expect(p.quantity).toBe(10);
    expect(p.costCents).toBe(50_150);
    expect(p.avgCost).toBeCloseTo(50.15, 6);
    expect(p.feesCents).toBe(150);
    expect(p.marketValueCents).toBeUndefined();
    expect(p.latentCents).toBeUndefined();
  });

  it('moyenne pondérée de deux achats', () => {
    const p = computePosition([achat('2026-01-10', 10, 50), achat('2026-02-10', 10, 70)]);
    expect(p.quantity).toBe(20);
    expect(p.costCents).toBe(120_000);
    expect(p.avgCost).toBe(60);
  });

  it('la plus-value latente suit le dernier cours', () => {
    const p = computePosition([achat('2026-01-10', 10, 50)], 62.5);
    expect(p.marketValueCents).toBe(62_500);
    expect(p.latentCents).toBe(12_500);
    const moins = computePosition([achat('2026-01-10', 10, 50)], 40);
    expect(moins.latentCents).toBe(-10_000);
  });

  it('une vente partielle retire le coût au PRU et réalise la plus-value, frais déduits', () => {
    const p = computePosition([achat('2026-01-10', 10, 50, 100), vente('2026-03-01', 4, 70, 50)]);
    // coût initial 50 100 ; 4/10 retiré = 20 040 ; produit 28 000 − frais 50
    expect(p.realizedCents).toBe(28_000 - 50 - 20_040);
    expect(p.quantity).toBe(6);
    expect(p.costCents).toBe(50_100 - 20_040);
    expect(p.feesCents).toBe(150);
    expect(p.avgCost).toBeCloseTo(50.1, 6);          // le PRU ne bouge pas à la vente
  });

  it('solder la position remet le coût exactement à zéro', () => {
    const p = computePosition([achat('2026-01-10', 3, 33.33, 99), vente('2026-03-01', 1, 40), vente('2026-03-02', 2, 41)]);
    expect(p.quantity).toBe(0);
    expect(p.costCents).toBe(0);
    expect(p.avgCost).toBe(0);
  });

  it('un ajustement change la quantité sans toucher au coût (division du titre)', () => {
    const p = computePosition([achat('2026-01-10', 10, 100), ajustement('2026-02-01', 10)]);
    expect(p.quantity).toBe(20);
    expect(p.costCents).toBe(100_000);
    expect(p.avgCost).toBe(50);
  });

  it('un regroupement réduit la quantité', () => {
    const p = computePosition([achat('2026-01-10', 100, 1), ajustement('2026-02-01', -90)]);
    expect(p.quantity).toBe(10);
    expect(p.avgCost).toBe(10);
  });

  it('les dividendes s’ajoutent aux gains réels sans toucher à la position', () => {
    const p = computePosition([achat('2026-01-10', 10, 50), dividende('2026-06-01', 1_200), dividende('2026-12-01', 800)]);
    expect(p.dividendsCents).toBe(2_000);
    expect(p.quantity).toBe(10);
    expect(p.costCents).toBe(50_000);
    expect(p.totalGainCents).toBe(2_000);
  });

  it('gains réels = plus-values réalisées + dividendes', () => {
    const p = computePosition([achat('2026-01-10', 10, 50), vente('2026-03-01', 10, 60), dividende('2026-04-01', 500)]);
    expect(p.realizedCents).toBe(10_000);
    expect(p.totalGainCents).toBe(10_500);
  });

  it('gère les quantités fractionnées', () => {
    const p = computePosition([achat('2026-01-10', 0.5, 200), vente('2026-02-01', 0.25, 220)], 210);
    expect(p.quantity).toBe(0.25);
    expect(p.costCents).toBe(5_000);
    expect(p.marketValueCents).toBe(5_250);
    expect(p.realizedCents).toBe(5_500 - 5_000);
  });

  it('classe les mouvements du même jour : l’achat avant la vente', () => {
    const v = vente('2026-02-01', 5, 60);
    const a = achat('2026-02-01', 5, 50);
    expect(sortTxs([v, a]).map(t => t.type)).toEqual(['achat', 'vente']);
    expect(validateTxs([v, a])).toBeNull();
  });
});

describe('validation des mouvements', () => {
  it('accepte une suite cohérente', () => {
    expect(validateTxs([achat('2026-01-10', 10, 50), vente('2026-02-10', 10, 60)])).toBeNull();
  });

  it('refuse la vente à découvert, à la date où elle a lieu', () => {
    expect(validateTxs([achat('2026-03-10', 10, 50), vente('2026-02-10', 5, 60)])).toMatch(/Vente impossible le 2026-02-10/);
    expect(validateTxs([achat('2026-01-10', 10, 50), vente('2026-02-10', 11, 60)])).toMatch(/ne détenez que 10/);
  });

  it('refuse un ajustement qui rendrait la quantité négative', () => {
    expect(validateTxs([achat('2026-01-10', 10, 50), ajustement('2026-02-01', -11)])).toMatch(/négative/);
  });

  it('refuse les valeurs aberrantes', () => {
    expect(validateTxs([achat('2026-01-10', 0, 50)])).toMatch(/quantité/);
    expect(validateTxs([achat('2026-01-10', 1, -5)])).toMatch(/cours/);
    expect(validateTxs([ajustement('2026-01-10', 0)])).toMatch(/non nulle/);
    expect(validateTxs([dividende('2026-01-10', 0)])).toMatch(/supérieur à zéro/);
    expect(validateTxs([achat('2026-01-10', 1, 5, -1)])).toMatch(/frais/);
  });

  it('la suppression d’un achat peut rendre une vente ultérieure impossible', () => {
    const a = achat('2026-01-10', 10, 50);
    const v = vente('2026-02-10', 10, 60);
    expect(validateTxs([a, v])).toBeNull();
    expect(validateTxs([v])).toMatch(/Vente impossible/);
  });
});

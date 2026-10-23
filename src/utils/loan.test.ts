import { describe, expect, it } from 'vitest';
import { amortization, monthlyPayment, summarize, validateLoan, type LoanSchedulable } from './loan';

const pret = (over: Partial<LoanSchedulable> = {}): LoanSchedulable => ({
  principalCents: 10_000_000, rateBp: 300, months: 240,
  firstPaymentDate: '2026-02-05', insuranceMonthlyCents: 0, ...over,
});

describe('mensualité', () => {
  it('retrouve la mensualité classique de 100 000 € à 3 % sur 20 ans : 554,60 €', () => {
    expect(monthlyPayment(10_000_000, 300, 240)).toBe(55_460);
  });

  it('sans intérêt, répartit le capital à parts égales', () => {
    expect(monthlyPayment(120_000, 0, 12)).toBe(10_000);
  });

  it('renvoie 0 pour des conditions absurdes', () => {
    expect(monthlyPayment(0, 300, 12)).toBe(0);
    expect(monthlyPayment(1000, 300, 0)).toBe(0);
  });
});

describe('tableau d’amortissement', () => {
  const rows = amortization(pret());

  it('compte une ligne par mensualité', () => {
    expect(rows).toHaveLength(240);
    expect(rows[0].index).toBe(1);
    expect(rows[239].index).toBe(240);
  });

  it('la première mensualité est faite surtout d’intérêts', () => {
    expect(rows[0].interestCents).toBe(25_000);            // 100 000 € × 0,25 %
    expect(rows[0].principalCents).toBe(55_460 - 25_000);
    expect(rows[0].remainingCents).toBe(10_000_000 - rows[0].principalCents);
  });

  it('solde exactement le capital : somme des capitaux = emprunt, reste dû final = 0', () => {
    expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(10_000_000);
    expect(rows[239].remainingCents).toBe(0);
  });

  it('chaque ligne vérifie capital + intérêts = mensualité', () => {
    for (const r of rows) {
      expect(r.paymentCents).toBe(r.principalCents + r.interestCents);
      expect(r.totalCents).toBe(r.paymentCents + r.insuranceCents);
    }
  });

  it('le reste dû ne fait que baisser', () => {
    for (let i = 1; i < rows.length; i++) expect(rows[i].remainingCents).toBeLessThanOrEqual(rows[i - 1].remainingCents);
  });

  it('l’écart d’arrondi de la dernière mensualité reste de quelques centimes', () => {
    expect(Math.abs(rows[239].paymentCents - 55_460)).toBeLessThan(150);
  });

  it('ajoute l’assurance à chaque mensualité sans toucher au capital', () => {
    const avec = amortization(pret({ insuranceMonthlyCents: 1_500 }));
    expect(avec[10].totalCents).toBe(avec[10].paymentCents + 1_500);
    expect(avec[10].principalCents).toBe(rows[10].principalCents);
  });

  it('garde le jour d’échéance malgré les mois courts', () => {
    const r = amortization(pret({ firstPaymentDate: '2026-01-31', months: 5 }));
    expect(r.map(x => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('gère un taux nul', () => {
    const r = amortization(pret({ principalCents: 120_000, rateBp: 0, months: 12 }));
    expect(r.every(x => x.interestCents === 0)).toBe(true);
    expect(r[0].principalCents).toBe(10_000);
    expect(r[11].remainingCents).toBe(0);
  });

  it('gère un capital qui ne se divise pas en parts égales', () => {
    const r = amortization(pret({ principalCents: 100_000, rateBp: 0, months: 3 }));
    expect(r.map(x => x.principalCents)).toEqual([33_333, 33_333, 33_334]);
  });

  it('ne produit rien pour des conditions invalides', () => {
    expect(amortization(pret({ months: 0 }))).toEqual([]);
    expect(amortization(pret({ principalCents: -5 }))).toEqual([]);
  });
});

describe('validation', () => {
  it('accepte des conditions normales', () => {
    expect(validateLoan(pret())).toBeNull();
  });
  it.each([
    [{ principalCents: 0 }, /montant/],
    [{ rateBp: -1 }, /taux/],
    [{ rateBp: 10_001 }, /taux/],
    [{ months: 0 }, /durée/],
    [{ months: 601 }, /durée/],
    [{ months: 12.5 }, /durée/],
    [{ insuranceMonthlyCents: -1 }, /assurance/],
  ])('refuse %j', (over, motif) => {
    expect(validateLoan(pret(over))).toMatch(motif);
  });
});

describe('situation du prêt', () => {
  const l = pret({ firstPaymentDate: '2026-02-05', months: 12, principalCents: 120_000, rateBp: 0 });

  it('compte les mensualités échues et celles restant à comptabiliser', () => {
    const s = summarize(l, 1, '2026-04-10');   // échues : 5/02, 5/03, 5/04 ; 1 comptabilisée
    expect(s.dueCount).toBe(3);
    expect(s.overdue.map(x => x.index)).toEqual([2, 3]);
    expect(s.next?.index).toBe(2);
    expect(s.remainingCents).toBe(110_000);
    expect(s.repaidCents).toBe(10_000);
    expect(s.percent).toBeCloseTo(8.33, 1);
  });

  it('avant la première échéance, rien n’est dû', () => {
    const s = summarize(l, 0, '2026-01-01');
    expect(s.dueCount).toBe(0);
    expect(s.overdue).toEqual([]);
    expect(s.remainingCents).toBe(120_000);
  });

  it('un prêt soldé n’a plus de prochaine mensualité', () => {
    const s = summarize(l, 12, '2030-01-01');
    expect(s.next).toBeUndefined();
    expect(s.remainingCents).toBe(0);
    expect(s.percent).toBe(100);
  });

  it('chiffre le coût total du crédit', () => {
    const s = summarize(pret({ insuranceMonthlyCents: 1_000 }), 0, '2026-01-01');
    expect(s.totalInsuranceCents).toBe(240_000);
    expect(s.totalCostCents).toBe(s.totalInterestCents + 240_000);
  });
});

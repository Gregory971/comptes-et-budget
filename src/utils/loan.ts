// Calcul d'un prêt à mensualités constantes (amortissement « à la française »).
//
// Fonctions pures, en centimes entiers : aucun flottant ne traverse la frontière
// d'un montant. Les intérêts de chaque période sont arrondis au centime, et la
// dernière mensualité absorbe l'écart d'arrondi pour solder exactement le capital.

import { addMonthsAnchored, dayOfMonth, type Ymd } from './date';
import type { Cents } from './money';

export interface LoanSchedulable {
  principalCents: Cents;
  /** Taux annuel en centièmes de pour cent : 350 = 3,50 %. */
  rateBp: number;
  months: number;
  firstPaymentDate: Ymd;
  insuranceMonthlyCents: Cents;
}

export interface LoanInstallment {
  /** Rang de la mensualité, à partir de 1. */
  index: number;
  date: Ymd;
  /** Capital remboursé par cette mensualité. */
  principalCents: Cents;
  interestCents: Cents;
  insuranceCents: Cents;
  /** Capital + intérêts, hors assurance : la mensualité « du prêt ». */
  paymentCents: Cents;
  /** Total prélevé : mensualité + assurance. */
  totalCents: Cents;
  /** Capital restant dû après cette mensualité. */
  remainingCents: Cents;
}

/** Taux périodique mensuel (fraction), à partir du taux annuel en centièmes de %. */
const monthlyRate = (rateBp: number): number => rateBp / 10_000 / 12;

/**
 * Mensualité constante, hors assurance : P·r / (1 − (1+r)^−n), arrondie au
 * centime. Sans intérêt, le capital est réparti à parts égales.
 */
export function monthlyPayment(principalCents: Cents, rateBp: number, months: number): Cents {
  if (months <= 0 || principalCents <= 0) return 0;
  const r = monthlyRate(rateBp);
  if (r === 0) return Math.round(principalCents / months);
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

/** Contrôle des conditions saisies ; renvoie un message ou null si elles sont valides. */
export function validateLoan(l: Pick<LoanSchedulable, 'principalCents' | 'rateBp' | 'months' | 'insuranceMonthlyCents'>): string | null {
  if (!Number.isInteger(l.principalCents) || l.principalCents <= 0) return 'Le montant emprunté doit être supérieur à zéro.';
  if (!Number.isFinite(l.rateBp) || l.rateBp < 0 || l.rateBp > 10_000) return 'Le taux annuel doit être compris entre 0 % et 100 %.';
  if (!Number.isInteger(l.months) || l.months < 1 || l.months > 600) return 'La durée doit être de 1 à 600 mensualités.';
  if (!Number.isInteger(l.insuranceMonthlyCents) || l.insuranceMonthlyCents < 0) return 'L’assurance ne peut pas être négative.';
  return null;
}

/** Tableau d'amortissement complet. */
export function amortization(l: LoanSchedulable): LoanInstallment[] {
  if (validateLoan(l)) return [];
  const r = monthlyRate(l.rateBp);
  const payment = monthlyPayment(l.principalCents, l.rateBp, l.months);
  const anchor = dayOfMonth(l.firstPaymentDate);
  const rows: LoanInstallment[] = [];
  let remaining = l.principalCents;

  for (let i = 1; i <= l.months; i++) {
    const interest = Math.round(remaining * r);
    const last = i === l.months;
    // Dernière mensualité : on solde le capital, quitte à ajuster de quelques centimes.
    const principal = last ? remaining : Math.min(remaining, payment - interest);
    remaining -= principal;
    rows.push({
      index: i,
      date: addMonthsAnchored(l.firstPaymentDate, i - 1, anchor),
      principalCents: principal,
      interestCents: interest,
      insuranceCents: l.insuranceMonthlyCents,
      paymentCents: principal + interest,
      totalCents: principal + interest + l.insuranceMonthlyCents,
      remainingCents: remaining,
    });
  }
  return rows;
}

export interface LoanSummary {
  /** Nombre de mensualités dont la date est atteinte à `asOf`. */
  dueCount: number;
  /** Capital restant dû après les mensualités comptabilisées. */
  remainingCents: Cents;
  /** Capital déjà remboursé. */
  repaidCents: Cents;
  totalInterestCents: Cents;
  totalInsuranceCents: Cents;
  /** Coût total du crédit : intérêts + assurance. */
  totalCostCents: Cents;
  /** Prochaine mensualité à comptabiliser, s'il en reste. */
  next?: LoanInstallment;
  /** Mensualités échues non encore comptabilisées. */
  overdue: LoanInstallment[];
  /** Avancement du remboursement du capital, de 0 à 100. */
  percent: number;
}

/** Situation d'un prêt à une date, d'après le nombre de mensualités comptabilisées. */
export function summarize(l: LoanSchedulable, postedCount: number, asOf: Ymd): LoanSummary {
  const rows = amortization(l);
  const posted = Math.max(0, Math.min(postedCount, rows.length));
  const remainingCents = posted === 0 ? l.principalCents : (rows[posted - 1]?.remainingCents ?? 0);
  const totalInterestCents = rows.reduce((s, x) => s + x.interestCents, 0);
  const totalInsuranceCents = rows.reduce((s, x) => s + x.insuranceCents, 0);
  const dueCount = rows.filter(x => x.date <= asOf).length;
  return {
    dueCount,
    remainingCents,
    repaidCents: l.principalCents - remainingCents,
    totalInterestCents,
    totalInsuranceCents,
    totalCostCents: totalInterestCents + totalInsuranceCents,
    next: rows[posted],
    overdue: rows.slice(posted, Math.max(posted, dueCount)),
    percent: l.principalCents > 0 ? ((l.principalCents - remainingCents) / l.principalCents) * 100 : 0,
  };
}

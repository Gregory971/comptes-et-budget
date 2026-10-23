// Suivi d'un titre : quantité détenue, prix de revient, plus-values, dividendes.
//
// Fonctions pures. Les montants sont des centimes entiers ; seules la quantité
// (parts, éventuellement fractionnées) et le cours unitaire sont décimaux, car ce
// ne sont pas des sommes d'argent. Chaque total en centimes est arrondi une fois.
//
// Méthode : PRIX DE REVIENT UNITAIRE MOYEN PONDÉRÉ (PRU).
//  · un achat augmente la quantité et le coût de revient (cours × quantité + frais) ;
//  · une vente retire la part correspondante du coût, au PRU courant ; la
//    plus-value RÉALISÉE est le produit net (hors frais) moins ce coût retiré ;
//  · un ajustement (division du titre, attribution gratuite, regroupement) change la
//    quantité sans toucher au coût : le PRU s'ajuste en conséquence ;
//  · un dividende est un revenu, sans effet sur la quantité ni le coût.
// La plus-value LATENTE est la valeur au dernier cours moins le coût restant.

import type { Cents, SecurityTx } from '../types';

/** Montant brut d'un achat ou d'une vente : quantité × cours unitaire, au centime. */
export const grossCents = (quantity: number, unitPrice: number): Cents =>
  Math.round((quantity * unitPrice + Number.EPSILON) * 100);

/** Les quantités sont des décimales : on les compare à une tolérance de 1e-9. */
const EPS = 1e-9;

export interface Position {
  /** Quantité détenue. */
  quantity: number;
  /** Coût de revient des parts détenues, frais d'achat compris. */
  costCents: Cents;
  /** Prix de revient unitaire (euros par part) ; 0 sans position. */
  avgCost: number;
  /** Plus-values réalisées par les ventes, nettes de frais. */
  realizedCents: Cents;
  dividendsCents: Cents;
  /** Frais payés, à l'achat comme à la vente. */
  feesCents: Cents;
  /** Dernier cours connu (euros par part), si renseigné. */
  lastPrice?: number;
  /** Valeur de la position au dernier cours ; absente sans cours. */
  marketValueCents?: Cents;
  /** Plus-value latente ; absente sans cours. */
  latentCents?: Cents;
  /** Gains réels : réalisés + dividendes, déduction faite des frais d'achat déjà dans le coût. */
  totalGainCents: Cents;
}

/** Ordre chronologique stable : même jour, achats avant ventes pour ne pas vendre à découvert. */
const RANG: Record<SecurityTx['type'], number> = { achat: 0, ajustement: 1, dividende: 2, vente: 3 };

export const sortTxs = (txs: SecurityTx[]): SecurityTx[] =>
  [...txs].sort((a, b) => a.date.localeCompare(b.date) || RANG[a.type] - RANG[b.type] || a.createdAt.localeCompare(b.createdAt));

/** Contrôle une suite de mouvements ; renvoie le premier problème trouvé ou null. */
export function validateTxs(txs: SecurityTx[]): string | null {
  let qty = 0;
  for (const t of sortTxs(txs)) {
    if (t.type === 'achat') {
      if (!(t.quantity > 0) || !(t.unitPrice >= 0)) return 'Un achat a besoin d’une quantité et d’un cours valides.';
      qty += t.quantity;
    } else if (t.type === 'vente') {
      if (!(t.quantity > 0) || !(t.unitPrice >= 0)) return 'Une vente a besoin d’une quantité et d’un cours valides.';
      if (t.quantity > qty + EPS) return `Vente impossible le ${t.date} : vous ne détenez que ${fmtQty(qty)} part(s) à cette date.`;
      qty -= t.quantity;
    } else if (t.type === 'ajustement') {
      if (!Number.isFinite(t.quantity) || Math.abs(t.quantity) < EPS) return 'Un ajustement a besoin d’une quantité non nulle.';
      qty += t.quantity;
      if (qty < -EPS) return `Ajustement impossible le ${t.date} : la quantité deviendrait négative.`;
    } else if (!(t.amountCents > 0)) {
      return 'Un dividende a besoin d’un montant supérieur à zéro.';
    }
    if (t.feesCents < 0 || !Number.isInteger(t.feesCents)) return 'Les frais ne peuvent pas être négatifs.';
  }
  return null;
}

export function fmtQty(q: number): string {
  return q.toLocaleString('fr-FR', { maximumFractionDigits: 6 });
}

/** Position d'un titre d'après tous ses mouvements et son dernier cours (euros par part). */
export function computePosition(txs: SecurityTx[], lastPrice?: number): Position {
  let quantity = 0, costCents = 0, realizedCents = 0, dividendsCents = 0, feesCents = 0;

  for (const t of sortTxs(txs)) {
    if (t.type === 'achat') {
      costCents += grossCents(t.quantity, t.unitPrice) + t.feesCents;
      quantity += t.quantity;
      feesCents += t.feesCents;
    } else if (t.type === 'vente') {
      const gross = grossCents(t.quantity, t.unitPrice);
      const sold = Math.min(t.quantity, quantity);
      // Solde exact à la dernière part vendue : plus de reliquat de coût.
      const removed = quantity - sold < EPS ? costCents : Math.round(costCents * (sold / quantity));
      realizedCents += gross - t.feesCents - removed;
      costCents -= removed;
      quantity -= sold;
      feesCents += t.feesCents;
    } else if (t.type === 'ajustement') {
      quantity += t.quantity;
    } else {
      dividendsCents += t.amountCents;
    }
  }
  if (Math.abs(quantity) < EPS) quantity = 0;

  const hasPrice = lastPrice !== undefined && Number.isFinite(lastPrice);
  const marketValueCents = hasPrice ? grossCents(quantity, lastPrice) : undefined;
  return {
    quantity, costCents,
    avgCost: quantity > 0 ? costCents / 100 / quantity : 0,
    realizedCents, dividendsCents, feesCents,
    lastPrice: hasPrice ? lastPrice : undefined,
    marketValueCents,
    latentCents: marketValueCents === undefined ? undefined : marketValueCents - costCents,
    totalGainCents: realizedCents + dividendsCents,
  };
}

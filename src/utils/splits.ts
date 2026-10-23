// Ventilation multiple : une opération répartie sur plusieurs catégories.
//
// Un ticket de caisse de 87 € peut être 60 € d'alimentation et 27 € d'entretien.
// Le montant de l'opération (`amountCents`, signé) reste la seule vérité du compte ;
// la ventilation ne fait que le répartir par catégorie, et la somme des parts DOIT
// lui être égale au centime près. Les parts portent le même signe que l'opération.

import type { Cents, Operation, OperationSplit } from '../types';

/** Parts effectives d'une opération pour les calculs par catégorie. */
export function categoryParts(
  op: Pick<Operation, 'categoryId' | 'amountCents' | 'splits'>,
): { categoryId?: string; amountCents: Cents }[] {
  return op.splits && op.splits.length > 0
    ? op.splits.map(s => ({ categoryId: s.categoryId, amountCents: s.amountCents }))
    : [{ categoryId: op.categoryId, amountCents: op.amountCents }];
}

export const isSplit = (op: Pick<Operation, 'splits'>): boolean => !!op.splits && op.splits.length > 1;

/** Une opération touche-t-elle cette catégorie, en entier ou par l'une de ses parts ? */
export const touchesCategory = (op: Pick<Operation, 'categoryId' | 'splits'>, categoryId: string): boolean =>
  op.categoryId === categoryId || !!op.splits?.some(s => s.categoryId === categoryId);

/**
 * Contrôle d'une ventilation saisie ; renvoie un message ou null si elle est valide.
 * `totalCents` est le montant signé de l'opération.
 */
export function validateSplits(totalCents: Cents, splits: OperationSplit[]): string | null {
  if (splits.length < 2) return 'Une ventilation compte au moins deux lignes.';
  if (totalCents === 0) return 'Le montant de l’opération est nul : rien à ventiler.';
  const sign = Math.sign(totalCents);
  for (const s of splits) {
    if (!Number.isInteger(s.amountCents) || s.amountCents === 0) return 'Chaque ligne de la ventilation doit avoir un montant.';
    if (Math.sign(s.amountCents) !== sign) return 'Les montants de la ventilation doivent avoir le même sens que l’opération.';
  }
  const sum = splits.reduce((t, s) => t + s.amountCents, 0);
  if (sum !== totalCents) {
    const diff = Math.abs(totalCents - sum);
    return `La ventilation ne correspond pas au montant : il ${sum > totalCents === (sign > 0) ? 'dépasse' : 'manque'} ${(diff / 100).toFixed(2).replace('.', ',')} €.`;
  }
  return null;
}

/** Reste à ventiler (signé comme l'opération) : 0 quand la ventilation est complète. */
export const remainingToSplit = (totalCents: Cents, splits: Pick<OperationSplit, 'amountCents'>[]): Cents =>
  totalCents - splits.reduce((t, s) => t + s.amountCents, 0);

/** Libellé court d'une ventilation, pour une cellule de tableau. */
export function splitSummary(op: Pick<Operation, 'splits'>, catName: (id?: string) => string): string {
  const parts = op.splits ?? [];
  return parts.map(p => catName(p.categoryId)).join(' · ');
}

/** Nom de catégorie à afficher pour une opération : « Ventilée (2) » ou la catégorie unique. */
export function operationCategoryName(
  op: Pick<Operation, 'categoryId' | 'splits'>, catName: (id?: string) => string,
): string {
  return isSplit(op) ? `Ventilée (${op.splits!.length})` : catName(op.categoryId);
}

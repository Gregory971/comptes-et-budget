import { db, uid, stamp } from './db';
import type { Operation, Ymd, Cents } from '../types';

/**
 * Virement entre deux comptes de la même base — écriture double.
 *
 * Correction P1 : le type « virement » existait dans le modèle sans aucune
 * implémentation, et le calcul de signe le traitait comme une recette. Un
 * virement crée désormais deux opérations liées par transferId : un débit sur le
 * compte source et un crédit de même montant sur le compte destinataire. Le
 * patrimoine total reste donc inchangé, et les bilans excluent ces écritures des
 * recettes et des dépenses.
 */
export const transferService = {
  async create(input: {
    dbId: string; fromAccountId: string; toAccountId: string;
    date: Ymd; amountCents: Cents; label?: string; paymentMethodId?: string;
  }): Promise<{ debit: Operation; credit: Operation }> {
    if (input.fromAccountId === input.toAccountId) {
      throw new Error('Le compte source et le compte destinataire doivent être différents.');
    }
    const amount = Math.abs(input.amountCents);
    if (amount <= 0) throw new Error('Le montant du virement doit être supérieur à zéro.');

    const now = stamp();
    const transferId = uid();
    const base = {
      dbId: input.dbId, date: input.date, kind: 'virement' as const,
      paymentMethodId: input.paymentMethodId, transferId,
      checked: false, createdAt: now, updatedAt: now,
    };
    const debit: Operation = {
      ...base, id: uid(), accountId: input.fromAccountId, amountCents: -amount,
      label: input.label ?? 'Virement émis',
    };
    const credit: Operation = {
      ...base, id: uid(), accountId: input.toAccountId, amountCents: amount,
      label: input.label ?? 'Virement reçu',
    };
    await db.transaction('rw', db.operations, async () => {
      await db.operations.bulkAdd([debit, credit]);
    });
    return { debit, credit };
  },

  /** Écriture jumelle d'un virement (pour l'affichage du compte en vis-à-vis). */
  async counterpart(op: Operation): Promise<Operation | undefined> {
    if (!op.transferId) return undefined;
    const both = await db.operations.where('transferId').equals(op.transferId).toArray();
    return both.find(o => o.id !== op.id);
  },
};

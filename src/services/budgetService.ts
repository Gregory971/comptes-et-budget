import { db, uid, stamp } from './db';
import { monthRange } from '../utils/date';
import type { Budget, Cents } from '../types';

export const budgetService = {
  list: (dbId: string) => db.budgets.where('dbId').equals(dbId).toArray(),

  async set(dbId: string, categoryId: string, monthlyAmountCents: Cents): Promise<void> {
    const existing = await db.budgets.where('[dbId+categoryId]').equals([dbId, categoryId]).first();
    if (existing) await db.budgets.update(existing.id, { monthlyAmountCents, updatedAt: stamp() });
    else await db.budgets.add({ id: uid(), dbId, categoryId, monthlyAmountCents, updatedAt: stamp() });
  },

  remove: (id: string) => db.budgets.delete(id),

  /**
   * Optimisation P2 : dépenses du mois courant agrégées par catégorie en UNE
   * lecture de la tranche de dates. L'ancienne version lisait toute la table
   * operations une fois par ligne de budget affichée.
   */
  async spentByCategory(dbId: string, anchor = new Date()): Promise<Record<string, Cents>> {
    const { from, to } = monthRange(anchor.getFullYear(), anchor.getMonth());
    const ops = await db.operations.where('[dbId+date]')
      .between([dbId, from], [dbId, to], true, true).toArray();
    const out: Record<string, Cents> = {};
    for (const o of ops) {
      // Les virements ne sont pas des dépenses : ils sortent du suivi budgétaire.
      if (o.deletedAt || o.kind === 'virement' || o.amountCents >= 0 || !o.categoryId) continue;
      out[o.categoryId] = (out[o.categoryId] ?? 0) - o.amountCents;
    }
    return out;
  },

  /** Vue consolidée : budget, dépensé et reste à vivre pour le mois courant. */
  async monthlyStatus(dbId: string, anchor = new Date()): Promise<
    { budget: Budget; spentCents: Cents; remainingCents: Cents; percent: number }[]
  > {
    const [budgets, spent] = await Promise.all([this.list(dbId), this.spentByCategory(dbId, anchor)]);
    return budgets.map(budget => {
      const spentCents = spent[budget.categoryId] ?? 0;
      return {
        budget, spentCents,
        remainingCents: budget.monthlyAmountCents - spentCents,
        percent: budget.monthlyAmountCents > 0
          ? Math.min(100, (spentCents / budget.monthlyAmountCents) * 100) : 0,
      };
    });
  },
};

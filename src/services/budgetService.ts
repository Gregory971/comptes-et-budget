import { db, uid, stamp } from './db';
import { monthRange } from '../utils/date';
import { categoryParts } from '../utils/splits';
import { convert, currencyService } from './currencyService';
import type { Budget, Cents } from '../types';

/** Ligne de suivi d'un budget pour le mois courant. */
export interface BudgetStatus {
  budget: Budget;
  spentCents: Cents;
  remainingCents: Cents;
  /** Consommation plafonnée à 100 : sert à dessiner la barre de progression. */
  percent: number;
  /**
   * Consommation réelle, non plafonnée (125 = 25 % de dépassement). Nécessaire
   * pour distinguer « budget atteint » de « budget dépassé », que `percent`
   * confond. Reste à 0 quand le budget est nul : le rapport n'est pas défini.
   */
  rawPercent: number;
}

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
    const [ops, rates] = await Promise.all([
      db.operations.where('[dbId+date]').between([dbId, from], [dbId, to], true, true).toArray(),
      currencyService.rates(dbId),
    ]);
    const out: Record<string, Cents> = {};
    for (const o of ops) {
      // Les virements ne sont pas des dépenses : ils sortent du suivi budgétaire.
      if (o.deletedAt || o.kind === 'virement' || o.amountCents >= 0) continue;
      // Une opération ventilée pèse sur chacune de ses catégories, pour sa part.
      const k = rates[o.accountId] ?? 1;   // les budgets sont en devise de la base
      for (const p of categoryParts(o)) {
        if (!p.categoryId || p.amountCents >= 0) continue;
        out[p.categoryId] = (out[p.categoryId] ?? 0) - convert(p.amountCents, k);
      }
    }
    return out;
  },

  /** Vue consolidée : budget, dépensé et reste à vivre pour le mois courant. */
  async monthlyStatus(dbId: string, anchor = new Date()): Promise<BudgetStatus[]> {
    const [budgets, spent] = await Promise.all([this.list(dbId), this.spentByCategory(dbId, anchor)]);
    return budgets.map(budget => {
      const spentCents = spent[budget.categoryId] ?? 0;
      const rawPercent = budget.monthlyAmountCents > 0
        ? (spentCents / budget.monthlyAmountCents) * 100 : 0;
      return {
        budget, spentCents,
        remainingCents: budget.monthlyAmountCents - spentCents,
        percent: Math.min(100, rawPercent),
        rawPercent,
      };
    });
  },
};

import { db, uid, stamp } from './db';
import { monthRange } from '../utils/date';
import { categoryParts } from '../utils/splits';
import { fromYmd, toYmd, type Ymd } from '../utils/date';
import { convert, currencyService } from './currencyService';
import type { Budget, BudgetPeriod, Cents } from '../types';

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

export const PERIOD_LABEL: Record<BudgetPeriod, string> = { 1: 'par mois', 3: 'par trimestre', 6: 'par semestre', 12: 'par an' };

/** Équivalent mensuel d'un montant saisi pour `periodMonths` mois, au centime le plus proche. */
export const monthlyFromPeriod = (amountCents: Cents, periodMonths: BudgetPeriod): Cents => Math.round(amountCents / periodMonths);

export interface BudgetSuggestion {
  categoryId: string;
  /** Moyenne mensuelle des dépenses de la catégorie sur la période observée. */
  averageCents: Cents;
  /** Montant proposé : la moyenne arrondie à l'euro supérieur le plus proche du pas choisi. */
  suggestedCents: Cents;
  /** Mois comptés dans la moyenne. */
  months: number;
  /** La catégorie a déjà un budget. */
  hasBudget: boolean;
}

/** Nombre de mois civils entre deux dates incluses (au moins 1). */
export function monthsBetween(from: Ymd, to: Ymd): number {
  const a = fromYmd(from), b = fromYmd(to);
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1);
}

export const budgetService = {
  list: (dbId: string) => db.budgets.where('dbId').equals(dbId).toArray(),

  async set(dbId: string, categoryId: string, monthlyAmountCents: Cents): Promise<void> {
    const existing = await db.budgets.where('[dbId+categoryId]').equals([dbId, categoryId]).first();
    // Un montant mensuel direct efface la période mémorisée : sinon l'ancienne saisie réapparaîtrait.
    if (existing) {
      await db.budgets.update(existing.id, { monthlyAmountCents, periodMonths: undefined, periodAmountCents: undefined, updatedAt: stamp() });
    } else {
      await db.budgets.add({ id: uid(), dbId, categoryId, monthlyAmountCents, updatedAt: stamp() });
    }
  },

  /**
   * Budget saisi pour une période (trimestre, semestre, année) : le montant mensuel
   * en est le lissage, et la saisie d'origine est conservée. Une période d'un mois
   * revient à un budget mensuel ordinaire.
   */
  async setPeriodic(dbId: string, categoryId: string, amountCents: Cents, periodMonths: BudgetPeriod): Promise<void> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Le montant du budget doit être supérieur à zéro.');
    if (![1, 3, 6, 12].includes(periodMonths)) throw new Error('La période du budget est invalide.');
    if (periodMonths === 1) return this.set(dbId, categoryId, amountCents);
    const monthly = monthlyFromPeriod(amountCents, periodMonths);
    if (monthly <= 0) throw new Error('Ce montant est trop faible pour la période choisie.');
    const existing = await db.budgets.where('[dbId+categoryId]').equals([dbId, categoryId]).first();
    const fields = { monthlyAmountCents: monthly, periodMonths, periodAmountCents: amountCents, updatedAt: stamp() };
    if (existing) await db.budgets.update(existing.id, fields);
    else await db.budgets.add({ id: uid(), dbId, categoryId, ...fields });
  },

  /** Supprime tous les budgets de la base. Renvoie combien. */
  async reset(dbId: string): Promise<number> {
    return db.budgets.where('dbId').equals(dbId).delete();
  },

  /**
   * Budgets suggérés d'après les dépenses réelles d'une période : moyenne mensuelle
   * par catégorie. Une opération ventilée compte pour chaque part dans sa catégorie ;
   * les virements, les recettes et les opérations supprimées sont ignorés ; les comptes
   * en devise étrangère sont convertis. `step` arrondit au multiple supérieur
   * (par défaut 5 € : un budget à 187,43 € n'a pas de sens).
   */
  async suggest(dbId: string, range: { from: Ymd; to: Ymd }, step: Cents = 500): Promise<BudgetSuggestion[]> {
    const [ops, rates, budgets] = await Promise.all([
      db.operations.where('[dbId+date]').between([dbId, range.from], [dbId, range.to], true, true).toArray(),
      currencyService.rates(dbId),
      db.budgets.where('dbId').equals(dbId).toArray(),
    ]);
    const months = monthsBetween(range.from, range.to);
    const total: Record<string, Cents> = {};
    for (const o of ops) {
      if (o.deletedAt || o.kind === 'virement' || o.amountCents >= 0) continue;
      const k = rates[o.accountId] ?? 1;
      for (const p of categoryParts(o)) {
        if (!p.categoryId || p.amountCents >= 0) continue;
        total[p.categoryId] = (total[p.categoryId] ?? 0) - convert(p.amountCents, k);
      }
    }
    const budgeted = new Set(budgets.map(b => b.categoryId));
    const roundUp = (c: Cents) => (step > 0 ? Math.ceil(c / step) * step : c);
    return Object.entries(total)
      .map(([categoryId, sum]) => {
        const averageCents = Math.round(sum / months);
        return { categoryId, averageCents, suggestedCents: roundUp(averageCents), months, hasBudget: budgeted.has(categoryId) };
      })
      .filter(s => s.suggestedCents > 0)
      .sort((a, b) => b.averageCents - a.averageCents);
  },

  /**
   * Applique des budgets suggérés. `replace` false : les catégories qui ont déjà un
   * budget sont laissées telles quelles. Renvoie les nombres créés et remplacés.
   */
  async applySuggestions(dbId: string, items: { categoryId: string; monthlyCents: Cents }[], replace: boolean): Promise<{ created: number; replaced: number; kept: number }> {
    const existing = new Set((await db.budgets.where('dbId').equals(dbId).toArray()).map(b => b.categoryId));
    let created = 0, replaced = 0, kept = 0;
    for (const it of items) {
      if (!Number.isInteger(it.monthlyCents) || it.monthlyCents <= 0) continue;
      if (existing.has(it.categoryId)) {
        if (!replace) { kept++; continue; }
        replaced++;
      } else created++;
      await this.set(dbId, it.categoryId, it.monthlyCents);
    }
    return { created, replaced, kept };
  },

  /** Plage des douze derniers mois civils COMPLETS avant `now`. */
  lastTwelveMonths(now: Date = new Date()): { from: Ymd; to: Ymd } {
    const end = new Date(now.getFullYear(), now.getMonth(), 0);                    // dernier jour du mois précédent
    const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
    return { from: toYmd(start), to: toYmd(end) };
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

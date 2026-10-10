import { useLiveQuery } from 'dexie-react-hooks';
import {
  budgetAlertService, DEFAULT_PREFS, monthKey, type AlertPrefs, type BudgetAlertReport,
} from '../services/budgetAlertService';

const NO_REPORT: BudgetAlertReport = { prefs: DEFAULT_PREFS, alerts: [], hiddenCount: 0 };

/**
 * Alertes de budget du mois courant, rafraîchies quand les budgets, les
 * opérations ou les réglages changent. Le mois fait partie des dépendances :
 * une session ouverte à cheval sur deux mois repart d'un compteur neuf.
 */
export function useBudgetAlerts(dbId?: string): BudgetAlertReport {
  const month = monthKey();
  return useLiveQuery(
    () => (dbId ? budgetAlertService.evaluate(dbId) : Promise.resolve(NO_REPORT)),
    [dbId, month], NO_REPORT,
  ) ?? NO_REPORT;
}

/** Réglages seuls (écran Budget, Préférences). */
export function useBudgetAlertPrefs(): AlertPrefs {
  return useLiveQuery(() => budgetAlertService.getPrefs(), [], DEFAULT_PREFS) ?? DEFAULT_PREFS;
}

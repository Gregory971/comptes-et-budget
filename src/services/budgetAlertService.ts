/**
 * Alertes de budget.
 *
 * Deux niveaux, évalués par catégorie sur le mois courant :
 *  · « attention » : la dépense atteint le seuil (80 % par défaut) du budget
 *    mensuel, sans le dépasser ;
 *  · « dépassé »   : la dépense est strictement supérieure au budget.
 *    Un budget consommé à exactement 100 % n'est donc qu'en « attention » :
 *    il n'y a pas encore de dépassement à signaler.
 *
 * Les dépenses viennent de budgetService.spentByCategory, qui exclut déjà les
 * virements, les opérations supprimées et les recettes : les alertes ne peuvent
 * pas diverger de ce que l'écran Budget affiche.
 *
 * Les comparaisons se font en centimes entiers (dépense × 100 ≥ seuil × budget)
 * plutôt qu'en pourcentages flottants : « exactement 80 % » ne dépend alors
 * d'aucun arrondi.
 *
 * Réglages dans la table `settings` (propre à l'appareil, hors sauvegarde) —
 * aucune nouvelle table ni migration. Aucun appel réseau, aucune notification
 * système : l'alerte n'existe que dans l'interface.
 */
import { db, stamp } from './db';
import { budgetService, type BudgetStatus } from './budgetService';
import { toYmd } from '../utils/date';
import type { Cents } from '../types';

export type AlertLevel = 'attention' | 'depasse';
/** Situation d'un budget : « ok » ne produit aucune alerte. */
export type BudgetState = 'ok' | AlertLevel;

/** Seuils d'attention proposés dans les Préférences. */
export const THRESHOLDS = [70, 80, 90] as const;
export const DEFAULT_THRESHOLD = 80;

export const LEVEL_LABEL: Record<AlertLevel, string> = {
  attention: 'Attention',
  depasse: 'Dépassé',
};

const RANK: Record<BudgetState, number> = { ok: 0, attention: 1, depasse: 2 };

export interface BudgetAlert {
  categoryId: string;
  level: AlertLevel;
  budgetCents: Cents;
  spentCents: Cents;
  /** Budget − dépensé : négatif en cas de dépassement. */
  remainingCents: Cents;
  /** Montant dépassé, 0 tant que le budget n'est pas franchi. */
  overCents: Cents;
  /** Consommation réelle en %, non plafonnée ; 0 pour un budget nul. */
  percent: number;
}

/** Valeur de seuil acceptable ; toute autre valeur retombe sur 80 %. */
export function normalizeThreshold(value: unknown): number {
  return (THRESHOLDS as readonly number[]).includes(value as number)
    ? (value as number) : DEFAULT_THRESHOLD;
}

/**
 * Situation d'un budget.
 *  · rien de dépensé → « ok », quel que soit le budget ;
 *  · budget nul (ou négatif, hérité d'un import) : toute dépense le dépasse,
 *    le rapport dépensé/budget n'étant pas défini ;
 *  · sinon « dépassé » au-delà de 100 %, « attention » dès le seuil inclus.
 */
export function budgetState(
  spentCents: Cents, budgetCents: Cents, threshold = DEFAULT_THRESHOLD,
): BudgetState {
  if (!(spentCents > 0)) return 'ok';
  if (!(budgetCents > 0)) return 'depasse';
  if (spentCents > budgetCents) return 'depasse';
  if (spentCents * 100 >= threshold * budgetCents) return 'attention';
  return 'ok';
}

/**
 * Alertes d'un ensemble de budgets, de la plus grave à la moins grave :
 * les dépassements d'abord (le plus fort en euros en tête), puis les
 * approches du plafond (la plus avancée en tête).
 */
export function computeAlerts(
  rows: Pick<BudgetStatus, 'budget' | 'spentCents'>[], threshold = DEFAULT_THRESHOLD,
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  for (const { budget, spentCents } of rows) {
    const level = budgetState(spentCents, budget.monthlyAmountCents, threshold);
    if (level === 'ok') continue;
    const budgetCents = budget.monthlyAmountCents;
    alerts.push({
      categoryId: budget.categoryId,
      level,
      budgetCents,
      spentCents,
      remainingCents: budgetCents - spentCents,
      overCents: Math.max(0, spentCents - budgetCents),
      percent: budgetCents > 0 ? (spentCents / budgetCents) * 100 : 0,
    });
  }
  return alerts.sort((a, b) =>
    RANK[b.level] - RANK[a.level]
    || b.overCents - a.overCents
    || b.percent - a.percent
    || b.spentCents - a.spentCents
    || a.categoryId.localeCompare(b.categoryId));
}

/** Alertes masquées pour un mois : catégorie → niveau au moment du masquage. */
export interface Dismissed {
  month: string; // 'AAAA-MM'
  levels: Record<string, AlertLevel>;
}

/** Mois civil « AAAA-MM » de la date donnée (fuseau local). */
export const monthKey = (anchor: Date = new Date()): string => toYmd(anchor).slice(0, 7);

/**
 * Une alerte masquée reste masquée tant qu'elle ne s'aggrave pas : masquer
 * « attention » ne doit pas cacher le dépassement qui suit.
 */
export function isDismissed(alert: BudgetAlert, dismissed: Dismissed | undefined, month: string): boolean {
  if (!dismissed || dismissed.month !== month) return false;
  const at = dismissed.levels[alert.categoryId];
  return at !== undefined && RANK[at] >= RANK[alert.level];
}

export function visibleAlerts(
  alerts: BudgetAlert[], dismissed: Dismissed | undefined, month: string,
): BudgetAlert[] {
  return alerts.filter(a => !isDismissed(a, dismissed, month));
}

// ---------------------------------------------------------------------------
// Persistance (table `settings`)
// ---------------------------------------------------------------------------

const K_ENABLED = 'budgetAlerts.enabled';
const K_THRESHOLD = 'budgetAlerts.threshold';
const kDismissed = (dbId: string) => `budgetAlerts.dismissed.${dbId}`;

export interface AlertPrefs {
  enabled: boolean;
  threshold: number;
}

export const DEFAULT_PREFS: AlertPrefs = { enabled: true, threshold: DEFAULT_THRESHOLD };

async function read<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

function sanitizeDismissed(raw: unknown): Dismissed | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { month, levels } = raw as Partial<Dismissed>;
  if (typeof month !== 'string' || !levels || typeof levels !== 'object') return undefined;
  const clean: Record<string, AlertLevel> = {};
  for (const [id, lv] of Object.entries(levels)) {
    if (lv === 'attention' || lv === 'depasse') clean[id] = lv;
  }
  return { month, levels: clean };
}

export interface BudgetAlertReport {
  prefs: AlertPrefs;
  /** Alertes à afficher : vide si les alertes sont désactivées. */
  alerts: BudgetAlert[];
  /** Nombre d'alertes existantes mais masquées pour ce mois. */
  hiddenCount: number;
}

export const budgetAlertService = {
  async getPrefs(): Promise<AlertPrefs> {
    const [enabled, threshold] = await Promise.all([
      read<boolean>(K_ENABLED), read<number>(K_THRESHOLD),
    ]);
    return {
      enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_PREFS.enabled,
      threshold: normalizeThreshold(threshold),
    };
  },

  async setEnabled(enabled: boolean): Promise<void> {
    await db.settings.put({ key: K_ENABLED, value: enabled, updatedAt: stamp() });
  },

  async setThreshold(threshold: number): Promise<void> {
    await db.settings.put({
      key: K_THRESHOLD, value: normalizeThreshold(threshold), updatedAt: stamp(),
    });
  },

  async getDismissed(dbId: string): Promise<Dismissed | undefined> {
    return sanitizeDismissed(await read(kDismissed(dbId)));
  },

  /** Masque l'alerte de cette catégorie jusqu'à la fin du mois (ou son aggravation). */
  async dismiss(
    dbId: string, alert: Pick<BudgetAlert, 'categoryId' | 'level'>, anchor: Date = new Date(),
  ): Promise<void> {
    const month = monthKey(anchor);
    await db.transaction('rw', db.settings, async () => {
      const current = sanitizeDismissed(await read(kDismissed(dbId)));
      // Un mois révolu est abandonné : seuls les masquages du mois courant comptent.
      const levels = current && current.month === month ? { ...current.levels } : {};
      levels[alert.categoryId] = alert.level;
      await db.settings.put({
        key: kDismissed(dbId), value: { month, levels } satisfies Dismissed, updatedAt: stamp(),
      });
    });
  },

  /** Réaffiche toutes les alertes masquées de cette base. */
  async clearDismissed(dbId: string): Promise<void> {
    await db.settings.delete(kDismissed(dbId));
  },

  /** Évaluation complète : réglages, alertes visibles et nombre de masquées. */
  async evaluate(dbId: string, anchor: Date = new Date()): Promise<BudgetAlertReport> {
    const prefs = await this.getPrefs();
    if (!prefs.enabled) return { prefs, alerts: [], hiddenCount: 0 };
    const [rows, dismissed] = await Promise.all([
      budgetService.monthlyStatus(dbId, anchor), this.getDismissed(dbId),
    ]);
    const all = computeAlerts(rows, prefs.threshold);
    const month = monthKey(anchor);
    const alerts = visibleAlerts(all, dismissed, month);
    return { prefs, alerts, hiddenCount: all.length - alerts.length };
  },
};

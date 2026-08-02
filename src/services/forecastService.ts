import { operationService } from './operationService';
import { accountService } from './accountService';
import { budgetService } from './budgetService';
import { scheduleService, advance } from './scheduleService';
import { categoryService } from './referentialService';
import { monthRange, today, type Ymd } from '../utils/date';
import { applyHolidayRule, shiftReason, type Region } from '../utils/holidays';
import type { Cents, Operation } from '../types';

/**
 * Projection d'un mois : opérations déjà saisies, puis prévisions.
 *
 * Deux natures de prévision, volontairement distinguées :
 *  · « echeance » — opérations programmées non encore comptabilisées, dont la
 *    date et le montant sont connus. Montant certain.
 *  · « budget »  — pour chaque catégorie budgétée, l'écart entre le budget
 *    mensuel et ce qui a déjà été dépensé, positionné en fin de mois. Montant
 *    estimé, à prendre comme une enveloppe restante et non comme une dépense sûre.
 *
 * Les deux ne se recouvrent pas : la part d'un budget déjà couverte par une
 * échéance à venir est retranchée du reste à vivre, faute de quoi un loyer
 * programmé serait compté deux fois.
 */

export type ForecastKind = 'echeance' | 'budget';

export interface ForecastLine {
  id: string;
  kind: ForecastKind;
  date: Ymd;
  amountCents: Cents;        // signé
  label: string;
  categoryId?: string;
  payeeId?: string;
  paymentMethodId?: string;
  accountId?: string;
  /** Motif du report d'un jour férié ou non ouvré, le cas échéant. */
  shiftedFrom?: Ymd;
  shiftReason?: string;
}

export interface MonthForecast {
  from: Ymd;
  to: Ymd;
  /** Solde à l'ouverture de la période. */
  openingCents: Cents;
  /** Opérations réellement enregistrées sur le mois. */
  operations: Operation[];
  /** Solde après les seules opérations réelles. */
  actualCents: Cents;
  /** Prévisions, triées par date. */
  forecast: ForecastLine[];
  scheduledCents: Cents;     // total des échéances à venir (signé)
  budgetRemainingCents: Cents; // reste à consommer des budgets (positif = à dépenser)
  /** Solde estimé en fin de mois : réel + échéances + reste à vivre. */
  projectedCents: Cents;
}

export const forecastService = {
  async build(
    dbId: string,
    accountId: string | undefined,
    anchor: Date,
    region: Region,
    at: Ymd = today(),
  ): Promise<MonthForecast> {
    const { from, to } = monthRange(anchor.getFullYear(), anchor.getMonth());
    const previous = previousDay(from);

    const [operations, openingCents, schedules, budgets, spent, cats] = await Promise.all([
      operationService.list(dbId, { accountId, from, to }),
      accountId
        ? accountService.balance(accountId, previous)
        : accountService.totalBalance(dbId, previous),
      scheduleService.list(dbId),
      budgetService.list(dbId),
      budgetService.spentByCategory(dbId, anchor),
      categoryService.listCategories(dbId, true),
    ]);

    const chrono = [...operations].sort((a, b) => a.date.localeCompare(b.date));
    const actualCents = chrono.reduce((s, o) => s + o.amountCents, openingCents);
    const catName = (id?: string) => cats.find(c => c.id === id)?.name ?? 'Sans catégorie';

    // --- 1. Échéances à venir, jusqu'à la fin du mois observé.
    const horizon = to < at ? to : to;   // borne haute : fin du mois affiché
    const lower = from > at ? from : at; // on ne prévoit pas le passé du mois courant
    const forecast: ForecastLine[] = [];
    const scheduledByCategory: Record<string, Cents> = {};

    for (const s of schedules) {
      if (!s.active) continue;
      if (accountId && s.accountId !== accountId) continue;
      let planned = s.nextDate;
      for (let i = 0; i < 40; i++) {
        if (planned > horizon) break;
        if (s.endDate && planned > s.endDate) break;
        const effective = applyHolidayRule(planned, s.holidayRule, region);
        // Une échéance dont la date effective est déjà passée a normalement été
        // comptabilisée : on ne l'affiche que si elle reste dans la fenêtre à venir.
        if (effective >= lower && effective >= from && effective <= to) {
          forecast.push({
            id: `s:${s.id}:${planned}`,
            kind: 'echeance',
            date: effective,
            amountCents: s.amountCents,
            label: s.label ?? catName(s.categoryId),
            categoryId: s.categoryId,
            payeeId: s.payeeId,
            paymentMethodId: s.paymentMethodId,
            accountId: s.accountId,
            shiftedFrom: effective === planned ? undefined : planned,
            shiftReason: effective === planned ? undefined : (shiftReason(planned, region) ?? undefined),
          });
          if (s.categoryId && s.amountCents < 0) {
            scheduledByCategory[s.categoryId] =
              (scheduledByCategory[s.categoryId] ?? 0) + -s.amountCents;
          }
        }
        if (s.periodicity === 'unique') break;
        planned = advance(planned, s.periodicity);
      }
    }

    // --- 2. Reste à consommer des budgets, hors part déjà couverte par une échéance.
    let budgetRemainingCents = 0;
    for (const b of budgets) {
      const already = spent[b.categoryId] ?? 0;
      const planned = scheduledByCategory[b.categoryId] ?? 0;
      const remaining = b.monthlyAmountCents - already - planned;
      if (remaining <= 0) continue;
      budgetRemainingCents += remaining;
      forecast.push({
        id: `b:${b.id}`,
        kind: 'budget',
        date: to,
        amountCents: -remaining,
        label: `Reste à vivre — ${catName(b.categoryId)}`,
        categoryId: b.categoryId,
      });
    }

    forecast.sort((a, b) =>
      a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'echeance' ? -1 : 1));

    const scheduledCents = forecast
      .filter(f => f.kind === 'echeance')
      .reduce((s, f) => s + f.amountCents, 0);

    return {
      from, to, openingCents, operations: chrono, actualCents,
      forecast, scheduledCents, budgetRemainingCents,
      projectedCents: actualCents + scheduledCents - budgetRemainingCents,
    };
  },
};

function previousDay(date: Ymd): Ymd {
  const [y, m, d] = date.split('-').map(Number);
  const prev = new Date(y, m - 1, d, 12);
  prev.setDate(prev.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
}

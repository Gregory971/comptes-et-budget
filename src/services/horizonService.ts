// Trésorerie prévisionnelle au-delà du mois courant.
//
// forecastService s'arrête à la fin du mois affiché : il répond à « où en
// serai-je le 31 ? », pas à « à quel moment vais-je passer sous zéro ? ». Or
// c'est la seconde question qui coûte cher — un découvert se voit venir des
// semaines à l'avance quand les échéances sont saisies.
//
// Deux natures de prévision, distinguées comme dans le prévisionnel mensuel :
// les ÉCHÉANCES ont une date et un montant certains ; les BUDGETS sont des
// enveloppes estimées, posées en fin de mois. Le point bas est calculé sur les
// seules échéances : y mêler des estimations donnerait une alerte de découvert
// qui n'existe peut-être pas.

import { accountService } from './accountService';
import { budgetService } from './budgetService';
import { scheduleService, advance, anchorOf } from './scheduleService';
import { applyHolidayRule, type Region } from '../utils/holidays';
import {
  addMonths, lastDayOfMonth, monthKey, monthLabel, today, type Ymd,
} from '../utils/date';
import type { Cents } from '../types';

export interface HorizonMonth {
  key: string;            // « AAAA-MM »
  label: string;          // « septembre 2026 »
  openingCents: Cents;    // solde au premier jour du mois
  scheduledCents: Cents;  // total des échéances du mois (signé)
  budgetCents: Cents;     // enveloppes budgétaires restantes (positif = à dépenser)
  /** Solde de fin de mois, échéances seules. */
  closingCents: Cents;
  /** Solde de fin de mois, échéances ET enveloppes budgétaires consommées. */
  closingWithBudgetCents: Cents;
  /** Point bas du mois, échéances seules, et sa date. */
  lowestCents: Cents;
  lowestDate: Ymd;
}

export interface Horizon {
  from: Ymd;
  to: Ymd;
  months: HorizonMonth[];
  /** Premier passage sous zéro, échéances seules — l'alerte qui compte. */
  firstNegative?: { date: Ymd; balanceCents: Cents };
  /** Idem, enveloppes budgétaires comprises : plus prudent, moins certain. */
  firstNegativeWithBudget?: { date: Ymd; balanceCents: Cents };
}

interface Occurrence { date: Ymd; amountCents: Cents }

/** Occurrences des échéances actives entre deux dates, report des fériés appliqué. */
async function occurrences(
  dbId: string, accountId: string | undefined, from: Ymd, to: Ymd, region: Region,
): Promise<Occurrence[]> {
  const schedules = await scheduleService.list(dbId);
  const out: Occurrence[] = [];
  for (const s of schedules) {
    if (!s.active) continue;
    if (accountId && s.accountId !== accountId) continue;
    let planned = s.nextDate;
    // Garde-fou : au plus une occurrence par semaine sur dix ans.
    for (let i = 0; i < 520; i++) {
      if (planned > to) break;
      if (s.endDate && planned > s.endDate) break;
      const effective = applyHolidayRule(planned, s.holidayRule, region);
      if (effective >= from && effective <= to) {
        out.push({ date: effective, amountCents: s.amountCents });
      }
      if (s.periodicity === 'unique') break;
      planned = advance(planned, s.periodicity, anchorOf(s));
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Projection sur `months` mois à partir d'aujourd'hui.
 * `accountId` absent : tous les comptes actifs confondus.
 */
export async function buildHorizon(
  dbId: string,
  accountId: string | undefined,
  months: number,
  region: Region,
  at: Ymd = today(),
): Promise<Horizon> {
  const [y, m] = at.split('-').map(Number);
  const dernier = addMonths(`${at.slice(0, 8)}01`, months - 1);
  const [ly, lm] = dernier.split('-').map(Number);
  const to = `${dernier.slice(0, 8)}${String(lastDayOfMonth(ly, lm - 1)).padStart(2, '0')}`;

  const [depart, ops, budgets] = await Promise.all([
    accountId ? accountService.balance(accountId, at) : accountService.totalBalance(dbId, at),
    occurrences(dbId, accountId, at, to, region),
    budgetService.list(dbId),
  ]);
  // Enveloppe budgétaire mensuelle : appliquée telle quelle aux mois à venir.
  const budgetMensuel = budgets.reduce((s, b) => s + b.monthlyAmountCents, 0);
  // Mois en cours : seule la part non encore dépensée reste à prévoir.
  const dejaDepense = Object.values(await budgetService.spentByCategory(dbId, new Date(y, m - 1, 15)))
    .reduce((s, v) => s + v, 0);

  const resultat: HorizonMonth[] = [];
  let solde = depart;
  let soldeAvecBudget = depart;
  let firstNegative: Horizon['firstNegative'];
  let firstNegativeWithBudget: Horizon['firstNegativeWithBudget'];

  for (let i = 0; i < months; i++) {
    const premier = addMonths(`${at.slice(0, 8)}01`, i);
    const [my, mm] = premier.split('-').map(Number);
    const fin = `${premier.slice(0, 8)}${String(lastDayOfMonth(my, mm - 1)).padStart(2, '0')}`;
    const key = monthKey(premier);

    const opening = solde;
    let lowestCents = solde;
    let lowestDate = i === 0 ? at : premier;
    let scheduledCents = 0;

    for (const o of ops.filter(o => monthKey(o.date) === key)) {
      solde += o.amountCents;
      soldeAvecBudget += o.amountCents;
      scheduledCents += o.amountCents;
      if (solde < lowestCents) { lowestCents = solde; lowestDate = o.date; }
      if (!firstNegative && solde < 0) firstNegative = { date: o.date, balanceCents: solde };
      if (!firstNegativeWithBudget && soldeAvecBudget < 0) {
        firstNegativeWithBudget = { date: o.date, balanceCents: soldeAvecBudget };
      }
    }

    const budgetCents = Math.max(0, i === 0 ? budgetMensuel - dejaDepense : budgetMensuel);
    soldeAvecBudget -= budgetCents;
    if (!firstNegativeWithBudget && soldeAvecBudget < 0) {
      firstNegativeWithBudget = { date: fin, balanceCents: soldeAvecBudget };
    }

    resultat.push({
      key, label: monthLabel(my, mm - 1),
      openingCents: opening,
      scheduledCents, budgetCents,
      closingCents: solde,
      closingWithBudgetCents: soldeAvecBudget,
      lowestCents, lowestDate,
    });
  }

  return { from: at, to, months: resultat, firstNegative, firstNegativeWithBudget };
}

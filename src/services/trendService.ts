import { db } from './db';
import { accountService } from './accountService';
import { convert, currencyService } from './currencyService';
import { toYmd, type Ymd } from '../utils/date';
import type { Cents } from '../types';

/**
 * Séries mensuelles pour les graphiques d'évolution : recettes et dépenses par mois,
 * et solde de chaque compte en fin de mois.
 *
 * Les mois sans écriture sont présents (à zéro) : un graphique qui saute les mois
 * creux fausse la lecture de la tendance. Plusieurs comptes sont additionnés en
 * devise de la base ; un compte seul reste dans sa devise (voir currencyService).
 */

export interface MonthPoint { mois: string; key: string; recettesCents: Cents; depensesCents: Cents }

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 2026-03 » → « mars 26 ». */
export const monthLabel = (key: string): string => `${MOIS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

/** Les `months` derniers mois, le mois de `anchor` compris, du plus ancien au plus récent. */
export function lastMonths(months: number, anchor: Date = new Date()): { key: string; first: Ymd; last: Ymd }[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1), 1);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { key: toYmd(d).slice(0, 7), first: toYmd(d), last: toYmd(end) };
  });
}

/** Recettes et dépenses de chaque mois (virements exclus). */
export async function monthlySeries(dbId: string, accountId: string | undefined, months = 12, anchor: Date = new Date()): Promise<MonthPoint[]> {
  const span = lastMonths(months, anchor);
  const [ops, rates] = await Promise.all([
    db.operations.where('[dbId+date]').between([dbId, span[0].first], [dbId, span[span.length - 1].last], true, true).toArray(),
    currencyService.rates(dbId),
  ]);
  const out = new Map<string, MonthPoint>(span.map(m => [m.key, { mois: monthLabel(m.key), key: m.key, recettesCents: 0, depensesCents: 0 }]));
  for (const o of ops) {
    if (o.deletedAt || o.kind === 'virement') continue;
    if (accountId && o.accountId !== accountId) continue;
    const p = out.get(o.date.slice(0, 7));
    if (!p) continue;
    const v = accountId ? o.amountCents : convert(o.amountCents, rates[o.accountId] ?? 1);
    if (v >= 0) p.recettesCents += v; else p.depensesCents += -v;
  }
  return [...out.values()];
}

export interface AccountSeries { id: string; name: string; values: Cents[] }
export interface AccountEvolution { keys: string[]; labels: string[]; series: AccountSeries[]; total: Cents[] }

/**
 * Solde de chaque compte à la fin de chacun des derniers mois. Les prêts sont des
 * dettes, pas de la trésorerie : ils n'y figurent pas (comme dans le solde total).
 */
export async function accountEvolution(dbId: string, accountId: string | undefined, months = 12, anchor: Date = new Date()): Promise<AccountEvolution> {
  const span = lastMonths(months, anchor);
  const [accounts, rates, ops] = await Promise.all([
    accountService.list(dbId),
    currencyService.rates(dbId),
    db.operations.where('[dbId+date]').between([dbId, '0000-01-01'], [dbId, span[span.length - 1].last], true, true).toArray(),
  ]);
  const chosen = accounts.filter(a => a.type !== 'pret' && (!accountId || a.id === accountId));
  const byAccount = new Map<string, { date: Ymd; amountCents: Cents }[]>();
  for (const o of ops) {
    if (o.deletedAt) continue;
    byAccount.set(o.accountId, [...(byAccount.get(o.accountId) ?? []), { date: o.date, amountCents: o.amountCents }]);
  }
  const series: AccountSeries[] = chosen.map(a => {
    const mine = (byAccount.get(a.id) ?? []).sort((x, y) => x.date.localeCompare(y.date));
    const k = accountId ? 1 : rates[a.id] ?? 1;
    let i = 0, run = a.initialBalanceCents;
    const values = span.map(m => {
      while (i < mine.length && mine[i].date <= m.last) run += mine[i++].amountCents;
      return convert(run, k);
    });
    return { id: a.id, name: a.name, values };
  });
  return {
    keys: span.map(m => m.key), labels: span.map(m => monthLabel(m.key)), series,
    total: span.map((_, j) => series.reduce((s, x) => s + x.values[j], 0)),
  };
}

/** Regroupe au-delà de `n` lignes sous « Autres », pour qu'un graphique reste lisible. */
export function topN(data: { name: string; valueCents: Cents }[], n = 8): { name: string; valueCents: Cents }[] {
  if (data.length <= n) return data;
  const head = data.slice(0, n);
  const rest = data.slice(n).reduce((s, d) => s + d.valueCents, 0);
  return rest > 0 ? [...head, { name: 'Autres', valueCents: rest }] : head;
}

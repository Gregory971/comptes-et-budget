import { operationService } from './operationService';
import { accountService } from './accountService';
import { categoryService } from './referentialService';
import { ymd, lastDayOfMonth, monthLabel, monthKey, type Ymd } from '../utils/date';
import type { Cents } from '../types';

export type Granularity = 'mois' | 'trimestre' | 'annee';

export interface Range { from: Ymd; to: Ymd; label: string; }

/**
 * Bornes d'une période, en dates civiles.
 *
 * Correction P1 : la version précédente produisait des bornes ISO via
 * new Date(y, m, 1).toISOString(), soit minuit LOCAL exprimé en UTC. En
 * Guadeloupe (UTC−4), la borne basse d'août devenait « 2026-08-01T04:00:00Z »,
 * excluant les opérations du 1er (enregistrées à 00:00Z) et incluant celles du
 * 1er septembre. Le relevé mensuel était donc décalé d'un jour, et différait
 * selon le lieu de consultation. Plus aucune conversion UTC n'intervient ici.
 */
export function periodRange(anchor: Date, g: Granularity): Range {
  const y = anchor.getFullYear();
  if (g === 'annee') {
    return { from: ymd(y, 0, 1), to: ymd(y, 11, 31), label: String(y) };
  }
  if (g === 'trimestre') {
    const q = Math.floor(anchor.getMonth() / 3);
    const endMonth = q * 3 + 2;
    return {
      from: ymd(y, q * 3, 1),
      to: ymd(y, endMonth, lastDayOfMonth(y, endMonth)),
      label: `T${q + 1} ${y}`,
    };
  }
  const m = anchor.getMonth();
  return { from: ymd(y, m, 1), to: ymd(y, m, lastDayOfMonth(y, m)), label: monthLabel(y, m) };
}

export function shiftAnchor(anchor: Date, g: Granularity, dir: number): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  if (g === 'annee') d.setFullYear(d.getFullYear() + dir);
  else if (g === 'trimestre') d.setMonth(d.getMonth() + dir * 3);
  else d.setMonth(d.getMonth() + dir);
  return d;
}

export interface ReportData {
  recettesCents: Cents; depensesCents: Cents; soldeCents: Cents;
  byCategory: { name: string; valueCents: Cents }[];
  byMonth: { mois: string; recettesCents: Cents; depensesCents: Cents }[];
  balanceCurve: { date: Ymd; soldeCents: Cents }[];
}

export const reportService = {
  async build(dbId: string, accountId: string | undefined, range: Range): Promise<ReportData> {
    const [ops, cats] = await Promise.all([
      operationService.list(dbId, { accountId, from: range.from, to: range.to }),
      categoryService.listCategories(dbId, true),
    ]);
    const catName = (id?: string) => cats.find(c => c.id === id)?.name ?? 'Sans catégorie';

    let recettesCents = 0, depensesCents = 0;
    const catMap: Record<string, Cents> = {};
    const monthMap: Record<string, { recettesCents: Cents; depensesCents: Cents }> = {};

    for (const o of ops) {
      // Un virement déplace de l'argent sans créer ni recette ni dépense.
      if (o.kind === 'virement') continue;
      const mk = monthKey(o.date);
      monthMap[mk] ??= { recettesCents: 0, depensesCents: 0 };
      if (o.amountCents >= 0) {
        recettesCents += o.amountCents;
        monthMap[mk].recettesCents += o.amountCents;
      } else {
        depensesCents += -o.amountCents;
        monthMap[mk].depensesCents += -o.amountCents;
        const key = catName(o.categoryId);
        catMap[key] = (catMap[key] ?? 0) + -o.amountCents;
      }
    }

    // Courbe de solde cumulée : les virements comptent ici, car ils modifient
    // bien la trésorerie du compte observé.
    const startCents = accountId
      ? await accountService.balance(accountId, previousDay(range.from))
      : await accountService.totalBalance(dbId, previousDay(range.from));
    const chrono = [...ops].sort((a, b) => a.date.localeCompare(b.date));
    let run = startCents;
    const balanceCurve = chrono.map(o => { run += o.amountCents; return { date: o.date, soldeCents: run }; });

    return {
      recettesCents, depensesCents, soldeCents: recettesCents - depensesCents,
      byCategory: Object.entries(catMap)
        .map(([name, valueCents]) => ({ name, valueCents }))
        .sort((a, b) => b.valueCents - a.valueCents),
      byMonth: Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b))
        .map(([mois, v]) => ({ mois, ...v })),
      balanceCurve,
    };
  },
};

/** Veille d'une date civile — borne du solde d'ouverture de la période. */
function previousDay(date: Ymd): Ymd {
  const [y, m, d] = date.split('-').map(Number);
  const prev = new Date(y, m - 1, d, 12);
  prev.setDate(prev.getDate() - 1);
  return ymd(prev.getFullYear(), prev.getMonth(), prev.getDate());
}

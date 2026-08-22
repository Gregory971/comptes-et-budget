import { db, uid, stamp } from './db';
import { operationService } from './operationService';
import { addMonthsAnchored, addYearsAnchored, dayOfMonth, today, type Ymd } from '../utils/date';
import { applyHolidayRule, shiftReason, type HolidayRule, type Region } from '../utils/holidays';
import type { Schedule, Kind, Periodicity, Cents } from '../types';

/**
 * Prochaine occurrence théorique, en date civile (aucune conversion de fuseau).
 *
 * `anchorDay` est le quantième d'origine de l'échéance. Il est indispensable :
 * sans lui, chaque calcul repart de la date déjà écrêtée par un mois court et
 * la dérive devient définitive (31/01 → 28/02 → 28/03 → 28/04…). À défaut, on
 * retombe sur le quantième de la date fournie — comportement des bases
 * antérieures à la v6.
 */
export function advance(date: Ymd, p: Periodicity, anchorDay = dayOfMonth(date)): Ymd {
  if (p === 'mensuelle') return addMonthsAnchored(date, 1, anchorDay);
  if (p === 'trimestrielle') return addMonthsAnchored(date, 3, anchorDay);
  if (p === 'annuelle') return addYearsAnchored(date, 1, anchorDay);
  return date;
}

/** Quantième de référence d'une échéance, avec repli sur sa prochaine date. */
export const anchorOf = (s: Pick<Schedule, 'nextDate' | 'anchorDay'>): number =>
  s.anchorDay ?? dayOfMonth(s.nextDate);

const sign = (kind: Kind, cents: Cents) => (kind === 'depense' ? -Math.abs(cents) : Math.abs(cents));

export interface ScheduleInput {
  dbId: string; accountId: string; amountCents: Cents; kind: Kind; periodicity: Periodicity;
  nextDate: Ymd; endDate?: Ymd; autoPost: boolean; holidayRule: HolidayRule;
  /** Quantième de référence ; déduit de nextDate s'il n'est pas fourni. */
  anchorDay?: number;
  payeeId?: string; categoryId?: string; paymentMethodId?: string;
  label?: string; reference?: string; note?: string;
  assetId?: string; projectId?: string;
}

/** Occurrence à venir, telle qu'elle sera réellement comptabilisée. */
export interface Occurrence {
  /** Date théorique portée par l'échéance. */
  plannedDate: Ymd;
  /** Date effective après application de la règle de jour férié. */
  effectiveDate: Ymd;
  /** Motif du report (« Noël », « samedi »…), null si aucun report. */
  reason: string | null;
}

/** Calcule la date effective d'une échéance selon sa règle de jour férié. */
export function occurrenceOf(schedule: Schedule, region: Region): Occurrence {
  const effectiveDate = applyHolidayRule(schedule.nextDate, schedule.holidayRule, region);
  return {
    plannedDate: schedule.nextDate,
    effectiveDate,
    reason: effectiveDate === schedule.nextDate ? null : shiftReason(schedule.nextDate, region),
  };
}

/** Les n prochaines occurrences, bornées par la date de fin. */
export function nextOccurrences(schedule: Schedule, region: Region, count = 3): Occurrence[] {
  const out: Occurrence[] = [];
  let planned = schedule.nextDate;
  for (let i = 0; i < count; i++) {
    if (schedule.endDate && planned > schedule.endDate) break;
    const effectiveDate = applyHolidayRule(planned, schedule.holidayRule, region);
    out.push({
      plannedDate: planned,
      effectiveDate,
      reason: effectiveDate === planned ? null : shiftReason(planned, region),
    });
    if (schedule.periodicity === 'unique') break;
    planned = advance(planned, schedule.periodicity, anchorOf(schedule));
  }
  return out;
}

export const scheduleService = {
  list: (dbId: string) =>
    db.schedules.where('dbId').equals(dbId).toArray()
      .then(r => r.sort((a, b) => a.nextDate.localeCompare(b.nextDate))),

  /** Échéances actives dont la date théorique est atteinte ou dépassée. */
  async due(dbId: string, at: Ymd = today()): Promise<Schedule[]> {
    const rows = await db.schedules.where('[dbId+nextDate]')
      .between([dbId, '0000-01-01'], [dbId, at], true, true).toArray();
    return rows.filter(s => s.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  },

  /** Échéances échues attendant une confirmation manuelle. */
  async pendingManual(dbId: string, at: Ymd = today()): Promise<Schedule[]> {
    return (await this.due(dbId, at)).filter(s => !s.autoPost);
  },

  async create(input: ScheduleInput): Promise<Schedule> {
    const s: Schedule = {
      id: uid(), active: true, updatedAt: stamp(),
      ...input, amountCents: sign(input.kind, input.amountCents),
      // Le quantième saisi fait foi pour toutes les occurrences suivantes.
      anchorDay: input.anchorDay ?? dayOfMonth(input.nextDate),
    };
    await db.schedules.add(s);
    return s;
  },

  /**
   * Modification d'une échéance. Changer la date de la prochaine occurrence
   * redéfinit le jour d'ancrage : déplacer un prélèvement au 5 doit le fixer au
   * 5, non le laisser revenir au quantième d'origine.
   */
  update: (id: string, patch: Partial<Schedule>) =>
    db.schedules.update(id, {
      ...patch,
      ...(patch.nextDate && patch.anchorDay === undefined
        ? { anchorDay: dayOfMonth(patch.nextDate) } : {}),
      updatedAt: stamp(),
    }),
  remove: (id: string) => db.schedules.delete(id),

  /**
   * « Comptabiliser » : crée l'opération réelle puis avance l'échéance.
   *
   * L'opération porte la date EFFECTIVE (après report éventuel d'un jour férié
   * ou d'un week-end), tandis que la prochaine échéance est calculée depuis la
   * date THÉORIQUE : un prélèvement du 15 reste au 15 le mois suivant, même si
   * ce mois-ci il a été reporté au 17.
   */
  async post(id: string, region: Region = 'metropole'): Promise<void> {
    const s = await db.schedules.get(id);
    if (!s || !s.active) return;

    const { effectiveDate } = occurrenceOf(s, region);
    await operationService.create({
      dbId: s.dbId, accountId: s.accountId, date: effectiveDate,
      amountCents: Math.abs(s.amountCents), kind: s.kind,
      payeeId: s.payeeId, categoryId: s.categoryId, paymentMethodId: s.paymentMethodId,
      label: s.label, reference: s.reference, note: s.note,
      assetId: s.assetId, projectId: s.projectId,
    });

    if (s.periodicity === 'unique') {
      await this.update(id, { active: false, lastPostedDate: effectiveDate });
      return;
    }
    const anchorDay = anchorOf(s);
    const next = advance(s.nextDate, s.periodicity, anchorDay);
    // La programmation s'arrête d'elle-même une fois la date de fin dépassée.
    const finished = Boolean(s.endDate && next > s.endDate);
    // anchorDay est réaffirmé : sans lui, update() le redéduirait de la
    // nouvelle date — soit 28 après un passage par février, et la dérive que
    // cette correction supprime reviendrait par la porte de service.
    await this.update(id, {
      nextDate: next, anchorDay, lastPostedDate: effectiveDate, active: !finished,
    });
  },

  /**
   * Comptabilisation automatique au lancement de l'application.
   * Rattrape toutes les occurrences échues (plusieurs mois d'absence compris),
   * dans l'ordre chronologique, en s'arrêtant à la date de fin.
   */
  async runAutoPost(dbId: string, region: Region, at: Ymd = today()): Promise<number> {
    let posted = 0;
    // Garde-fou : évite toute boucle infinie si une donnée est incohérente.
    for (let guard = 0; guard < 500; guard++) {
      const due = (await this.due(dbId, at)).filter(s => s.autoPost);
      if (due.length === 0) break;
      await this.post(due[0].id, region);
      posted++;
    }
    return posted;
  },
};

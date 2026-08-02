import { fromYmd, toYmd, ymd, type Ymd } from './date';

/**
 * Jours fériés légaux français et règle de report des échéances.
 *
 * Sources :
 *  · Code du travail, art. L3133-1 — les 11 jours fériés nationaux ;
 *  · Code du travail, art. L3422-2 — commémoration de l'abolition de
 *    l'esclavage : 27 mai en Guadeloupe et à Saint-Martin, 22 mai en
 *    Martinique, 10 juin en Guyane, 27 avril à Mayotte, 9 octobre à
 *    Saint-Barthélemy, 20 décembre à La Réunion.
 *
 * Le Vendredi saint et le 26 décembre ne sont fériés qu'en Alsace-Moselle
 * (art. L3134-13) : ils ne s'appliquent pas à la Guadeloupe. Les jours gras
 * (lundi et mardi du carnaval) et la mi-carême relèvent de l'usage local, non
 * de la loi — ils ne figurent donc pas dans ce calendrier.
 */

export type Region =
  | 'metropole' | 'guadeloupe' | 'martinique' | 'guyane'
  | 'reunion' | 'mayotte' | 'saint-barthelemy';

export const REGION_LABEL: Record<Region, string> = {
  metropole: 'France métropolitaine',
  guadeloupe: 'Guadeloupe / Saint-Martin',
  martinique: 'Martinique',
  guyane: 'Guyane',
  reunion: 'La Réunion',
  mayotte: 'Mayotte',
  'saint-barthelemy': 'Saint-Barthélemy',
};

/** Dimanche de Pâques — algorithme de Meeus/Jones/Butcher (grégorien). */
export function easterSunday(year: number): Ymd {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);   // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month - 1, day);
}

/** Décale une date civile de n jours. */
export function addDays(date: Ymd, n: number): Ymd {
  const d = fromYmd(date);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

/** Commémoration locale de l'abolition de l'esclavage (art. L3422-2). */
function abolitionDay(year: number, region: Region): Ymd | null {
  switch (region) {
    case 'guadeloupe': return ymd(year, 4, 27);          // 27 mai
    case 'martinique': return ymd(year, 4, 22);          // 22 mai
    case 'guyane': return ymd(year, 5, 10);              // 10 juin
    case 'mayotte': return ymd(year, 3, 27);             // 27 avril
    case 'saint-barthelemy': return ymd(year, 9, 9);     // 9 octobre
    case 'reunion': return ymd(year, 11, 20);            // 20 décembre
    default: return null;
  }
}

/** Jours fériés d'une année, avec leur intitulé. */
export function holidaysOfYear(year: number, region: Region = 'metropole'): Map<Ymd, string> {
  const easter = easterSunday(year);
  const days = new Map<Ymd, string>([
    [ymd(year, 0, 1), 'Jour de l’An'],
    [addDays(easter, 1), 'Lundi de Pâques'],
    [ymd(year, 4, 1), 'Fête du Travail'],
    [ymd(year, 4, 8), 'Victoire 1945'],
    [addDays(easter, 39), 'Ascension'],
    [addDays(easter, 50), 'Lundi de Pentecôte'],
    [ymd(year, 6, 14), 'Fête nationale'],
    [ymd(year, 7, 15), 'Assomption'],
    [ymd(year, 10, 1), 'Toussaint'],
    [ymd(year, 10, 11), 'Armistice 1918'],
    [ymd(year, 11, 25), 'Noël'],
  ]);
  const abolition = abolitionDay(year, region);
  if (abolition) days.set(abolition, 'Abolition de l’esclavage');
  return days;
}

const cache = new Map<string, Map<Ymd, string>>();

function holidaysCached(year: number, region: Region): Map<Ymd, string> {
  const key = `${region}-${year}`;
  let found = cache.get(key);
  if (!found) { found = holidaysOfYear(year, region); cache.set(key, found); }
  return found;
}

/** Intitulé du jour férié, ou null. */
export function holidayName(date: Ymd, region: Region = 'metropole'): string | null {
  return holidaysCached(Number(date.slice(0, 4)), region).get(date) ?? null;
}

export const isHoliday = (date: Ymd, region: Region = 'metropole') =>
  holidayName(date, region) !== null;

/** Samedi ou dimanche. */
export function isWeekend(date: Ymd): boolean {
  const day = fromYmd(date).getDay();
  return day === 0 || day === 6;
}

/** Jour ouvré : ni week-end, ni jour férié. */
export const isBusinessDay = (date: Ymd, region: Region = 'metropole') =>
  !isWeekend(date) && !isHoliday(date, region);

export function nextBusinessDay(date: Ymd, region: Region = 'metropole'): Ymd {
  let d = date;
  for (let i = 0; i < 15 && !isBusinessDay(d, region); i++) d = addDays(d, 1);
  return d;
}

export function previousBusinessDay(date: Ymd, region: Region = 'metropole'): Ymd {
  let d = date;
  for (let i = 0; i < 15 && !isBusinessDay(d, region); i++) d = addDays(d, -1);
  return d;
}

/** Règle appliquée lorsqu'une échéance tombe un jour férié ou non ouvré. */
export type HolidayRule = 'suivant' | 'precedent' | 'exacte';

export const HOLIDAY_RULE_LABEL: Record<HolidayRule, string> = {
  suivant: 'Comptabiliser le jour ouvrable suivant',
  precedent: 'Comptabiliser le jour ouvrable précédent',
  exacte: 'Comptabiliser à la date exacte',
};

/** Date effective de comptabilisation d'une échéance. */
export function applyHolidayRule(
  date: Ymd, rule: HolidayRule, region: Region = 'metropole',
): Ymd {
  if (rule === 'exacte' || isBusinessDay(date, region)) return date;
  return rule === 'precedent' ? previousBusinessDay(date, region) : nextBusinessDay(date, region);
}

/** Motif du report, à afficher à l'utilisateur (null si aucun report). */
export function shiftReason(date: Ymd, region: Region = 'metropole'): string | null {
  const name = holidayName(date, region);
  if (name) return name;
  if (!isWeekend(date)) return null;
  return fromYmd(date).getDay() === 6 ? 'samedi' : 'dimanche';
}

// Dates civiles « AAAA-MM-JJ » — jamais d'horodatage UTC pour les dates métier.
//
// Correction P1 : les bornes de période étaient construites avec
// new Date(y, m, 1).toISOString(), c.-à-d. minuit LOCAL converti en UTC, alors que
// les opérations étaient enregistrées à minuit UTC. En zone UTC négative
// (Guadeloupe, UTC−4) la fenêtre mensuelle se décalait d'un jour : les opérations
// du 1er du mois sortaient du relevé. Une date civile pure supprime la classe
// entière de bugs : la comparaison lexicographique de « AAAA-MM-JJ » est
// équivalente à la comparaison chronologique, quel que soit le fuseau.

export type Ymd = string; // 'AAAA-MM-JJ'

const pad = (n: number) => String(n).padStart(2, '0');

/** Date civile d'un objet Date, lue dans le fuseau LOCAL (jamais toISOString). */
export function toYmd(d: Date): Ymd {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date civile du jour, dans le fuseau de l'utilisateur. */
export const today = (): Ymd => toYmd(new Date());

/** Construit une date civile à partir de ses composants (mois 0-indexé). */
export const ymd = (y: number, m: number, d: number): Ymd => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Objet Date à midi local — évite tout basculement de jour lors des calculs. */
export function fromYmd(s: Ymd): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

/** Normalise une valeur héritée (ISO horodaté ou date civile) en date civile. */
export function normalizeYmd(value: string): Ymd {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // Les anciennes valeurs étaient produites par new Date('AAAA-MM-JJ').toISOString(),
  // donc minuit UTC : les 10 premiers caractères portent la bonne date civile.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? today() : toYmd(d);
}

/** Dernier jour du mois (mois 0-indexé). */
export const lastDayOfMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Décale une date civile de n mois, en bornant au dernier jour du mois cible. */
export function addMonths(date: Ymd, n: number): Ymd {
  const [y, m, d] = date.split('-').map(Number);
  const total = (m - 1) + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  return ymd(ty, tm, Math.min(d, lastDayOfMonth(ty, tm)));
}

export function addYears(date: Ymd, n: number): Ymd {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(y + n, m - 1, Math.min(d, lastDayOfMonth(y + n, m - 1)));
}

/** Quantième d'une date civile (1 à 31). */
export const dayOfMonth = (date: Ymd): number => Number(date.slice(8, 10));

/**
 * Décale une date civile de n mois en conservant un JOUR D'ANCRAGE.
 *
 * addMonths borne au dernier jour du mois cible, ce qui est correct pour un
 * décalage isolé mais faux quand on enchaîne les décalages : un prélèvement du
 * 31 janvier devenait le 28 février, puis le 28 mars, puis le 28 avril — la
 * date de prélèvement dérivait définitivement dès qu'elle rencontrait un mois
 * court. En repartant du jour d'ancrage à chaque calcul, le 31 redevient le 31
 * dès que le mois cible le permet : 31/01 → 28/02 → 31/03 → 30/04 → 31/05.
 */
export function addMonthsAnchored(date: Ymd, n: number, anchorDay: number): Ymd {
  const [y, m] = date.split('-').map(Number);
  const total = (m - 1) + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  return ymd(ty, tm, Math.min(anchorDay, lastDayOfMonth(ty, tm)));
}

/** Décale d'une année en conservant le jour d'ancrage (29 février compris). */
export function addYearsAnchored(date: Ymd, n: number, anchorDay: number): Ymd {
  const [y, m] = date.split('-').map(Number);
  return ymd(y + n, m - 1, Math.min(anchorDay, lastDayOfMonth(y + n, m - 1)));
}

/** Bornes inclusives d'un mois. */
export function monthRange(y: number, m: number): { from: Ymd; to: Ymd } {
  return { from: ymd(y, m, 1), to: ymd(y, m, lastDayOfMonth(y, m)) };
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const monthLabel = (y: number, m: number) => `${MONTHS[m]} ${y}`;

/** Affichage français JJ/MM/AAAA à partir d'une date civile. */
export function formatFr(date: Ymd): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** Clé de mois « AAAA-MM » utilisée pour les agrégats. */
export const monthKey = (date: Ymd): string => date.slice(0, 7);

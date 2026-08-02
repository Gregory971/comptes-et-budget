// Montants en centimes entiers.
//
// Correction P3 : les euros étaient stockés en Number flottant. Les cumuls répétés
// (soldes courants, courbes, agrégats) accumulaient des erreurs de représentation
// binaire — 0.1 + 0.2 !== 0.3. En centimes entiers, toute addition est exacte tant
// que l'on reste sous Number.MAX_SAFE_INTEGER (soit ~90 000 milliards d'euros).

export type Cents = number;

/** Euros (nombre) → centimes entiers. */
export const toCents = (euros: number): Cents => Math.round(euros * 100);

/** Centimes → euros (pour l'affichage et les champs de saisie uniquement). */
export const toEuros = (cents: Cents): number => cents / 100;

/**
 * Analyse une saisie utilisateur française ou anglaise.
 * Accepte « 12,50 », « 12.50 », « 1 234,56 », « 1234.56 », « -12,50 ».
 * Renvoie null si la saisie est invalide (au lieu d'un NaN silencieux).
 *
 * Correction P2 : input type="number" + parseFloat refusait la virgule sur
 * plusieurs navigateurs ; le bouton « Enregistrer » restait alors sans effet.
 */
export function parseEuro(input: string): Cents | null {
  const cleaned = input
    .replace(/[\s\u00A0\u202F]/g, '')   // espaces ordinaires, insécables et fines
    .replace(/€/g, '')
    .replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return toCents(n);
}

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const NUM = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** « 1 234,56 € » */
export const formatEur = (cents: Cents): string => EUR.format(toEuros(cents || 0));
/** « 1 234,56 » (sans symbole, pour les colonnes chiffrées) */
export const formatNum = (cents: Cents): string => NUM.format(toEuros(cents || 0));
/** « 1 235 » (axes de graphiques) */
export const formatInt = (cents: Cents): string => INT.format(Math.round(toEuros(cents || 0)));

/** Valeur d'un champ de saisie à partir de centimes (« 12.50 »). */
export const centsToInput = (cents: Cents): string => (cents / 100).toFixed(2);

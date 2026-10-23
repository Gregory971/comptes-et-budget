import { db, uid, stamp } from './db';
import type { Account, Cents, Currency, Operation } from '../types';

/**
 * Devises étrangères.
 *
 * Règle d'ensemble, volontairement simple : chaque compte est tenu dans SA
 * devise (celle de la base, l'euro, quand il n'en déclare pas). Un compte étranger
 * affiche donc ses soldes et ses opérations dans sa devise. Toute vue qui MÉLANGE
 * plusieurs comptes — solde total, bilans, budgets, prévisions, « Tous les
 * comptes » — est exprimée en devise de la base, au taux enregistré ici. Ce taux
 * est celui du jour que l'utilisateur saisit : il n'y a pas d'historique de taux,
 * et aucune requête réseau (connect-src 'none').
 *
 * `rate` = combien de devise de la base vaut UNE unité de la devise étrangère
 * (1 USD = 0,92 EUR → rate 0,92).
 */

/** Convertit un montant avec un taux, au centime le plus proche. */
export const convert = (cents: Cents, rate: number): Cents => (rate === 1 ? cents : Math.round(cents * rate));

/** Copie des opérations avec montants (et parts de ventilation) ramenés à la devise de la base. */
export function convertOperations(ops: Operation[], rates: Record<string, number>): Operation[] {
  return ops.map(o => {
    const k = rates[o.accountId] ?? 1;
    if (k === 1) return o;
    return {
      ...o, amountCents: convert(o.amountCents, k),
      splits: o.splits?.map(s => ({ ...s, amountCents: convert(s.amountCents, k) })),
    };
  });
}

/** Code ISO 4217 : trois lettres majuscules. */
const CODE = /^[A-Z]{3}$/;

export function validateCurrency(input: { code: string; name: string; rate: number }, baseCode: string): string | null {
  if (!CODE.test(input.code)) return 'Le code de la devise comporte trois lettres majuscules (exemple : USD).';
  if (input.code === baseCode) return `${baseCode} est déjà la devise de la base.`;
  if (!input.name.trim()) return 'Le nom de la devise est obligatoire.';
  if (!Number.isFinite(input.rate) || input.rate <= 0) return 'Le taux de change doit être un nombre supérieur à zéro.';
  if (input.rate > 1_000_000) return 'Le taux de change est invraisemblable.';
  return null;
}

/** Taux à appliquer à un compte : 1 pour la devise de la base ou une devise inconnue. */
export function rateOfAccount(account: Pick<Account, 'currency'>, currencies: Currency[]): number {
  if (!account.currency) return 1;
  return currencies.find(c => c.code === account.currency)?.rate ?? 1;
}

export const currencyService = {
  list: async (dbId: string): Promise<Currency[]> =>
    (await db.currencies.where('dbId').equals(dbId).toArray()).sort((a, b) => a.code.localeCompare(b.code)),

  async baseCode(dbId: string): Promise<string> {
    return (await db.databases.get(dbId))?.currency ?? 'EUR';
  },

  async create(input: { dbId: string; code: string; name: string; rate: number }): Promise<Currency> {
    const code = input.code.trim().toUpperCase();
    const problem = validateCurrency({ ...input, code }, await this.baseCode(input.dbId));
    if (problem) throw new Error(problem);
    if ((await this.list(input.dbId)).some(c => c.code === code)) {
      throw new Error(`La devise ${code} existe déjà.`);
    }
    const row: Currency = { id: uid(), dbId: input.dbId, code, name: input.name.trim(), rate: input.rate, updatedAt: stamp() };
    await db.currencies.add(row);
    return row;
  },

  async update(id: string, patch: { name?: string; rate?: number }): Promise<void> {
    const cur = await db.currencies.get(id);
    if (!cur) return;
    const next = { code: cur.code, name: patch.name ?? cur.name, rate: patch.rate ?? cur.rate };
    const problem = validateCurrency(next, await this.baseCode(cur.dbId));
    if (problem) throw new Error(problem);
    await db.currencies.update(id, { name: next.name.trim(), rate: next.rate, updatedAt: stamp() });
  },

  /** Refuse de supprimer une devise encore portée par un compte. */
  async remove(id: string): Promise<void> {
    const cur = await db.currencies.get(id);
    if (!cur) return;
    const used = (await db.accounts.where('dbId').equals(cur.dbId).toArray()).filter(a => a.currency === cur.code);
    if (used.length > 0) {
      throw new Error(`Impossible : ${used.length > 1 ? 'des comptes utilisent' : `le compte « ${used[0].name} » utilise`} la devise ${cur.code}.`);
    }
    await db.currencies.delete(id);
  },

  /** Taux de chaque compte de la base (identifiant → taux), 1 pour la devise de la base. */
  async rates(dbId: string): Promise<Record<string, number>> {
    const [accounts, currencies] = await Promise.all([
      db.accounts.where('dbId').equals(dbId).toArray(),
      this.list(dbId),
    ]);
    const out: Record<string, number> = {};
    for (const a of accounts) out[a.id] = rateOfAccount(a, currencies);
    return out;
  },
};

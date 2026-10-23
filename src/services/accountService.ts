import { db, uid, stamp } from './db';
import type { Account, AccountType, Ymd, Cents } from '../types';

/** Favoris d'abord, puis par groupe (sans groupe en dernier), puis par nom. */
export function compareAccounts(a: Account, b: Account): number {
  if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
  const ga = a.group?.trim() ?? '', gb = b.group?.trim() ?? '';
  if (ga !== gb) {
    if (!ga) return 1;
    if (!gb) return -1;
    return ga.localeCompare(gb, 'fr');
  }
  return a.name.localeCompare(b.name, 'fr');
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  courant: 'Compte courant', epargne: 'Épargne', especes: 'Espèces', carte: 'Carte', pret: 'Prêt',
};

/** Un prêt est une dette, pas de la trésorerie : il n'entre pas dans le solde total. */
export const isCash = (a: Pick<Account, 'type'>): boolean => a.type !== 'pret';

export const accountService = {
  /**
   * Comptes actifs par défaut ; les comptes archivés ET masqués sont exclus
   * partout. Avec `includeArchived`, tout est renvoyé — c'est la vue de gestion
   * de l'écran Comptes. Favoris en tête, puis groupe, puis nom.
   */
  async list(dbId: string, includeArchived = false): Promise<Account[]> {
    const rows = await db.accounts.where('dbId').equals(dbId).toArray();
    return (includeArchived ? rows : rows.filter(a => !a.archived && !a.hidden))
      .sort(compareAccounts);
  },

  async create(input: {
    dbId: string; name: string; type: AccountType;
    initialBalanceCents: Cents; startDate: Ymd; logo?: string;
    group?: string; number?: string; favorite?: boolean; hidden?: boolean;
  }): Promise<Account> {
    const acc: Account = { id: uid(), archived: false, updatedAt: stamp(), ...input };
    await db.accounts.add(acc);
    return acc;
  },

  update: (id: string, patch: Partial<Account>) =>
    db.accounts.update(id, { ...patch, updatedAt: stamp() }),
  archive: (id: string) => db.accounts.update(id, { archived: true, updatedAt: stamp() }),
  unarchive: (id: string) => db.accounts.update(id, { archived: false, updatedAt: stamp() }),

  /**
   * Optimisation P2 : un seul balayage de l'index [dbId+date] renvoie les soldes
   * de TOUS les comptes. L'ancienne version relisait l'intégralité de l'historique
   * une fois par compte, dans une boucle séquentielle (N+1 requêtes par écran).
   */
  async balances(dbId: string, upTo?: Ymd): Promise<Record<string, Cents>> {
    const limit = upTo ?? '9999-12-31';
    const [accounts, ops] = await Promise.all([
      this.list(dbId, true),
      db.operations.where('[dbId+date]')
        .between([dbId, '0000-01-01'], [dbId, limit], true, true).toArray(),
    ]);
    const out: Record<string, Cents> = {};
    for (const a of accounts) out[a.id] = a.initialBalanceCents;
    for (const o of ops) {
      if (o.deletedAt) continue;
      if (out[o.accountId] !== undefined) out[o.accountId] += o.amountCents;
    }
    return out;
  },

  /** Solde d'un compte à une date donnée (bornes incluses). */
  async balance(accountId: string, upTo?: Ymd): Promise<Cents> {
    const acc = await db.accounts.get(accountId);
    if (!acc) return 0;
    const ops = await db.operations.where('[accountId+date]')
      .between([accountId, '0000-01-01'], [accountId, upTo ?? '9999-12-31'], true, true)
      .toArray();
    return ops.reduce((s, o) => (o.deletedAt ? s : s + o.amountCents), acc.initialBalanceCents);
  },

  /** Somme des soldes des comptes actifs, hors prêts (dettes). */
  async totalBalance(dbId: string, upTo?: Ymd): Promise<Cents> {
    const [balances, accounts] = await Promise.all([this.balances(dbId, upTo), this.list(dbId)]);
    return accounts.filter(isCash).reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  },
};

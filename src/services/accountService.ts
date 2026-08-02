import { db, uid, stamp } from './db';
import type { Account, AccountType, Ymd, Cents } from '../types';

export const accountService = {
  /** Comptes actifs par défaut ; les comptes archivés sont exclus partout. */
  async list(dbId: string, includeArchived = false): Promise<Account[]> {
    const rows = await db.accounts.where('dbId').equals(dbId).toArray();
    return (includeArchived ? rows : rows.filter(a => !a.archived))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },

  async create(input: {
    dbId: string; name: string; type: AccountType;
    initialBalanceCents: Cents; startDate: Ymd; logo?: string;
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

  /** Somme des soldes des comptes actifs. */
  async totalBalance(dbId: string, upTo?: Ymd): Promise<Cents> {
    const [balances, accounts] = await Promise.all([this.balances(dbId, upTo), this.list(dbId)]);
    return accounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  },
};

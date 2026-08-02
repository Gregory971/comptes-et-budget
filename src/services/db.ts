import Dexie, { type Table, type Transaction } from 'dexie';
import type {
  Database, Account, Payee, CategoryGroup, Category,
  PaymentMethod, Operation, Preferences, Schedule, Budget, Asset, Project,
} from '../types';
import { normalizeYmd, today } from '../utils/date';
import { toCents } from '../utils/money';

/** Version du modèle de données ; reportée dans Database.schemaVersion. */
export const SCHEMA_VERSION = 5;

export class AppDB extends Dexie {
  databases!: Table<Database, string>;
  accounts!: Table<Account, string>;
  payees!: Table<Payee, string>;
  categoryGroups!: Table<CategoryGroup, string>;
  categories!: Table<Category, string>;
  paymentMethods!: Table<PaymentMethod, string>;
  operations!: Table<Operation, string>;
  preferences!: Table<Preferences, string>;
  schedules!: Table<Schedule, string>;
  budgets!: Table<Budget, string>;
  assets!: Table<Asset, string>;
  projects!: Table<Project, string>;

  constructor(name = 'comptes-budget') {
    super(name);
    this.version(1).stores({
      databases: 'id',
      accounts: 'id, dbId',
      payees: 'id, dbId',
      categoryGroups: 'id, dbId',
      categories: 'id, dbId, groupId',
      paymentMethods: 'id, dbId',
      operations: 'id, dbId, accountId, date, categoryId',
      preferences: 'id, dbId',
    });
    // v2 : échéances (opérations programmées) + budgets prévisionnels
    this.version(2).stores({
      schedules: 'id, dbId, accountId, nextDate',
      budgets: 'id, dbId, categoryId',
    });
    // v3 : patrimoine (biens) + projets d'épargne
    this.version(3).stores({
      assets: 'id, dbId',
      projects: 'id, dbId',
    });
    // v4 : dates civiles, montants en centimes, index composés, traçabilité.
    this.version(4).stores({
      // Index composés : permettent de ne lire que la tranche de dates utile
      // au lieu de charger tout l'historique puis de filtrer en mémoire.
      operations: 'id, dbId, accountId, date, categoryId, payeeId, transferId, [dbId+date], [accountId+date]',
      accounts: 'id, dbId, [dbId+archived]',
      schedules: 'id, dbId, accountId, nextDate, [dbId+nextDate]',
      budgets: 'id, dbId, categoryId, [dbId+categoryId]',
      categories: 'id, dbId, groupId, [dbId+groupId]',
    }).upgrade(migrateToV4);
    // v5 : échéances complètes (fin de programmation, comptabilisation
    // automatique, règle de jour férié) et saisie enrichie (référence,
    // commentaire, rattachement à un bien ou à un projet).
    this.version(5).stores({
      operations: 'id, dbId, accountId, date, categoryId, payeeId, transferId, assetId, projectId, [dbId+date], [accountId+date]',
    }).upgrade(migrateToV5);
  }
}

/** Conversion des bases existantes : ISO → date civile, euros → centimes. */
async function migrateToV4(tx: Transaction): Promise<void> {
  const stamp = new Date().toISOString();
  const legacy = (row: Record<string, unknown>, key: string): number =>
    typeof row[key] === 'number' ? (row[key] as number) : 0;

  await tx.table('operations').toCollection().modify((o: Record<string, unknown>) => {
    if (o.amountCents === undefined) o.amountCents = toCents(legacy(o, 'amount'));
    delete o.amount;
    o.date = normalizeYmd(String(o.date ?? today()));
    o.updatedAt ??= (o.createdAt as string) ?? stamp;
  });

  await tx.table('accounts').toCollection().modify((a: Record<string, unknown>) => {
    if (a.initialBalanceCents === undefined) a.initialBalanceCents = toCents(legacy(a, 'initialBalance'));
    delete a.initialBalance;
    a.startDate = normalizeYmd(String(a.startDate ?? today()));
    a.archived ??= false;
    a.updatedAt ??= stamp;
  });

  await tx.table('schedules').toCollection().modify((s: Record<string, unknown>) => {
    if (s.amountCents === undefined) s.amountCents = toCents(legacy(s, 'amount'));
    delete s.amount;
    s.nextDate = normalizeYmd(String(s.nextDate ?? today()));
    s.updatedAt ??= stamp;
  });

  await tx.table('budgets').toCollection().modify((b: Record<string, unknown>) => {
    if (b.monthlyAmountCents === undefined) b.monthlyAmountCents = toCents(legacy(b, 'monthlyAmount'));
    delete b.monthlyAmount;
    b.updatedAt ??= stamp;
  });

  await tx.table('assets').toCollection().modify((a: Record<string, unknown>) => {
    if (a.valueCents === undefined) a.valueCents = toCents(legacy(a, 'value'));
    delete a.value;
    if (a.acquiredDate) a.acquiredDate = normalizeYmd(String(a.acquiredDate));
    a.updatedAt ??= stamp;
  });

  await tx.table('projects').toCollection().modify((p: Record<string, unknown>) => {
    if (p.targetAmountCents === undefined) p.targetAmountCents = toCents(legacy(p, 'targetAmount'));
    if (p.savedAmountCents === undefined) p.savedAmountCents = toCents(legacy(p, 'savedAmount'));
    delete p.targetAmount; delete p.savedAmount;
    if (p.deadline) p.deadline = normalizeYmd(String(p.deadline));
    p.updatedAt ??= stamp;
  });

  await tx.table('categoryGroups').toCollection().modify((g: Record<string, unknown>) => {
    g.archived ??= false;
    g.updatedAt ??= stamp;
  });

  for (const name of ['payees', 'categories', 'paymentMethods', 'preferences', 'databases']) {
    await tx.table(name).toCollection().modify((r: Record<string, unknown>) => {
      r.updatedAt ??= stamp;
      if (name !== 'databases' && name !== 'preferences') r.archived ??= false;
    });
  }

  await tx.table('databases').toCollection().modify((d: Record<string, unknown>) => {
    d.profile ??= 'perso';
    d.schemaVersion = SCHEMA_VERSION;
  });
}

/** Valeurs par défaut des échéances, appliquées aux bases antérieures. */
async function migrateToV5(tx: Transaction): Promise<void> {
  const at = new Date().toISOString();
  await tx.table('schedules').toCollection().modify((s: Record<string, unknown>) => {
    // Comportement historique : comptabilisation manuelle, sans report ni fin.
    s.autoPost ??= false;
    s.holidayRule ??= 'suivant';
    s.updatedAt = at;
  });
  await tx.table('databases').toCollection().modify((d: Record<string, unknown>) => {
    d.holidayRegion ??= 'metropole';
    d.schemaVersion = SCHEMA_VERSION;
  });
}

export const db = new AppDB();

/** Identifiant unique : crypto.randomUUID si disponible, repli sinon. */
export const uid = (): string => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
};

/** Horodatage de modification, à poser sur toute écriture. */
export const stamp = (): string => new Date().toISOString();

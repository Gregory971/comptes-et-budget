import { db, uid, stamp, SCHEMA_VERSION } from './db';
import { dbService } from './dbService';
import { toCents } from '../utils/money';
import { normalizeYmd, today, toYmd } from '../utils/date';
import type {
  Database, Account, Payee, CategoryGroup, Category, PaymentMethod,
  Operation, Preferences, Schedule, Budget, Asset, Project,
} from '../types';

export const BACKUP_VERSION = 2;

export interface Backup {
  format: 'comptes-budget';
  version: number;
  schemaVersion: number;
  exportedAt: string;
  database: Database;
  accounts: Account[];
  payees: Payee[];
  categoryGroups: CategoryGroup[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  operations: Operation[];
  preferences: Preferences[];
  schedules: Schedule[];
  budgets: Budget[];
  assets: Asset[];
  projects: Project[];
}

type TableName = Exclude<keyof Backup, 'format' | 'version' | 'schemaVersion' | 'exportedAt' | 'database'>;

/**
 * Tables exportées, associées à leur table Dexie.
 * Table explicite plutôt qu'accès indexé dynamique : le typage reste vérifiable
 * et l'ajout d'une entité se voit immédiatement à la compilation.
 */
const TABLE_MAP = {
  accounts: () => db.accounts,
  payees: () => db.payees,
  categoryGroups: () => db.categoryGroups,
  categories: () => db.categories,
  paymentMethods: () => db.paymentMethods,
  operations: () => db.operations,
  preferences: () => db.preferences,
  schedules: () => db.schedules,
  budgets: () => db.budgets,
  assets: () => db.assets,
  projects: () => db.projects,
} as const satisfies Record<TableName, () => { name: string }>;

const TABLES = Object.keys(TABLE_MAP) as TableName[];

type AnyRow = { id: string; dbId: string; updatedAt?: string };
const tableOf = (name: TableName) =>
  TABLE_MAP[name]() as unknown as import('dexie').Table<AnyRow, string>;

/** Résumé affiché à l'utilisateur AVANT tout écrasement de données. */
export interface BackupSummary {
  databaseName: string;
  exportedAt: string;
  version: number;
  operations: number;
  accounts: number;
  isKnownBase: boolean;   // la base existe déjà localement
  needsUpgrade: boolean;  // fichier produit par une version antérieure
}

async function tablesFor(dbId: string): Promise<Pick<Backup, TableName>> {
  const out = {} as Record<TableName, unknown[]>;
  for (const name of TABLES) {
    out[name] = await tableOf(name).where('dbId').equals(dbId).toArray();
  }
  return out as unknown as Pick<Backup, TableName>;
}

export const backupService = {
  /** Sérialise toute la base active (fichier .cbjson destiné à Google Drive). */
  async export(): Promise<Backup> {
    const database = await dbService.getActive();
    if (!database) throw new Error('Aucune base active');
    return {
      format: 'comptes-budget', version: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION,
      exportedAt: stamp(), database, ...(await tablesFor(database.id)),
    };
  },

  async download(suffix = ''): Promise<string> {
    const data = await this.export();
    const name = `${data.database.name.replace(/[^\w-]+/g, '_')}_${toYmd(new Date())}${suffix}.cbjson`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    // Révocation différée : Firefox annule le téléchargement si l'URL part trop tôt.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return name;
  },

  /**
   * Analyse un fichier sans rien écrire — alimente la fenêtre de confirmation.
   * Correction P2 : l'import supprimait puis réécrivait toutes les tables sans
   * confirmation, sans sauvegarde préalable et sans vérifier le champ version.
   */
  async inspect(json: string): Promise<{ backup: Backup; summary: BackupSummary }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Fichier illisible : ce n’est pas un fichier de sauvegarde valide.');
    }
    const b = parsed as Backup;
    if (!b || b.format !== 'comptes-budget') throw new Error('Fichier non reconnu (format attendu : comptes-budget).');
    if (!b.database?.id) throw new Error('Fichier incomplet : aucune base de données décrite.');
    if (b.version > BACKUP_VERSION) {
      throw new Error(`Fichier créé avec une version plus récente de l’application (v${b.version}). Mettez l’application à jour avant de l’importer.`);
    }
    const upgraded = b.version < BACKUP_VERSION ? upgradeBackup(b) : b;
    const existing = await db.databases.get(upgraded.database.id);
    return {
      backup: upgraded,
      summary: {
        databaseName: upgraded.database.name,
        exportedAt: upgraded.exportedAt,
        version: b.version,
        operations: upgraded.operations?.length ?? 0,
        accounts: upgraded.accounts?.length ?? 0,
        isKnownBase: Boolean(existing),
        needsUpgrade: b.version < BACKUP_VERSION,
      },
    };
  },

  /**
   * Restaure une sauvegarde.
   *  · 'replace' : l'état du fichier fait foi (comportement historique) ;
   *  · 'merge'   : fusion enregistrement par enregistrement, la modification la
   *                plus récente (updatedAt) l'emporte — évite qu'une synchro
   *                Google Drive n'écrase les saisies de l'autre appareil.
   * Dans les deux cas, l'état courant est exporté au préalable.
   */
  async restore(backup: Backup, mode: 'replace' | 'merge' = 'replace', safetyCopy = true): Promise<void> {
    if (safetyCopy) {
      const active = await dbService.getActive();
      if (active) await this.download('_avant-import').catch(() => undefined);
    }

    const dbId = backup.database.id;
    const tables = [db.databases, ...TABLES.map(tableOf)];

    await db.transaction('rw', tables, async () => {
      if (mode === 'replace') {
        for (const name of TABLES) await tableOf(name).where('dbId').equals(dbId).delete();
        await db.databases.put(backup.database);
        for (const name of TABLES) {
          const rows = (backup[name] ?? []) as unknown as AnyRow[];
          if (rows.length) await tableOf(name).bulkPut(rows);
        }
        return;
      }

      // Fusion : on ne remplace un enregistrement local que s'il est plus ancien.
      const local = await db.databases.get(dbId);
      if (!local || (backup.database.updatedAt ?? '') > (local.updatedAt ?? '')) {
        await db.databases.put(backup.database);
      }
      for (const name of TABLES) {
        const incoming = (backup[name] ?? []) as unknown as AnyRow[];
        if (!incoming.length) continue;
        const table = tableOf(name);
        const current = await table.bulkGet(incoming.map(r => r.id));
        const toWrite = incoming.filter((row, i) => {
          const existing = current[i];
          return !existing || (row.updatedAt ?? '') > (existing.updatedAt ?? '');
        });
        if (toWrite.length) await table.bulkPut(toWrite);
      }
    });

    dbService.setActive(dbId);
  },

  /** Jeu de données de démonstration. */
  async seedDemo(dbId: string): Promise<void> {
    const at = stamp();
    const methods = ['Carte bancaire', 'Espèces', 'Virement', 'Prélèvement'];
    await db.paymentMethods.bulkAdd(methods.map(name => ({
      id: uid(), dbId, name, archived: false, updatedAt: at,
    })));

    const payees = ['Carrefour', 'Total', 'EDF', 'Employeur', 'Restaurant', 'Netflix'];
    await db.payees.bulkAdd(payees.map(name => ({
      id: uid(), dbId, name, archived: false, updatedAt: at,
    })));

    const groups: { name: string; kind: 'depense' | 'recette'; icon: string; cats: string[] }[] = [
      { name: 'Alimentation', kind: 'depense', icon: '🛒', cats: ['Courses', 'Restaurants'] },
      { name: 'Logement', kind: 'depense', icon: '🏠', cats: ['Loyer', 'Énergie'] },
      { name: 'Transport', kind: 'depense', icon: '🚗', cats: ['Carburant', 'Transports'] },
      { name: 'Loisirs', kind: 'depense', icon: '🎬', cats: ['Abonnements', 'Sorties'] },
      { name: 'Revenus', kind: 'recette', icon: '💼', cats: ['Salaire', 'Prime'] },
    ];
    const catId: Record<string, string> = {};
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const gid = uid();
      await db.categoryGroups.add({
        id: gid, dbId, name: g.name, kind: g.kind, icon: g.icon,
        sortOrder: i, archived: false, updatedAt: at,
      });
      for (const c of g.cats) {
        const cid = uid();
        await db.categories.add({
          id: cid, dbId, groupId: gid, name: c, archived: false, updatedAt: at,
        });
        catId[c] = cid;
      }
    }

    const acc = await db.accounts.where('dbId').equals(dbId).first();
    if (!acc) return;
    const mk = (dayOffset: number, euros: number, kind: 'depense' | 'recette', cat: string, label: string): Operation => {
      const d = new Date();
      d.setDate(d.getDate() - dayOffset);
      const cents = toCents(euros);
      return {
        id: uid(), dbId, accountId: acc.id, date: toYmd(d),
        amountCents: kind === 'depense' ? -Math.abs(cents) : Math.abs(cents), kind,
        categoryId: catId[cat], label, checked: true, createdAt: at, updatedAt: at,
      };
    };
    await db.operations.bulkAdd([
      mk(28, 2400, 'recette', 'Salaire', 'Salaire'),
      mk(27, 800, 'depense', 'Loyer', 'Loyer'),
      mk(25, 95.4, 'depense', 'Courses', 'Courses Carrefour'),
      mk(20, 60, 'depense', 'Carburant', 'Plein'),
      mk(18, 42.5, 'depense', 'Restaurants', 'Déjeuner'),
      mk(15, 39.99, 'depense', 'Abonnements', 'Netflix + box'),
      mk(10, 110.2, 'depense', 'Courses', 'Courses'),
      mk(5, 24, 'depense', 'Sorties', 'Cinéma'),
      mk(2, 120, 'recette', 'Prime', 'Prime'),
    ]);
  },
};

/**
 * Reprise des fichiers .cbjson v1 : euros flottants → centimes, dates ISO
 * horodatées → dates civiles, ajout des champs de traçabilité.
 */
export function upgradeBackup(b: Backup): Backup {
  const at = stamp();
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const row = <T extends object>(r: T) => ({ updatedAt: at, ...r }) as T;

  return {
    ...b,
    version: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    database: row({ ...b.database, profile: b.database.profile ?? 'perso', schemaVersion: SCHEMA_VERSION }),
    accounts: (b.accounts ?? []).map(a => {
      const legacy = a as unknown as { initialBalance?: number };
      return row({
        ...a,
        initialBalanceCents: a.initialBalanceCents ?? toCents(n(legacy.initialBalance)),
        startDate: normalizeYmd(String(a.startDate ?? today())),
        archived: a.archived ?? false,
      });
    }),
    operations: (b.operations ?? []).map(o => {
      const legacy = o as unknown as { amount?: number };
      return row({
        ...o,
        amountCents: o.amountCents ?? toCents(n(legacy.amount)),
        date: normalizeYmd(String(o.date ?? today())),
      });
    }),
    schedules: (b.schedules ?? []).map(s => {
      const legacy = s as unknown as { amount?: number };
      return row({
        ...s,
        amountCents: s.amountCents ?? toCents(n(legacy.amount)),
        nextDate: normalizeYmd(String(s.nextDate ?? today())),
      });
    }),
    budgets: (b.budgets ?? []).map(x => {
      const legacy = x as unknown as { monthlyAmount?: number };
      return row({ ...x, monthlyAmountCents: x.monthlyAmountCents ?? toCents(n(legacy.monthlyAmount)) });
    }),
    assets: (b.assets ?? []).map(a => {
      const legacy = a as unknown as { value?: number };
      return row({
        ...a,
        valueCents: a.valueCents ?? toCents(n(legacy.value)),
        acquiredDate: a.acquiredDate ? normalizeYmd(String(a.acquiredDate)) : undefined,
      });
    }),
    projects: (b.projects ?? []).map(p => {
      const legacy = p as unknown as { targetAmount?: number; savedAmount?: number };
      return row({
        ...p,
        targetAmountCents: p.targetAmountCents ?? toCents(n(legacy.targetAmount)),
        savedAmountCents: p.savedAmountCents ?? toCents(n(legacy.savedAmount)),
        deadline: p.deadline ? normalizeYmd(String(p.deadline)) : undefined,
      });
    }),
    categoryGroups: (b.categoryGroups ?? []).map(g => row({ ...g, archived: g.archived ?? false })),
    categories: (b.categories ?? []).map(c => row({ ...c, archived: c.archived ?? false })),
    payees: (b.payees ?? []).map(p => row({ ...p, archived: p.archived ?? false })),
    paymentMethods: (b.paymentMethods ?? []).map(m => row({ ...m, archived: m.archived ?? false })),
    preferences: (b.preferences ?? []).map(p => row({ ...p })),
  };
}

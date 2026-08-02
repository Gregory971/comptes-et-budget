import { db, uid, stamp, SCHEMA_VERSION } from './db';
import type { Database, Profile, Region } from '../types';
import { DEFAULT_CATEGORY_CATALOG, DEFAULT_PAYMENT_METHODS } from './catalog';

const ACTIVE_KEY = 'cb_active_db';

export const dbService = {
  list: () => db.databases.toArray(),

  async getActive(): Promise<Database | undefined> {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id) {
      const base = await db.databases.get(id);
      if (base) return normalize(base);
    }
    const first = await db.databases.toArray();
    return first[0] ? normalize(first[0]) : undefined;
  },

  setActive(id: string) { localStorage.setItem(ACTIVE_KEY, id); },

  async create(name: string, profile: Profile = 'perso'): Promise<Database> {
    const now = stamp();
    const base: Database = {
      id: uid(),
      name: name.trim() || (profile === 'pro' ? 'Compte Pro' : 'Compte Perso'),
      profile, currency: 'EUR', createdAt: now, updatedAt: now,
      schemaVersion: SCHEMA_VERSION, holidayRegion: 'guadeloupe',
    };
    await db.databases.add(base);
    await this.seedReferentials(base.id);
    this.setActive(base.id);
    return base;
  },

  /** Catalogue initial, écrit en une transaction et en lots. */
  async seedReferentials(dbId: string): Promise<void> {
    const at = stamp();
    await db.transaction('rw', db.paymentMethods, db.categoryGroups, db.categories, async () => {
      await db.paymentMethods.bulkAdd(DEFAULT_PAYMENT_METHODS.map(name => ({
        id: uid(), dbId, name, archived: false, updatedAt: at,
      })));

      const groups = DEFAULT_CATEGORY_CATALOG.map((g, sortOrder) => ({
        id: uid(), dbId, name: g.name, kind: g.kind, icon: g.icon,
        sortOrder, archived: false, updatedAt: at, source: g,
      }));
      await db.categoryGroups.bulkAdd(groups.map(({ source: _source, ...g }) => g));
      await db.categories.bulkAdd(groups.flatMap(g => g.source.categories.map(c => ({
        id: uid(), dbId, groupId: g.id, name: c.name, icon: c.icon,
        archived: false, updatedAt: at,
      }))));
    });
  },

  async rename(id: string, name: string): Promise<void> {
    await db.databases.update(id, { name: name.trim(), updatedAt: stamp() });
  },

  async setHolidayRegion(id: string, holidayRegion: Region): Promise<void> {
    await db.databases.update(id, { holidayRegion, updatedAt: stamp() });
  },
};

/** Compatibilité des bases créées avant l'ajout de certains champs. */
function normalize(b: Database): Database {
  return {
    ...b,
    profile: b.profile ?? 'perso',
    updatedAt: b.updatedAt ?? b.createdAt,
    holidayRegion: b.holidayRegion ?? 'metropole',
  };
}

import { db, uid, stamp } from './db';
import type { Asset, Project, AssetType, Ymd, Cents } from '../types';

export const assetService = {
  list: (dbId: string) => db.assets.where('dbId').equals(dbId).toArray(),
  async create(dbId: string, input: {
    name: string; type: AssetType; valueCents: Cents; acquiredDate?: Ymd; note?: string;
  }) {
    const a: Asset = { id: uid(), dbId, updatedAt: stamp(), ...input };
    await db.assets.add(a); return a;
  },
  update: (id: string, patch: Partial<Asset>) => db.assets.update(id, { ...patch, updatedAt: stamp() }),
  remove: (id: string) => db.assets.delete(id),
  async total(dbId: string): Promise<Cents> {
    const rows = await db.assets.where('dbId').equals(dbId).toArray();
    return rows.reduce((s, a) => s + a.valueCents, 0);
  },
};

export const projectService = {
  list: (dbId: string) => db.projects.where('dbId').equals(dbId).toArray(),
  async create(dbId: string, input: {
    name: string; targetAmountCents: Cents; savedAmountCents: Cents; deadline?: Ymd; note?: string;
  }) {
    const p: Project = { id: uid(), dbId, updatedAt: stamp(), ...input };
    await db.projects.add(p); return p;
  },
  update: (id: string, patch: Partial<Project>) => db.projects.update(id, { ...patch, updatedAt: stamp() }),
  async addSaving(id: string, deltaCents: Cents) {
    const p = await db.projects.get(id);
    if (!p) return;
    await db.projects.update(id, {
      savedAmountCents: Math.max(0, p.savedAmountCents + deltaCents), updatedAt: stamp(),
    });
  },
  remove: (id: string) => db.projects.delete(id),
};

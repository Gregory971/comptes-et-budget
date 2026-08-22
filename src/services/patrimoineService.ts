import { db, uid, stamp } from './db';
import { operationService } from './operationService';
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

/**
 * Épargne d'un projet, tous mouvements confondus.
 *
 * Convention de signe : une somme mise de côté quitte le compte courant, elle
 * est donc enregistrée en négatif ; elle AUGMENTE l'épargne du projet. Une
 * recette rattachée au projet (reprise sur l'épargne) la diminue d'autant.
 * D'où l'inversion du total signé des opérations rattachées.
 */
export const savedFrom = (openingSavedCents: Cents, linkedTotalCents: Cents): Cents =>
  openingSavedCents - linkedTotalCents;

export interface ProjectStatus {
  project: Project;
  /** Mouvements rattachés au projet, total signé tel qu'enregistré. */
  linkedCents: Cents;
  /** Épargne constituée : solde d'ouverture + mouvements rattachés. */
  savedCents: Cents;
  /** Avancement vers l'objectif, borné à 100 %. */
  percent: number;
}

export const projectService = {
  list: (dbId: string) => db.projects.where('dbId').equals(dbId).toArray(),
  async create(dbId: string, input: {
    name: string; targetAmountCents: Cents; openingSavedCents: Cents; deadline?: Ymd; note?: string;
  }) {
    const p: Project = { id: uid(), dbId, updatedAt: stamp(), ...input };
    await db.projects.add(p); return p;
  },
  update: (id: string, patch: Partial<Project>) => db.projects.update(id, { ...patch, updatedAt: stamp() }),

  /** Ajustement manuel du solde d'ouverture (versement non saisi en opération). */
  async addSaving(id: string, deltaCents: Cents) {
    const p = await db.projects.get(id);
    if (!p) return;
    await db.projects.update(id, {
      openingSavedCents: Math.max(0, p.openingSavedCents + deltaCents), updatedAt: stamp(),
    });
  },

  /** Vue consolidée de tous les projets d'une base : une seule épargne par projet. */
  async status(dbId: string): Promise<ProjectStatus[]> {
    const projects = await this.list(dbId);
    return Promise.all(projects.map(async project => {
      const linkedCents = await operationService.totalForRef(dbId, 'projectId', project.id);
      const savedCents = savedFrom(project.openingSavedCents, linkedCents);
      return {
        project, linkedCents, savedCents,
        percent: project.targetAmountCents > 0
          ? Math.max(0, Math.min(100, (savedCents / project.targetAmountCents) * 100)) : 0,
      };
    }));
  },

  remove: (id: string) => db.projects.delete(id),
};

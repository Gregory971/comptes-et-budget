import { db, uid, stamp } from './db';
import { operationService } from './operationService';
import type { Payee, CategoryGroup, Category, PaymentMethod } from '../types';

/**
 * CRUD des référentiels.
 *
 * Correction P2 (intégrité référentielle) : les tiers, catégories et modes de
 * paiement étaient supprimés physiquement alors que les opérations passées y
 * font référence — la colonne « Tiers » se vidait silencieusement et les bilans
 * historiques changeaient rétroactivement. L'action par défaut est désormais
 * l'archivage ; la suppression définitive n'est possible que si aucune opération
 * ne référence l'élément (remove() renvoie le nombre de références bloquantes).
 */

export interface RemoveResult { removed: boolean; references: number; }

export const payeeService = {
  async list(dbId: string, includeArchived = false): Promise<Payee[]> {
    const rows = await db.payees.where('dbId').equals(dbId).toArray();
    return (includeArchived ? rows : rows.filter(p => !p.archived))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },
  async create(dbId: string, name: string) {
    const p: Payee = { id: uid(), dbId, name: name.trim(), archived: false, updatedAt: stamp() };
    await db.payees.add(p); return p;
  },
  update: (id: string, patch: Partial<Payee>) => db.payees.update(id, { ...patch, updatedAt: stamp() }),
  archive: (id: string) => db.payees.update(id, { archived: true, updatedAt: stamp() }),
  restore: (id: string) => db.payees.update(id, { archived: false, updatedAt: stamp() }),

  async remove(dbId: string, id: string): Promise<RemoveResult> {
    const references = await operationService.countByRef(dbId, 'payeeId', id);
    if (references > 0) return { removed: false, references };
    await db.payees.delete(id);
    return { removed: true, references: 0 };
  },

  /**
   * Résout un nom saisi librement en identifiant de tiers : réutilise le tiers
   * existant (comparaison insensible à la casse et aux accents, en réactivant
   * un tiers archivé) ou en crée un nouveau. Renvoie undefined si le nom est vide.
   *
   * Appelée au moment de l'enregistrement plutôt qu'à la sortie du champ : la
   * création étant asynchrone, la résoudre au blur laissait passer un clic
   * direct sur « Enregistrer » avant que le tiers ne soit rattaché.
   */
  async resolveByName(dbId: string, rawName: string): Promise<string | undefined> {
    const name = rawName.trim();
    if (!name) return undefined;
    const all = await this.list(dbId, true);
    const match = all.find(p => p.name.localeCompare(name, 'fr', { sensitivity: 'base' }) === 0);
    if (match) {
      if (match.archived) await this.restore(match.id);
      return match.id;
    }
    return (await this.create(dbId, name)).id;
  },
};

export const paymentMethodService = {
  async list(dbId: string, includeArchived = false): Promise<PaymentMethod[]> {
    const rows = await db.paymentMethods.where('dbId').equals(dbId).toArray();
    return includeArchived ? rows : rows.filter(m => !m.archived);
  },
  async create(dbId: string, name: string) {
    const m: PaymentMethod = { id: uid(), dbId, name: name.trim(), archived: false, updatedAt: stamp() };
    await db.paymentMethods.add(m); return m;
  },
  update: (id: string, patch: Partial<PaymentMethod>) =>
    db.paymentMethods.update(id, { ...patch, updatedAt: stamp() }),
  archive: (id: string) => db.paymentMethods.update(id, { archived: true, updatedAt: stamp() }),
  restore: (id: string) => db.paymentMethods.update(id, { archived: false, updatedAt: stamp() }),

  async remove(dbId: string, id: string): Promise<RemoveResult> {
    const references = await operationService.countByRef(dbId, 'paymentMethodId', id);
    if (references > 0) return { removed: false, references };
    await db.paymentMethods.delete(id);
    return { removed: true, references: 0 };
  },
};

export const categoryService = {
  async listGroups(dbId: string, includeArchived = false): Promise<CategoryGroup[]> {
    const rows = await db.categoryGroups.where('dbId').equals(dbId).toArray();
    return (includeArchived ? rows : rows.filter(g => !g.archived))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
  async listCategories(dbId: string, includeArchived = false): Promise<Category[]> {
    const rows = await db.categories.where('dbId').equals(dbId).toArray();
    return includeArchived ? rows : rows.filter(c => !c.archived);
  },

  async createGroup(dbId: string, name: string, kind: 'depense' | 'recette', icon?: string) {
    const count = await db.categoryGroups.where('dbId').equals(dbId).count();
    const g: CategoryGroup = {
      id: uid(), dbId, name: name.trim(), kind, icon, sortOrder: count,
      archived: false, updatedAt: stamp(),
    };
    await db.categoryGroups.add(g); return g;
  },
  updateGroup: (id: string, patch: Partial<CategoryGroup>) =>
    db.categoryGroups.update(id, { ...patch, updatedAt: stamp() }),

  /** Archive le groupe et toutes ses catégories (réversible). */
  async archiveGroup(id: string): Promise<void> {
    const at = stamp();
    await db.transaction('rw', db.categoryGroups, db.categories, async () => {
      await db.categoryGroups.update(id, { archived: true, updatedAt: at });
      await db.categories.where('groupId').equals(id).modify({ archived: true, updatedAt: at });
    });
  },
  async restoreGroup(id: string): Promise<void> {
    const at = stamp();
    await db.transaction('rw', db.categoryGroups, db.categories, async () => {
      await db.categoryGroups.update(id, { archived: false, updatedAt: at });
      await db.categories.where('groupId').equals(id).modify({ archived: false, updatedAt: at });
    });
  },

  /** Suppression définitive du groupe, refusée si une opération y renvoie. */
  async removeGroup(dbId: string, id: string): Promise<RemoveResult> {
    const cats = await db.categories.where('[dbId+groupId]').equals([dbId, id]).toArray();
    let references = 0;
    for (const c of cats) references += await operationService.countByRef(dbId, 'categoryId', c.id);
    if (references > 0) return { removed: false, references };
    await db.transaction('rw', db.categoryGroups, db.categories, db.budgets, async () => {
      for (const c of cats) await db.budgets.where('[dbId+categoryId]').equals([dbId, c.id]).delete();
      await db.categories.where('[dbId+groupId]').equals([dbId, id]).delete();
      await db.categoryGroups.delete(id);
    });
    return { removed: true, references: 0 };
  },

  async createCategory(dbId: string, groupId: string, name: string, icon?: string) {
    const c: Category = {
      id: uid(), dbId, groupId, name: name.trim(), icon, archived: false, updatedAt: stamp(),
    };
    await db.categories.add(c); return c;
  },
  updateCategory: (id: string, patch: Partial<Category>) =>
    db.categories.update(id, { ...patch, updatedAt: stamp() }),
  archiveCategory: (id: string) => db.categories.update(id, { archived: true, updatedAt: stamp() }),
  restoreCategory: (id: string) => db.categories.update(id, { archived: false, updatedAt: stamp() }),

  async removeCategory(dbId: string, id: string): Promise<RemoveResult> {
    const references = await operationService.countByRef(dbId, 'categoryId', id);
    if (references > 0) return { removed: false, references };
    await db.transaction('rw', db.categories, db.budgets, async () => {
      await db.budgets.where('[dbId+categoryId]').equals([dbId, id]).delete();
      await db.categories.delete(id);
    });
    return { removed: true, references: 0 };
  },
};

import { db, stamp } from './db';
import { operationService } from './operationService';
import { replacePathPrefix, validateDocument } from '../utils/documents';
import type { DocumentLink, Operation, Schedule, Ymd } from '../types';

/**
 * Opérations de maintenance sur la base : fusion, épuration, remplacement et
 * suppression en masse.
 *
 * Principe commun : tout ce qui touche plusieurs tables se fait dans UNE
 * transaction — un échec au milieu ne laisse jamais une fusion à moitié faite —
 * et chaque outil sait d'abord COMPTER ce qu'il va modifier, pour que l'écran
 * l'annonce avant de demander confirmation.
 */

export interface MergeResult {
  /** Opérations dont la référence a changé. */
  operations: number;
  schedules: number;
  /** Budgets déplacés ou additionnés (catégories seulement). */
  budgets: number;
}

/* ------------------------------------------------------------- fusions */

async function sameBase<T extends { dbId: string }>(rows: (T | undefined)[], dbId: string, what: string): Promise<T[]> {
  if (rows.some(r => !r || r.dbId !== dbId)) throw new Error(`${what} introuvable.`);
  return rows as T[];
}

/**
 * Remplace la catégorie `fromId` par `toId` partout (opérations, parts de
 * ventilation, échéances, règles apprises, budgets), puis supprime `fromId`.
 * Refusée entre une catégorie de dépense et une catégorie de recette : le sens
 * des opérations ne se déduirait plus de leur catégorie.
 */
export async function mergeCategories(dbId: string, fromId: string, toId: string): Promise<MergeResult> {
  if (fromId === toId) throw new Error('Choisissez deux catégories différentes.');
  const [from, to] = await sameBase([await db.categories.get(fromId), await db.categories.get(toId)], dbId, 'Catégorie');
  const [gFrom, gTo] = await Promise.all([db.categoryGroups.get(from.groupId), db.categoryGroups.get(to.groupId)]);
  if (gFrom && gTo && gFrom.kind !== gTo.kind) {
    throw new Error('On ne fusionne pas une catégorie de dépense avec une catégorie de recette.');
  }

  return db.transaction('rw', [db.categories, db.operations, db.schedules, db.budgets, db.categorizationRules], async () => {
    const now = stamp();
    let operations = 0;
    await db.operations.where('dbId').equals(dbId).modify((o: Operation) => {
      let touched = false;
      if (o.categoryId === fromId) { o.categoryId = toId; touched = true; }
      if (o.splits?.some(s => s.categoryId === fromId)) {
        o.splits = o.splits.map(s => (s.categoryId === fromId ? { ...s, categoryId: toId } : s));
        touched = true;
      }
      if (touched) { o.updatedAt = now; operations++; }
    });

    const schedules = await db.schedules.where('dbId').equals(dbId).and(s => s.categoryId === fromId)
      .modify({ categoryId: toId, updatedAt: now });

    await db.categorizationRules.where('dbId').equals(dbId).and(r => r.categoryId === fromId)
      .modify({ categoryId: toId, updatedAt: now });

    // Budgets : celui de la catégorie absorbée s'ajoute à celui de la catégorie cible.
    let budgets = 0;
    const bFrom = await db.budgets.where('[dbId+categoryId]').equals([dbId, fromId]).first();
    if (bFrom) {
      const bTo = await db.budgets.where('[dbId+categoryId]').equals([dbId, toId]).first();
      if (bTo) {
        await db.budgets.update(bTo.id, { monthlyAmountCents: bTo.monthlyAmountCents + bFrom.monthlyAmountCents, updatedAt: now });
        await db.budgets.delete(bFrom.id);
      } else {
        await db.budgets.update(bFrom.id, { categoryId: toId, updatedAt: now });
      }
      budgets = 1;
    }

    await db.categories.delete(fromId);
    return { operations, schedules, budgets };
  });
}

/** Remplace le tiers `fromId` par `toId` (opérations, échéances, règles apprises), puis supprime `fromId`. */
export async function mergePayees(dbId: string, fromId: string, toId: string): Promise<MergeResult> {
  if (fromId === toId) throw new Error('Choisissez deux tiers différents.');
  await sameBase([await db.payees.get(fromId), await db.payees.get(toId)], dbId, 'Tiers');

  return db.transaction('rw', [db.payees, db.operations, db.schedules, db.categorizationRules], async () => {
    const now = stamp();
    const operations = await db.operations.where('dbId').equals(dbId).and(o => o.payeeId === fromId)
      .modify({ payeeId: toId, updatedAt: now });
    const schedules = await db.schedules.where('dbId').equals(dbId).and(s => s.payeeId === fromId)
      .modify({ payeeId: toId, updatedAt: now });
    await db.categorizationRules.where('dbId').equals(dbId).and(r => r.payeeId === fromId)
      .modify({ payeeId: toId, updatedAt: now });
    // Le tiers absorbé garde sa catégorie par défaut seulement si la cible n'en a pas.
    const [from, to] = await Promise.all([db.payees.get(fromId), db.payees.get(toId)]);
    if (from?.defaultCategoryId && !to?.defaultCategoryId) {
      await db.payees.update(toId, { defaultCategoryId: from.defaultCategoryId, updatedAt: now });
    }
    await db.payees.delete(fromId);
    return { operations, schedules, budgets: 0 };
  });
}

/* ------------------------------------------------------------ épuration */

/**
 * Tiers actifs sans aucune opération (ni échéance) depuis `before` : date de la
 * dernière utilisation strictement antérieure à `before`, ou jamais utilisés.
 */
export async function unusedPayees(dbId: string, before: Ymd): Promise<{ id: string; name: string; lastUse?: Ymd }[]> {
  const [payees, ops, schedules] = await Promise.all([
    db.payees.where('dbId').equals(dbId).toArray(),
    db.operations.where('dbId').equals(dbId).toArray(),
    db.schedules.where('dbId').equals(dbId).toArray(),
  ]);
  const last = new Map<string, Ymd>();
  for (const o of ops) {
    if (o.deletedAt || !o.payeeId) continue;
    if (!last.has(o.payeeId) || o.date > last.get(o.payeeId)!) last.set(o.payeeId, o.date);
  }
  // Une échéance en cours fait du tiers un tiers vivant, quelle que soit sa date.
  const scheduled = new Set(schedules.filter(s => s.active && s.payeeId).map(s => s.payeeId!));
  return payees
    .filter(p => !p.archived && !scheduled.has(p.id) && (last.get(p.id) ?? '') < before)
    .map(p => ({ id: p.id, name: p.name, lastUse: last.get(p.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/**
 * Archive les tiers inutilisés depuis `before`. Archiver plutôt que supprimer :
 * les opérations anciennes gardent leur tiers lisible dans l'historique, et le
 * tiers revient dès qu'on ressaisit son nom.
 */
export async function purgeUnusedPayees(dbId: string, before: Ymd): Promise<number> {
  const rows = await unusedPayees(dbId, before);
  const now = stamp();
  await db.transaction('rw', db.payees, async () => {
    for (const p of rows) await db.payees.update(p.id, { archived: true, updatedAt: now });
  });
  return rows.length;
}

/* ------------------------------------------------------ remplacement en masse */

export type ReplaceField = 'categoryId' | 'payeeId' | 'paymentMethodId';

/** Les trois champs remplaçables d'une opération ou d'une échéance. */
const pickFields = (r: { categoryId?: string; payeeId?: string; paymentMethodId?: string }): Pick<Operation, ReplaceField> =>
  ({ categoryId: r.categoryId, payeeId: r.payeeId, paymentMethodId: r.paymentMethodId });

export interface BulkScope {
  dbId: string;
  accountId?: string;
  from?: Ymd;
  to?: Ymd;
}

async function inScope(scope: BulkScope): Promise<Operation[]> {
  return operationService.list(scope.dbId, { accountId: scope.accountId, from: scope.from, to: scope.to });
}

export interface ReplaceSpec {
  field: ReplaceField;
  /** Valeur à remplacer ; absente : les opérations qui n'en ont pas. */
  fromValue?: string;
  /** Nouvelle valeur ; absente : vider le champ. */
  toValue?: string;
  /** Inclure les échéances programmées. */
  includeSchedules: boolean;
}

/** Une catégorie ne s'applique qu'aux opérations du même sens ; les virements n'en ont pas. */
async function categoryKind(id: string | undefined): Promise<'depense' | 'recette' | undefined> {
  if (!id) return undefined;
  const cat = await db.categories.get(id);
  return cat ? (await db.categoryGroups.get(cat.groupId))?.kind : undefined;
}

function matches(o: Operation, spec: ReplaceSpec, kind: 'depense' | 'recette' | undefined): boolean {
  if (o.kind === 'virement') return false;
  if (spec.field === 'categoryId') {
    // Une opération ventilée garde ses parts : on ne change pas une catégorie unique qu'elle n'a pas.
    if (o.splits?.length) return o.splits.some(s => s.categoryId === spec.fromValue)
      && (!kind || (o.kind === kind));
    if ((o.categoryId ?? undefined) !== spec.fromValue) return false;
    return !kind || o.kind === kind;
  }
  return (o[spec.field] ?? undefined) === spec.fromValue;
}

/** Combien d'opérations (et d'échéances) un remplacement toucherait, sans rien modifier. */
export async function previewReplace(scope: BulkScope, spec: ReplaceSpec): Promise<{ operations: number; schedules: number; skipped: number }> {
  if (spec.fromValue === spec.toValue) return { operations: 0, schedules: 0, skipped: 0 };
  const kind = spec.field === 'categoryId' ? await categoryKind(spec.toValue) : undefined;
  const ops = await inScope(scope);
  const hit = ops.filter(o => matches(o, spec, kind));
  // Opérations qui portaient bien la valeur mais que le sens de la catégorie cible exclut.
  const skipped = spec.field === 'categoryId' && kind
    ? ops.filter(o => o.kind !== 'virement' && matches(o, spec, undefined) && o.kind !== kind).length : 0;
  const schedules = spec.includeSchedules ? await countSchedules(scope.dbId, spec, kind) : 0;
  return { operations: hit.length, schedules, skipped };
}

async function countSchedules(dbId: string, spec: ReplaceSpec, kind: 'depense' | 'recette' | undefined): Promise<number> {
  return (await db.schedules.where('dbId').equals(dbId).toArray())
    .filter(s => (s[spec.field] ?? undefined) === spec.fromValue && (!kind || spec.field !== 'categoryId' || s.kind === kind)).length;
}

export async function replaceInOperations(scope: BulkScope, spec: ReplaceSpec): Promise<{ operations: number; schedules: number }> {
  if (spec.fromValue === spec.toValue) return { operations: 0, schedules: 0 };
  const kind = spec.field === 'categoryId' ? await categoryKind(spec.toValue) : undefined;
  if (spec.toValue) {
    const table = spec.field === 'categoryId' ? db.categories : spec.field === 'payeeId' ? db.payees : db.paymentMethods;
    const target = await table.get(spec.toValue);
    if (!target || target.dbId !== scope.dbId) throw new Error('La nouvelle valeur est introuvable.');
  }
  const ops = (await inScope(scope)).filter(o => matches(o, spec, kind));
  return db.transaction('rw', [db.operations, db.schedules], async () => {
    const now = stamp();
    for (const o of ops) {
      if (spec.field === 'categoryId' && o.splits?.length) {
        await db.operations.update(o.id, {
          splits: o.splits.map(s => (s.categoryId === spec.fromValue ? { ...s, categoryId: spec.toValue } : s)), updatedAt: now,
        });
      } else {
        const patch: Pick<Operation, ReplaceField> & { updatedAt: string } = { ...pickFields(o), updatedAt: now };
        patch[spec.field] = spec.toValue;
        await db.operations.update(o.id, patch);
      }
    }
    let schedules = 0;
    if (spec.includeSchedules) {
      const all = await db.schedules.where('dbId').equals(scope.dbId).toArray();
      for (const s of all) {
        if ((s[spec.field] ?? undefined) !== spec.fromValue) continue;
        if (kind && spec.field === 'categoryId' && s.kind !== kind) continue;
        const patch: Pick<Schedule, ReplaceField> & { updatedAt: string } = { ...pickFields(s), updatedAt: now };
        patch[spec.field] = spec.toValue;
        await db.schedules.update(s.id, patch);
        schedules++;
      }
    }
    return { operations: ops.length, schedules };
  });
}

/* ------------------------------------------------------ suppression en masse */

export interface DeleteSpec extends BulkScope {
  categoryId?: string;
  payeeId?: string;
  /** Épargne les opérations pointées (rapprochées avec un relevé). */
  keepChecked: boolean;
  includeTransfers: boolean;
}

export async function selectForDeletion(spec: DeleteSpec): Promise<Operation[]> {
  return (await operationService.list(spec.dbId, {
    accountId: spec.accountId, from: spec.from, to: spec.to,
    categoryId: spec.categoryId, payeeId: spec.payeeId, includeTransfers: spec.includeTransfers,
  })).filter(o => !(spec.keepChecked && o.checked));
}

/**
 * Supprime (suppression logique) les opérations qui correspondent. Les deux volets
 * d'un virement partent ensemble : si un volet est épargné par `keepChecked`, l'autre
 * l'est aussi, pour ne jamais laisser un virement orphelin.
 */
export async function deleteOperations(spec: DeleteSpec): Promise<number> {
  const picked = await selectForDeletion(spec);
  const protectedTransfers = new Set(
    (await operationService.list(spec.dbId, { accountId: undefined, includeTransfers: true }))
      .filter(o => o.transferId && spec.keepChecked && o.checked).map(o => o.transferId!));
  const toDelete = picked.filter(o => !(o.transferId && protectedTransfers.has(o.transferId)));
  const seen = new Set<string>();
  let count = 0;
  for (const o of toDelete) {
    if (o.transferId) {
      if (seen.has(o.transferId)) continue;
      seen.add(o.transferId);
    }
    await operationService.remove(o.id);    // un virement emporte ses deux écritures
    count++;
  }
  return count;
}

/* ---------------------------------------------------- liens de documents */

/**
 * Corrige en masse les liens de documents après un déménagement de dossier ou de
 * disque : le début `from` du chemin devient `to`. Les deux séparateurs et la casse
 * sont équivalents (usage de Windows) ; seuls les chemins qui commencent vraiment par
 * `from` — jusqu'à une frontière de dossier — sont touchés. Les liens https ne le sont jamais.
 */
export async function previewDocumentPrefix(dbId: string, from: string): Promise<{ documents: number; operations: number }> {
  let documents = 0, operations = 0;
  for (const o of await db.operations.where('dbId').equals(dbId).toArray()) {
    const n = (o.documents ?? []).filter(d => replacePathPrefix(d.path, from, 'X') !== null).length;
    if (n > 0) { documents += n; operations++; }
  }
  return { documents, operations };
}

export async function replaceDocumentPrefix(dbId: string, from: string, to: string): Promise<{ documents: number; operations: number }> {
  if (!from.trim()) throw new Error('Indiquez le début du chemin à remplacer.');
  if (!to.trim()) throw new Error('Indiquez le nouveau début de chemin.');
  const changes: { id: string; documents: DocumentLink[] }[] = [];
  let documents = 0;
  for (const o of await db.operations.where('dbId').equals(dbId).toArray()) {
    let touched = false;
    const next = (o.documents ?? []).map(d => {
      const path = replacePathPrefix(d.path, from, to);
      if (path === null) return d;
      touched = true; documents++;
      return { ...d, path };
    });
    if (!touched) continue;
    // Tout contrôler AVANT d'écrire : un nouveau préfixe invalide ne doit rien abîmer.
    for (const d of next) {
      const problem = validateDocument(d);
      if (problem) throw new Error(`Le nouveau chemin « ${d.path} » est refusé : ${problem}`);
    }
    changes.push({ id: o.id, documents: next });
  }
  const now = stamp();
  await db.transaction('rw', db.operations, async () => {
    for (const c of changes) await db.operations.update(c.id, { documents: c.documents, updatedAt: now });
  });
  return { documents, operations: changes.length };
}

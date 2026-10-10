// Règles de catégorisation apprises à l'import des relevés.
//
// Rien n'est appris en silence : une règle naît uniquement quand l'utilisateur,
// à la confirmation d'un import, a choisi ou corrigé le tiers / la catégorie
// d'une ligne. L'historique des opérations (déjà en base) alimente quant à lui
// le moteur sans passer par ce stockage — voir src/utils/categorize.ts.

import { db, uid, stamp } from './db';
import { lineKind, patternOf, type Proposal } from '../utils/categorize';
import type { CategorizationRule } from '../types';

export const ruleService = {
  async list(dbId: string, includeDisabled = false): Promise<CategorizationRule[]> {
    const rows = await db.categorizationRules.where('dbId').equals(dbId).toArray();
    return (includeDisabled ? rows : rows.filter(r => !r.disabled))
      .sort((a, b) => a.pattern.localeCompare(b.pattern, 'fr'));
  },

  /** « Oublier » une règle : désactivation, pas suppression, pour que la fusion de sauvegardes la propage. */
  disable: (id: string) =>
    db.categorizationRules.update(id, { disabled: true, updatedAt: stamp() }),
};

export interface LearnItem {
  label: string;
  amountCents: number;
  /** Classement retenu par l'utilisateur à la confirmation. */
  final: { categoryId?: string; payeeId?: string };
  /** Classement posé d'office à la préparation (vide pour une proposition seulement suggérée). */
  auto: { categoryId?: string; payeeId?: string };
  proposal?: Proposal;
}

export interface LearnResult { created: number; updated: number; confirmed: number; disabled: number; }

/**
 * Met les règles à jour d'après ce que l'utilisateur a confirmé :
 *  · classement laissé tel que proposé par une règle → la règle gagne une confirmation ;
 *  · classement choisi ou corrigé → règle créée, ou ajustée si le motif existe déjà ;
 *  · proposition d'une règle effacée sans remplacement → la règle est désactivée ;
 *  · classement issu de l'historique ou d'un tiers et laissé tel quel → rien : l'opération
 *    importée rejoint l'historique et le renforce d'elle-même.
 * Les lignes sans motif exploitable (libellé vide ou fait de chiffres) n'enseignent rien.
 */
export async function learnFromImport(dbId: string, items: LearnItem[]): Promise<LearnResult> {
  const result: LearnResult = { created: 0, updated: 0, confirmed: 0, disabled: 0 };
  if (items.length === 0) return result;

  await db.transaction('rw', db.categorizationRules, async () => {
    const rules = await db.categorizationRules.where('dbId').equals(dbId).toArray();
    const touched = new Map<string, CategorizationRule>();
    const at = stamp();
    const keep = (r: CategorizationRule) => { touched.set(r.id, r); };

    for (const it of items) {
      const pattern = patternOf(it.label);
      if (!pattern) continue;
      const kind = lineKind(it.amountCents);
      const changed = it.final.categoryId !== it.auto.categoryId
        || it.final.payeeId !== it.auto.payeeId;
      const origin = it.proposal?.ruleId ? rules.find(r => r.id === it.proposal!.ruleId) : undefined;

      if (!changed) {
        if (origin && !origin.disabled) {
          origin.hits += 1; origin.updatedAt = at; keep(origin); result.confirmed += 1;
        }
        continue;
      }

      if (!it.final.categoryId && !it.final.payeeId) {
        if (origin && !origin.disabled) {
          origin.disabled = true; origin.updatedAt = at; keep(origin); result.disabled += 1;
        }
        continue;
      }

      const existing = rules.find(r => r.pattern === pattern && r.kind === kind);
      if (existing) {
        const same = !existing.disabled
          && existing.categoryId === it.final.categoryId && existing.payeeId === it.final.payeeId;
        existing.categoryId = it.final.categoryId;
        existing.payeeId = it.final.payeeId;
        existing.hits = same ? existing.hits + 1 : 1;
        existing.disabled = false;
        existing.updatedAt = at;
        keep(existing); result.updated += 1;
      } else {
        const rule: CategorizationRule = {
          id: uid(), dbId, pattern, kind,
          categoryId: it.final.categoryId, payeeId: it.final.payeeId,
          hits: 1, origin: it.proposal ? 'correction' : 'ajout',
          disabled: false, createdAt: at, updatedAt: at,
        };
        rules.push(rule); keep(rule); result.created += 1;
      }
    }
    if (touched.size) await db.categorizationRules.bulkPut([...touched.values()]);
  });

  return result;
}

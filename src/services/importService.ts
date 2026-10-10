// Intégration d'un relevé bancaire dans la base.
//
// Deux garde-fous, parce qu'un import se fait sur des centaines de lignes que
// personne ne relira une à une :
//  · DOUBLONS — une opération déjà saisie à la main ou importée d'un relevé
//    précédent ne doit pas revenir en double. Chaque opération existante ne
//    peut absorber qu'une seule ligne du relevé, faute de quoi deux cafés du
//    même jour au même prix n'en feraient plus qu'un.
//  · CLASSEMENT — le libellé de la banque est confronté aux règles apprises, aux
//    tiers déjà connus et à l'historique des opérations (voir utils/categorize).
//    Chaque proposition porte son origine et un niveau de confiance ; une
//    proposition peu sûre est seulement suggérée, jamais posée, et une ligne non
//    reconnue reste sans catégorie plutôt que d'en recevoir une fausse.
//    Rien n'est écrit avant la confirmation ; les corrections de l'utilisateur
//    alimentent alors les règles apprises.

import { db, uid } from './db';
import { operationService } from './operationService';
import { payeeService, categoryService } from './referentialService';
import { learnFromImport, type LearnItem } from './categorizationService';
import { fromYmd, toYmd, type Ymd } from '../utils/date';
import type { StatementEntry } from '../utils/statement';
import {
  buildHistoryIndex, isApplied, matchPayee, normalizeText, propose,
  type CategorizerContext, type LineKind, type Proposal,
} from '../utils/categorize';
import type { Operation } from '../types';

export { matchPayee };

/** Tolérance de date entre le relevé et la saisie manuelle (jours). */
export const DUPLICATE_WINDOW_DAYS = 4;

export interface ImportCandidate extends StatementEntry {
  /** Clé de ligne, stable le temps de la fenêtre de confirmation. */
  key: string;
  /** Opération existante que cette ligne semble reproduire. */
  duplicateOfId?: string;
  duplicateDate?: Ymd;
  payeeId?: string;
  payeeName?: string;
  categoryId?: string;
  /** Proposition du moteur (origine, confiance), même quand elle n'est que suggérée. */
  proposal?: Proposal;
  /** Tiers et catégorie posés d'office : référence pour savoir ce que l'utilisateur a corrigé. */
  autoPayeeId?: string;
  autoCategoryId?: string;
  /** Ligne retenue pour l'import ; un doublon est décoché d'office. */
  selected: boolean;
}

const norm = normalizeText;

const daysBetween = (a: Ymd, b: Ymd) =>
  Math.abs(fromYmd(a).getTime() - fromYmd(b).getTime()) / 86_400_000;

/**
 * Confronte le relevé à la base : doublons repérés, tiers et catégorie
 * proposés. Aucune écriture — c'est la fenêtre de confirmation qui décide.
 */
export async function prepareImport(
  dbId: string, accountId: string, entries: StatementEntry[],
): Promise<ImportCandidate[]> {
  const [historique, payees, cats, groups, rules] = await Promise.all([
    db.operations.where('dbId').equals(dbId).toArray(),
    payeeService.list(dbId, true),
    categoryService.listCategories(dbId),
    categoryService.listGroups(dbId),
    db.categorizationRules.where('dbId').equals(dbId).toArray(),
  ]);
  const vivantes = historique.filter(o => o.accountId === accountId && !o.deletedAt);
  const consommees = new Set<string>();

  const groupKind = new Map(groups.map(g => [g.id, g.kind]));
  const categoryKinds = new Map<string, LineKind>();
  for (const c of cats) {
    const k = groupKind.get(c.groupId);
    if (k) categoryKinds.set(c.id, k);
  }
  const ctx: CategorizerContext = {
    payees, categoryKinds, rules,
    history: buildHistoryIndex(historique, {
      payeeNames: new Map(payees.map(p => [p.id, p.name])), categoryKinds,
    }),
  };

  return entries.map((e, i) => {
    const jumelle = trouveDoublon(e, vivantes, consommees);
    if (jumelle) consommees.add(jumelle.id);
    const proposal = propose(e.label, e.amountCents, ctx);
    // Seule une proposition assez sûre est posée ; les autres restent des suggestions.
    const posee = isApplied(proposal) ? proposal : undefined;
    const payeeId = posee?.payeeId;
    return {
      ...e,
      key: `${i}:${e.date}:${e.amountCents}`,
      duplicateOfId: jumelle?.id,
      duplicateDate: jumelle?.date,
      payeeId,
      payeeName: payeeId ? payees.find(p => p.id === payeeId)?.name : undefined,
      categoryId: posee?.categoryId,
      proposal,
      autoPayeeId: payeeId,
      autoCategoryId: posee?.categoryId,
      selected: !jumelle,
    };
  });
}

function trouveDoublon(
  e: StatementEntry, existantes: Operation[], consommees: Set<string>,
): Operation | undefined {
  const candidates = existantes.filter(o =>
    !consommees.has(o.id)
    && o.amountCents === e.amountCents
    && daysBetween(o.date, e.date) <= DUPLICATE_WINDOW_DAYS);
  if (candidates.length === 0) return undefined;

  // Même référence : certitude. Sinon, la plus proche en date.
  if (e.reference) {
    const parRef = candidates.find(o => o.reference && norm(o.reference) === norm(e.reference!));
    if (parRef) return parRef;
  }
  return [...candidates].sort((a, b) => daysBetween(a.date, e.date) - daysBetween(b.date, e.date))[0];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  /** Étiquette du lot, inscrite dans la note de chaque opération importée. */
  batchLabel: string;
  /** Règles créées, ajustées ou confirmées d'après les choix de l'utilisateur. */
  rulesLearned: number;
}

/**
 * Écrit les lignes retenues. Le lot est daté pour pouvoir être retrouvé. Les
 * tiers saisis librement dans la fenêtre de confirmation sont créés ici, et non
 * avant : tant que l'utilisateur n'a pas confirmé, la base n'est pas touchée.
 * Les règles apprises sont mises à jour une fois les opérations écrites : un
 * échec de l'apprentissage ne doit pas faire perdre l'import.
 */
export async function commitImport(
  dbId: string, accountId: string, candidates: ImportCandidate[],
): Promise<ImportResult> {
  const retenues = candidates.filter(c => c.selected);
  const batchLabel = `Import du ${toYmd(new Date())}`;
  const batchId = uid().slice(0, 8);

  const payeeIds = new Map<string, string | undefined>();
  for (const c of retenues) {
    if (c.payeeId || !c.payeeName?.trim()) continue;
    const cle = norm(c.payeeName);
    if (!payeeIds.has(cle)) payeeIds.set(cle, await resolvePayeeForImport(dbId, c.payeeName));
  }
  const payeeOf = (c: ImportCandidate) =>
    c.payeeId ?? (c.payeeName?.trim() ? payeeIds.get(norm(c.payeeName)) : undefined);

  await db.transaction('rw', db.operations, async () => {
    for (const c of retenues) {
      await operationService.create({
        dbId, accountId, date: c.date,
        amountCents: Math.abs(c.amountCents),
        kind: c.amountCents < 0 ? 'depense' : 'recette',
        label: c.label || undefined,
        reference: c.reference,
        payeeId: payeeOf(c),
        categoryId: c.categoryId,
        note: `${batchLabel} (lot ${batchId})`,
      });
    }
  });

  let rulesLearned = 0;
  try {
    const items: LearnItem[] = retenues.map(c => ({
      label: c.label, amountCents: c.amountCents,
      final: { categoryId: c.categoryId, payeeId: payeeOf(c) },
      auto: { categoryId: c.autoCategoryId, payeeId: c.autoPayeeId },
      proposal: c.proposal,
    }));
    const r = await learnFromImport(dbId, items);
    rulesLearned = r.created + r.updated + r.confirmed + r.disabled;
  } catch (e) {
    console.warn('Apprentissage des règles impossible :', e);
  }

  return {
    imported: retenues.length, skipped: candidates.length - retenues.length,
    batchLabel, rulesLearned,
  };
}

/** Rattache un tiers saisi dans la fenêtre de confirmation, en le créant au besoin. */
export async function resolvePayeeForImport(dbId: string, name: string): Promise<string | undefined> {
  return payeeService.resolveByName(dbId, name);
}

// Intégration d'un relevé bancaire dans la base.
//
// Deux garde-fous, parce qu'un import se fait sur des centaines de lignes que
// personne ne relira une à une :
//  · DOUBLONS — une opération déjà saisie à la main ou importée d'un relevé
//    précédent ne doit pas revenir en double. Chaque opération existante ne
//    peut absorber qu'une seule ligne du relevé, faute de quoi deux cafés du
//    même jour au même prix n'en feraient plus qu'un.
//  · CLASSEMENT — le libellé de la banque est confronté aux tiers déjà connus,
//    ce qui rattache l'opération au tiers et à sa catégorie par défaut. Rien
//    n'est deviné au-delà : une ligne non reconnue reste sans catégorie plutôt
//    que d'en recevoir une fausse.

import { db, uid } from './db';
import { operationService } from './operationService';
import { payeeService } from './referentialService';
import { fromYmd, toYmd, type Ymd } from '../utils/date';
import type { StatementEntry } from '../utils/statement';
import type { Operation, Payee } from '../types';

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
  /** Ligne retenue pour l'import ; un doublon est décoché d'office. */
  selected: boolean;
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const daysBetween = (a: Ymd, b: Ymd) =>
  Math.abs(fromYmd(a).getTime() - fromYmd(b).getTime()) / 86_400_000;

/** Tiers reconnu dans un libellé : le nom le plus long qui y figure. */
export function matchPayee(label: string, payees: Payee[]): Payee | undefined {
  const l = norm(label);
  if (!l) return undefined;
  let best: Payee | undefined;
  for (const p of payees) {
    const n = norm(p.name);
    if (n.length < 3 || !l.includes(n)) continue;
    if (!best || n.length > norm(best.name).length) best = p;
  }
  return best;
}

/**
 * Confronte le relevé à la base : doublons repérés, tiers et catégorie
 * proposés. Aucune écriture — c'est la fenêtre de confirmation qui décide.
 */
export async function prepareImport(
  dbId: string, accountId: string, entries: StatementEntry[],
): Promise<ImportCandidate[]> {
  const [existing, payees] = await Promise.all([
    db.operations.where('accountId').equals(accountId).toArray(),
    payeeService.list(dbId, true),
  ]);
  const vivantes = existing.filter(o => !o.deletedAt);
  const consommees = new Set<string>();

  return entries.map((e, i) => {
    const jumelle = trouveDoublon(e, vivantes, consommees);
    if (jumelle) consommees.add(jumelle.id);
    const payee = matchPayee(e.label, payees);
    return {
      ...e,
      key: `${i}:${e.date}:${e.amountCents}`,
      duplicateOfId: jumelle?.id,
      duplicateDate: jumelle?.date,
      payeeId: payee?.id,
      payeeName: payee?.name,
      categoryId: payee?.defaultCategoryId,
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
}

/** Écrit les lignes retenues. Le lot est daté pour pouvoir être retrouvé. */
export async function commitImport(
  dbId: string, accountId: string, candidates: ImportCandidate[],
): Promise<ImportResult> {
  const retenues = candidates.filter(c => c.selected);
  const batchLabel = `Import du ${toYmd(new Date())}`;
  const batchId = uid().slice(0, 8);

  await db.transaction('rw', db.operations, async () => {
    for (const c of retenues) {
      await operationService.create({
        dbId, accountId, date: c.date,
        amountCents: Math.abs(c.amountCents),
        kind: c.amountCents < 0 ? 'depense' : 'recette',
        label: c.label || undefined,
        reference: c.reference,
        payeeId: c.payeeId,
        categoryId: c.categoryId,
        note: `${batchLabel} (lot ${batchId})`,
      });
    }
  });

  return { imported: retenues.length, skipped: candidates.length - retenues.length, batchLabel };
}

/** Rattache un tiers saisi dans la fenêtre de confirmation, en le créant au besoin. */
export async function resolvePayeeForImport(dbId: string, name: string): Promise<string | undefined> {
  return payeeService.resolveByName(dbId, name);
}

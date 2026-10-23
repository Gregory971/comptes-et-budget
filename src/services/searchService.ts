import { db } from './db';
import { normalizeText } from '../utils/categorize';
import { parseAmount, parseDate } from '../utils/statement';
import { formatFr } from '../utils/date';
import { formatNum, type Cents } from '../utils/money';
import type { Ymd } from '../types';
import type { Screen } from '../store/useStore';

/**
 * Recherche globale : une seule saisie, tout ce que la base contient.
 *
 * Insensible à la casse et aux accents. Plusieurs mots : tous doivent se
 * retrouver (ET), dans n'importe quel ordre. Un mot qui se lit comme un montant
 * (« 42,50 ») ou une date (« 25/10/2026 ») est comparé aux montants et aux dates,
 * pas seulement au texte — c'est ce qu'on cherche en relisant un relevé.
 */

export type SearchKind = 'operation' | 'compte' | 'tiers' | 'categorie' | 'titre' | 'tache' | 'echeance' | 'bien' | 'projet';

export const KIND_LABEL: Record<SearchKind, string> = {
  operation: 'Opérations', compte: 'Comptes', tiers: 'Tiers', categorie: 'Catégories', titre: 'Titres',
  tache: 'Tâches et notes', echeance: 'Échéances', bien: 'Biens', projet: 'Projets',
};

/** Ordre d'affichage des groupes de résultats. */
export const KIND_ORDER = Object.keys(KIND_LABEL) as SearchKind[];

const SCREEN: Record<SearchKind, Screen> = {
  operation: 'operations', compte: 'comptes', tiers: 'preferences', categorie: 'preferences', titre: 'placements',
  tache: 'accueil', echeance: 'echeances', bien: 'biens', projet: 'biens',
};

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  detail?: string;
  date?: Ymd;
  amountCents?: Cents;
  screen: Screen;
}

export interface SearchOptions {
  kinds?: SearchKind[];
  /** Résultats gardés par type (les plus récents d'abord pour les opérations). */
  limit?: number;
}

/** Longueur minimale d'une recherche : en dessous, tout correspondrait. */
export const MIN_QUERY = 2;

interface Matcher {
  /** Vrai si chaque mot de la requête se retrouve dans le texte, le montant ou la date fournis. */
  test: (text: string, amountCents?: Cents, date?: Ymd) => boolean;
}

function makeMatcher(query: string): Matcher | null {
  const q = query.trim();
  if (q.length < MIN_QUERY) return null;
  const tokens = q.split(/\s+/).map(t => ({
    text: normalizeText(t),
    amount: /\d/.test(t) ? parseAmount(t) : null,
    date: /\d/.test(t) ? parseDate(t) : null,
  })).filter(t => t.text || t.amount !== null || t.date);
  if (tokens.length === 0) return null;
  return {
    test: (text, amountCents, date) => tokens.every(t =>
      (t.text !== '' && text.includes(t.text))
      || (t.amount !== null && amountCents !== undefined && Math.abs(amountCents) === Math.abs(t.amount))
      || (t.date !== null && date === t.date)),
  };
}

const hay = (...parts: (string | undefined | null)[]) => normalizeText(parts.filter(Boolean).join(' '));

export async function globalSearch(dbId: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const m = makeMatcher(query);
  if (!m) return [];
  const limit = options.limit ?? 25;
  const want = (k: SearchKind) => !options.kinds || options.kinds.includes(k);
  const out: SearchHit[] = [];
  const push = (hits: SearchHit[]) => out.push(...hits.slice(0, limit));

  const [accounts, payees, cats, secs, tasks, schedules, assets, projects] = await Promise.all([
    db.accounts.where('dbId').equals(dbId).toArray(),
    db.payees.where('dbId').equals(dbId).toArray(),
    db.categories.where('dbId').equals(dbId).toArray(),
    want('titre') ? db.securities.where('dbId').equals(dbId).toArray() : Promise.resolve([]),
    want('tache') ? db.tasks.where('dbId').equals(dbId).toArray() : Promise.resolve([]),
    want('echeance') ? db.schedules.where('dbId').equals(dbId).toArray() : Promise.resolve([]),
    want('bien') ? db.assets.where('dbId').equals(dbId).toArray() : Promise.resolve([]),
    want('projet') ? db.projects.where('dbId').equals(dbId).toArray() : Promise.resolve([]),
  ]);
  const accountName = new Map(accounts.map(a => [a.id, a.name]));
  const payeeName = new Map(payees.map(p => [p.id, p.name]));
  const catName = new Map(cats.map(c => [c.id, c.name]));

  if (want('operation')) {
    const ops = await db.operations.where('dbId').equals(dbId).toArray();
    push(ops
      .filter(o => !o.deletedAt)
      .filter(o => m.test(
        hay(o.label, o.note, o.reference, payeeName.get(o.payeeId ?? ''), accountName.get(o.accountId),
          catName.get(o.categoryId ?? ''), ...(o.splits ?? []).map(s => catName.get(s.categoryId ?? '')),
          formatNum(o.amountCents), o.date, formatFr(o.date)),
        o.amountCents, o.date))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map(o => ({
        kind: 'operation' as const, id: o.id,
        title: o.label || payeeName.get(o.payeeId ?? '') || (o.kind === 'virement' ? 'Virement' : catName.get(o.categoryId ?? '') ?? 'Opération'),
        detail: [accountName.get(o.accountId), payeeName.get(o.payeeId ?? ''),
          o.splits?.length ? 'ventilée' : catName.get(o.categoryId ?? '')].filter(Boolean).join(' · '),
        date: o.date, amountCents: o.amountCents, screen: SCREEN.operation,
      })));
  }
  if (want('compte')) {
    push(accounts.filter(a => m.test(hay(a.name, a.number, a.group, a.type))).map(a => ({
      kind: 'compte' as const, id: a.id, title: a.name, detail: [a.group, a.archived ? 'archivé' : a.hidden ? 'masqué' : ''].filter(Boolean).join(' · '),
      screen: SCREEN.compte,
    })));
  }
  if (want('tiers')) {
    push(payees.filter(p => m.test(hay(p.name))).map(p => ({
      kind: 'tiers' as const, id: p.id, title: p.name, detail: p.archived ? 'archivé' : undefined, screen: SCREEN.tiers,
    })));
  }
  if (want('categorie')) {
    push(cats.filter(c => m.test(hay(c.name))).map(c => ({
      kind: 'categorie' as const, id: c.id, title: c.name, detail: c.archived ? 'archivée' : undefined, screen: SCREEN.categorie,
    })));
  }
  push(secs.filter(s => m.test(hay(s.name, s.symbol))).map(s => ({
    kind: 'titre' as const, id: s.id, title: s.name, detail: s.symbol, screen: SCREEN.titre,
  })));
  push(tasks.filter(t => m.test(hay(t.text), undefined, t.due)).map(t => ({
    kind: 'tache' as const, id: t.id, title: t.text, detail: t.kind === 'note' ? 'note' : t.done ? 'terminée' : undefined,
    date: t.due, screen: SCREEN.tache,
  })));
  push(schedules.filter(s => m.test(hay(s.label, s.note, payeeName.get(s.payeeId ?? ''), catName.get(s.categoryId ?? ''), accountName.get(s.accountId)), s.amountCents, s.nextDate)).map(s => ({
    kind: 'echeance' as const, id: s.id, title: s.label || catName.get(s.categoryId ?? '') || 'Échéance',
    detail: accountName.get(s.accountId), date: s.nextDate, amountCents: s.amountCents, screen: SCREEN.echeance,
  })));
  push(assets.filter(a => m.test(hay(a.name, a.note), a.valueCents)).map(a => ({
    kind: 'bien' as const, id: a.id, title: a.name, detail: a.type, amountCents: a.valueCents, screen: SCREEN.bien,
  })));
  push(projects.filter(p => m.test(hay(p.name, p.note), p.targetAmountCents, p.deadline)).map(p => ({
    kind: 'projet' as const, id: p.id, title: p.name, date: p.deadline, amountCents: p.targetAmountCents, screen: SCREEN.projet,
  })));

  // Regroupés par type, dans un ordre stable.
  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

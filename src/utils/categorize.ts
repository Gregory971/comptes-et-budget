// Catégorisation d'une ligne de relevé bancaire à partir de son libellé.
//
// Le moteur est pur (aucun accès à la base, aucun réseau) : il reçoit les tiers,
// les règles apprises et un index de l'historique, et renvoie une PROPOSITION
// assortie d'un niveau de confiance. Il ne décide jamais à la place de
// l'utilisateur :
//  · confiance « haute » ou « moyenne » : la proposition est pré-remplie, mais
//    son origine reste affichée et l'utilisateur peut la changer ;
//  · confiance « faible » : la proposition est seulement SUGGÉRÉE, jamais posée ;
//  · libellé ambigu (l'historique se partage entre plusieurs catégories) ou
//    inconnu : la ligne reste sans catégorie plutôt que d'en recevoir une fausse.
//
// Ordre de priorité : règle apprise > tiers reconnu > historique. Une règle est
// ce que l'utilisateur a lui-même corrigé : elle l'emporte sur toute statistique.

import type { CategorizationRule, Operation, Payee } from '../types';

export type Confidence = 'haute' | 'moyenne' | 'faible';
export type ProposalSource = 'regle' | 'tiers' | 'historique';
export type LineKind = 'depense' | 'recette';

export const lineKind = (amountCents: number): LineKind => (amountCents < 0 ? 'depense' : 'recette');

export interface Proposal {
  source: ProposalSource;
  confidence: Confidence;
  categoryId?: string;
  payeeId?: string;
  /** Nombre d'opérations (ou de confirmations) qui étayent la proposition. */
  support: number;
  /** Motif lisible, affiché à l'utilisateur. */
  basis: string;
  /** Motif de libellé retenu (« carrefour market »). */
  pattern?: string;
  ruleId?: string;
  /** L'historique se partage entre plusieurs catégories : aucune n'est retenue. */
  ambiguous: boolean;
  /** Autres catégories rencontrées pour ce libellé, de la plus fréquente à la moins fréquente. */
  alternatives: { categoryId: string; count: number }[];
}

/** Une proposition « faible » ou ambiguë n'est jamais appliquée d'office. */
export const isApplied = (p: Proposal | undefined): boolean =>
  !!p && !p.ambiguous && p.confidence !== 'faible';

/* ------------------------------------------------------------- libellés */

export const normalizeText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Mots qui décrivent le MOYEN de paiement ou la mise en forme de la banque, non
 * le commerçant : ils varient d'un établissement à l'autre et ne disent rien de
 * la catégorie. Les mois sont écartés pour qu'« EDF AOUT » et « EDF SEPTEMBRE »
 * donnent le même motif.
 */
const NOISE = new Set([
  // moyens de paiement et types d'opération
  'paiement', 'payment', 'pmt', 'cb', 'carte', 'cartes', 'par', 'prlv', 'prelevement', 'prelev',
  'prlvt', 'sepa', 'vir', 'virement', 'vrt', 'inst', 'instantane', 'instant', 'recu', 'emis',
  'emission', 'reception', 'achat', 'tpe', 'ope', 'operation', 'dab', 'gab', 'dist',
  // références administratives
  'ref', 'reference', 'refer', 'mandat', 'mdt', 'rum', 'ics', 'ech', 'echeance', 'num', 'numero',
  'facture', 'fact', 'fac', 'motif', 'lib', 'libelle', 'date', 'valeur', 'compte', 'cpt',
  // civilités, formes juridiques, mots vides
  'mme', 'mlle', 'madame', 'monsieur', 'sas', 'sarl', 'eurl', 'sasu', 'sci', 'cie', 'client', 'clients',
  'part', 'des', 'les', 'une', 'aux', 'sur', 'chez', 'pour', 'dans', 'avec', 'the',
  // pays, domaines, devises
  'fr', 'www', 'com', 'http', 'https', 'eur', 'usd',
  // villes fréquentes dans les libellés de carte : le lieu change, pas le commerçant
  // (« CARREFOUR MARKET PARIS » / « … LYON »). Liste volontairement courte et sans
  // ambiguïté ; une ville absente reste un mot du motif, sans conséquence grave.
  'paris', 'lyon', 'marseille', 'toulouse', 'nantes', 'strasbourg', 'montpellier', 'bordeaux',
  'lille', 'rennes', 'reims', 'toulon', 'grenoble', 'dijon', 'angers', 'nimes', 'brest', 'limoges',
  'amiens', 'metz', 'perpignan', 'orleans', 'rouen', 'caen', 'nancy', 'avignon',
  'abymes', 'gosier', 'jarry', 'mahault', 'lamentin', 'pitre', 'gourbeyre', 'cayenne',
  // mois
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre',
  'novembre', 'decembre', 'janv', 'fevr', 'avr', 'juil', 'sept', 'oct', 'nov', 'dec',
]);

const CASH_WORDS = new Set(['dab', 'gab', 'espece', 'especes', 'distributeur', 'dist']);

/** Nombre maximal de mots conservés : au-delà, c'est de l'adresse ou du bruit. */
const MAX_TOKENS = 6;

/**
 * Mots significatifs d'un libellé, dans l'ordre. Sont écartés : les mots qui
 * contiennent un chiffre (dates, n° de carte, références, codes postaux, numéros
 * de magasin), les mots de moins de 3 lettres, les mots de bruit bancaire. Un
 * retrait d'espèces donne toujours le même motif, quel que soit le distributeur.
 */
export function significantTokens(label: string): string[] {
  const words = normalizeText(label).split(' ').filter(Boolean);
  if (words.includes('retrait') && words.some(w => CASH_WORDS.has(w))) return ['retrait', 'especes'];

  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || /\d/.test(w) || NOISE.has(w) || /^(.)\1+$/.test(w)) continue;
    if (out[out.length - 1] === w) continue;
    out.push(w);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

/**
 * Motif stable d'un libellé : ses deux premiers mots significatifs (un seul s'il
 * n'y en a qu'un). « CARREFOUR MARKET 0123 PARIS » et « CB CARREFOUR MARKET
 * 05/08 » donnent tous deux « carrefour market ». Vide : rien d'exploitable,
 * donc aucune règle ni proposition possibles.
 */
export function patternOf(label: string): string {
  return significantTokens(label).slice(0, 2).join(' ');
}

/* ---------------------------------------------------------- historique */

interface Bucket { n: number; cats: Map<string, number>; payees: Map<string, number>; }

/** Statistiques « mot(s) du libellé → catégorie », séparées dépenses / recettes. */
export interface HistoryIndex {
  uni: Map<string, Bucket>;
  bi: Map<string, Bucket>;
}

export interface IndexContext {
  /** Noms des tiers, par identifiant : un tiers rattaché enrichit le libellé. */
  payeeNames: Map<string, string>;
  /** Sens des catégories utilisables (actives). */
  categoryKinds: Map<string, LineKind>;
}

function vote(map: Map<string, Bucket>, key: string, categoryId: string, payeeId: string | undefined) {
  let b = map.get(key);
  if (!b) { b = { n: 0, cats: new Map(), payees: new Map() }; map.set(key, b); }
  b.n += 1;
  b.cats.set(categoryId, (b.cats.get(categoryId) ?? 0) + 1);
  if (payeeId) b.payees.set(payeeId, (b.payees.get(payeeId) ?? 0) + 1);
}

/**
 * Apprend de l'historique : chaque opération classée vote, pour chacun de ses
 * mots significatifs et de ses couples de mots consécutifs, en faveur de sa
 * catégorie. Sont ignorés : les opérations supprimées, les virements entre
 * comptes, celles sans catégorie, et celles dont la catégorie ne correspond pas
 * au sens de l'opération (un remboursement classé en dépense n'enseigne rien).
 */
export function buildHistoryIndex(ops: Operation[], ctx: IndexContext): HistoryIndex {
  const index: HistoryIndex = { uni: new Map(), bi: new Map() };
  for (const o of ops) {
    if (o.deletedAt || o.transferId || o.kind === 'virement' || !o.categoryId) continue;
    if (ctx.categoryKinds.get(o.categoryId) !== o.kind) continue;

    const lists = [significantTokens(o.label ?? '')];
    const payeeName = o.payeeId ? ctx.payeeNames.get(o.payeeId) : undefined;
    if (payeeName) lists.push(significantTokens(payeeName));

    const seenUni = new Set<string>();
    const seenBi = new Set<string>();
    for (const tokens of lists) {
      for (let i = 0; i < tokens.length; i++) {
        const u = `${o.kind}|${tokens[i]}`;
        if (!seenUni.has(u)) { seenUni.add(u); vote(index.uni, u, o.categoryId, o.payeeId); }
        if (i + 1 < tokens.length) {
          const b = `${o.kind}|${tokens[i]} ${tokens[i + 1]}`;
          if (!seenBi.has(b)) { seenBi.add(b); vote(index.bi, b, o.categoryId, o.payeeId); }
        }
      }
    }
  }
  return index;
}

interface Evidence {
  level: 1 | 2;
  key: string;
  n: number;
  purity: number;
  categoryId: string;
  payeeId?: string;
  confidence?: Confidence;
  alternatives: { categoryId: string; count: number }[];
}

/**
 * Niveau de confiance d'un lot d'opérations similaires.
 * Un motif de deux mots est plus spécifique qu'un seul mot (« total energies »
 * contre « total ») : il atteint la confiance plus tôt. Dès que l'historique se
 * partage (pureté trop basse), aucune confiance n'est accordée.
 */
function confidenceOf(level: 1 | 2, n: number, purity: number): Confidence | undefined {
  if (level === 2) {
    if (n >= 3 && purity >= 0.85) return 'haute';
    if (n >= 2 && purity >= 0.8) return 'moyenne';
    if (purity >= 0.6) return 'faible';
    return undefined;
  }
  if (n >= 5 && purity >= 0.9) return 'haute';
  if (n >= 3 && purity >= 0.9) return 'moyenne';
  if (n === 1 || (n >= 2 && purity >= 0.8)) return 'faible';
  return undefined;
}

function evaluate(bucket: Bucket | undefined, level: 1 | 2, key: string): Evidence | undefined {
  if (!bucket) return undefined;
  const cats = [...bucket.cats.entries()].sort((a, b) => b[1] - a[1]);
  const [categoryId, count] = cats[0];
  const purity = count / bucket.n;
  let payeeId: string | undefined;
  const topPayee = [...bucket.payees.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topPayee && topPayee[1] / bucket.n >= 0.8) payeeId = topPayee[0];
  return {
    level, key, n: bucket.n, purity, categoryId, payeeId,
    confidence: confidenceOf(level, bucket.n, purity),
    alternatives: cats.map(([id, c]) => ({ categoryId: id, count: c })),
  };
}

const RANK: Record<Confidence, number> = { haute: 3, moyenne: 2, faible: 1 };

function historyEvidence(
  tokens: string[], kind: LineKind, history: HistoryIndex,
): Evidence | undefined {
  const t0 = tokens[0];
  if (!t0) return undefined;
  const bi = tokens[1] ? evaluate(history.bi.get(`${kind}|${t0} ${tokens[1]}`), 2, `${t0} ${tokens[1]}`) : undefined;
  const uni = evaluate(history.uni.get(`${kind}|${t0}`), 1, t0);

  // Le motif à deux mots, plus spécifique, prime dès qu'il est un peu étayé.
  if (bi?.confidence && RANK[bi.confidence] >= RANK.moyenne) return bi;
  const sure = [bi, uni].filter((e): e is Evidence => !!e?.confidence);
  if (sure.length) {
    return sure.sort((a, b) => RANK[b.confidence!] - RANK[a.confidence!] || b.level - a.level)[0];
  }
  // Rien d'assez net : si l'historique existe mais se partage, on le signale.
  return bi ?? uni;
}

/* ------------------------------------------------------------- moteur */

export interface CategorizerContext {
  /** Tiers de la base. */
  payees: Payee[];
  /** Sens des catégories utilisables (actives). */
  categoryKinds: Map<string, LineKind>;
  rules: CategorizationRule[];
  history: HistoryIndex;
}

/** Tiers reconnu dans un libellé : le nom le plus long qui y figure. */
export function matchPayee(label: string, payees: Payee[]): Payee | undefined {
  const l = normalizeText(label);
  if (!l) return undefined;
  let best: Payee | undefined;
  for (const p of payees) {
    const n = normalizeText(p.name);
    if (n.length < 3 || !l.includes(n)) continue;
    if (!best || n.length > normalizeText(best.name).length) best = p;
  }
  return best;
}

const wholeWord = (label: string, name: string) =>
  ` ${normalizeText(label)} `.includes(` ${normalizeText(name)} `);

function matchRule(
  tokens: string[], kind: LineKind, ctx: CategorizerContext,
): CategorizationRule | undefined {
  let best: { rule: CategorizationRule; len: number } | undefined;
  for (const r of ctx.rules) {
    if (r.disabled || r.kind !== kind) continue;
    const catOk = !!r.categoryId && ctx.categoryKinds.get(r.categoryId) === kind;
    const payeeOk = !!r.payeeId && ctx.payees.some(p => p.id === r.payeeId && !p.archived);
    if (!catOk && !payeeOk) continue;
    const parts = r.pattern.split(' ');
    if (parts.length > tokens.length || !parts.every((w, i) => tokens[i] === w)) continue;
    if (!best
      || parts.length > best.len
      || (parts.length === best.len && (r.hits > best.rule.hits
        || (r.hits === best.rule.hits && r.updatedAt > best.rule.updatedAt)))) {
      best = { rule: r, len: parts.length };
    }
  }
  return best?.rule;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Propose un classement pour une ligne de relevé. Renvoie undefined quand rien
 * n'est connu : la ligne reste alors sans tiers ni catégorie.
 */
export function propose(
  label: string, amountCents: number, ctx: CategorizerContext,
): Proposal | undefined {
  const kind = lineKind(amountCents);
  const tokens = significantTokens(label);
  const pattern = tokens.slice(0, 2).join(' ');
  const activePayees = ctx.payees.filter(p => !p.archived);

  // 1. Règle apprise : ce que l'utilisateur a lui-même corrigé.
  const rule = tokens.length ? matchRule(tokens, kind, ctx) : undefined;
  if (rule) {
    const single = !rule.pattern.includes(' ');
    const confidence: Confidence = rule.hits >= (single ? 3 : 2) ? 'haute' : 'moyenne';
    const categoryId = rule.categoryId && ctx.categoryKinds.get(rule.categoryId) === kind
      ? rule.categoryId : undefined;
    const payeeId = rule.payeeId && activePayees.some(p => p.id === rule.payeeId)
      ? rule.payeeId : undefined;
    return {
      source: 'regle', confidence, categoryId, payeeId,
      support: rule.hits, pattern: rule.pattern, ruleId: rule.id,
      basis: `Règle apprise « ${rule.pattern} » (${plural(rule.hits, 'confirmation', 'confirmations')})`,
      ambiguous: false, alternatives: [],
    };
  }

  const evidence = historyEvidence(tokens, kind, ctx.history);

  // 2. Tiers déjà connu, nommé dans le libellé.
  const payee = matchPayee(label, activePayees);
  if (payee) {
    const exact = wholeWord(label, payee.name);
    const def = payee.defaultCategoryId && ctx.categoryKinds.get(payee.defaultCategoryId) === kind
      ? payee.defaultCategoryId : undefined;
    const histCat = evidence?.confidence && RANK[evidence.confidence] >= RANK.moyenne
      ? evidence.categoryId : undefined;

    if (def && histCat && histCat !== def && evidence) {
      // Le tiers renvoie vers une catégorie, l'historique du libellé vers une
      // autre : ne rien imposer, signaler le conflit.
      return {
        source: 'tiers', confidence: 'faible', categoryId: def, payeeId: payee.id,
        support: evidence.n, pattern: evidence.key, ambiguous: false,
        alternatives: evidence.alternatives,
        basis: `Conflit : le tiers « ${payee.name} » renvoie à une catégorie, `
          + `mais ${plural(evidence.n, 'opération passée', 'opérations passées')} « ${evidence.key} » vont ailleurs`,
      };
    }
    const categoryId = def ?? histCat;
    return {
      source: 'tiers', confidence: exact ? 'haute' : 'faible', categoryId, payeeId: payee.id,
      support: 1, pattern: pattern || undefined, ambiguous: false, alternatives: [],
      basis: exact
        ? `Tiers « ${payee.name} » reconnu dans le libellé`
        : `Le libellé contient « ${payee.name} » collé à d’autres lettres : reconnaissance incertaine`,
    };
  }

  // 3. Historique des opérations déjà saisies ou importées.
  if (!evidence) return undefined;
  if (!evidence.confidence) {
    // Plusieurs catégories pour ce même libellé : on le dit, on ne choisit pas.
    return {
      source: 'historique', confidence: 'faible', support: evidence.n, pattern: evidence.key,
      ambiguous: true, alternatives: evidence.alternatives,
      basis: `Libellé ambigu : « ${evidence.key} » a été classé dans plusieurs catégories`,
    };
  }
  const payeeId = evidence.payeeId && activePayees.some(p => p.id === evidence.payeeId)
    ? evidence.payeeId : undefined;
  return {
    source: 'historique', confidence: evidence.confidence,
    categoryId: evidence.categoryId, payeeId,
    support: evidence.n, pattern: evidence.key, ambiguous: false,
    alternatives: evidence.alternatives,
    basis: `${plural(evidence.n, 'opération passée', 'opérations passées')} « ${evidence.key} » `
      + `(${pct(evidence.purity)} dans cette catégorie)`,
  };
}

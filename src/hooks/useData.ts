import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { accountService } from '../services/accountService';
import { payeeService, paymentMethodService, categoryService } from '../services/referentialService';
import { assetService, projectService } from '../services/patrimoineService';
import { useStore } from '../store/useStore';
import type {
  Account, Asset, Category, CategoryGroup, Database, Payee, PaymentMethod, Project, Cents, Ymd,
} from '../types';

// Références stables : un littéral [] créé à chaque rendu casserait la
// mémoïsation des hooks qui en dépendent.
const NO_ACCOUNTS: Account[] = [];
const NO_PAYEES: Payee[] = [];
const NO_METHODS: PaymentMethod[] = [];
const NO_CATS: Category[] = [];
const NO_GROUPS: CategoryGroup[] = [];
const NO_BALANCES: Record<string, Cents> = {};
const NO_ASSETS: Asset[] = [];
const NO_PROJECTS: Project[] = [];

/**
 * Lecture réactive des données : chaque hook ne se réexécute que si les tables
 * qu'il interroge changent (dexie-react-hooks). Remplace le rechargement manuel
 * par compteur « rev » et les useEffect de chargement disséminés dans les écrans.
 */

export function useBases(): Database[] | undefined {
  return useLiveQuery(() => db.databases.toArray(), []);
}

export function useActiveDatabase(): { database?: Database; loading: boolean } {
  const activeDbId = useStore(s => s.activeDbId);
  const bases = useBases();
  if (bases === undefined) return { loading: true };
  const database = bases.find(b => b.id === activeDbId) ?? bases[0];
  return { database: database ? { ...database, profile: database.profile ?? 'perso' } : undefined, loading: false };
}

export function useAccounts(dbId?: string, includeArchived = false): Account[] {
  return useLiveQuery(
    () => (dbId ? accountService.list(dbId, includeArchived) : Promise.resolve([])),
    [dbId, includeArchived], NO_ACCOUNTS,
  ) ?? NO_ACCOUNTS;
}

export function useBalances(dbId?: string, upTo?: Ymd): Record<string, Cents> {
  return useLiveQuery(
    () => (dbId ? accountService.balances(dbId, upTo) : Promise.resolve({})),
    [dbId, upTo], NO_BALANCES,
  ) ?? NO_BALANCES;
}

export interface Referentials {
  dbId: string;
  payees: Payee[];
  methods: PaymentMethod[];
  cats: Category[];
  groups: CategoryGroup[];
  catsForKind: (kind: 'depense' | 'recette') => Category[];
  cat: (id?: string) => Category | undefined;
  payeeName: (id?: string) => string;
  methodName: (id?: string) => string;
  catName: (id?: string) => string;
}

/**
 * Référentiels d'une base, avec les fonctions de résolution.
 * La valeur de retour est mémoïsée : sans cela, l'objet était recréé à chaque
 * rendu, ce qui neutralisait les useMemo des écrans qui en dépendaient.
 */
export function useReferentials(dbId: string): Referentials {
  const payees = useLiveQuery(() => payeeService.list(dbId, true), [dbId], NO_PAYEES) ?? NO_PAYEES;
  const methods = useLiveQuery(() => paymentMethodService.list(dbId, true), [dbId], NO_METHODS) ?? NO_METHODS;
  const cats = useLiveQuery(() => categoryService.listCategories(dbId, true), [dbId], NO_CATS) ?? NO_CATS;
  const groups = useLiveQuery(() => categoryService.listGroups(dbId, true), [dbId], NO_GROUPS) ?? NO_GROUPS;

  return useMemo(() => {
    const catById = new Map(cats.map(c => [c.id, c]));
    const payeeById = new Map(payees.map(p => [p.id, p]));
    const methodById = new Map(methods.map(m => [m.id, m]));
    return {
      dbId, payees, methods, cats, groups,
      catsForKind: (kind) => {
        const gids = new Set(groups.filter(g => g.kind === kind && !g.archived).map(g => g.id));
        return cats.filter(c => !c.archived && gids.has(c.groupId));
      },
      cat: (id) => (id ? catById.get(id) : undefined),
      payeeName: (id) => (id ? payeeById.get(id)?.name ?? '' : ''),
      methodName: (id) => (id ? methodById.get(id)?.name ?? '' : ''),
      catName: (id) => (id ? catById.get(id)?.name ?? 'Non catégorisé' : 'Non catégorisé'),
    };
  }, [dbId, payees, methods, cats, groups]);
}

/** Biens et projets d'épargne, pour le rattachement d'une opération. */
export function usePatrimoine(dbId: string): { assets: Asset[]; projects: Project[] } {
  const assets = useLiveQuery(() => assetService.list(dbId), [dbId], NO_ASSETS) ?? NO_ASSETS;
  const projects = useLiveQuery(() => projectService.list(dbId), [dbId], NO_PROJECTS) ?? NO_PROJECTS;
  return useMemo(() => ({ assets, projects }), [assets, projects]);
}

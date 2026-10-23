import { create } from 'zustand';
import { dbService } from '../services/dbService';
import type { Profile, Ymd } from '../types';

export type Screen =
  | 'accueil' | 'comptes' | 'operations' | 'echeances'
  | 'budget' | 'placements' | 'biens' | 'bilans' | 'preferences' | 'comptabiliser';

/**
 * État de session uniquement (écran courant, base active).
 *
 * Optimisation P2 : le store ne porte plus de copie des données ni le compteur
 * « rev ». Chaque écriture incrémentait ce compteur, présent dans les
 * dépendances de tous les useEffect : modifier un tiers rechargeait les
 * opérations, les budgets et les soldes de tous les écrans montés. Les données
 * sont désormais lues par useLiveQuery (dexie-react-hooks), qui ne rafraîchit
 * qu'en cas de changement réel des tables observées.
 */
/** Recherche à ouvrir dans l'écran Opérations : texte déjà saisi et mois à afficher. */
export interface PendingFocus { search: string; date?: Ymd }

interface UiState {
  activeDbId?: string;
  screen: Screen;
  /** Posé par la recherche globale, consommé (et effacé) par l'écran Opérations à son ouverture. */
  pendingFocus?: PendingFocus;
  setPendingFocus: (f?: PendingFocus) => void;
  setScreen: (s: Screen) => void;
  setActiveDbId: (id: string) => void;
  createBase: (name: string, profile?: Profile) => Promise<string>;
  switchBase: (id: string) => void;
}

const ACTIVE_KEY = 'cb_active_db';

export const useStore = create<UiState>((set) => ({
  activeDbId: localStorage.getItem(ACTIVE_KEY) ?? undefined,
  screen: 'accueil',

  setScreen: (screen) => set({ screen }),

  setPendingFocus: (pendingFocus) => set({ pendingFocus }),

  setActiveDbId: (id) => { dbService.setActive(id); set({ activeDbId: id }); },

  async createBase(name, profile = 'perso') {
    const base = await dbService.create(name, profile);
    set({ activeDbId: base.id, screen: 'accueil' });
    return base.id;
  },

  switchBase(id) { dbService.setActive(id); set({ activeDbId: id, screen: 'accueil' }); },
}));

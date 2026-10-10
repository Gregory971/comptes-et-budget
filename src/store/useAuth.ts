import { create } from 'zustand';
import { authService, cryptoAvailable, DEFAULT_IDLE_MINUTES } from '../services/authService';

/**
 * État de session de l'accès — en mémoire uniquement.
 *
 * Le fait d'être connecté n'est PAS persisté (ni localStorage, ni
 * sessionStorage) : un drapeau écrit quelque part serait un drapeau qu'on peut
 * poser à la main. Recharger la page ou rouvrir l'application redemande donc les
 * identifiants — comme une application bancaire, et à l'inverse d'une session de
 * site web. C'est le prix d'un verrou qui n'a pas de serveur pour dire « cette
 * personne est bien connectée ».
 *
 * Quatre états :
 *  · checking  — lecture de la configuration, rien n'est encore affiché ;
 *  · setup     — aucun accès configuré : création imposée au premier lancement ;
 *  · locked    — accès configuré, identifiants attendus ;
 *  · unlocked  — session ouverte.
 *
 * `email` n'est renseignée qu'APRÈS une connexion réussie : l'écran de
 * verrouillage d'un lancement à froid ne la connaît pas, et ne doit donc pas la
 * montrer. Après un verrouillage en cours de session, elle est déjà connue de la
 * page, ce qui permet de ne redemander que le mot de passe.
 */
export type AuthStatus = 'checking' | 'setup' | 'locked' | 'unlocked';

interface AuthState {
  status: AuthStatus;
  /** Verrou actif : l'application peut être verrouillée et le délai s'applique. */
  guarded: boolean;
  email: string;
  idleMinutes: number;
  /** Lit la configuration et fixe l'état de départ. Sans effet une fois initialisé. */
  init: () => Promise<void>;
  /** Relit la configuration sans changer l'état (après un réglage). */
  refresh: () => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => void;
  /** Rouvre l'écran de création (activer la protection après l'avoir désactivée). */
  beginSetup: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'checking',
  guarded: false,
  email: '',
  idleMinutes: DEFAULT_IDLE_MINUTES,

  async init() {
    if (get().status !== 'checking') return;
    const s = await authService.state();
    // Sans WebCrypto, créer l'accès est impossible : l'imposer au premier
    // lancement rendrait l'application inutilisable. On l'ouvre donc sans verrou
    // — ce qui est son comportement d'avant — et la page Sécurité explique
    // pourquoi. Si un accès existe déjà, on le respecte : le laisser s'ouvrir sans
    // identifiants parce que le navigateur est déficient serait un contournement.
    if (s.kind === 'none' && !cryptoAvailable()) set({ status: 'unlocked', guarded: false });
    else if (s.kind === 'none') set({ status: 'setup', guarded: false });
    // Protection désactivée volontairement : l'application s'ouvre, comme avant.
    else if (s.kind === 'off') set({ status: 'unlocked', guarded: false });
    else set({ status: 'locked', guarded: true, idleMinutes: s.idleMinutes });
  },

  async refresh() {
    const s = await authService.state();
    if (s.kind === 'on') set({ guarded: true, email: s.email, idleMinutes: s.idleMinutes });
    else set({ guarded: false, email: '' });
  },

  async unlock() {
    await get().refresh();
    set({ status: 'unlocked' });
  },

  lock() {
    if (get().guarded) set({ status: 'locked' });
  },

  beginSetup() {
    set({ status: 'setup' });
  },
}));

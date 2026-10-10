import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

/**
 * Mises à jour de l'application installée (service worker).
 *
 * Le piège que ce fichier existe pour éviter : avec l'ancien réglage
 * `registerType: 'autoUpdate'`, un déploiement n'était jamais annoncé. Le
 * navigateur télécharge la nouvelle version en arrière-plan pendant que l'ancienne
 * continue de s'afficher ; l'utilisateur pouvait ainsi travailler des jours sur
 * une version périmée sans en être informé. Le mode `prompt` garde la nouvelle
 * version en attente et laisse la page décider — ici, demander.
 *
 * Aucun appel réseau ne part de la page : `connect-src 'none'` (src/utils/csp.ts)
 * reste intact. La vérification périodique passe par `registration.update()`, que
 * le NAVIGATEUR exécute pour le service worker ; un `fetch` du script depuis la
 * page, tel que le propose la documentation de vite-plugin-pwa, serait refusé.
 */

/** Intervalle entre deux recherches de nouvelle version tant que la page reste ouverte. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface PwaUpdateState {
  /** Une nouvelle version est téléchargée et attend qu'on l'active. */
  needRefresh: boolean;
  /** L'utilisateur a choisi « Plus tard » ; la notice revient si une autre version arrive. */
  refreshDismissed: boolean;
  /** Première installation terminée : l'application fonctionne désormais hors ligne. */
  offlineReady: boolean;
  /** Activation en cours (le rechargement suit de lui-même). */
  applying: boolean;
  error: string | null;
  dismissRefresh: () => void;
  dismissOffline: () => void;
  /** Active la nouvelle version et recharge la page. NE DEMANDE RIEN : voir UpdateNotice. */
  apply: () => Promise<void>;
}

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

export const usePwaUpdate = create<PwaUpdateState>((set) => ({
  needRefresh: false,
  refreshDismissed: false,
  offlineReady: false,
  applying: false,
  error: null,

  dismissRefresh: () => set({ refreshDismissed: true }),
  dismissOffline: () => set({ offlineReady: false }),

  async apply() {
    set({ applying: true, error: null });
    try {
      if (!updateSW) throw new Error('service worker absent');
      // `true` : recharge la page dès que la nouvelle version a pris la main.
      await updateSW(true);
    } catch (e) {
      console.error('Activation de la nouvelle version impossible :', e);
      set({
        applying: false,
        error: 'Le rechargement a échoué. Fermez puis rouvrez l’application pour obtenir la nouvelle version.',
      });
    }
  },
}));

/**
 * Enregistre le service worker et branche ses événements sur le store.
 * À appeler une fois, au lancement. Sans effet utile en développement et dans le
 * fichier autonome, où aucun service worker n'existe.
 */
export function startPwaUpdates(): void {
  try {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => usePwaUpdate.setState({ needRefresh: true, refreshDismissed: false }),
      onOfflineReady: () => usePwaUpdate.setState({ offlineReady: true }),
      onRegisteredSW: (_url, registration) => {
        if (!registration) return;
        const check = () => {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
          // Rejette hors ligne ou en cas d'échec réseau : sans conséquence.
          registration.update().catch(() => {});
        };
        setInterval(check, CHECK_INTERVAL_MS);
        // Retour sur l'onglet après une longue absence : on n'attend pas l'heure suivante.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      },
      onRegisterError: (e) => console.error('Enregistrement du service worker impossible :', e),
    });
  } catch (e) {
    console.error('Mises à jour de l’application indisponibles :', e);
  }
}

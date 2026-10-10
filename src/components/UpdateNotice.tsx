import { useEffect, useState } from 'react';
import { usePwaUpdate } from '../services/pwaUpdate';
import { useAuth } from '../store/useAuth';
import { hasPendingInput, watchPendingInput } from '../utils/pendingInput';

/** Durée d'affichage de « Application prête hors ligne » (information, non bloquante). */
export const OFFLINE_NOTICE_MS = 8000;

/**
 * Notice de mise à jour de l'application.
 *
 * Montée À CÔTÉ de LockGate (voir main.tsx), jamais dedans : elle reste visible
 * sur l'écran de connexion, y compris quand l'inactivité vient de démonter
 * l'application. Elle ne lit aucune donnée et ne touche pas à l'accès : le
 * rechargement repart d'un état verrouillé — la session n'est tenue qu'en
 * mémoire (useAuth) —, il ne peut donc rien ouvrir.
 *
 * Règle d'or : un rechargement ne se fait jamais sur une saisie en cours sans
 * que l'utilisateur ait confirmé. Si une fenêtre est ouverte ou un champ
 * rempli, « Recharger » passe par une confirmation ; « Plus tard » ne coûte
 * rien, et la notice revient au prochain lancement tant que la mise à jour n'est
 * pas appliquée.
 */
export function UpdateNotice() {
  const needRefresh = usePwaUpdate(s => s.needRefresh);
  const dismissed = usePwaUpdate(s => s.refreshDismissed);
  const offlineReady = usePwaUpdate(s => s.offlineReady);
  const applying = usePwaUpdate(s => s.applying);
  const error = usePwaUpdate(s => s.error);
  const apply = usePwaUpdate(s => s.apply);
  const dismissRefresh = usePwaUpdate(s => s.dismissRefresh);
  const dismissOffline = usePwaUpdate(s => s.dismissOffline);
  const relock = useAuth(s => s.guarded && s.status === 'unlocked');

  const [confirming, setConfirming] = useState(false);

  // Le suivi doit exister AVANT la première frappe : il est donc posé dès le
  // montage, que la notice soit visible ou non.
  useEffect(() => watchPendingInput(), []);

  useEffect(() => {
    if (!offlineReady || needRefresh) return;
    const t = setTimeout(dismissOffline, OFFLINE_NOTICE_MS);
    return () => clearTimeout(t);
  }, [offlineReady, needRefresh, dismissOffline]);

  const showRefresh = needRefresh && !dismissed;

  function reload() {
    if (hasPendingInput()) setConfirming(true);
    else void apply();
  }

  if (showRefresh && confirming) {
    return (
      <div className="toast update-notice" role="alert">
        <span>
          Une saisie ou une fenêtre est ouverte : recharger maintenant l’abandonnerait.
          {relock && ' Votre accès sera aussi redemandé.'}
        </span>
        <button className="btn ghost" autoFocus onClick={() => setConfirming(false)}>
          Revenir
        </button>
        <button className="btn ghost" disabled={applying} onClick={() => void apply()}>
          {applying ? 'Rechargement…' : 'Recharger quand même'}
        </button>
        {error && <span>{error}</span>}
      </div>
    );
  }

  if (showRefresh) {
    return (
      <div className="toast update-notice" role="status">
        <span>
          Nouvelle version disponible —
          {relock && ' le rechargement redemandera votre accès.'}
        </span>
        <button className="btn ghost" disabled={applying} onClick={reload}>
          {applying ? 'Rechargement…' : 'Recharger'}
        </button>
        <button className="linklike" onClick={dismissRefresh}>Plus tard</button>
        {error && <span>{error}</span>}
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="toast update-notice" role="status">
        <span>Application prête hors ligne.</span>
        <button className="linklike" onClick={dismissOffline}>Fermer</button>
      </div>
    );
  }

  return null;
}

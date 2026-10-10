import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../store/useAuth';
import { useIdleLock } from '../hooks/useIdleLock';
import { AuthScreen } from '../screens/AuthScreen';

/**
 * Barrière d'accès : n'affiche l'application que session ouverte.
 *
 * `children` n'est MONTÉ qu'une fois connecté — pas simplement masqué derrière
 * un calque. Tant que l'accès n'est pas accordé, aucun écran ne s'exécute, aucune
 * requête ne lit la base, et rien de sensible n'existe dans le DOM. C'est aussi
 * ce qui arrête, pendant le verrouillage, la sauvegarde automatique et la
 * comptabilisation des échéances, qui vivent dans l'application.
 *
 * Contrepartie assumée : un verrouillage pour inactivité démonte l'application,
 * et une saisie en cours est perdue. Le délai (15 min par défaut) est long
 * devant le temps d'une saisie, et la perte vaut mieux qu'un formulaire de
 * montants resté lisible sur un écran abandonné.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const status = useAuth(s => s.status);
  const guarded = useAuth(s => s.guarded);
  const idleMinutes = useAuth(s => s.idleMinutes);
  const init = useAuth(s => s.init);
  const lock = useAuth(s => s.lock);

  useEffect(() => { void init(); }, [init]);
  useIdleLock(status === 'unlocked' && guarded, idleMinutes, lock);

  if (status === 'checking') {
    return <div className="auth-wait" role="status">Chargement…</div>;
  }
  if (status !== 'unlocked') return <AuthScreen />;
  return <>{children}</>;
}

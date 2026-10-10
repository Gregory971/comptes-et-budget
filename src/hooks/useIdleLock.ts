import { useEffect, useRef } from 'react';

/** Gestes qui comptent comme une présence. Le survol de la souris en fait partie. */
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Appelle `onIdle` après `minutes` minutes sans geste de l'utilisateur.
 *
 * Le délai se mesure sur des HORODATAGES et non sur un minuteur unique : les
 * navigateurs ralentissent, voire suspendent, les minuteurs d'un onglet en
 * arrière-plan, et un ordinateur en veille n'en fait tourner aucun. Un
 * `setTimeout` de quinze minutes poserait donc un verrou qui n'arrive jamais. On
 * compare plutôt l'instant présent au dernier geste, à intervalle régulier et
 * surtout au retour de l'onglet — le moment où quelqu'un d'autre peut se
 * trouver devant l'écran.
 */
export function useIdleLock(active: boolean, minutes: number, onIdle: () => void): void {
  // Valeur d'attente : l'effet ci-dessous la remet à l'instant présent dès que
  // la surveillance démarre, et Date.now() n'a pas sa place dans un rendu.
  const last = useRef(0);
  const callback = useRef(onIdle);

  useEffect(() => { callback.current = onIdle; });

  useEffect(() => {
    if (!active) return;
    last.current = Date.now();
    const limite = minutes * 60_000;

    const toucher = () => { last.current = Date.now(); };
    const verifier = () => { if (Date.now() - last.current >= limite) callback.current(); };
    const auRetour = () => { if (document.visibilityState === 'visible') verifier(); };

    for (const e of ACTIVITY) window.addEventListener(e, toucher, { passive: true });
    document.addEventListener('visibilitychange', auRetour);
    const minuteur = setInterval(verifier, 10_000);

    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, toucher);
      document.removeEventListener('visibilitychange', auRetour);
      clearInterval(minuteur);
    };
  }, [active, minutes]);
}

/**
 * Thème d'affichage — clair, sombre ou réglage du système.
 *
 * Choix d'appareil et non de base : une même sauvegarde ouverte sur un
 * ordinateur de bureau et sur un téléphone n'impose pas le même confort de
 * lecture. Le réglage vit donc dans localStorage, à côté de la base active, et
 * n'entre pas dans le fichier de sauvegarde.
 *
 * L'attribut « data-mode » est posé sur <html> : « data-theme » sert déjà à
 * distinguer les profils perso et pro sur le conteneur de l'application.
 */

export type ThemeMode = 'systeme' | 'clair' | 'sombre';

const KEY = 'cb_theme';
const MODES: ThemeMode[] = ['systeme', 'clair', 'sombre'];

export const THEME_LABEL: Record<ThemeMode, string> = {
  systeme: 'Système',
  clair: 'Clair',
  sombre: 'Sombre',
};

/** Réglage enregistré ; « systeme » par défaut et en cas de valeur illisible. */
export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v as ThemeMode) ? (v as ThemeMode) : 'systeme';
  } catch {
    // Navigation privée ou stockage refusé : le thème du système fait foi.
    return 'systeme';
  }
}

/** Applique le réglage au document. « systeme » retire l'attribut : la
 *  requête média prefers-color-scheme reprend alors la main. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'systeme') delete root.dataset.mode;
  else root.dataset.mode = mode;
}

export function writeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Réglage non conservé, mais appliqué pour la session en cours.
  }
  applyTheme(mode);
}

/** Thème effectivement affiché, requête média comprise. */
export function resolvedTheme(mode: ThemeMode = readTheme()): 'clair' | 'sombre' {
  if (mode !== 'systeme') return mode;
  const mq = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)');
  return mq && mq.matches ? 'sombre' : 'clair';
}

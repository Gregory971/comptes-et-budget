/**
 * Politique de sécurité du contenu (CSP).
 *
 * L'application promet que les données ne quittent jamais l'appareil. Sans CSP,
 * cette promesse ne repose que sur un constat de lecture — le code n'appelle
 * aucune API réseau — qu'une dépendance ajoutée plus tard pourrait rompre
 * silencieusement. `connect-src 'none'` la rend opposable : le navigateur
 * lui-même refuse tout fetch, XMLHttpRequest, WebSocket et sendBeacon.
 *
 * Déclarée ici plutôt que dans `vite.config.ts` pour être couverte par le
 * contrôle de types et par `csp.test.ts` ; la configuration de construction
 * l'importe et l'injecte dans index.html sous forme de balise <meta>.
 */

/**
 * `frame-ancestors` est délibérément absent : la directive est ignorée
 * lorsqu'elle est déclarée par balise <meta>, et GitHub Pages ne permet pas
 * d'émettre d'en-tête HTTP. L'y inscrire donnerait l'illusion d'une protection
 * contre le détournement de clic (clickjacking) qui ne s'appliquerait pas.
 *
 * @param single fichier autonome (`build:single`) : script et feuille de style
 *   sont incorporés au HTML, ce qui impose `'unsafe-inline'` pour les scripts.
 *   La version servie en HTTP charge des fichiers séparés et s'en passe.
 */
export function contentSecurityPolicy(single: boolean): string {
  return [
    "default-src 'self'",
    // Le cœur de la garantie local-first.
    "connect-src 'none'",
    single ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    // Feuille de style incorporée au fichier autonome, et attributs `style`
    // produits par React dans les deux modes.
    "style-src 'self' 'unsafe-inline'",
    // L'icône est une URI `data:` incorporée dans index.html.
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

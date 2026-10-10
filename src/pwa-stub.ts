/**
 * Remplaçant de `virtual:pwa-register` pour `npm run build:single`.
 *
 * Le fichier autonome s'ouvre en file:// où aucun service worker ne peut
 * s'enregistrer, et la configuration n'y charge pas vite-plugin-pwa : le module
 * virtuel n'existe donc pas. vite.config.ts redirige l'import vers ce fichier,
 * qui ne fait rien — il n'y a ni mise à jour ni mode hors ligne à annoncer.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}

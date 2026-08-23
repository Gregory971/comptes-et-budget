/**
 * Réglages du service worker.
 *
 * Le piège que ce fichier existe pour éviter : `navigateFallback` renvoie
 * index.html pour toute navigation qui ne correspond à aucun fichier
 * précaché — et une URL portant une chaîne de requête (`?code=…`) n'y
 * correspond justement pas. Le retour de la connexion Microsoft,
 * `onedrive.html?code=…&state=…`, se voyait donc servir L'APPLICATION à la
 * place de la passerelle : la page chargée n'avait ni le script d'échange des
 * jetons, ni le droit de joindre le réseau, et la connexion échouait sans le
 * moindre message. Le symptôme est invisible en développement (aucun service
 * worker) et n'apparaît que sur le site construit.
 *
 * La liste d'exclusion ci-dessous laisse ces navigations aller au réseau.
 */
export const NAVIGATE_FALLBACK_DENYLIST = [/onedrive\.html/];

export function workboxOptions(base: string) {
  return {
    globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
    navigateFallback: `${base}index.html`,
    navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
  };
}

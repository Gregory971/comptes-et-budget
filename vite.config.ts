import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import { contentSecurityPolicy, gatewayContentSecurityPolicy } from './src/utils/csp';
import { workboxOptions } from './src/utils/pwa';

/**
 * Injecte la CSP (définie et testée dans src/utils/csp.ts) à la construction
 * seulement : en développement, Vite a besoin d'un WebSocket et de scripts en
 * ligne pour le rechargement à chaud.
 */
const cspPlugin = (single: boolean): Plugin => ({
  name: 'comptes-budget:csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    // Chaque page reçoit SA politique : l'application garde connect-src 'none',
    // la passerelle OneDrive est la seule à pouvoir joindre Microsoft.
    handler: (_html, ctx) => [{
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: ctx.path.endsWith('onedrive.html')
          ? gatewayContentSecurityPolicy()
          : contentSecurityPolicy(single),
      },
      injectTo: 'head-prepend',
    }],
  },
});

/**
 * Deux modes de production :
 *  · `npm run build`        → application classique (dist/), installable en PWA
 *                             lorsqu'elle est servie en HTTP ;
 *  · `npm run build:single` → fichier HTML autonome unique, ouvrable directement
 *                             depuis l'explorateur de fichiers (protocole file://).
 *
 * Un service worker ne peut pas s'enregistrer sous file:// : la PWA est donc
 * volontairement désactivée dans le mode « single file ». Ce mode remplace la
 * production manuelle de Comptes-et-Budget-v2.html, qui risquait de diverger
 * silencieusement du code source.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  // Chemin de publication : relatif par défaut (ouverture directe du fichier),
  // absolu pour GitHub Pages, où le site est servi depuis un sous-répertoire
  // (/comptes-et-budget/). Le service worker exige un chemin absolu pour établir
  // correctement sa portée.
  const base = single ? './' : (process.env.VITE_BASE ?? './');
  return {
    base,
    plugins: [
      react(),
      cspPlugin(single),
      ...(single ? [viteSingleFile()] : [VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Comptes & Budget',
          short_name: 'Comptes',
          description: 'Gestionnaire de comptes personnels local-first, montants en euros.',
          lang: 'fr',
          theme_color: '#00a8a9',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        // Défini et testé dans src/utils/pwa.ts : la passerelle OneDrive doit
        // échapper au repli de navigation, sans quoi le retour de connexion
        // Microsoft se voit servir l'application à sa place.
        workbox: workboxOptions(base),
      })]),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2020',
      // Fichier autonome : les polices doivent être incorporées en base64, sans
      // quoi elles seraient introuvables une fois le fichier ouvert seul en
      // file://. En mode servi, on garde des fichiers séparés, mieux mis en cache.
      assetsInlineLimit: single ? 64 * 1024 : 4096,
      ...(single ? {} : {
        rollupOptions: {
          // Deux pages : l'application et la passerelle OneDrive. Le fichier
          // autonome n'en porte qu'une — ouvert en file://, il ne peut de toute
          // façon pas servir d'URI de redirection OAuth.
          input: {
            main: resolve(__dirname, 'index.html'),
            onedrive: resolve(__dirname, 'onedrive.html'),
          },
          output: {
            // Le noyau React change rarement : le séparer améliore la mise en
            // cache entre deux versions de l'application.
            manualChunks: { react: ['react', 'react-dom'], dexie: ['dexie', 'dexie-react-hooks'] },
          },
        },
      }),
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});

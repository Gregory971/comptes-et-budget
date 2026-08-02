import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';

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
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
          navigateFallback: `${base}index.html`,
        },
      })]),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2020',
      ...(single ? {} : {
        rollupOptions: {
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

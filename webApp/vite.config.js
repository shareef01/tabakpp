import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Build identity (item 17): a stable identifier for THIS commit/release, not
 * a fresh value on every invocation. `Date.now()` here previously meant an
 * identical source tree produced completely different asset names on every
 * build — defeating long-term browser/CDN caching between deploys of
 * unchanged code, and forcing every open tab's one-shot reload check
 * (`__BUILD_TIME__` in App.jsx) to fire on a no-op redeploy. CI sets
 * `VITE_BUILD_ID` (or `GITHUB_SHA` is picked up automatically) to the git
 * commit SHA; local dev falls back to a fixed string so repeated `npm run
 * build`/`dev` runs of the same tree are byte-for-byte stable. Per-file
 * cache-busting is still primarily content hashes (`[hash]` below) — this ID
 * is only an extra, human-readable build marker, not the caching mechanism.
 */
const BUILD_ID = process.env.VITE_BUILD_ID || process.env.GITHUB_SHA || 'dev';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'offline-shell-snapshot',
      // Copy the final, hashed production HTML before VitePWA's closeBundle
      // precache scan. A separate URL keeps normal index/root requests out of
      // the precache route, so available deployments still win on the network.
      writeBundle(output) {
        copyFileSync(resolve(output.dir, 'index.html'), resolve(output.dir, 'offline-shell.html'));
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'splash-*.png'],
      manifest: false, // use public/manifest.json
      workbox: {
        // Versioned offline snapshot only; normal HTML stays network-first.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}', 'offline-shell.html'],
        // Keep HEIC converter out of the install precache (lazy-loaded on demand).
        globIgnores: ['**/heic2any*.js'],
        // generateSW's NavigationRoute would serve precached HTML before the
        // runtime strategy. Use one network-first route with an error fallback.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Firebase / Google APIs — never cache auth or Firestore payloads
            urlPattern: ({ url }) =>
              url.hostname.includes('googleapis.com') ||
              url.hostname.includes('firebaseio.com') ||
              url.hostname.includes('firebaseapp.com') ||
              url.hostname.includes('gstatic.com') ||
              url.hostname.includes('google.com'),
            handler: 'NetworkOnly',
          },
          {
            // Hashed static assets
            urlPattern: ({ request, url }) =>
              request.destination === 'script' ||
              request.destination === 'style' ||
              url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tabak-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // No runtime HTML cache: it could retain old asset references after
            // precache activation. Only a network failure uses the
            // revisioned snapshot; API/auth endpoints never receive that shell.
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && url.origin === self.location.origin &&
              !/^\/(?:api|__)/.test(url.pathname),
            handler: 'NetworkOnly',
            options: {
              precacheFallback: { fallbackURL: '/offline-shell.html' },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_ID),
  },
  build: {
    manifest: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Content hashes (`[hash]`) do cache-busting — identical code
        // always produces the same hash, ensuring stable long-term caching.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Split heavy third-party libs out of the main entry chunk so they
        // download in parallel and cache independently of app code. Recharts
        // stays isolated so it only loads with the lazy History screen.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('heic2any')) return 'heic2any';
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase';
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/victory-')) return 'recharts';
          if (id.includes('/framer-motion/') || id.includes('/motion-dom/') || id.includes('/motion-utils/')) return 'framer';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react';
          return 'vendor';
        }
      }
    }
  }
})

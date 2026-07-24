import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const BUILD_ID = Date.now();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'splash-*.png'],
      manifest: false, // use public/manifest.json
      workbox: {
        // App shell only — never precache HTML as sticky; network-first navigations.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        // Keep HEIC converter out of the install precache (lazy-loaded on demand).
        globIgnores: ['**/heic2any*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/__/],
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
            // App shell navigations — prefer network so deploys win quickly
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tabak-pages',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
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
        // Enforce unique names for all assets to bust CDN and Browser caches
        entryFileNames: `assets/[name].${BUILD_ID}.js`,
        chunkFileNames: `assets/[name].[hash].${BUILD_ID}.js`,
        assetFileNames: `assets/[name].[hash].${BUILD_ID}.[ext]`,
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

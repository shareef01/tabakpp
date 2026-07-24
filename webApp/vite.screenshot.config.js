import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds a self-contained demo of the real app with Firebase swapped for the
// seeded stubs in src/demo/, so the screenshot harness never needs live auth or
// data. Output goes to dist-demo/ with relative asset paths (base './').

const dir = path.dirname(fileURLToPath(import.meta.url));

const REDIRECTS = [
  ['/src/firebase.js', 'src/demo/firebase.js'],
  ['/src/context/AuthContext.jsx', 'src/demo/AuthContext.jsx'],
  ['/src/hooks/useRegistry.js', 'src/demo/useRegistry.js'],
  ['/src/services/registryService.js', 'src/demo/registryService.js'],
];

const demoMocks = () => ({
  name: 'demo-mocks',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (source === 'virtual:pwa-register') return '\0virtual:pwa-register';
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!resolved) return null;
    const norm = resolved.id.replace(/\\/g, '/');
    for (const [suffix, target] of REDIRECTS) {
      if (norm.endsWith(suffix)) return path.resolve(dir, target);
    }
    return null;
  },
  load(id) {
    if (id === '\0virtual:pwa-register') {
      return 'export function registerSW() { return () => {}; }';
    }
  },
});

export default defineConfig({
  base: './',
  plugins: [demoMocks(), react()],
  define: { __BUILD_TIME__: JSON.stringify(Date.now()) },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
  },
});

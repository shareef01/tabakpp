import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    // Emulator-backed suites need a live Firestore; they run via `npm run test:rules`.
    exclude: [
      ...configDefaults.exclude,
      'src/**/*.rules.test.js',
      'src/**/*.emulator.test.js',
    ],
  },
});

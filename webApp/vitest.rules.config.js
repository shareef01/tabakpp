import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // *.rules.test.js  — security-rules assertions
    // *.emulator.test.js — service code driven through the unmocked Firebase SDK
    include: ['src/**/*.rules.test.js', 'src/**/*.emulator.test.js'],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});

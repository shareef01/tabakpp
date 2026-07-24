import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.rules.test.js'],
    fileParallelism: false,
  },
});

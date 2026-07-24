import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'dist-demo/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        __BUILD_TIME__: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
];

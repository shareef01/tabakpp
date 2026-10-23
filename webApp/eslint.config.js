import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

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
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The web client has ~28 useEffects and ~31 useCallbacks, most of them
      // built around explicit ref mirrors (activeCountsRef, todayRef,
      // profileSettingsRef …). Nothing enforced the rules that keep those
      // correct until now: stale closures and conditional hooks were entirely
      // unguarded. `rules-of-hooks` is a hard error because a violation is a
      // runtime crash, not a style issue; `exhaustive-deps` starts as a warning
      // so the existing allowlist-by-comment sites can be triaged deliberately.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.mjs'],
    rules: {
      // Tests mount many small inline components and deliberately omit deps.
      'react-hooks/exhaustive-deps': 'off',
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

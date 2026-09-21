import js from '@eslint/js';
import globals from 'globals';

// Minimal correctness-focused lint config: no existing style/formatting
// convention is enforced (the codebase has none), this only catches
// classes of bugs the audit found by hand (unused vars, undefined globals,
// accidental reassignment of consts, etc.).
export default [
  js.configs.recommended,
  {
    // TS workers already have their own `tsc --noEmit` typecheck; this config
    // is scoped to the plain-JS frontend, which had no lint coverage at all.
    ignores: ['dist/**', 'node_modules/**', 'public/**', '**/node_modules/**', 'workers/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
    },
  },
  {
    files: ['vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];

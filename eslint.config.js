// Flat ESLint config (v1.0.50 polish pass). Three zones:
//   electron/  main process, Node ESM (preload.js is the one CJS file)
//   src/       renderer React (Vite, JSX via the React 19 transform)
//   mobile/    PWA React, same shape as src
// Kept intentionally light: recommended + react-hooks. Style is not linted
// (no formatter war); this exists to catch real defects mechanically:
// undefined vars, unused imports, broken hook usage.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const sharedRules = {
  // _-prefixed args/vars are the codebase's existing "intentionally unused"
  // idiom (e.g. `(_event, projectPath) =>` in every IPC handler).
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  // `catch { /* comment */ }` with an explanatory comment is used deliberately
  // for best-effort paths; empty WITHOUT a comment still errors.
  'no-empty': ['error', { allowEmptyCatch: false }],
  // Terminal app: regexes match/strip ANSI escapes (\x1b) and PTY control
  // bytes by design. The rule exists to catch accidental control chars;
  // here they are the whole point.
  'no-control-regex': 'off',
};

export default [
  { ignores: ['dist/**', 'dist-mobile/**', 'dist-electron/**', 'node_modules/**', 'build/**'] },

  // Main process (ESM)
  {
    files: ['electron/**/*.js', 'electron/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
  // voice-bridge embeds generated SHELL scripts in template literals where
  // \$ deliberately marks shell-side variables (vs JS ${} interpolation).
  // The escapes are redundant to the parser but load-bearing for humans.
  {
    files: ['electron/voice-bridge.js'],
    rules: { 'no-useless-escape': 'off' },
  },
  // Preload is CommonJS by design (contextBridge sandbox)
  {
    files: ['electron/preload.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
  // Renderer + mobile React
  {
    files: ['src/**/*.{js,jsx}', 'mobile/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...sharedRules,
      // Only the classic high-signal hook rules. The v6 "recommended" extras
      // (set-state-in-effect, purity, static-components, refs) flag this
      // codebase's standard load-on-mount effect pattern 40+ times without
      // pointing at real defects; revisit if we adopt the React compiler.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];

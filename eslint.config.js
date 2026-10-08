import js from '@eslint/js';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '.claude/**',
      '**/routeTree.gen.ts',
      'docs/**',
      // Video segments are *.ts files that are not TypeScript.
      'apps/desktop/e2e/fixtures/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    // UI copy must go through i18next (docs/PRD.md UI-4).
    files: ['apps/desktop/src/renderer/**/*.tsx'],
    // The playback spike page is a development tool in plain English.
    ignores: ['**/*.test.*', 'apps/desktop/src/renderer/src/routes/_app/dev/**'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },
);

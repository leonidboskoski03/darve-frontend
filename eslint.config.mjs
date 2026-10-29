import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import architecture from './tools/eslint-architecture.mjs';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-acceptance/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'artifacts.local/**',
      '.husky/_/**',
    ],
  },
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['tests/setup.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': hooks, 'react-refresh': refresh },
    rules: {
      ...hooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: 'Use explicit named exports to keep public module surfaces reviewable.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { architecture },
    rules: { 'architecture/boundaries': 'error', 'architecture/infrastructure': 'error' },
  },
);

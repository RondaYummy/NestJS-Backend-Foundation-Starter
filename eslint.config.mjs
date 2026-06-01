import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'drizzle/**'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './libs/domain', from: './libs/infrastructure' },
            { target: './libs/domain', from: './libs/application' },
            { target: './libs/application', from: './libs/infrastructure' },
            { target: './libs/contracts', from: './libs/infrastructure' },
          ],
        },
      ],
    },
  },
  prettier,
];

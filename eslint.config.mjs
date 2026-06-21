import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'drizzle/**',
      'libs/infrastructure/src/database/drizzle/migrations/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
    ],
  },

  eslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },

    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },

    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },

    rules: {
      'no-undef': 'off',
      ...tseslint.configs.recommended.rules,

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      'import/no-cycle': ['error', { maxDepth: 10 }],

      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './libs/domain',
              from: './libs/application',
            },
            {
              target: './libs/domain',
              from: './libs/infrastructure',
            },
            {
              target: './libs/domain',
              from: './apps',
            },

            {
              target: './libs/application',
              from: './libs/infrastructure',
            },
            {
              target: './libs/application',
              from: './apps',
            },

            {
              target: './libs/contracts',
              from: './libs/infrastructure',
            },
            {
              target: './libs/contracts',
              from: './libs/application',
            },
            {
              target: './libs/contracts',
              from: './apps',
            },

            {
              target: './libs/shared',
              from: './libs/domain',
            },
            {
              target: './libs/shared',
              from: './libs/application',
            },
            {
              target: './libs/shared',
              from: './libs/infrastructure',
            },
            {
              target: './libs/shared',
              from: './apps',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['libs/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@nestjs/*',
            'drizzle-orm',
            'drizzle-orm/*',
            'ioredis',
            'bullmq',
            'express',
            'fastify',
            'class-validator',
            'class-transformer',
            '@app/application/*',
            '@app/infrastructure/*',
            '@app/apps/*',
            '@application/*',
            '@infrastructure/*',
            '@apps/*',
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Domain must be pure TypeScript. Do not use process.env in domain.',
        },
      ],
    },
  },

  {
    files: ['libs/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@nestjs/*',
            'drizzle-orm',
            'drizzle-orm/*',
            'ioredis',
            'bullmq',
            'express',
            'fastify',
            '@app/infrastructure/*',
            '@app/apps/*',
            '@infrastructure/*',
            '@apps/*',
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Application layer must use contracts and typed config, not process.env.',
        },
      ],
    },
  },

  {
    files: ['libs/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@nestjs/*',
            'drizzle-orm',
            'drizzle-orm/*',
            'ioredis',
            'bullmq',
            'express',
            'fastify',
            '@app/application/*',
            '@app/infrastructure/*',
            '@app/apps/*',
            '@application/*',
            '@infrastructure/*',
            '@apps/*',
          ],
        },
      ],
    },
  },

  {
    files: ['libs/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@app/domain/*',
            '@app/application/*',
            '@app/infrastructure/*',
            '@app/apps/*',
            '@domain/*',
            '@application/*',
            '@infrastructure/*',
            '@apps/*',
          ],
        },
      ],
    },
  },

  {
    files: [
      'apps/api/src/controllers/**/*.ts',
      'apps/worker/src/processors/**/*.ts',
      'apps/cron/src/schedules/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@app/domain/*', '@domain/*'],
        },
      ],
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettier,
];

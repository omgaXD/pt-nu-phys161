import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/coverage/**',
      'extra/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] },
    },
  },
  {
    // @pt/core must stay framework- and I/O-free.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'os', 'child_process'], message: '@pt/core is I/O-free.' },
            { group: ['svelte', 'svelte/*', '@sveltejs/*', 'katex'], message: '@pt/core is framework-free.' },
            { group: ['@pt/*'], message: '@pt/core must not depend on other workspace packages.' },
          ],
        },
      ],
    },
  },
  {
    // @pt/quiz is runner logic only: storage is injected, rendering lives in the app.
    files: ['packages/quiz/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'os', 'child_process'], message: '@pt/quiz is I/O-free.' },
            { group: ['svelte', 'svelte/*', '@sveltejs/*', 'katex'], message: '@pt/quiz is framework-free.' },
            { group: ['@pt/ui', '@pt/cli', '@pt/store-*'], message: '@pt/quiz depends on @pt/core only.' },
          ],
        },
      ],
    },
  },
);

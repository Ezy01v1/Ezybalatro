// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
      'apps/mobile/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // ADR 0003: the engine is pure and deterministic. No clock, randomness, timers, network or Node APIs.
    files: ['packages/engine/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Engine is pure: receive time as data in the action (ADR 0003).' },
        { name: 'setTimeout', message: 'Engine is pure: timeouts are actions sent by the server.' },
        { name: 'setInterval', message: 'Engine is pure.' },
        { name: 'fetch', message: 'Engine is pure: no network.' },
        { name: 'process', message: 'Engine is pure: no environment access.' },
        { name: 'crypto', message: 'Engine is pure: receive an injected Rng.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the injected Rng (ADR 0003).' },
        { object: 'Date', property: 'now', message: 'Receive time as data (ADR 0003).' },
        { object: 'performance', property: 'now', message: 'Engine is pure.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'Engine is pure: no Node APIs.' },
            { group: ['react', 'react-native', '@nestjs/*', 'socket.io*'], message: 'Engine has no framework dependencies.' },
          ],
        },
      ],
    },
  },
);

import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.mjs';

/**
 * ESLint configuration for the NestJS API.
 */
export const nestConfig = tseslint.config(
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Nest resolves providers from decorator metadata, so classes routinely
      // reference types that only exist at compile time. The base rule would
      // report these as unused.
      '@typescript-eslint/no-extraneous-class': 'off',

      // Controllers and providers are wired by the framework, not called
      // directly, so an unbound-method report here is always a false positive.
      '@typescript-eslint/unbound-method': 'off',

      // Interceptors and guards frequently return `void` where Nest accepts a
      // promise; the framework awaits them correctly.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
    },
  },
  {
    // Prisma Client is generated TypeScript. It lives under `src/` because the
    // Nest compiler has to emit it, but it must never be linted.
    ignores: ['src/generated/**'],
  },
);

export default nestConfig;

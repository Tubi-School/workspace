import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.mjs';

/**
 * ESLint configuration for Next.js applications.
 *
 * `eslint-config-next/core-web-vitals` layers on the App Router, React Hooks
 * and accessibility rules, plus the Core Web Vitals checks promoted to errors.
 */
export const nextJsConfig = tseslint.config(
  ...baseConfig,
  ...nextCoreWebVitals,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Business logic belongs in the API. Flag the easy accidents that pull
      // rendering concerns into places they do not belong.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
);

export default nextJsConfig;

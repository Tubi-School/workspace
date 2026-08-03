import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.mjs';

/**
 * ESLint configuration for React packages that are consumed by an app rather
 * than rendered on their own (currently `@tubi/ui`).
 *
 * It intentionally omits the Next.js plugin: shared components must not depend
 * on framework-specific APIs.
 */
export const reactLibraryConfig = tseslint.config(...baseConfig, {
  files: ['**/*.{ts,tsx}'],
  plugins: { 'react-hooks': reactHooks },
  languageOptions: {
    globals: { ...globals.browser },
  },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
});

export default reactLibraryConfig;

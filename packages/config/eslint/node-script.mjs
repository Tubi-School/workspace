import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

import { sharedIgnores } from './base.mjs';

/**
 * Configuration for standalone Node scripts (`scripts/`, root config files).
 *
 * These files sit outside every TypeScript project, so the type-aware base
 * config cannot be applied to them.
 */
export const nodeScriptConfig = [
  { ignores: sharedIgnores },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  eslintConfigPrettier,
];

export default nodeScriptConfig;

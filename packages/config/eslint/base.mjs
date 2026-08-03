import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import turboPlugin from 'eslint-plugin-turbo';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Paths that no linter should ever walk: build output, caches, and code owned
 * by a generator. Exported so per-package configs can extend rather than
 * restate the list.
 */
export const sharedIgnores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/generated/**',
  '**/*.tsbuildinfo',
];

/**
 * The rule set every TUBI workspace inherits.
 *
 * Type-aware linting is enabled deliberately: rules like `no-floating-promises`
 * catch a whole class of async bugs that syntax-only linting cannot see. It is
 * driven by the TypeScript project service, so each package only has to point
 * `tsconfigRootDir` at itself.
 */
export const baseConfig = tseslint.config(
  { ignores: sharedIgnores },

  js.configs.recommended,

  {
    plugins: { turbo: turboPlugin },
    rules: {
      // Environment variables read at runtime must be declared in turbo.json,
      // otherwise Turborepo will happily serve a cache entry built with
      // different configuration.
      'turbo/no-undeclared-env-vars': 'error',
    },
  },

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // An explicit `unknown` is fine; an implicit `any` is not.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    },
  },

  // Plain JavaScript (config files, scripts) has no type information to lint
  // against, so the type-aware rules must be switched off for it.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Must stay last: switches off every rule that would fight Prettier.
  eslintConfigPrettier,
);

export default baseConfig;

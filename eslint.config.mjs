import { nodeScriptConfig } from '@tubi/config/eslint/node-script';

/**
 * Root ESLint configuration.
 *
 * Apps and packages each own an `eslint.config.mjs` and are linted through
 * Turborepo. This root config only covers repository-level tooling: the
 * maintenance scripts in `scripts/` and the loose config files at the root.
 */
const config = [
  {
    ignores: ['apps/**', 'packages/**', '**/dist/**', '**/.next/**', '**/.turbo/**'],
  },
  ...nodeScriptConfig,
];

export default config;

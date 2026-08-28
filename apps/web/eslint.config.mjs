import { nextJsConfig } from '@tubi/config/eslint/next';

const config = [
  ...nextJsConfig,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The vitest config itself is a build tool file, not application code —
    // eslint-config-next's parser takes over `.mts` files ahead of the
    // type-aware TypeScript rules here, so type-aware linting cannot run on
    // it correctly; excluded rather than fought.
    ignores: ['vitest.config.mts'],
  },
];

export default config;

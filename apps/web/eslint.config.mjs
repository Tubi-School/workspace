import { nextJsConfig } from '@tubi/config/eslint/next';

const config = [
  ...nextJsConfig,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];

export default config;

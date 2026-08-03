import { baseConfig } from '@tubi/config/eslint/base';

const config = [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];

export default config;

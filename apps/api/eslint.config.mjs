import { nestConfig } from '@tubi/config/eslint/nest';

const config = [
  ...nestConfig,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];

export default config;

import { reactLibraryConfig } from '@tubi/config/eslint/react-library';

const config = [
  ...reactLibraryConfig,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];

export default config;

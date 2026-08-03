import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Shared Prettier configuration.
 *
 * `prettier-plugin-tailwindcss` sorts utility classes into Tailwind's canonical
 * order. That removes an entire category of review comment and keeps diffs
 * meaningful when classes are added.
 *
 * The plugin is resolved to an absolute path: Prettier loads plugins relative
 * to the current working directory, not to the file that declares them, and
 * the plugin is a dependency of this package rather than of the repository
 * root.
 *
 * @type {import('prettier').Config}
 */
const config = {
  semi: true,
  singleQuote: true,
  jsxSingleQuote: false,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  plugins: [require.resolve('prettier-plugin-tailwindcss')],
  overrides: [
    {
      files: ['*.md', '*.mdx'],
      options: { proseWrap: 'preserve' },
    },
    {
      files: ['*.json', '*.jsonc'],
      options: { trailingComma: 'none' },
    },
  ],
};

export default config;

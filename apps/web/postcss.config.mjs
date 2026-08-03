/**
 * Tailwind CSS v4 ships as a single PostCSS plugin. There is no
 * `tailwind.config.js`: the theme is declared in CSS, in
 * `packages/ui/src/styles/theme.css`.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;

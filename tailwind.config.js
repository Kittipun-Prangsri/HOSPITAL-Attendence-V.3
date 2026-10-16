const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js'],
  // Legacy pages still load Bootstrap; skip preflight so its reboot stays in charge
  // and block utility names that collide with Bootstrap components.
  corePlugins: { preflight: false },
  blocklist: ['collapse', 'container', 'table'],
  theme: {
    extend: {
      // Match the 992px breakpoint used by the sidebar toggle script and Bootstrap
      screens: { lg: '992px' },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', '"Noto Sans Thai"', 'Sarabun', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      colors: {
        // Tailwind built-in palettes: pink for actions/accents, purple for the sidebar shell
        brand: colors.pink,
        plum: colors.purple
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        drawer: '-12px 0 40px rgba(15, 23, 42, 0.18)'
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      }
    }
  },
  plugins: []
};

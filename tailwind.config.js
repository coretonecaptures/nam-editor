/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        ui: ['IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        'app-bg':       'var(--app-bg)',
        'panel':        'var(--panel)',
        'panel-2':      'var(--panel-2)',
        'raised':       'var(--raised)',
        'hov':          'var(--hover)',
        'active-bg':    'var(--active)',
        'nm-border':    'var(--border)',
        'nm-border-s':  'var(--border-soft)',
        'nm-text':      'var(--text)',
        'nm-text-2':    'var(--text-2)',
        'nm-text-3':    'var(--text-3)',
        'field-bg':     'var(--field)',
        'field-bd':     'var(--field-border)',
        'nm-accent':    'var(--accent)',
        'accent-fg':    'var(--accent-fg)',
        'accent-text':  'var(--accent-text)',
      },
    },
  },
  plugins: [],
}

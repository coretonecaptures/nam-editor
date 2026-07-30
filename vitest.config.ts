import { defineConfig } from 'vitest/config'

/**
 * Vitest config.
 *
 * `oxc.jsx` rather than the React plugin or `esbuild.jsx`: vitest 4 runs on rolldown, whose oxc
 * transformer takes precedence and ignores esbuild options (it warns as much). Component tests
 * import .tsx files, so without this nothing JSX-adjacent can even be parsed.
 *
 * Environment stays `node` — component tests use renderToString, so no jsdom is needed to catch
 * mount-time crashes.
 */
export default defineConfig({
  oxc: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node'
  }
})

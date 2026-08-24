#!/usr/bin/env node
/**
 * Runs vitest under Electron's own Node build (ELECTRON_RUN_AS_NODE) instead of the plain Node.js
 * devDependency, so specs that need Electron's node:sqlite (FTS5-compiled, unlike plain Node's --
 * see src/main/irCatalog/sqliteCapabilities.ts) actually run instead of self-skipping.
 *
 * ELECTRON_RUN_AS_NODE runs a script with Electron's Node/V8/SQLite build without spinning up an
 * app or window -- no display needed, works in CI.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const electronPath = require('electron')
const vitestEntry = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs')

const result = spawnSync(electronPath, [vitestEntry, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

process.exit(result.status ?? 1)

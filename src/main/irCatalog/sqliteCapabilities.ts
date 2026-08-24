/**
 * Whether the current `node:sqlite` build has FTS5 compiled in.
 *
 * True inside Electron's main process (verified: Electron 41.10.3 embeds SQLite 3.53.1 with FTS5)
 * — the only place this schema ever actually runs, per docs/ir-lab-manager-build-plan.md's
 * single-writer design. False under the plain Node.js this repo's devDependency ships (verified:
 * Node 22.13.0 embeds SQLite 3.47.2, no FTS5) — which is what `vitest run` uses by default, since
 * this project has no Electron-aware test runner otherwise. Run `npm run test:electron` to run
 * the full suite (including FTS5-dependent specs) under Electron's own Node build instead.
 */
import { DatabaseSync } from 'node:sqlite'

let cached: boolean | null = null

export function hasFts5(): boolean {
  if (cached !== null) return cached
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE VIRTUAL TABLE __fts5_probe USING fts5(a)')
    cached = true
  } catch {
    cached = false
  } finally {
    db.close()
  }
  return cached
}

/**
 * Capture rename for NAM Projects (parity backlog item 15) — scoped down from the item's own
 * original wording after checking the real IR Lab source (2026-09-13; see
 * docs/ir-nam-parity-backlog.md item 15 for the write-up).
 *
 * The item's own text assumed a `.SessionData/<captureId>/session.json` + project-level
 * `captureIndex` layout (true for `ir_project` — see `labProjectEnrichment.ts`). NAM Captures
 * (schemaVersion 2, `namCaptureEnrichment.ts`) use a DIFFERENT, simpler on-disk shape: each
 * capture is a `<Capture Name>.wav` sitting flat in `NAM Captures/`, alongside a same-basename
 * `<Capture Name>.nam-capture.json` sidecar (and, once trained, a same-basename
 * `<Capture Name>.nam-lab-result.json`) — no shared project index file at all. Grouping into a
 * project happens via each sidecar's own `projectId` field, not a captureIndex list
 * (`namCaptureEnrichment.ts`'s own header comment). So THIS rename only ever has to keep three
 * same-folder files in sync with each other — never a separate shared file another running app
 * might have open — which is a materially smaller, safer operation than the item's original
 * wording implied.
 *
 * Renames, in order: the WAV (via the existing generic `renameItem`, which also updates the
 * catalog row), then the `.nam-capture.json` sidecar (rewritten in place — parse, patch
 * `captureName`/`recording`, write back; a plain JSON.parse/stringify round-trip is fine here,
 * unlike a `.nam` file, since this sidecar carries no binary payload and no established
 * preserve-formatting contract), then the `.nam-lab-result.json` sidecar if training has already
 * produced one (filename only — its own contents point at the trained MODEL's path, not the
 * recording's, so nothing inside it needs to change). Rolls back the WAV rename if any sidecar
 * step fails, so a partial rename can never leave the WAV and its sidecars under different names —
 * NAM Capture's same-basename guarantee (this file's own comment above, and IR Lab's own
 * `NamCaptureStore.cpp`) is exactly the invariant a partial rename would break.
 *
 * **Not independently verified against the real IR Lab app** (this environment can build against
 * the source but not run it) — the WAV/sidecar consistency above is confirmed directly from
 * source, but "a renamed capture reopens correctly in IR Lab" per the item's own "Done when"
 * wording should still get one real check before this is treated as fully closed.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join, dirname, extname, basename } from 'node:path'
import { renameItem, type FileOpResult } from './fileOps'

const SIDECAR_SUFFIX = '.nam-capture.json'
const RESULT_SUFFIX = '.nam-lab-result.json'

export async function renameNamCapture(db: DatabaseSync, itemId: string, newBaseName: string, force = false): Promise<FileOpResult> {
  const row = db
    .prepare(
      `SELECT item.relative_path as relativePath, library_root.path as rootPath
       FROM item JOIN library_root ON library_root.id = item.library_root_id
       WHERE item.id = ?`
    )
    .get(itemId) as { relativePath: string; rootPath: string } | undefined
  if (!row) return { itemId, success: false, error: 'Item not found in catalog.' }

  const trimmed = newBaseName.trim()
  if (!trimmed) return { itemId, success: false, error: 'New name cannot be empty.' }

  const oldAbsPath = join(row.rootPath, ...row.relativePath.split('/'))
  const dir = dirname(oldAbsPath)
  const ext = extname(oldAbsPath)
  const oldBase = basename(oldAbsPath, ext)
  if (trimmed === oldBase) return { itemId, success: true, newAbsPath: oldAbsPath }

  const oldSidecar = join(dir, `${oldBase}${SIDECAR_SUFFIX}`)
  const oldResult = join(dir, `${oldBase}${RESULT_SUFFIX}`)
  const newSidecar = join(dir, `${trimmed}${SIDECAR_SUFFIX}`)
  const newResult = join(dir, `${trimmed}${RESULT_SUFFIX}`)

  if (!force && (fs.existsSync(newSidecar) || fs.existsSync(newResult))) {
    return { itemId, success: false, error: 'A capture with that name already exists.' }
  }

  const wavResult = await renameItem(db, itemId, trimmed, force)
  if (!wavResult.success) return wavResult

  const renamedSidecarPaths: Array<{ from: string; to: string }> = []
  try {
    if (fs.existsSync(oldSidecar)) {
      const json = JSON.parse(fs.readFileSync(oldSidecar, 'utf8')) as Record<string, unknown>
      json.captureName = trimmed
      json.recording = `${trimmed}${ext}`
      fs.writeFileSync(newSidecar, JSON.stringify(json, null, 2))
      fs.unlinkSync(oldSidecar)
      renamedSidecarPaths.push({ from: oldSidecar, to: newSidecar })
    }
    if (fs.existsSync(oldResult)) {
      fs.renameSync(oldResult, newResult)
      renamedSidecarPaths.push({ from: oldResult, to: newResult })
    }
  } catch (err) {
    // Roll back the WAV + item row so disk/catalog never disagree about the name, and undo
    // whichever sidecar step(s) already succeeded.
    await renameItem(db, itemId, oldBase, true)
    for (const { from, to } of renamedSidecarPaths) {
      try {
        fs.renameSync(to, from)
      } catch {
        // Best effort — surfaced via the error message below regardless.
      }
    }
    return { itemId, success: false, error: `Renamed the WAV but a sidecar update failed, rolled back: ${String(err)}` }
  }

  // nam_capture_item's own capture_name/recording_path mirror the sidecar (namCaptureEnrichment.ts
  // writes them from the same fields on every scan) — updated here too so the catalog reflects the
  // rename immediately rather than only after the next rescan. display_name also follows the
  // "no extension" convention that pass establishes (`captureName`, not the raw filename) — set
  // directly here so display doesn't flip from "Name.wav" to "Name" only on the next scan.
  db.prepare(`UPDATE nam_capture_item SET capture_name = ?, recording_path = ? WHERE item_id = ?`).run(
    trimmed,
    join(dir, `${trimmed}${ext}`),
    itemId
  )
  db.prepare(`UPDATE item SET display_name = ? WHERE id = ?`).run(trimmed, itemId)

  return wavResult
}

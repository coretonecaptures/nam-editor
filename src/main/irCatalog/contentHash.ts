/**
 * Full-file content_hash — the background half of the plan's two-tier hashing design (section 4)
 * that Phase 1 never built (tracked as a gap in docs/ir-lab-manager-build-plan.md section 12).
 * `quick_hash` (size + first/last 64KB, quickHash.ts) is computed inline at scan time and is
 * cheap; a full-file hash means reading the entire file, which for a 500K-file library means
 * hundreds of GB off disk — explicitly lazy, explicitly allowed to lag behind a huge import.
 *
 * Streamed, not read-whole-file-into-memory (quickHash.ts's approach is fine at 128KB/file; this
 * isn't, since files can be hundreds of MB).
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mapPool } from './concurrency'

const HASH_CONCURRENCY = 8 // lower than scan's 32 — this competes with whatever else is using disk I/O in the background, deliberately gentler.
const BATCH_SIZE = 500

export async function computeContentHash(absPath: string): Promise<string> {
  const hash = createHash('sha1')
  const stream = fs.createReadStream(absPath)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface ContentHashProgress {
  processed: number
  total: number
}

/**
 * Processes every item in `libraryRootId` still missing a content_hash, in batches, updating the
 * DB as it goes so a crash/interrupt loses at most one in-flight batch. No cancellation token yet
 * — same documented gap as scan's own missing cancel support (plan section 12, Phase 2 notes).
 */
export async function runContentHashQueue(
  db: DatabaseSync,
  libraryRootId: number,
  onProgress?: (p: ContentHashProgress) => void
): Promise<{ processed: number }> {
  const root = db.prepare('SELECT path FROM library_root WHERE id = ?').get(libraryRootId) as { path: string } | undefined
  if (!root) return { processed: 0 }

  const pending = db
    .prepare(`SELECT id, relative_path FROM item WHERE library_root_id = ? AND content_hash IS NULL`)
    .all(libraryRootId) as Array<{ id: string; relative_path: string }>

  const total = pending.length
  let processed = 0
  const updateStmt = db.prepare(`UPDATE item SET content_hash = ? WHERE id = ?`)

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    const hashes = await mapPool(batch, HASH_CONCURRENCY, async (item) => {
      const absPath = join(root.path, ...item.relative_path.split('/'))
      try {
        return await computeContentHash(absPath)
      } catch {
        return null // file gone/unreadable — leave content_hash null, reconciliation/rescan handles it
      }
    })

    db.exec('BEGIN')
    try {
      for (let j = 0; j < batch.length; j++) {
        if (hashes[j]) updateStmt.run(hashes[j], batch[j].id)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    processed += batch.length
    onProgress?.({ processed, total })
  }

  return { processed }
}

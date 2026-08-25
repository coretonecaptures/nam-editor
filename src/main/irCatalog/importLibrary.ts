/**
 * Batched, resumable-shaped import of one library_root into the catalog.
 *
 * "Resumable-shaped" for Phase 1: this commits per batch (so a killed process loses at most one
 * in-flight batch, not the whole import) and is safe to re-run against the same root (folder/item
 * rows are upserted by their UNIQUE(library_root_id, relative_path)), but the cursor-based
 * resume-from-where-it-stopped UX described in the plan is a later-phase UI concern, not something
 * this standalone harness needs to implement to answer Phase 1's questions.
 *
 * item_search is populated by direct insert inside the same batch transaction, with live-edit
 * triggers absent for the duration — see schema.ts / docs/ir-lab-manager-build-plan.md section 2c.
 */
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { walkWavLibrary, toPosixRel, type WalkEvent } from './scanWalk'
import { computeQuickHash } from './quickHash'
import { withoutLiveSearchTriggers } from './schema'
import { mapPool } from './concurrency'

/**
 * How many files' quick_hash computations run concurrently per batch. Same fix, same reasoning
 * as scanWalk.ts's STAT_CONCURRENCY — this was the other fully-serial I/O loop Phase 1's
 * real-library run found collapsing throughput. Hashing is computed outside the DB transaction
 * (pure fs I/O, no SQLite involved) so parallelizing it doesn't touch the single synchronous
 * connection at all.
 */
const HASH_CONCURRENCY = 32

export interface ImportOptions {
  /** Rows per transaction. Plan section 4: ~2,000-5,000. */
  batchSize?: number
  /** Skip quick_hash computation — for isolating pure insert/FTS5 cost from hashing I/O cost. */
  skipQuickHash?: boolean
  onProgress?: (p: { filesSeen: number; foldersSeen: number; elapsedMs: number }) => void
}

export interface ImportStats {
  libraryRootId: number
  foldersInserted: number
  itemsInserted: number
  elapsedMs: number
}

type PendingFolder = { relPath: string; parentRelPath: string | null }
type PendingItem = {
  relPath: string
  folderRelPath: string
  absPath: string
  size: number
  modifiedAt: string
}

export async function importLibrary(
  db: DatabaseSync,
  rootPath: string,
  label: string | null,
  options: ImportOptions = {}
): Promise<ImportStats> {
  const batchSize = options.batchSize ?? 3000
  const skipQuickHash = options.skipQuickHash ?? false
  const started = Date.now()

  const insertRoot = db.prepare(
    `INSERT INTO library_root (path, label, watch_mode, created_at)
     VALUES (?, ?, 'manual', ?)
     ON CONFLICT(path) DO UPDATE SET label = excluded.label
     RETURNING id`
  )
  const rootRow = insertRoot.get(rootPath, label, new Date().toISOString()) as { id: number }
  const libraryRootId = rootRow.id

  // relPath (posix-normalized) -> folder.id, kept in memory for the duration of one import so
  // file inserts can resolve folder_id without a query per file. Folders number in the hundreds
  // even under a 226K-file pack (plan section 2a/2), so this map stays small regardless of how
  // many files are under it.
  // Populated as folder events are flushed; the walk always yields a folder's own event before
  // any of its descendants', so a child's parent is guaranteed to already be in this map.
  const folderIds = new Map<string, number>()

  const insertFolder = db.prepare(
    `INSERT INTO folder (library_root_id, parent_id, relative_path)
     VALUES (?, ?, ?)
     ON CONFLICT(library_root_id, relative_path) DO UPDATE SET relative_path = excluded.relative_path
     RETURNING id`
  )
  const insertItem = db.prepare(
    `INSERT INTO item (
       id, kind, library_root_id, folder_id, relative_path, display_name,
       modified_at, indexed_at, last_seen_at, file_size, quick_hash
     ) VALUES (?, 'ir', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(library_root_id, relative_path) DO UPDATE SET
       folder_id = excluded.folder_id,
       modified_at = excluded.modified_at,
       last_seen_at = excluded.last_seen_at,
       file_size = excluded.file_size,
       quick_hash = excluded.quick_hash,
       missing_since = NULL
     RETURNING id`
  )
  // Delete-then-insert rather than plain insert: a re-run against an already-imported root (the
  // resumability case Phase 1 tests) upserts existing item rows, and item_search has no
  // uniqueness constraint of its own to lean on — without the delete, re-running would duplicate
  // search rows for every already-seen item.
  const deleteSearch = db.prepare(`DELETE FROM item_search WHERE item_id = ?`)
  const insertSearch = db.prepare(
    `INSERT INTO item_search (item_id, display_name) VALUES (?, ?)`
  )

  let foldersInserted = 0
  let itemsInserted = 0
  let filesSeen = 0
  let foldersSeen = 0

  const pendingFolders: PendingFolder[] = []
  const pendingItems: PendingItem[] = []

  const flushFolders = (): void => {
    for (const f of pendingFolders) {
      const relPosix = toPosixRel(f.relPath)
      const parentId = f.parentRelPath === null ? null : folderIds.get(toPosixRel(f.parentRelPath)) ?? null
      const row = insertFolder.get(libraryRootId, parentId, relPosix) as { id: number }
      folderIds.set(relPosix, row.id)
      foldersInserted++
    }
    pendingFolders.length = 0
  }

  // Pure fs I/O, no SQLite involved — safe to run with real concurrency, and deliberately done
  // BEFORE the DB transaction opens rather than inside flushItems, so the single synchronous
  // connection is never sitting idle mid-transaction waiting on file reads.
  const computeHashes = async (): Promise<Array<string | null>> => {
    if (skipQuickHash) return pendingItems.map(() => null)
    return mapPool(pendingItems, HASH_CONCURRENCY, (it) => computeQuickHash(it.absPath, it.size))
  }

  const flushItems = (hashes: Array<string | null>): void => {
    if (pendingItems.length === 0) return
    const now = new Date().toISOString()
    for (let i = 0; i < pendingItems.length; i++) {
      const it = pendingItems[i]
      const relPosix = toPosixRel(it.relPath)
      const folderId = folderIds.get(toPosixRel(it.folderRelPath)) ?? null
      const displayName = relPosix.slice(relPosix.lastIndexOf('/') + 1)
      const id = randomUUID()

      const row = insertItem.get(
        id, libraryRootId, folderId, relPosix, displayName, it.modifiedAt, now, now, it.size, hashes[i]
      ) as { id: string }
      deleteSearch.run(row.id)
      insertSearch.run(row.id, displayName)
      itemsInserted++
    }
    pendingItems.length = 0
  }

  const runBatch = async (): Promise<void> => {
    const hashes = await computeHashes()
    db.exec('BEGIN')
    try {
      flushFolders()
      flushItems(hashes)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  await withoutLiveSearchTriggers(db, async () => {
    for await (const event of walkWavLibrary(rootPath)) {
      if (event.type === 'folder') {
        foldersSeen++
        pendingFolders.push(event.folder as WalkEvent['folder'] as PendingFolder)
      } else {
        filesSeen++
        const f = event.file as WalkEvent['file'] as PendingItem
        pendingItems.push(f)
      }

      if (pendingFolders.length + pendingItems.length >= batchSize) {
        await runBatch()
        options.onProgress?.({ filesSeen, foldersSeen, elapsedMs: Date.now() - started })
      }
    }
    if (pendingFolders.length + pendingItems.length > 0) {
      await runBatch()
      options.onProgress?.({ filesSeen, foldersSeen, elapsedMs: Date.now() - started })
    }
  })

  return {
    libraryRootId,
    foldersInserted,
    itemsInserted,
    elapsedMs: Date.now() - started
  }
}

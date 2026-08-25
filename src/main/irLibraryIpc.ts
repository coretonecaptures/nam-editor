/**
 * IR Lab Manager — main-process IPC layer for Phase 2 (read-only browse + search).
 * docs/ir-lab-manager-build-plan.md section 10 lists the eventual channel set; this wires the
 * subset Phase 2 needs: addRoot, listRoots, scan (progress-reporting), query, setFavorite,
 * setRating. Vendor parsers/audition/tray are later phases and untouched here.
 *
 * catalog.db lives at userData/ir-catalog.db, opened lazily on first use — `app.getPath` must
 * never be called at module load time (CLAUDE.md).
 */
import { ipcMain, app, type BrowserWindow } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes, itemSearchTableExists } from './irCatalog/schema'
import { importLibrary } from './irCatalog/importLibrary'
import { queryItems, countItems, setFavorite, setRating } from './irCatalog/queryLibrary'
import { applyVendorParsers } from './irCatalog/vendorParsers/applyVendorParsers'
import { reconcileMissingItems } from './irCatalog/reconciliation'
import { runContentHashQueue } from './irCatalog/contentHash'
import { setFolderMetadata, removeFolderMetadata } from './irCatalog/folderMetadata'

let db: DatabaseSync | null = null
// Guards against two overlapping background content_hash runs for the same root — a second
// 'Add Library Folder' scan on the same root while the first's hash queue is still draining would
// otherwise start a second pass over the same rows.
const hashingInProgress = new Set<number>()

function getDb(): DatabaseSync {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'ir-catalog.db')
  db = new DatabaseSync(dbPath)
  createCoreSchema(db)
  // Phase 2 has no bulk-import UI flow distinct from "add a root" yet, so there's no in-progress
  // core-only window a crash could leave item_search-less — safe to finalize eagerly on open.
  if (!itemSearchTableExists(db)) finalizeIndexes(db)
  return db
}

export function registerIrLibraryIpc(getMainWindow: () => BrowserWindow | null): void {
  const safeSend = (channel: string, ...args: unknown[]): void => {
    const win = getMainWindow()
    const wc = win?.webContents
    if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) return
    try {
      wc.send(channel, ...args)
    } catch {
      // Frame disposed mid-flight — same as safeSend in index.ts, swallow and move on.
    }
  }

  ipcMain.handle('irLibrary:listRoots', () => {
    const database = getDb()
    return database.prepare('SELECT id, path, label, watch_mode, created_at FROM library_root ORDER BY created_at').all()
  })

  ipcMain.handle('irLibrary:addRoot', async (_event, folderPath: string, label: string | null) => {
    const database = getDb()
    const now = new Date().toISOString()
    const row = database
      .prepare(
        `INSERT INTO library_root (path, label, watch_mode, created_at)
         VALUES (?, ?, 'manual', ?)
         ON CONFLICT(path) DO UPDATE SET label = excluded.label
         RETURNING id`
      )
      .get(folderPath, label, now) as { id: number }
    return { libraryRootId: row.id }
  })

  // Runs the batched import (irCatalog/importLibrary.ts) — which also marks anything not
  // re-found as missing_since (section 5) — finalizes indexes/FTS5 once (Phase 1 fix), then
  // reconciliation (section 5: relink an exact quick_hash/content_hash match, e.g. a renamed or
  // moved file, merging it back onto its original item id rather than leaving two rows), then
  // the vendor parser chain (Phase 3, section 6) on whatever's left, then finalizes again so the
  // newly-parsed manufacturer/cabinet/speaker/microphone fields are searchable (see schema.ts's
  // finalizeIndexes doc comment). Progress streams to the renderer over 'irLibrary:scanProgress';
  // the resolved value is the final import stats (reconciliation/vendor-parse stats aren't
  // currently surfaced to the UI — no progress event for those phases, they run as bulk passes).
  //
  // The content_hash background queue (section 4) is started AFTER this handler resolves, not
  // awaited here — it's explicitly lazy/best-effort (full-file hashing of a huge library can take
  // a long time) and reconciliation above already ran with whatever hashes existed at scan time;
  // a slow-arriving content_hash only improves the NEXT reconciliation pass's tier-1 accuracy, not
  // this one's.
  ipcMain.handle('irLibrary:scan', async (_event, folderPath: string, label: string | null) => {
    const database = getDb()
    const stats = await importLibrary(database, folderPath, label, {
      onProgress: (p) => {
        safeSend('irLibrary:scanProgress', { filesSeen: p.filesSeen, foldersSeen: p.foldersSeen, elapsedMs: p.elapsedMs, done: false })
      }
    })
    finalizeIndexes(database)
    reconcileMissingItems(database, stats.libraryRootId)
    applyVendorParsers(database, stats.libraryRootId)
    finalizeIndexes(database)
    safeSend('irLibrary:scanProgress', {
      filesSeen: stats.itemsInserted,
      foldersSeen: stats.foldersInserted,
      elapsedMs: stats.elapsedMs,
      done: true
    })

    if (!hashingInProgress.has(stats.libraryRootId)) {
      hashingInProgress.add(stats.libraryRootId)
      void runContentHashQueue(database, stats.libraryRootId)
        .catch(() => {
          // Best-effort background work — a failure here (e.g. a file vanished mid-hash) must
          // never surface as a scan error; computeContentHash itself already swallows per-file
          // failures, so this only guards the queue driver itself.
        })
        .finally(() => {
          hashingInProgress.delete(stats.libraryRootId)
        })
    }

    return stats
  })

  ipcMain.handle(
    'irLibrary:query',
    (_event, options: { libraryRootId?: number | null; search?: string; offset: number; limit: number }) => {
      const database = getDb()
      const rows = queryItems(database, options).map((row) => ({
        ...row,
        // Computed here (node:path, correct separators) rather than in SQL — Phase 4 (audition)
        // needs a real filesystem path to read the file's audio bytes via the existing generic
        // window.api.readFileBinary. relative_path is stored posix-normalized (toPosixRel), so
        // it's split and rejoined rather than passed straight to `join`.
        abs_path: join(row.library_root_path, ...row.relative_path.split('/'))
      }))
      return {
        rows,
        total: countItems(database, options)
      }
    }
  )

  ipcMain.handle('irLibrary:setFavorite', (_event, itemId: string, isFavorite: boolean) => {
    setFavorite(getDb(), itemId, isFavorite)
    return { success: true }
  })

  ipcMain.handle('irLibrary:setRating', (_event, itemId: string, rating: number | null) => {
    setRating(getDb(), itemId, rating)
    return { success: true }
  })

  // Backend only — no UI panel calls these yet (docs/ir-lab-manager-build-plan.md section 12,
  // Phase 5 notes: folder notes/vendor-document-import UI is tracked as a separate, not-yet-built
  // feature; this just makes the already-implemented inheritance backend reachable from IPC).
  ipcMain.handle('irLibrary:setFolderMetadata', (_event, folderId: number, field: string, value: string, source: string) => {
    setFolderMetadata(getDb(), folderId, field, value, source)
    return { success: true }
  })

  ipcMain.handle('irLibrary:removeFolderMetadata', (_event, folderId: number, field: string) => {
    removeFolderMetadata(getDb(), folderId, field)
    return { success: true }
  })
}

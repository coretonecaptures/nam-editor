/**
 * IR Lab Manager — main-process IPC layer. docs/ir-lab-manager-build-plan.md section 10 lists
 * the eventual full channel set; this file now wires Phases 2 (browse/search), 3 (vendor
 * parsers, inside the scan handler), 4 (audition needs abs_path from query, not its own
 * channels — see useIrAudition.ts), 5 (folder metadata/documents), and 6 (tray + IR Lab
 * connector). A/B audition and the rest of Phase 7 are still not here.
 *
 * catalog.db lives at userData/ir-catalog.db, opened lazily on first use — `app.getPath` must
 * never be called at module load time (CLAUDE.md).
 */
import { ipcMain, app, dialog, type BrowserWindow } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes, itemSearchTableExists } from './irCatalog/schema'
import { importLibrary } from './irCatalog/importLibrary'
import { queryItems, countItems, setFavorite, setRating, listFacetOptions, listNumericFacetOptions } from './irCatalog/queryLibrary'
import { applyVendorParsers } from './irCatalog/vendorParsers/applyVendorParsers'
import { reconcileMissingItems } from './irCatalog/reconciliation'
import { runContentHashQueue } from './irCatalog/contentHash'
import {
  setFolderMetadata,
  removeFolderMetadata,
  setFolderNotes,
  listFolders,
  listAllFolders,
  getFolderDetail
} from './irCatalog/folderMetadata'
import { importFolderDocument, listFolderDocuments, deleteFolderDocument } from './irCatalog/folderDocuments'
import { extractVendorDocumentFields } from './irCatalog/vendorDocExtraction'
import { addToTray, removeFromTray, listTray, isInTray } from './irCatalog/tray'
import { sendToIrLab, irLabConnectorAvailable } from './irLabConnector'
import { getLibraryOverview } from './irCatalog/libraryOverview'
import { enrichLabProjects, getProjectDetailForFolder } from './irCatalog/labProjectEnrichment'
import {
  previewFolderRemoval,
  removeFolderFromCatalog,
  previewLibraryRootRemoval,
  removeLibraryRoot
} from './irCatalog/removeFromCatalog'
import {
  listTags,
  getOrCreateTag,
  renameTag,
  deleteTag,
  addItemToTag,
  removeItemFromTag,
  listTagsForItem
} from './irCatalog/tag'

let db: DatabaseSync | null = null
// Guards against two overlapping background content_hash runs for the same root — a second
// 'Add Library Folder' scan on the same root while the first's hash queue is still draining would
// otherwise start a second pass over the same rows.
const hashingInProgress = new Set<number>()

function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Guards against the duplicate-import risk the user specifically flagged (plan section 8c/§3):
 * two different library_root rows pointing at overlapping paths, e.g. a normal "Add Library
 * Folder" on a parent folder plus a later "Import IR Lab Project(s)..." pointed at a Projects
 * subfolder inside it. If `folderPath` is already covered by (or exactly matches) an existing
 * root, returns that root and the caller should re-scan at the EXISTING root's own path instead
 * of registering a second root — rescans are cheap (Phase 1 benchmarks) and idempotent, so
 * "rescan the whole existing root" is a safe, simple way to still pick up whatever's new under
 * the more specific subfolder the user actually pointed at. */
function findContainingRoot(db: DatabaseSync, folderPath: string): { id: number; path: string } | null {
  const roots = db.prepare(`SELECT id, path FROM library_root`).all() as Array<{ id: number; path: string }>
  const target = normalizeForCompare(folderPath)
  for (const root of roots) {
    const rootNorm = normalizeForCompare(root.path)
    if (target === rootNorm || target.startsWith(`${rootNorm}/`)) return root
  }
  return null
}

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
    // Third pass (plan section 8c) -- detects any .SessionData/project.json anywhere under this
    // root and enriches its already-correctly-scanned deliverable items with real IR Lab metadata.
    // Automatic on every scan, not just the dedicated "Import IR Lab Project(s)..." action below.
    enrichLabProjects(database, stats.libraryRootId)
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

  // "Import IR Lab Project(s)..." (plan section 8c/§4) -- a distinct File-menu action for pointing
  // directly at a folder full of Projects and getting only those, rather than everything the
  // folder happens to contain. Runs the identical pipeline as a normal scan (import -> finalize ->
  // reconcile -> vendor-parse -> enrich -> finalize), subject to the same duplicate-root guard, and
  // then -- ONLY when this call created a genuinely new library_root (never when it reused an
  // existing one, to avoid ever deleting a user's pre-existing generic scan content) -- deletes any
  // item whose folder isn't a detected Project folder.
  ipcMain.handle('irLibrary:importLabProjects', async (_event, folderPath: string, label: string | null) => {
    const database = getDb()
    const existingRoot = findContainingRoot(database, folderPath)
    const scanPath = existingRoot ? existingRoot.path : folderPath

    const stats = await importLibrary(database, scanPath, label, {
      onProgress: (p) => {
        safeSend('irLibrary:scanProgress', { filesSeen: p.filesSeen, foldersSeen: p.foldersSeen, elapsedMs: p.elapsedMs, done: false })
      }
    })
    finalizeIndexes(database)
    reconcileMissingItems(database, stats.libraryRootId)
    applyVendorParsers(database, stats.libraryRootId)
    const enrichStats = enrichLabProjects(database, stats.libraryRootId)

    let nonProjectItemsRemoved = 0
    if (!existingRoot) {
      const result = database
        .prepare(
          `DELETE FROM item WHERE library_root_id = ? AND (folder_id IS NULL OR folder_id NOT IN (
             SELECT folder_id FROM collection WHERE library_root_id = ? AND kind = 'ir_project' AND folder_id IS NOT NULL
           ))`
        )
        .run(stats.libraryRootId, stats.libraryRootId)
      nonProjectItemsRemoved = Number(result.changes)
    }
    finalizeIndexes(database)

    safeSend('irLibrary:scanProgress', {
      filesSeen: stats.itemsInserted,
      foldersSeen: stats.foldersInserted,
      elapsedMs: stats.elapsedMs,
      done: true
    })

    return {
      ...stats,
      projectsFound: enrichStats.projectsFound,
      itemsEnriched: enrichStats.itemsEnriched,
      nonProjectItemsRemoved,
      reusedExistingRoot: existingRoot != null
    }
  })

  ipcMain.handle('irLibrary:getProjectDetailForFolder', (_event, folderId: number) => {
    return getProjectDetailForFolder(getDb(), folderId)
  })

  // Folder/root removal — "remove a folder and its children from the catalog, with a confirm
  // dialog" (removeFromCatalog.ts's own header comment has the full reasoning). Preview handlers
  // exist so the renderer's confirm dialog can show a real item count before the user commits,
  // rather than a generic "are you sure?" with no idea of the blast radius.
  ipcMain.handle('irLibrary:previewFolderRemoval', (_event, folderId: number) => {
    return previewFolderRemoval(getDb(), folderId)
  })
  ipcMain.handle('irLibrary:removeFolderFromCatalog', (_event, folderId: number) => {
    return removeFolderFromCatalog(getDb(), folderId)
  })
  ipcMain.handle('irLibrary:previewLibraryRootRemoval', (_event, libraryRootId: number) => {
    return previewLibraryRootRemoval(getDb(), libraryRootId)
  })
  ipcMain.handle('irLibrary:removeLibraryRoot', (_event, libraryRootId: number) => {
    return removeLibraryRoot(getDb(), libraryRootId)
  })

  ipcMain.handle(
    'irLibrary:listFacetOptions',
    (_event, field: 'manufacturer' | 'speaker' | 'microphone', libraryRootId: number | null, folderId: number | null) => {
      return listFacetOptions(getDb(), field, libraryRootId ?? null, folderId ?? null)
    }
  )

  ipcMain.handle(
    'irLibrary:listNumericFacetOptions',
    (_event, field: 'sampleRate' | 'bitDepth', libraryRootId: number | null, folderId: number | null) => {
      return listNumericFacetOptions(getDb(), field, libraryRootId ?? null, folderId ?? null)
    }
  )

  ipcMain.handle(
    'irLibrary:query',
    (
      _event,
      options: {
        libraryRootId?: number | null
        folderId?: number | null
        search?: string
        favoritesOnly?: boolean
        minRating?: number
        tagId?: number
        manufacturer?: string | string[]
        cabinet?: string
        speaker?: string | string[]
        microphone?: string | string[]
        sampleRate?: number | number[]
        bitDepth?: number | number[]
        channels?: number
        offset: number
        limit: number
      }
    ) => {
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

  ipcMain.handle('irLibrary:setFolderMetadata', (_event, folderId: number, field: string, value: string, source: string) => {
    setFolderMetadata(getDb(), folderId, field, value, source)
    return { success: true }
  })

  ipcMain.handle('irLibrary:removeFolderMetadata', (_event, folderId: number, field: string) => {
    removeFolderMetadata(getDb(), folderId, field)
    return { success: true }
  })

  ipcMain.handle('irLibrary:setFolderNotes', (_event, folderId: number, notes: string) => {
    setFolderNotes(getDb(), folderId, notes)
    return { success: true }
  })

  ipcMain.handle('irLibrary:listFolders', (_event, libraryRootId: number) => {
    return listFolders(getDb(), libraryRootId)
  })

  ipcMain.handle('irLibrary:listAllFolders', () => {
    return listAllFolders(getDb())
  })

  ipcMain.handle('irLibrary:getFolderDetail', (_event, folderId: number) => {
    const database = getDb()
    const detail = getFolderDetail(database, folderId)
    if (!detail) return null
    return { ...detail, documents: listFolderDocuments(database, folderId) }
  })

  // Runs its own file-picker dialog directly (no separate generic dialog:* channel needed — this
  // handler already runs in the main process) rather than reusing dialog:openImportFile, which is
  // filtered to xlsx/csv for NAM Lab's own spreadsheet import and shouldn't grow PDF-awareness for
  // an unrelated feature.
  ipcMain.handle('irLibrary:importFolderDocument', async (_event, folderId: number) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Vendor documentation', extensions: ['pdf', 'csv', 'txt'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const database = getDb()
    const storageDir = join(app.getPath('userData'), 'ir-documents')
    const doc = importFolderDocument(database, folderId, result.filePaths[0], storageDir)
    // Best-effort, synchronous with the import (documents are small, one at a time — no need for
    // a background queue the way content-hashing needs one for a whole library). A failure here
    // (corrupt PDF, unsupported encoding) must never fail the import itself.
    try {
      await extractVendorDocumentFields(database, folderId)
    } catch {
      // Swallowed on purpose — the document is still imported and linked either way.
    }
    return doc
  })

  ipcMain.handle('irLibrary:extractVendorDocumentFields', async (_event, folderId: number) => {
    return extractVendorDocumentFields(getDb(), folderId)
  })

  ipcMain.handle('irLibrary:deleteFolderDocument', (_event, documentId: number) => {
    deleteFolderDocument(getDb(), documentId)
    return { success: true }
  })

  // Tray + Send to IR Lab (docs/ir-lab-manager-build-plan.md section 9). isInTray reads through
  // getDb() per-call rather than caching in the renderer — the tray is small (max 8) and this
  // avoids a second source of truth going stale.
  ipcMain.handle('irLibrary:addToTray', (_event, itemId: string) => addToTray(getDb(), itemId))
  ipcMain.handle('irLibrary:removeFromTray', (_event, itemId: string) => {
    removeFromTray(getDb(), itemId)
    return { success: true }
  })
  ipcMain.handle('irLibrary:listTray', () => listTray(getDb()))
  ipcMain.handle('irLibrary:isInTray', (_event, itemId: string) => isInTray(getDb(), itemId))
  ipcMain.handle('irLibrary:irLabConnectorAvailable', () => irLabConnectorAvailable())
  ipcMain.handle('irLibrary:sendTrayToIrLab', async () => {
    const tray = listTray(getDb())
    if (tray.length === 0) return { success: false, reason: 'Tray is empty' }
    return sendToIrLab({ kind: 'blend', items: tray.map((row) => row.abs_path) })
  })
  // "Reveal in folder" reuses the existing generic shell:revealFile channel (window.api.revealFile)
  // rather than a duplicate irLibrary:-prefixed one — it's a plain absolute-path reveal, nothing
  // IR-catalog-specific about it.

  ipcMain.handle('irLibrary:getLibraryOverview', (_event, libraryRootId: number, folderId?: number | null) => {
    return getLibraryOverview(getDb(), libraryRootId, folderId ?? null)
  })

  // Groups (plan section 8, item 8) — named, cross-folder tags. "Add to Group..." on an item row
  // creates-or-reuses a tag by name (getOrCreateTag) rather than requiring a separate "new group"
  // step; a Groups filter dropdown in the browse bar lists them via listTags.
  ipcMain.handle('irLibrary:listTags', () => listTags(getDb()))
  ipcMain.handle('irLibrary:getOrCreateTag', (_event, name: string) => getOrCreateTag(getDb(), name))
  ipcMain.handle('irLibrary:renameTag', (_event, tagId: number, name: string) => {
    renameTag(getDb(), tagId, name)
    return { success: true }
  })
  ipcMain.handle('irLibrary:deleteTag', (_event, tagId: number) => {
    deleteTag(getDb(), tagId)
    return { success: true }
  })
  ipcMain.handle('irLibrary:addItemToTag', (_event, itemId: string, tagId: number) => {
    addItemToTag(getDb(), itemId, tagId)
    return { success: true }
  })
  ipcMain.handle('irLibrary:removeItemFromTag', (_event, itemId: string, tagId: number) => {
    removeItemFromTag(getDb(), itemId, tagId)
    return { success: true }
  })
  ipcMain.handle('irLibrary:listTagsForItem', (_event, itemId: string) => listTagsForItem(getDb(), itemId))
}

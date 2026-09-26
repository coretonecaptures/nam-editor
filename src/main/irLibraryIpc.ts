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
import { writeFileSync, readFileSync } from 'node:fs'
import { embedBwfMetadata } from './irCatalog/wavMetadataWriter'
import { createCoreSchema, finalizeIndexes, itemSearchTableExists } from './irCatalog/schema'
import { importLibrary } from './irCatalog/importLibrary'
import { queryItems, countItems, setFavorite, setRating, listFacetOptions, listNumericFacetOptions, queryItemsForSuggestions } from './irCatalog/queryLibrary'
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
import { addToTray, removeFromTray, listTray, isInTray, reorderTray } from './irCatalog/tray'
import { sendToIrLab, irLabConnectorAvailable } from './irLabConnector'
import { checkBlendAllowlist, checkNamAllowlist, readIrLabNamFolder } from './irLabRoots'
import { readIrLabStatus } from './irLabStatus'
import { getLibraryOverview } from './irCatalog/libraryOverview'
import { enrichLabProjects, getProjectDetailForFolder } from './irCatalog/labProjectEnrichment'
import { findDuplicates } from './irCatalog/duplicates'
import { getCoverageMatrix } from './irCatalog/coveragePlanner'
import { renameItem, renameItemsBatch, moveItems, trashItems, copyItems, ensureDestinationFolder, createFolder, renameFolder, deleteFolder } from './irCatalog/fileOps'
import { syncRootWatchers, stopAllRootWatchers, suppressIrRootWatcher } from './irCatalog/irRootWatcher'
import { previewLibraryCleanup, runLibraryCleanup, type CleanupPreviewRow } from './irCatalog/libraryCleanup'
import { createIrFieldWriter, promoteFieldToFolder } from './irCatalog/fieldConfidence'
import { getItemDetail } from './irCatalog/itemDetail'
import { previewSpreadsheetImport, applySpreadsheetImport, type ImportRow, type ImportDiffRow } from './irCatalog/spreadsheetImport'
import { renameNamCapture } from './irCatalog/namCaptureFileOps'
import {
  enrichNamCaptures,
  listNamProjects,
  getNamProjectDetail,
  getNamLibraryOverview,
  setNamCaptureMetadata,
  relinkNamCaptureModel,
  findNamModelCandidates,
  applyProjectDefaults
} from './irCatalog/namCaptureEnrichment'
import {
  previewFolderRemoval,
  removeFolderFromCatalog,
  previewLibraryRootRemoval,
  removeLibraryRoot,
  removeItemFromCatalog
} from './irCatalog/removeFromCatalog'
import { checkItemAvailability, relinkLibraryRoot } from './irCatalog/missingFileCheck'
import {
  listTags,
  getOrCreateTag,
  renameTag,
  deleteTag,
  addItemToTag,
  removeItemFromTag,
  listTagsForItem
} from './irCatalog/tag'
import { listSavedSearches, createSavedSearch, renameSavedSearch, deleteSavedSearch } from './irCatalog/savedSearches'

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
  // Extracted so the watcher (item 13 — syncRootWatchers below) can run the exact same pipeline a
  // manual Rescan does, instead of a second, drifting copy of it.
  const rescanRoot = async (folderPath: string, label: string | null) => {
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
    // Fourth pass (docs/nam-capture-import-plan-2026-08-29.md §2) — detects any nam-capture.json
    // under this root and groups the captures into nam_project collections. Automatic on every
    // scan, same as enrichLabProjects above.
    enrichNamCaptures(database, stats.libraryRootId)
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
  }

  // Watched roots (parity backlog item 13) — library_root.watch_mode had existed since the
  // original schema with nothing ever reading it. watcherLog avoids importing main/index.ts's own
  // `log()` (that file is the Electron entry point; importing anything from it here would create
  // a real circular import, since index.ts already imports this file — see trashFile.ts's matching
  // comment for the same reasoning applied to deleteWithFallback).
  const watcherLog = (msg: string): void => console.error(`[IR root watcher] ${msg}`)
  const resyncWatchers = (): void => {
    // Full teardown + rebuild rather than a diff against path — `syncRootWatchers` only compares
    // watch_mode/existence by id, so a relinked root's watcher (same id, changed path) wouldn't
    // otherwise notice its target moved. Only called on an actual change (startup, watch-mode
    // toggle, root add/remove/relink), never per-render, so the cost is negligible.
    stopAllRootWatchers()
    syncRootWatchers(
      getDb(),
      (_rootId, rootPath) => {
        void rescanRoot(rootPath, null).catch((err) => watcherLog(`rescan of "${rootPath}" failed: ${String(err)}`))
      },
      watcherLog
    )
  }
  resyncWatchers()

  ipcMain.handle('irLibrary:scan', async (_event, folderPath: string, label: string | null) => rescanRoot(folderPath, label))

  ipcMain.handle('irLibrary:setRootWatchMode', (_event, libraryRootId: number, watchMode: 'manual' | 'watched') => {
    getDb().prepare(`UPDATE library_root SET watch_mode = ? WHERE id = ?`).run(watchMode, libraryRootId)
    resyncWatchers()
    return { success: true }
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
    enrichNamCaptures(database, stats.libraryRootId)

    let nonProjectItemsRemoved = 0
    if (!existingRoot) {
      // Keep anything in an IR Lab Project folder, plus every folder that holds a NAM Capture
      // (each NAM capture is its own folder, so the nam_project collection only anchors one of
      // them — the kind='nam_capture' item check below is what protects the rest).
      const result = database
        .prepare(
          `DELETE FROM item WHERE library_root_id = ? AND kind != 'nam_capture' AND (folder_id IS NULL OR folder_id NOT IN (
             SELECT folder_id FROM collection WHERE library_root_id = ? AND kind = 'ir_project' AND folder_id IS NOT NULL
             UNION
             SELECT folder_id FROM item WHERE library_root_id = ? AND kind = 'nam_capture' AND folder_id IS NOT NULL
           ))`
        )
        .run(stats.libraryRootId, stats.libraryRootId, stats.libraryRootId)
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

  // "NAM Projects" mode (docs/nam-capture-import-plan-2026-08-29.md §1). listNamProjects backs
  // the left rail; getNamProjectDetail backs the right panel. Both read trained/untrained purely
  // from the presence of nam-lab-result.json in each capture folder — no stored flag to drift.
  ipcMain.handle('irLibrary:listNamProjects', () => listNamProjects(getDb()))
  ipcMain.handle('irLibrary:getNamProjectDetail', (_event, collectionId: string) => {
    return getNamProjectDetail(getDb(), collectionId)
  })
  ipcMain.handle('irLibrary:getNamLibraryOverview', () => getNamLibraryOverview(getDb()))

  // NAM Projects capture detail (docs/nam-projects-detail-design-2026-08-31.md §7/§6).
  ipcMain.handle(
    'irLibrary:setNamCaptureMetadata',
    (_event, itemId: string, patch: Record<string, unknown>) => setNamCaptureMetadata(getDb(), itemId, patch)
  )
  ipcMain.handle('irLibrary:relinkNamModel', (_event, itemId: string, newModelPath: string) =>
    relinkNamCaptureModel(getDb(), itemId, newModelPath)
  )
  ipcMain.handle('irLibrary:findNamModelCandidates', (_event, modelName: string, roots: string[]) =>
    findNamModelCandidates(modelName, Array.isArray(roots) ? roots.filter((r) => typeof r === 'string') : [])
  )
  // "Set project defaults" (parity backlog item 14) — fills only the captures in this project
  // that don't already have their own value for a given field; never overwrites an existing
  // per-capture value (including a deliberate empty-string clear).
  ipcMain.handle(
    'irLibrary:applyProjectDefaults',
    (
      _event,
      collectionId: string,
      patch: Partial<{ modeledBy: string; gearMake: string; gearModel: string; gearType: string; toneType: string }>
    ) => applyProjectDefaults(getDb(), collectionId, patch)
  )

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
    const result = removeLibraryRoot(getDb(), libraryRootId)
    resyncWatchers() // stop watching a root that no longer exists
    return result
  })

  // "Highlight the capture if someone tries to open one and realizes it doesn't exist" — checked
  // once, at the moment a row is actually opened, not on a timer or per-render. See
  // missingFileCheck.ts's own header comment for why this app follows Lightroom's "detect on
  // demand" model rather than a live filesystem watcher.
  ipcMain.handle('irLibrary:checkItemAvailability', (_event, itemId: string) => {
    return checkItemAvailability(getDb(), itemId)
  })

  // "Find the folder and restore it" — repoints an existing root at its new location; the
  // renderer immediately follows this with the normal 'irLibrary:scan' call to re-validate.
  ipcMain.handle('irLibrary:relinkLibraryRoot', (_event, libraryRootId: number, newPath: string) => {
    relinkLibraryRoot(getDb(), libraryRootId, newPath)
    resyncWatchers() // a watched root's watcher must move to the new path, not keep watching the old one
  })
  ipcMain.handle('irLibrary:removeItemFromCatalog', (_event, itemId: string) => {
    removeItemFromCatalog(getDb(), itemId)
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
        kind?: 'cab' | 'reverb'
        sort?: string
        sortDir?: 'asc' | 'desc'
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

  // Spreadsheet export (audit finding B6) — same filter shape as irLibrary:query, minus paging:
  // this runs the current browse/search/facet scope with no LIMIT/OFFSET (up to a hard cap) so
  // the export always matches what's on screen, not just the currently-loaded page window.
  // Capped rather than unbounded — a real library here runs into the hundreds of thousands of
  // rows (B7), and there's no reason a spreadsheet needs to hold more than this at once.
  const EXPORT_ROW_CAP = 250_000
  ipcMain.handle(
    'irLibrary:queryForExport',
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
        kind?: 'cab' | 'reverb'
        sort?: string
        sortDir?: 'asc' | 'desc'
      }
    ) => {
      const database = getDb()
      const total = countItems(database, options)
      const rows = queryItems(database, { ...options, offset: 0, limit: EXPORT_ROW_CAP }).map((row) => ({
        ...row,
        abs_path: join(row.library_root_path, ...row.relative_path.split('/'))
      }))
      return { rows, total, truncated: total > EXPORT_ROW_CAP }
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
  // Audit finding B5 — slot position maps to a Blender control, so drag-to-reorder in the tray
  // drawer needs to persist, not just reorder the in-memory list until the next listTray() call.
  ipcMain.handle('irLibrary:reorderTray', (_event, orderedItemIds: string[]) => {
    reorderTray(getDb(), orderedItemIds)
    return { success: true }
  })
  ipcMain.handle('irLibrary:irLabConnectorAvailable', () => irLabConnectorAvailable())
  // Richer than the above: irLabConnectorAvailable() is a build-time question (was the URL scheme
  // injected at all — a self-built, non-official copy of this app can never send regardless of
  // what's installed). This is a runtime one — has IR Lab actually run on THIS machine, and what
  // did it last report about itself (audit finding A3).
  ipcMain.handle('irLibrary:getIrLabStatus', () => readIrLabStatus())
  ipcMain.handle('irLibrary:sendTrayToIrLab', async () => {
    const tray = listTray(getDb())
    if (tray.length === 0) return { success: false, reason: 'Tray is empty' }
    const absPaths = tray.map((row) => row.abs_path)

    // Pre-flight IR Lab's OWN allowlist (security audit 2026-08-31, LOW-1: blend only accepts
    // paths under IR Lab's configured Cab IR / Reverb IR / DI folders) so a mismatch shows up as a
    // message in THIS app, not as a silent drop reported by the other one after the user already
    // thinks it worked. See irLabRoots.ts for exactly what this reads and why.
    const check = checkBlendAllowlist(absPaths)
    if (check.noRootsConfigured) {
      return {
        success: false,
        reason:
          'IR Lab has no Cab IR, Reverb IR, or DI folder configured yet, so it will reject every item ' +
          'you send. Open IR Lab → Live Audition settings and set at least one of those folders first.'
      }
    }
    if (check.rejected.length > 0) {
      const n = check.rejected.length
      return {
        success: false,
        reason:
          `${n} of ${absPaths.length} tray item${absPaths.length === 1 ? '' : 's'} ` +
          `${n === 1 ? "isn't" : "aren't"} inside any of IR Lab's configured Cab IR / Reverb IR / DI ` +
          `folders, so IR Lab would silently drop ${n === 1 ? 'it' : 'them'}. Move ${n === 1 ? 'it' : 'them'} ` +
          `into one of those folders, or add this folder in IR Lab's Live Audition settings, then try again.`
      }
    }

    return sendToIrLab({ kind: 'blend', items: absPaths })
  })
  // "Play in IR Lab" (ir-library-gpt-audit-2026-09-25's P0) — loads directly into Live Audition's
  // Cab A/B slots instead of opening Blender, so it needs its OWN handoff, not a reuse of
  // sendTrayToIrLab's blend route. Same pre-flight allowlist as blend (both load real cab IR
  // files, so the same three configured folders apply) and the same 4-item cap `buildIrLabUrl`
  // already enforces — checked again here so a caller sending more than 4 gets a clear reason
  // instead of a URL that silently truncates. NOT YET RECEIVED by IR Lab's own
  // ExternalHandoffRouter.cpp as of this comment — see docs/ir-lab-play-in-ir-lab-spec-2026-09-25.md.
  ipcMain.handle('irLibrary:sendPlayCabToIrLab', async (_event, itemIds: string[]) => {
    if (itemIds.length === 0) return { success: false, reason: 'No items selected.' }
    if (itemIds.length > 4) {
      return { success: false, reason: 'Play in IR Lab takes at most 4 IRs (1-2 for a normal rig, up to 4 for a stereo rig).' }
    }
    const database = getDb()
    const placeholders = itemIds.map(() => '?').join(',')
    const rows = database
      .prepare(
        `SELECT item.id as id, library_root.path as rootPath, item.relative_path as relativePath
         FROM item JOIN library_root ON library_root.id = item.library_root_id
         WHERE item.id IN (${placeholders})`
      )
      .all(...itemIds) as Array<{ id: string; rootPath: string; relativePath: string }>
    if (rows.length !== itemIds.length) return { success: false, reason: 'One or more selected items could not be found in the catalog.' }
    const absPaths = rows.map((r) => join(r.rootPath, ...r.relativePath.split('/')))

    const check = checkBlendAllowlist(absPaths)
    if (check.noRootsConfigured) {
      return {
        success: false,
        reason:
          'IR Lab has no Cab IR, Reverb IR, or DI folder configured yet, so it will reject every item ' +
          'you send. Open IR Lab → Live Audition settings and set at least one of those folders first.'
      }
    }
    if (check.rejected.length > 0) {
      const n = check.rejected.length
      return {
        success: false,
        reason:
          `${n} of ${absPaths.length} selected item${absPaths.length === 1 ? '' : 's'} ` +
          `${n === 1 ? "isn't" : "aren't"} inside any of IR Lab's configured Cab IR / Reverb IR / DI ` +
          `folders, so IR Lab would silently drop ${n === 1 ? 'it' : 'them'}. Move ${n === 1 ? 'it' : 'them'} ` +
          `into one of those folders, or add this folder in IR Lab's Live Audition settings, then try again.`
      }
    }

    return sendToIrLab({ kind: 'playcab', items: absPaths })
  })
  // The other two handoff routes IR Lab's ExternalHandoffRouter has always supported
  // (irlab://session, irlab://project) — build plan section 11. Both payloads are just IDs IR Lab
  // already knows how to resolve through its own SessionStore/ProjectStore; nothing catalog-
  // specific to look up here beyond what the caller already has on screen (a capture's captureId,
  // a project's real IR Lab projectId — namCaptureEnrichment.ts's `naming_template` column).
  ipcMain.handle('irLibrary:findDuplicates', (_event, options: { libraryRootId?: number | null; folderId?: number | null }) =>
    findDuplicates(getDb(), options)
  )
  // The coverage planner (audit idea 1 / backlog step 10) — see coveragePlanner.ts's own header
  // for the gap-detection rule and why it reuses queryItems() rather than a second resolution of
  // cabinet/speaker.
  ipcMain.handle('irLibrary:getCoverageMatrix', (_event, libraryRootId?: number | null) =>
    getCoverageMatrix(getDb(), { libraryRootId: libraryRootId ?? null })
  )
  // Catalog-transactional file operations (parity backlog item 1/2) — see fileOps.ts's own header
  // for why these can't just be the plain disk-only file:rename/file:move/file:trash/file:copy
  // channels NAM mode uses.
  ipcMain.handle('irLibrary:renameItem', (_event, itemId: string, newBaseName: string, force?: boolean) =>
    renameItem(getDb(), itemId, newBaseName, force)
  )
  ipcMain.handle(
    'irLibrary:renameItemsBatch',
    (_event, renames: Array<{ itemId: string; newBaseName: string }>, force?: boolean) =>
      renameItemsBatch(getDb(), renames, force)
  )
  ipcMain.handle('irLibrary:moveItems', (_event, itemIds: string[], destFolderId: number | null, force?: boolean) =>
    moveItems(getDb(), itemIds, destFolderId, force)
  )
  ipcMain.handle('irLibrary:trashItems', (_event, itemIds: string[]) => trashItems(getDb(), itemIds))
  ipcMain.handle('irLibrary:copyItems', (_event, itemIds: string[], destFolderId: number | null, force?: boolean) =>
    copyItems(getDb(), itemIds, destFolderId, force)
  )
  ipcMain.handle('irLibrary:ensureDestinationFolder', (_event, libraryRootId: number, relativeFolderPath: string) =>
    ensureDestinationFolder(getDb(), libraryRootId, relativeFolderPath)
  )
  // Folder create/rename/delete (parity backlog item 11).
  ipcMain.handle('irLibrary:createFolder', (_event, libraryRootId: number, parentFolderId: number | null, name: string) =>
    createFolder(getDb(), libraryRootId, parentFolderId, name)
  )
  ipcMain.handle('irLibrary:renameFolder', (_event, folderId: number, newName: string, force?: boolean) =>
    renameFolder(getDb(), folderId, newName, force)
  )
  ipcMain.handle('irLibrary:deleteFolder', (_event, folderId: number) => deleteFolder(getDb(), folderId))

  // Library Cleanup / Build Library (parity backlog item 12).
  ipcMain.handle(
    'irLibrary:previewLibraryCleanup',
    (_event, options: { libraryRootId: number | null; folderId: number | null; structureTemplate: string }) =>
      previewLibraryCleanup(getDb(), options)
  )
  ipcMain.handle(
    'irLibrary:runLibraryCleanup',
    async (_event, options: { libraryRootId: number | null; folderId: number | null }, rows: CleanupPreviewRow[], mode: 'move' | 'copy') =>
      runLibraryCleanup(getDb(), options, rows, mode)
  )
  // Per-item metadata editing (parity backlog item 7, widened 2026-09-13 per
  // docs/ir-metadata-full-parity-proposal-2026-09-13.md's G1 — see that doc for why the original
  // four-field set was a deliberately-noted gap, not the final scope). Always writes at
  // 'user_entered', the sticky-against-automation confidence tier fieldConfidence.ts already
  // enforces. `notes` lives on `item`, not `ir_item` — fieldConfidence.ts's writer already knows to
  // route it there (see its own comment) — everything else here is a real `ir_item` column.
  // Deliberately excludes fields IR Lab itself only ever records automatically, never lets an
  // operator type (capture_type, preset_kind, reverb_capture_mode, reverb_source_signal_type) and
  // the WAV-header-measured facts (is_reverb/is_stereo/is_true_stereo) — those stay read-only
  // display in the item detail panel, matching how this app treats NAM mode's own auto-set fields
  // (e.g. loudness/gain/latency, which are editable only behind MetadataEditor's explicit
  // unlock-to-override affordance, not a plain text field).
  const EDITABLE_IR_FIELDS = new Set([
    'manufacturer', 'cabinet', 'speaker', 'microphone', 'position', 'notes',
    'speaker_position', 'modeled_microphone',
    'mic_a_type', 'mic_a_polar_pattern', 'mic_a_target_zone', 'mic_a_distance_unit',
    'mic_a_signal_chain_override', 'mic_a_notes',
    'mic_b_type', 'mic_b_polar_pattern', 'mic_b_target_zone', 'mic_b_distance_unit',
    'mic_b_signal_chain_override', 'mic_b_notes',
    'reverb_unit_make', 'reverb_unit_model', 'reverb_preset_name', 'reverb_space_type'
  ])
  ipcMain.handle('irLibrary:setItemMetadata', (_event, itemId: string, field: string, value: string) => {
    if (!EDITABLE_IR_FIELDS.has(field)) return { success: false }
    const trimmed = value.trim()
    if (!trimmed) return { success: false }
    return { success: createIrFieldWriter(getDb()).write(itemId, field, trimmed, 'user_entered') }
  })
  // Clear an item-level override back to folder inheritance (parity backlog item 8).
  ipcMain.handle('irLibrary:clearItemMetadata', (_event, itemId: string, field: string) => {
    if (!EDITABLE_IR_FIELDS.has(field)) return { success: false }
    createIrFieldWriter(getDb()).clear(itemId, field)
    return { success: true }
  })
  // "Apply this value to the whole folder" (parity backlog item 10). Resolved server-side from
  // itemId rather than trusting a client-supplied folderId/value — the item's own current
  // ir_item.<field> and folder_id are the only honest source of "what am I actually promoting."
  ipcMain.handle('irLibrary:promoteItemFieldToFolder', (_event, itemId: string, field: string) => {
    if (!EDITABLE_IR_FIELDS.has(field)) return { success: false, itemsCleared: 0 }
    const database = getDb()
    const row = database
      .prepare(`SELECT item.folder_id as folderId, ir_item.${field} as value FROM item JOIN ir_item ON ir_item.item_id = item.id WHERE item.id = ?`)
      .get(itemId) as { folderId: number | null; value: string | null } | undefined
    if (!row || row.folderId == null || !row.value) return { success: false, itemsCleared: 0 }
    const { itemsCleared } = promoteFieldToFolder(database, row.folderId, field, row.value)
    return { success: true, itemsCleared }
  })
  // Numeric ir_item fields — mic distance/axis-angle, reverb wet%/pre-delay. Kept as a separate
  // channel from setItemMetadata rather than overloading it with a string-vs-number union: these
  // columns are REAL, and going through the string writer would store a TEXT value in a REAL
  // column (SQLite allows it, but every numeric comparison/sort against that column downstream
  // would then be comparing types inconsistently — not worth the ambiguity for two fields' worth
  // of code reuse). `null` clears the field. No `user_entered` ladder check on read here since the
  // ladder itself already lives in labProjectEnrichment.ts's writeNumericField — this channel IS
  // the user_entered writer, the same relationship setItemMetadata has to that file's writeField.
  const EDITABLE_IR_NUMERIC_FIELDS = new Set([
    'mic_a_distance', 'mic_a_axis_angle_deg', 'mic_b_distance', 'mic_b_axis_angle_deg',
    'reverb_recommended_wet_percent', 'reverb_recommended_pre_delay_ms'
  ])
  ipcMain.handle('irLibrary:setItemNumericField', (_event, itemId: string, field: string, value: number | null) => {
    if (!EDITABLE_IR_NUMERIC_FIELDS.has(field)) return { success: false }
    const database = getDb()
    database.prepare(`UPDATE ir_item SET ${field} = ? WHERE item_id = ?`).run(value, itemId)
    if (value === null) {
      database.prepare(`DELETE FROM ir_item_field_source WHERE item_id = ? AND field = ?`).run(itemId, field)
    } else {
      database
        .prepare(
          `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, ?, 'user_entered')
           ON CONFLICT(item_id, field) DO UPDATE SET source = excluded.source`
        )
        .run(itemId, field)
    }
    return { success: true }
  })
  // Full single-item detail for the docked item detail panel (see itemDetail.ts's own header for
  // why this is a separate query from the paginated browse SELECT).
  ipcMain.handle('irLibrary:getItemDetail', (_event, itemId: string) => getItemDetail(getDb(), itemId))

  // Embed metadata into the WAV itself (G3 of docs/ir-metadata-full-parity-proposal-2026-09-13.md)
  // — gated server-side, not just by the renderer hiding the button, since this is the one IR
  // metadata action that mutates the file on disk rather than only the catalog. Re-reads
  // settings.json directly rather than importing main/index.ts's own loadAppSettingsFile — that
  // file can't be imported here without re-running its app.whenReady() startup (same reason
  // fileOps.ts's own header comment gives for staying out of main/index.ts entirely).
  function embedMetadataAllowed(): boolean {
    try {
      const raw = readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8')
      const parsed = JSON.parse(raw) as { irAllowEmbedMetadataInFile?: unknown }
      return parsed.irAllowEmbedMetadataInFile === true
    } catch {
      return false
    }
  }

  function embedOneItem(itemId: string): { itemId: string; success: boolean; error?: string; truncatedDescription?: boolean } {
    const database = getDb()
    const row = database
      .prepare(
        `SELECT item.relative_path as relativePath, library_root.path as rootPath,
                ir_item.cabinet as cabinet, ir_item.speaker as speaker, ir_item.microphone as microphone,
                ir_item.position as position, ir_item.capture_type as captureType,
                ir_item.mic_a_distance as micADistance, ir_item.mic_a_distance_unit as micADistanceUnit,
                item.notes as notes
         FROM item
         JOIN library_root ON library_root.id = item.library_root_id
         LEFT JOIN ir_item ON ir_item.item_id = item.id
         WHERE item.id = ?`
      )
      .get(itemId) as
      | {
          relativePath: string
          rootPath: string
          cabinet: string | null
          speaker: string | null
          microphone: string | null
          position: string | null
          captureType: string | null
          micADistance: number | null
          micADistanceUnit: string | null
          notes: string | null
        }
      | undefined
    if (!row) return { itemId, success: false, error: 'Item not found in the catalog.' }
    const absPath = join(row.rootPath, ...row.relativePath.split('/'))
    suppressIrRootWatcher()
    const result = embedBwfMetadata(absPath, {
      cabinet: row.cabinet,
      speaker: row.speaker,
      microphone: row.microphone,
      position: row.position,
      captureType: row.captureType,
      micADistance: row.micADistance,
      micADistanceUnit: row.micADistanceUnit,
      notes: row.notes
    })
    return { itemId, ...result }
  }

  ipcMain.handle('irLibrary:embedItemsMetadata', async (_event, itemIds: string[]) => {
    if (!embedMetadataAllowed()) {
      return { allowed: false, results: [] as ReturnType<typeof embedOneItem>[] }
    }
    // embedOneItem's WAV rewrite is fully synchronous fs I/O (open/read/write/close) — a genuinely
    // async rewrite of that path would need the exact same careful position-tracking as the sync
    // one (a real bug there was just found and fixed: mixing position-specified and
    // position-omitted writes on one fd silently corrupted the RIFF header), which is more surgery
    // than this fix warrants on its own. Yielding to the event loop BETWEEN items at least keeps
    // Electron's single-threaded main process — and therefore every other IPC call and the UI
    // itself — responsive between files in a multi-item embed, instead of freezing for the summed
    // I/O time of the whole selection in one unbroken synchronous stretch.
    const results: ReturnType<typeof embedOneItem>[] = []
    for (const itemId of itemIds) {
      results.push(embedOneItem(itemId))
      await new Promise((resolve) => setImmediate(resolve))
    }
    return { allowed: true, results }
  })
  ipcMain.handle('irLibrary:embedMetadataAllowed', () => embedMetadataAllowed())

  // Spreadsheet import (parity backlog item 19) — preview and apply are two separate calls
  // deliberately: the renderer shows the preview's diff, the user confirms, THEN apply runs on
  // exactly those rows (see spreadsheetImport.ts's own header for why apply never recomputes).
  ipcMain.handle('irLibrary:previewSpreadsheetImport', (_event, rows: ImportRow[]) => previewSpreadsheetImport(getDb(), rows))
  ipcMain.handle('irLibrary:applySpreadsheetImport', (_event, diffRows: ImportDiffRow[]) => applySpreadsheetImport(getDb(), diffRows))

  // Metadata suggestion rules (parity backlog item 20) — the source rows the renderer's rule
  // engine (utils/irMetadataSuggest.ts) runs against; applying a resulting suggestion reuses the
  // existing irLibrary:setItemMetadata channel (same user_entered write everything else uses), so
  // no separate "apply suggestion" IPC is needed.
  ipcMain.handle('irLibrary:queryItemsForSuggestions', (_event, options: { libraryRootId: number | null; folderId: number | null }) =>
    queryItemsForSuggestions(getDb(), options)
  )

  // NAM Capture rename (parity backlog item 15) — see namCaptureFileOps.ts's own header for the
  // scope this ended up at, and what's still unverified against the real IR Lab app.
  ipcMain.handle('irLibrary:renameNamCapture', (_event, itemId: string, newBaseName: string, force?: boolean) =>
    renameNamCapture(getDb(), itemId, newBaseName, force)
  )

  ipcMain.handle('irLibrary:sendSessionToIrLab', async (_event, captureId: string) => {
    if (!captureId) return { success: false, reason: 'No capture id for this item.' }
    return sendToIrLab({ kind: 'session', captureId })
  })
  ipcMain.handle('irLibrary:sendProjectToIrLab', async (_event, projectId: string, preset?: string) => {
    if (!projectId) return { success: false, reason: 'No project id for this item.' }
    return sendToIrLab({ kind: 'project', id: projectId, preset })
  })
  // "Group -> IR Lab Player" (the audit's flagship idea, backlog item I3): hand a curated set of
  // .nam files to IR Lab's `namgroup` route (commit bb2ece4, shipped ahead of this side existing)
  // as a manifest IR Lab cycles through in one Live Audition NAM slot via PREV/NEXT.
  ipcMain.handle('irLibrary:sendNamGroupToIrLab', async (_event, items: Array<{ path: string; name?: string }>, slot?: number) => {
    if (!items || items.length === 0) return { success: false, reason: 'Nothing to send — the group is empty.' }
    const paths = items.map((i) => i.path)

    // Pre-flight the SAME allowlist IR Lab's own ExternalHandoffRouter enforces
    // (LiveAuditionSettingsStore::defaultNamFolder()) — catches the exact failure mode A2/I2
    // already fixed for `blend` (a mismatch reported in the OTHER app, after this one already
    // said "sent"), applied here to the nam/namgroup routes instead.
    const check = checkNamAllowlist(paths)
    if (check.noRootsConfigured) {
      return {
        success: false,
        reason:
          'IR Lab has no NAM folder configured yet, so it will reject this group. Open IR Lab → Live Audition ' +
          'settings and set a NAM folder first.'
      }
    }
    if (check.rejected.length > 0) {
      const n = check.rejected.length
      return {
        success: false,
        reason:
          `${n} of ${paths.length} file${paths.length === 1 ? '' : 's'} ${n === 1 ? "isn't" : "aren't"} inside IR Lab's ` +
          `configured NAM folder, so IR Lab would reject the whole group. Move ${n === 1 ? 'it' : 'them'} there, or add ` +
          `this folder in IR Lab's Live Audition settings, then try again.`
      }
    }

    // The manifest file itself must ALSO live under defaultNamFolder — IR Lab allowlists the
    // manifest path exactly like a single .nam (ExternalHandoffRouter.cpp's own comment on the
    // namgroup route). readIrLabNamFolder() is safe to call again here: checkNamAllowlist just
    // confirmed it's set and every item resolves under it.
    const namFolder = readIrLabNamFolder() as string
    const manifestPath = join(namFolder, `nam-lab-group-${Date.now()}.json`)
    try {
      writeFileSync(
        manifestPath,
        JSON.stringify({ items: items.map((i) => ({ file: i.path, name: i.name ?? undefined })) }, null, 2),
        'utf-8'
      )
    } catch (err) {
      return { success: false, reason: `Could not write the group manifest: ${String(err)}` }
    }

    return sendToIrLab({ kind: 'namgroup', manifestPath, slot })
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

  // Saved searches (audit finding B6) — a named filter/facet combination, re-run live rather than
  // a static item list (see savedSearches.ts header comment for the distinction from a Group).
  ipcMain.handle('irLibrary:listSavedSearches', () => listSavedSearches(getDb()))
  ipcMain.handle('irLibrary:createSavedSearch', (_event, name: string, filterJson: string) =>
    createSavedSearch(getDb(), name, filterJson)
  )
  ipcMain.handle('irLibrary:renameSavedSearch', (_event, id: string, name: string) => {
    renameSavedSearch(getDb(), id, name)
    return { success: true }
  })
  ipcMain.handle('irLibrary:deleteSavedSearch', (_event, id: string) => {
    deleteSavedSearch(getDb(), id)
    return { success: true }
  })
}

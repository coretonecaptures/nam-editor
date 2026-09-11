/**
 * Catalog-transactional file operations for IR items — parity backlog item 1, the foundation
 * everything else in "Phase 2: file operations in IR mode" depends on.
 *
 * Why this exists as its own layer instead of just calling NAM mode's `file:rename`/`file:move`:
 * those are catalog-UNaware and can afford to be, because NAM mode re-derives a folder's contents
 * by scanning it. An IR item is a row with a stable UUID carrying ratings, favourites, tags, tray
 * membership and FTS entries. Calling the plain disk-only IPC from IR mode would rename the file
 * and leave the row pointing at a path that no longer exists — on the next scan it comes back as a
 * BRAND NEW row with a fresh UUID and none of that. Every function here does the disk mutation and
 * the catalog update as one unit, so identity and everything keyed to it survives.
 *
 * Ordering: disk operation first, then the DB update. Disk failures (permissions, in-use file, a
 * vanished source) are the likely failure mode and are cheap to detect before touching the catalog
 * at all. If the DB update throws after a successful disk op, this attempts a best-effort rollback
 * of the disk side so the two never end up silently out of sync.
 *
 * `suppressWatcher()` (main/index.ts) is deliberately NOT called here: nothing watches IR library
 * roots yet (parity backlog item 13 — `library_root.watch_mode = 'watched'` exists as a column
 * with nothing reading it). Once that watcher exists, it will need its own suppression mechanism
 * anyway, scoped to IR roots rather than NAM mode's `.nam`-file watcher — wire it then, not now.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { toPosixRel } from './scanWalk'
import { deleteWithFallback } from '../trashFile'

export interface FileOpResult {
  itemId: string
  success: boolean
  error?: string
  /** New abs path, for rename/move/copy. Absent on trash or on failure. */
  newAbsPath?: string
  /** copyItems only — the id of the newly-created catalog row for the copy. */
  newItemId?: string
}

interface ResolvedItem {
  id: string
  libraryRootId: number
  libraryRootPath: string
  folderId: number | null
  relativePath: string
  displayName: string
  missingSince: string | null
}

function resolveItem(db: DatabaseSync, itemId: string): ResolvedItem | null {
  const row = db
    .prepare(
      `SELECT item.id as id, item.library_root_id as libraryRootId, library_root.path as libraryRootPath,
              item.folder_id as folderId, item.relative_path as relativePath, item.display_name as displayName,
              item.missing_since as missingSince
       FROM item
       JOIN library_root ON library_root.id = item.library_root_id
       WHERE item.id = ?`
    )
    .get(itemId) as ResolvedItem | undefined
  return row ?? null
}

function absPathOf(item: Pick<ResolvedItem, 'libraryRootPath' | 'relativePath'>): string {
  return join(item.libraryRootPath, ...item.relativePath.split('/'))
}

/** Walks a folder's relative path top-down, creating any missing `folder` rows exactly like the
 * scanner does (`importLibrary.ts`'s own `insertFolder`) — same ON CONFLICT upsert shape, so a
 * move into a not-yet-seen destination folder behaves identically to that folder having been
 * discovered by a scan. Returns the leaf folder's id, or null for the root itself (empty path). */
function ensureFolderPath(db: DatabaseSync, libraryRootId: number, relativeFolderPath: string): number | null {
  const posix = toPosixRel(relativeFolderPath).replace(/^\/+|\/+$/g, '')
  if (!posix) return null

  const insertFolder = db.prepare(
    `INSERT INTO folder (library_root_id, parent_id, relative_path)
     VALUES (?, ?, ?)
     ON CONFLICT(library_root_id, relative_path) DO UPDATE SET relative_path = excluded.relative_path
     RETURNING id`
  )

  const segments = posix.split('/')
  let parentId: number | null = null
  let builtPath = ''
  for (const segment of segments) {
    builtPath = builtPath ? `${builtPath}/${segment}` : segment
    const row = insertFolder.get(libraryRootId, parentId, builtPath) as { id: number }
    parentId = row.id
  }
  return parentId
}

function folderRelativePath(db: DatabaseSync, folderId: number | null): string {
  if (folderId == null) return ''
  const row = db.prepare(`SELECT relative_path as relativePath FROM folder WHERE id = ?`).get(folderId) as
    | { relativePath: string }
    | undefined
  return row?.relativePath ?? ''
}

function updateItemPath(db: DatabaseSync, itemId: string, folderId: number | null, relativePath: string, displayName: string): void {
  db.prepare(
    `UPDATE item SET folder_id = ?, relative_path = ?, display_name = ?, modified_at = ? WHERE id = ?`
  ).run(folderId, relativePath, displayName, new Date().toISOString(), itemId)
}

function guardOperable(item: ResolvedItem | null, itemId: string): FileOpResult | null {
  if (!item) return { itemId, success: false, error: 'Item not found in catalog.' }
  if (item.missingSince) return { itemId, success: false, error: 'File is marked missing — rescan or relink before operating on it.' }
  return null
}

// ---- rename -----------------------------------------------------------------------------------

/** Renames one item in place. `newBaseName` excludes the extension — the item keeps its own,
 * matching NAM mode's own `file:rename` convention (extension isn't user-editable there either). */
export async function renameItem(db: DatabaseSync, itemId: string, newBaseName: string, force = false): Promise<FileOpResult> {
  const item = resolveItem(db, itemId)
  const guard = guardOperable(item, itemId)
  if (guard) return guard
  const resolved = item as ResolvedItem

  const oldAbsPath = absPathOf(resolved)
  const ext = extname(oldAbsPath)
  const trimmed = newBaseName.trim()
  if (!trimmed) return { itemId, success: false, error: 'New name cannot be empty.' }
  const newFileName = trimmed + ext
  const newAbsPath = join(dirname(oldAbsPath), newFileName)

  if (newAbsPath === oldAbsPath) return { itemId, success: true, newAbsPath }

  try {
    if (fs.existsSync(newAbsPath)) {
      if (!force) return { itemId, success: false, error: 'A file with that name already exists.' }
      fs.unlinkSync(newAbsPath)
    }
    fs.renameSync(oldAbsPath, newAbsPath)
  } catch (err) {
    return { itemId, success: false, error: String(err) }
  }

  const folderRel = folderRelativePath(db, resolved.folderId)
  const newRelativePath = toPosixRel(folderRel ? `${folderRel}/${newFileName}` : newFileName)

  try {
    updateItemPath(db, itemId, resolved.folderId, newRelativePath, newFileName)
  } catch (err) {
    // Best-effort rollback so disk and catalog don't end up silently disagreeing.
    try {
      fs.renameSync(newAbsPath, oldAbsPath)
    } catch {
      // Nothing more to do — surface the original DB error; the file is left at newAbsPath.
    }
    return { itemId, success: false, error: `Renamed on disk but the catalog update failed: ${String(err)}` }
  }

  return { itemId, success: true, newAbsPath }
}

// ---- move ---------------------------------------------------------------------------------------

/** Moves items to a destination folder within the SAME library root — cross-root moves aren't
 * supported (a different root is a different physical location the user chose deliberately; moving
 * across that boundary is a user decision this function shouldn't make silently). Creates the
 * destination folder if it doesn't exist yet, matching how the scanner would discover it. */
export async function moveItems(db: DatabaseSync, itemIds: string[], destFolderId: number | null, force = false): Promise<FileOpResult[]> {
  const results: FileOpResult[] = []
  const destFolderRel = destFolderId != null ? folderRelativePath(db, destFolderId) : ''

  for (const itemId of itemIds) {
    const item = resolveItem(db, itemId)
    const guard = guardOperable(item, itemId)
    if (guard) {
      results.push(guard)
      continue
    }
    const resolved = item as ResolvedItem

    if (destFolderId != null) {
      const destFolder = db.prepare(`SELECT library_root_id as libraryRootId FROM folder WHERE id = ?`).get(destFolderId) as
        | { libraryRootId: number }
        | undefined
      if (!destFolder || destFolder.libraryRootId !== resolved.libraryRootId) {
        results.push({ itemId, success: false, error: 'Cannot move across library roots.' })
        continue
      }
    }

    const oldAbsPath = absPathOf(resolved)
    const fileName = resolved.relativePath.split('/').pop() as string
    const newAbsPath = join(resolved.libraryRootPath, ...(destFolderRel ? destFolderRel.split('/') : []), fileName)

    if (newAbsPath === oldAbsPath) {
      results.push({ itemId, success: true, newAbsPath })
      continue
    }

    try {
      if (fs.existsSync(newAbsPath)) {
        if (!force) {
          results.push({ itemId, success: false, error: 'A file with that name already exists in the destination.' })
          continue
        }
        fs.unlinkSync(newAbsPath)
      }
      fs.renameSync(oldAbsPath, newAbsPath)
    } catch (err) {
      results.push({ itemId, success: false, error: String(err) })
      continue
    }

    const newRelativePath = toPosixRel(destFolderRel ? `${destFolderRel}/${fileName}` : fileName)
    try {
      updateItemPath(db, itemId, destFolderId, newRelativePath, fileName)
    } catch (err) {
      try {
        fs.renameSync(newAbsPath, oldAbsPath)
      } catch {
        // See renameItem's matching comment.
      }
      results.push({ itemId, success: false, error: `Moved on disk but the catalog update failed: ${String(err)}` })
      continue
    }

    results.push({ itemId, success: true, newAbsPath })
  }

  return results
}

/** Ensures the destination folder exists (creating it if needed) and returns its id — the entry
 * point for a "Move to…" picker that lets the user type/pick a folder that may not exist yet. */
export function ensureDestinationFolder(db: DatabaseSync, libraryRootId: number, relativeFolderPath: string): number | null {
  return ensureFolderPath(db, libraryRootId, relativeFolderPath)
}

// ---- trash --------------------------------------------------------------------------------------

/** Sends each item's file to the OS trash (never a hard delete — matches NAM mode's own
 * `file:trash`) and removes its catalog row outright. Deliberately not `missing_since`: the user
 * asked for it to go, not for it to be flagged as unexpectedly absent. `ON DELETE CASCADE` on
 * `ir_item`/`nam_capture_item`/etc. (schema.ts) takes the attached rows with it. */
export async function trashItems(db: DatabaseSync, itemIds: string[]): Promise<FileOpResult[]> {
  const results: FileOpResult[] = []
  const deleteItem = db.prepare(`DELETE FROM item WHERE id = ?`)

  for (const itemId of itemIds) {
    const item = resolveItem(db, itemId)
    const guard = guardOperable(item, itemId)
    if (guard) {
      results.push(guard)
      continue
    }
    const resolved = item as ResolvedItem
    const absPath = absPathOf(resolved)

    try {
      await deleteWithFallback(absPath)
    } catch (err) {
      results.push({ itemId, success: false, error: String(err) })
      continue
    }

    try {
      deleteItem.run(itemId)
    } catch (err) {
      // The file is already gone (OS trash or a hard delete) — there's no disk-side rollback for
      // that. Surface the DB failure clearly rather than pretending the operation fully failed.
      results.push({ itemId, success: false, error: `File trashed but the catalog row could not be removed: ${String(err)}` })
      continue
    }

    results.push({ itemId, success: true })
  }

  return results
}

// ---- copy -----------------------------------------------------------------------------------------

/** Copies items into a destination folder, creating a NEW catalog row for each copy — a copy is a
 * genuinely new file with its own identity, not a second name for the source's. Ratings/tags/tray
 * membership are intentionally NOT carried over: those describe the user's relationship to a
 * specific file, and silently duplicating them onto a copy neither NAM mode nor IR Lab's own
 * project model does anywhere else in this app. */
export async function copyItems(db: DatabaseSync, itemIds: string[], destFolderId: number | null, force = false): Promise<FileOpResult[]> {
  const results: FileOpResult[] = []
  const destFolderRel = destFolderId != null ? folderRelativePath(db, destFolderId) : ''

  const insertItem = db.prepare(
    `INSERT INTO item (id, kind, library_root_id, folder_id, relative_path, display_name, indexed_at, last_seen_at, file_size)
     SELECT ?, kind, library_root_id, ?, ?, ?, ?, ?, file_size FROM item WHERE id = ?`
  )

  for (const itemId of itemIds) {
    const item = resolveItem(db, itemId)
    const guard = guardOperable(item, itemId)
    if (guard) {
      results.push(guard)
      continue
    }
    const resolved = item as ResolvedItem

    if (destFolderId != null) {
      const destFolder = db.prepare(`SELECT library_root_id as libraryRootId FROM folder WHERE id = ?`).get(destFolderId) as
        | { libraryRootId: number }
        | undefined
      if (!destFolder || destFolder.libraryRootId !== resolved.libraryRootId) {
        results.push({ itemId, success: false, error: 'Cannot copy across library roots.' })
        continue
      }
    }

    const oldAbsPath = absPathOf(resolved)
    const fileName = resolved.relativePath.split('/').pop() as string
    const newAbsPath = join(resolved.libraryRootPath, ...(destFolderRel ? destFolderRel.split('/') : []), fileName)

    if (newAbsPath === oldAbsPath) {
      results.push({ itemId, success: false, error: 'Source and destination are the same file.' })
      continue
    }

    try {
      if (fs.existsSync(newAbsPath)) {
        if (!force) {
          results.push({ itemId, success: false, error: 'A file with that name already exists in the destination.' })
          continue
        }
        fs.unlinkSync(newAbsPath)
      }
      fs.copyFileSync(oldAbsPath, newAbsPath)
    } catch (err) {
      results.push({ itemId, success: false, error: String(err) })
      continue
    }

    const newRelativePath = toPosixRel(destFolderRel ? `${destFolderRel}/${fileName}` : fileName)
    const newItemId = randomUUID()
    const now = new Date().toISOString()
    try {
      insertItem.run(newItemId, destFolderId, newRelativePath, fileName, now, now, itemId)
    } catch (err) {
      try {
        fs.unlinkSync(newAbsPath)
      } catch {
        // Best-effort only — see renameItem's matching comment.
      }
      results.push({ itemId, success: false, error: `Copied on disk but the catalog insert failed: ${String(err)}` })
      continue
    }

    results.push({ itemId, success: true, newAbsPath, newItemId })
  }

  return results
}

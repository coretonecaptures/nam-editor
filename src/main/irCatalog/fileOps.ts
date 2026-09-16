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
 * discovered by a scan — AND the real directory on disk, via one `fs.mkdirSync(..., {recursive})`
 * on the full path. Without this, a move/copy into a genuinely new path (the "Create & Move" path
 * in `IrMoveToFolderModal.tsx`) would insert the catalog rows successfully and then fail the very
 * next `fs.renameSync`/`fs.copyFileSync` with ENOENT, since Node requires a rename/copy
 * destination's parent directory to already exist — caught while building item 11, which needed
 * this same "create a real folder" primitive and is where this bug would have first been hit
 * directly rather than indirectly through a move. Returns the leaf folder's id, or null for the
 * root itself (empty path). */
function ensureFolderPath(db: DatabaseSync, libraryRootId: number, relativeFolderPath: string): number | null {
  const posix = toPosixRel(relativeFolderPath).replace(/^\/+|\/+$/g, '')
  if (!posix) return null

  const rootPath = (db.prepare(`SELECT path FROM library_root WHERE id = ?`).get(libraryRootId) as { path: string } | undefined)?.path
  if (rootPath) fs.mkdirSync(join(rootPath, ...posix.split('/')), { recursive: true })

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

/** Renames many items as one atomic unit — the batch-rename-with-a-template feature (parity
 * backlog item 6) originally shipped as a loop of independent `renameItem` calls: each one safe on
 * its own, but not atomic as a GROUP. A failure partway through left earlier renames applied and
 * later ones not, reported only as a succeeded/failed count.
 *
 * This does every item's disk rename first, tracking what actually succeeded so a later failure
 * can roll all of them back, then commits every catalog update in ONE DB transaction (same
 * BEGIN/COMMIT/ROLLBACK idiom `contentHash.ts` and `importLibrary.ts` already use) — so the batch
 * either fully lands, on both disk and catalog, or fully reverts to exactly where it started.
 * Precondition failures (item not found, missing, blank name) abort the WHOLE batch before any
 * disk mutation happens at all, rather than renaming some files and then discovering a later one
 * in the list was invalid.
 */
export async function renameItemsBatch(
  db: DatabaseSync,
  renames: Array<{ itemId: string; newBaseName: string }>,
  force = false
): Promise<FileOpResult[]> {
  interface Planned {
    itemId: string
    folderId: number | null
    oldAbsPath: string
    newAbsPath: string
    newFileName: string
  }
  const planned: Planned[] = []

  // Preflight: resolve every item and compute its destination path before touching disk. Any
  // failure here aborts the batch entirely — nothing has moved yet, so "abort" is free.
  for (const { itemId, newBaseName } of renames) {
    const item = resolveItem(db, itemId)
    const guard = guardOperable(item, itemId)
    if (guard) return renames.map((r) => (r.itemId === itemId ? guard : { itemId: r.itemId, success: false, error: `Batch aborted — item ${itemId} failed: ${guard.error}` }))
    const resolved = item as ResolvedItem
    const oldAbsPath = absPathOf(resolved)
    const ext = extname(oldAbsPath)
    const trimmed = newBaseName.trim()
    if (!trimmed) {
      const err = { itemId, success: false, error: 'New name cannot be empty.' }
      return renames.map((r) => (r.itemId === itemId ? err : { itemId: r.itemId, success: false, error: 'Batch aborted — another item in this batch had an empty name.' }))
    }
    const newFileName = trimmed + ext
    const newAbsPath = join(dirname(oldAbsPath), newFileName)
    planned.push({ itemId, folderId: resolved.folderId, oldAbsPath, newAbsPath, newFileName })
  }

  // Disk phase: rename each in order, remembering what succeeded so a failure partway can be
  // rolled back to leave the filesystem exactly as it was before the batch started.
  const renamedOnDisk: Planned[] = []
  for (const p of planned) {
    if (p.newAbsPath === p.oldAbsPath) {
      renamedOnDisk.push(p)
      continue
    }
    try {
      if (fs.existsSync(p.newAbsPath)) {
        if (!force) throw new Error('A file with that name already exists.')
        fs.unlinkSync(p.newAbsPath)
      }
      fs.renameSync(p.oldAbsPath, p.newAbsPath)
      renamedOnDisk.push(p)
    } catch (err) {
      for (const done of renamedOnDisk) {
        if (done.newAbsPath === done.oldAbsPath) continue
        try {
          fs.renameSync(done.newAbsPath, done.oldAbsPath)
        } catch {
          // Best-effort — surfaced generically below; nothing more to do per-file here.
        }
      }
      const failedId = p.itemId
      return planned.map((x) =>
        x.itemId === failedId
          ? { itemId: x.itemId, success: false, error: String(err) }
          : { itemId: x.itemId, success: false, error: `Batch rolled back — item ${failedId} failed: ${String(err)}` }
      )
    }
  }

  // Catalog phase: one transaction for every item's row update. If it throws, roll back both the
  // DB transaction AND every disk rename this batch just performed.
  db.exec('BEGIN')
  try {
    for (const p of renamedOnDisk) {
      const folderRel = folderRelativePath(db, p.folderId)
      const newRelativePath = toPosixRel(folderRel ? `${folderRel}/${p.newFileName}` : p.newFileName)
      updateItemPath(db, p.itemId, p.folderId, newRelativePath, p.newFileName)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    for (const p of renamedOnDisk) {
      if (p.newAbsPath === p.oldAbsPath) continue
      try {
        fs.renameSync(p.newAbsPath, p.oldAbsPath)
      } catch {
        // Best-effort — surfaced generically below.
      }
    }
    return planned.map((x) => ({ itemId: x.itemId, success: false, error: `Batch rolled back — catalog update failed: ${String(err)}` }))
  }

  return planned.map((p) => ({ itemId: p.itemId, success: true, newAbsPath: p.newAbsPath }))
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

// ---- folder operations (parity backlog item 11) --------------------------------------------------

export interface FolderOpResult {
  success: boolean
  error?: string
  /** How many descendant items had their relative_path updated — surfaced so a rename of a big
   * subtree can say what it actually touched, not just "done." */
  itemsAffected?: number
}

interface ResolvedFolder {
  id: number
  libraryRootId: number
  libraryRootPath: string
  parentId: number | null
  relativePath: string
}

function resolveFolder(db: DatabaseSync, folderId: number): ResolvedFolder | null {
  const row = db
    .prepare(
      `SELECT folder.id as id, folder.library_root_id as libraryRootId, library_root.path as libraryRootPath,
              folder.parent_id as parentId, folder.relative_path as relativePath
       FROM folder JOIN library_root ON library_root.id = folder.library_root_id
       WHERE folder.id = ?`
    )
    .get(folderId) as ResolvedFolder | undefined
  return row ?? null
}

/** Creates a real directory on disk plus its catalog row — same primitive `ensureFolderPath`
 * above uses for a move's "type a new path" case, exposed directly for the IR tree's own
 * "New Folder" action. `parentFolderId: null` means directly under the library root. */
export function createFolder(db: DatabaseSync, libraryRootId: number, parentFolderId: number | null, name: string): FolderOpResult {
  const trimmed = name.trim()
  if (!trimmed) return { success: false, error: 'Name cannot be empty.' }
  const parentRel = parentFolderId != null ? folderRelativePath(db, parentFolderId) : ''
  const relativePath = parentRel ? `${parentRel}/${trimmed}` : trimmed
  const rootPath = (db.prepare(`SELECT path FROM library_root WHERE id = ?`).get(libraryRootId) as { path: string } | undefined)?.path
  if (!rootPath) return { success: false, error: 'Library root not found.' }
  const absPath = join(rootPath, ...relativePath.split('/'))
  if (fs.existsSync(absPath)) return { success: false, error: 'A folder with that name already exists.' }
  try {
    fs.mkdirSync(absPath, { recursive: true })
  } catch (err) {
    return { success: false, error: String(err) }
  }
  ensureFolderPath(db, libraryRootId, relativePath)
  return { success: true }
}

/** Renames a folder on disk and cascades the `relative_path` change to every descendant folder
 * AND item — none of their `parent_id`/`folder_id` values change (the hierarchy itself is
 * untouched by a rename), only the path strings that encode where each one lives on disk. Walked
 * via the recursive-CTE descendant set (ID lineage), not a string-prefix match on relative_path —
 * a prefix match would wrongly catch a sibling like "Package" when renaming "Pack". */
export function renameFolder(db: DatabaseSync, folderId: number, newName: string, force = false): FolderOpResult {
  const folder = resolveFolder(db, folderId)
  if (!folder) return { success: false, error: 'Folder not found.' }
  const trimmed = newName.trim()
  if (!trimmed) return { success: false, error: 'Name cannot be empty.' }

  const parentRel = folder.parentId != null ? folderRelativePath(db, folder.parentId) : ''
  const newRelativePath = parentRel ? `${parentRel}/${trimmed}` : trimmed
  if (newRelativePath === folder.relativePath) return { success: true, itemsAffected: 0 }

  const oldAbsPath = join(folder.libraryRootPath, ...folder.relativePath.split('/'))
  const newAbsPath = join(folder.libraryRootPath, ...newRelativePath.split('/'))

  try {
    if (fs.existsSync(newAbsPath)) {
      if (!force) return { success: false, error: 'A folder with that name already exists.' }
      fs.rmSync(newAbsPath, { recursive: true, force: true })
    }
    fs.renameSync(oldAbsPath, newAbsPath)
  } catch (err) {
    return { success: false, error: String(err) }
  }

  const descendantFolders = db
    .prepare(
      `WITH RECURSIVE d(id, relative_path) AS (
         SELECT id, relative_path FROM folder WHERE id = ?
         UNION ALL
         SELECT folder.id, folder.relative_path FROM folder JOIN d ON folder.parent_id = d.id
       )
       SELECT id, relative_path as relativePath FROM d`
    )
    .all(folderId) as Array<{ id: number; relativePath: string }>

  const updateFolder = db.prepare(`UPDATE folder SET relative_path = ? WHERE id = ?`)
  for (const f of descendantFolders) {
    const suffix = f.relativePath === folder.relativePath ? '' : f.relativePath.slice(folder.relativePath.length)
    updateFolder.run(newRelativePath + suffix, f.id)
  }

  const descendantFolderIds = descendantFolders.map((f) => f.id)
  const items = db
    .prepare(`SELECT id, relative_path as relativePath FROM item WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`)
    .all(...descendantFolderIds) as Array<{ id: string; relativePath: string }>
  const updateItem = db.prepare(`UPDATE item SET relative_path = ? WHERE id = ?`)
  for (const it of items) {
    const suffix = it.relativePath.slice(folder.relativePath.length)
    updateItem.run(newRelativePath + suffix, it.id)
  }

  return { success: true, itemsAffected: items.length }
}

/** Trashes the real folder (and everything in it) via the OS trash, then removes it and every
 * descendant folder/item from the catalog. `ON DELETE CASCADE` on `ir_item`/`nam_capture_item`/
 * `item_tag`/`collection_item` (schema.ts) takes each item's attached rows with it; explicit
 * folder deletes here since `folder` has no such cascade defined for itself. */
export async function deleteFolder(db: DatabaseSync, folderId: number): Promise<FolderOpResult> {
  const folder = resolveFolder(db, folderId)
  if (!folder) return { success: false, error: 'Folder not found.' }
  const absPath = join(folder.libraryRootPath, ...folder.relativePath.split('/'))

  try {
    await deleteWithFallback(absPath)
  } catch (err) {
    return { success: false, error: String(err) }
  }

  const descendantFolderIds = (
    db
      .prepare(
        `WITH RECURSIVE d(id) AS (
           SELECT id FROM folder WHERE id = ?
           UNION ALL
           SELECT folder.id FROM folder JOIN d ON folder.parent_id = d.id
         )
         SELECT id FROM d`
      )
      .all(folderId) as Array<{ id: number }>
  ).map((r) => r.id)

  const itemCount = (
    db
      .prepare(`SELECT COUNT(*) as n FROM item WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`)
      .get(...descendantFolderIds) as { n: number }
  ).n

  db.prepare(`DELETE FROM item WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`).run(...descendantFolderIds)

  // folder.parent_id -> folder.id has no ON DELETE CASCADE, and foreign_keys is ON (schema.ts) —
  // deleting a parent while a child row still references it is rejected. The recursive CTE above
  // returns rows breadth-first (target, then its direct children, then grandchildren, ...);
  // reversing that list deletes every row only after everything strictly deeper than it is already
  // gone, which is exactly "children before their own parent" for every branch, not just one.
  const deleteFolderRow = db.prepare(`DELETE FROM folder WHERE id = ?`)
  for (const id of [...descendantFolderIds].reverse()) deleteFolderRow.run(id)

  return { success: true, itemsAffected: itemCount }
}

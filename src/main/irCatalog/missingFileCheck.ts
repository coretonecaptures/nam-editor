/**
 * On-open missing-file detection — "highlight the capture if someone tries to open one and
 * realizes it doesn't exist... search up from the file to see if the folder, or its parent(s),
 * are also missing... ask if they want to remove from the app or find the folder and restore it."
 *
 * Deliberately NOT a background watcher (see removeFromCatalog.ts's own header comment on why —
 * this app follows the Lightroom-style "detect on demand" model, not live fs.watch). This runs
 * exactly once, at the moment a user actually tries to open a capture (Play/Play Live), which is
 * the moment a stale row is actually noticed — no reason to pay a filesystem stat for every row in
 * a 282K-item library on every render.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join } from 'node:path'

export type MissingScope = 'item' | 'folder' | 'root'

export interface MissingCheckResult {
  fileMissing: boolean
  /** Undefined when fileMissing is false. 'item' = just this file; 'folder' = the shallowest
   * ancestor folder that's actually gone (everything under it is gone too, but relocating/removing
   * THAT folder is the real fix, not each individual missing descendant); 'root' = the whole added
   * library folder itself is gone. */
  missingScope?: MissingScope
  /** The folder id to act on when missingScope is 'folder' — pass to removeFolderFromCatalog. */
  missingFolderId?: number
  missingFolderName?: string
  libraryRootId: number
  libraryRootLabel: string
  /** How many catalog items live under the missing scope — for the dialog's wording ("this folder
   * and 11 other captures also appear to be missing"), not itself acted upon. */
  affectedItemCount: number
}

/** Checks one item's file on disk, walking UP from the library root DOWN to the item (root first,
 * then each subfolder in turn) rather than starting at the leaf — the first ancestor that's
 * missing IS the real scope of what moved/got deleted; everything nested inside it is necessarily
 * also missing, but reporting the topmost one is what actually lets the user fix or remove the
 * right thing in one action instead of being told about each descendant separately. Also marks
 * `missing_since` on the item immediately (if not already set) so the row's own badge updates
 * without waiting for a full rescan. */
export function checkItemAvailability(db: DatabaseSync, itemId: string): MissingCheckResult {
  const item = db
    .prepare(
      `SELECT item.relative_path as relative_path, item.folder_id as folder_id,
              item.library_root_id as library_root_id, library_root.path as root_path,
              library_root.label as root_label
       FROM item JOIN library_root ON library_root.id = item.library_root_id
       WHERE item.id = ?`
    )
    .get(itemId) as
    | { relative_path: string; folder_id: number | null; library_root_id: number; root_path: string; root_label: string }
    | undefined
  if (!item) {
    throw new Error(`checkItemAvailability: no item with id ${itemId}`)
  }

  const absItemPath = join(item.root_path, ...item.relative_path.split('/'))
  if (fs.existsSync(absItemPath)) {
    return { fileMissing: false, libraryRootId: item.library_root_id, libraryRootLabel: item.root_label, affectedItemCount: 0 }
  }

  // Mark it now, live, rather than waiting for the next full rescan — see this file's own header
  // comment for why a rescan isn't triggered automatically here.
  db.prepare(`UPDATE item SET missing_since = COALESCE(missing_since, ?) WHERE id = ?`).run(new Date().toISOString(), itemId)

  if (!fs.existsSync(item.root_path)) {
    const affectedItemCount = (
      db.prepare(`SELECT COUNT(*) as c FROM item WHERE library_root_id = ?`).get(item.library_root_id) as { c: number }
    ).c
    return {
      fileMissing: true,
      missingScope: 'root',
      libraryRootId: item.library_root_id,
      libraryRootLabel: item.root_label,
      affectedItemCount
    }
  }

  // Root-to-leaf ancestor chain: walk parent_id from the item's own folder up to the root's folder
  // row (relative_path === ''), then reverse — checking shallowest first is what lets this stop at
  // the TOPMOST missing folder rather than the item's immediate (and least useful) parent.
  const chain: Array<{ id: number; relative_path: string }> = []
  let currentId = item.folder_id
  while (currentId != null) {
    const folder = db.prepare(`SELECT id, parent_id, relative_path FROM folder WHERE id = ?`).get(currentId) as
      | { id: number; parent_id: number | null; relative_path: string }
      | undefined
    if (!folder) break
    chain.push({ id: folder.id, relative_path: folder.relative_path })
    currentId = folder.parent_id
  }
  chain.reverse()

  for (const folder of chain) {
    if (folder.relative_path === '') continue // the root's own folder row — already confirmed to exist above
    const absFolderPath = join(item.root_path, ...folder.relative_path.split('/'))
    if (!fs.existsSync(absFolderPath)) {
      const affectedItemCount = (
        db.prepare(`SELECT COUNT(*) as c FROM item WHERE folder_id IN (
          WITH RECURSIVE d(id) AS (SELECT id FROM folder WHERE id = ? UNION ALL SELECT folder.id FROM folder JOIN d ON folder.parent_id = d.id)
          SELECT id FROM d
        )`).get(folder.id) as { c: number }
      ).c
      return {
        fileMissing: true,
        missingScope: 'folder',
        missingFolderId: folder.id,
        missingFolderName: folder.relative_path.split('/').pop() ?? folder.relative_path,
        libraryRootId: item.library_root_id,
        libraryRootLabel: item.root_label,
        affectedItemCount
      }
    }
  }

  // Every ancestor folder exists on disk — just this one file is gone.
  return {
    fileMissing: true,
    missingScope: 'item',
    libraryRootId: item.library_root_id,
    libraryRootLabel: item.root_label,
    affectedItemCount: 1
  }
}

/**
 * "Find the folder and restore it" — the `missingScope === 'root'` half of that ask. Repoints an
 * existing library_root at a NEW absolute path (the user relocated/renamed the whole added
 * folder, or a drive letter changed) rather than creating a second root: `library_root.path` is
 * UNIQUE, so a plain UPDATE here means the very next scan against this same root id (its
 * `INSERT ... ON CONFLICT(path) DO UPDATE` in importLibrary.ts) re-resolves against the row this
 * already updated, refreshing every folder/item's relative_path resolution and re-validating what
 * still exists — the caller is expected to trigger that scan immediately after this call.
 *
 * Deliberately does NOT attempt to relink a single missing SUBfolder (`missingScope === 'folder'`)
 * to an arbitrary new location: `relative_path` is stored relative to `library_root.path`, so a
 * subfolder that moved to somewhere NOT still nested under the same root path has no clean way to
 * be represented without either moving the whole root (this function, if the whole thing moved
 * together) or introducing per-item absolute-path overrides (out of scope for this pass). For that
 * case, the only offered action today is removing the missing subtree via
 * `removeFromCatalog.ts`'s `removeFolderFromCatalog` and re-adding it fresh from its new location.
 */
export function relinkLibraryRoot(db: DatabaseSync, libraryRootId: number, newPath: string): void {
  db.prepare(`UPDATE library_root SET path = ? WHERE id = ?`).run(newPath, libraryRootId)
}

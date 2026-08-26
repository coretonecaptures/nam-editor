/**
 * Removing a library folder (or a whole added root) from the catalog — "how do we manage changes
 * to folders, or remove from library" / "right click a folder and remove it and its children,
 * with a confirm dialog."
 *
 * This ONLY ever touches catalog.db rows. Nothing here deletes, moves, or renames a real file —
 * the catalog is a disposable index over files that stay exactly where they are (build-plan
 * principle 1). "Remove" means "stop tracking this," not "delete my IRs."
 *
 * Foreign keys are enforced (schema.ts: `PRAGMA foreign_keys = ON`), but `folder.library_root_id`
 * and `item.folder_id`/`item.library_root_id` are deliberately NOT `ON DELETE CASCADE` (a stray
 * `DELETE FROM library_root` should never silently cascade away a whole library by accident) —
 * so removal here is an explicit, ordered delete: collection rows first (which DO cascade to
 * collection_item/checklist_item/delivery_target/asset_file via their own `ON DELETE CASCADE`),
 * then item (cascades ir_item/nam_capture_item/item_tag/ir_derivative_variant/asset_file(item_id),
 * and fires the existing `item_search_ad` trigger so the FTS index stays in sync live — no
 * `finalizeIndexes()` call needed after this), then folder last.
 */
import type { DatabaseSync } from 'node:sqlite'
import { resolveFolderScopeIds } from './queryLibrary'

export interface RemovalPreview {
  itemCount: number
  folderCount: number
}

export interface RemovalStats {
  itemsRemoved: number
  foldersRemoved: number
}

/** Item/folder counts for a folder and its full subtree — shown in the confirm dialog before
 * `removeFolderFromCatalog` actually runs. */
export function previewFolderRemoval(db: DatabaseSync, folderId: number): RemovalPreview {
  const ids = resolveFolderScopeIds(db, folderId)
  if (ids.length === 0) return { itemCount: 0, folderCount: 0 }
  const placeholders = ids.map(() => '?').join(',')
  const itemCount = (db.prepare(`SELECT COUNT(*) as c FROM item WHERE folder_id IN (${placeholders})`).get(...ids) as { c: number }).c
  return { itemCount, folderCount: ids.length }
}

/** Removes one folder and everything under it from the catalog — including any ir_project
 * collection anchored inside that subtree (e.g. removing an IR Lab Projects folder that itself
 * contains several Project subfolders removes those Projects' own collection rows too, not just
 * their items). Scoped strictly to this subtree: sibling folders and the rest of the library_root
 * are untouched. */
export function removeFolderFromCatalog(db: DatabaseSync, folderId: number): RemovalStats {
  const ids = resolveFolderScopeIds(db, folderId)
  if (ids.length === 0) return { itemsRemoved: 0, foldersRemoved: 0 }
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM collection WHERE folder_id IN (${placeholders})`).run(...ids)
  const itemsRemoved = db.prepare(`DELETE FROM item WHERE folder_id IN (${placeholders})`).run(...ids).changes as number
  const foldersRemoved = db.prepare(`DELETE FROM folder WHERE id IN (${placeholders})`).run(...ids).changes as number
  return { itemsRemoved, foldersRemoved }
}

/** Item/folder counts for a whole added library root — shown in the confirm dialog before
 * `removeLibraryRoot` actually runs. */
export function previewLibraryRootRemoval(db: DatabaseSync, libraryRootId: number): RemovalPreview {
  const itemCount = (db.prepare(`SELECT COUNT(*) as c FROM item WHERE library_root_id = ?`).get(libraryRootId) as { c: number }).c
  const folderCount = (db.prepare(`SELECT COUNT(*) as c FROM folder WHERE library_root_id = ?`).get(libraryRootId) as { c: number }).c
  return { itemCount, folderCount }
}

/** Stops tracking a whole added library folder (an "Add Library Folder…" root) — every folder,
 * item, and ir_project collection under it, and the library_root row itself. Never touches the
 * files on disk; run "Add Library Folder…" again on the same path to re-add it from scratch. */
export function removeLibraryRoot(db: DatabaseSync, libraryRootId: number): RemovalStats {
  db.prepare(`DELETE FROM collection WHERE library_root_id = ?`).run(libraryRootId)
  const itemsRemoved = db.prepare(`DELETE FROM item WHERE library_root_id = ?`).run(libraryRootId).changes as number
  const foldersRemoved = db.prepare(`DELETE FROM folder WHERE library_root_id = ?`).run(libraryRootId).changes as number
  db.prepare(`DELETE FROM library_root WHERE id = ?`).run(libraryRootId)
  return { itemsRemoved, foldersRemoved }
}

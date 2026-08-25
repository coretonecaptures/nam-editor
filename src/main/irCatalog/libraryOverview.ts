/**
 * "Overview" — the right panel's Overview tab (plan section 8): rollup stats plus a couple of
 * breakdown bars (manufacturer, microphone) using whatever Phase 3's vendor parsers have already
 * populated. Originally whole-library only; generalized here to also scope to one folder and its
 * full subtree (clicking a folder in the tree should show that folder's own rollup, matching NAM
 * Lab's Overview tab — "if you click at the root you would get everything, if you click a folder
 * you get the folder"), via the same `resolveFolderScopeIds` folder+descendants resolution
 * `queryLibrary.ts` uses for browse filtering, not a separate ad hoc walk.
 */
import type { DatabaseSync } from 'node:sqlite'
import { resolveFolderScopeIds } from './queryLibrary'

export interface FieldBreakdownEntry {
  value: string
  count: number
}

export interface LibraryOverview {
  totalItems: number
  totalFolders: number
  favoriteCount: number
  ratedCount: number
  documentCount: number
  /** How many items have at least one vendor-parsed field — a rough "how much of this library do
   * we actually know anything about" signal, not a precise metric. */
  taggedCount: number
  manufacturerBreakdown: FieldBreakdownEntry[]
  microphoneBreakdown: FieldBreakdownEntry[]
}

const BREAKDOWN_LIMIT = 8

/** Either "every item under this library_root" (root/whole-library scope) or "every item in this
 * folder and its descendants" (folder scope) — same `item` WHERE shape either way so every stat
 * query below can stay a single flat prepared statement. */
function scopeWhereAndParams(db: DatabaseSync, libraryRootId: number, folderId: number | null | undefined): { where: string; params: number[] } {
  if (folderId == null) {
    return { where: 'item.library_root_id = ?', params: [libraryRootId] }
  }
  const ids = resolveFolderScopeIds(db, folderId)
  if (ids.length === 0) return { where: '0 = 1', params: [] }
  return { where: `item.folder_id IN (${ids.map(() => '?').join(',')})`, params: ids }
}

function fieldBreakdown(
  db: DatabaseSync,
  itemWhere: string,
  itemParams: number[],
  field: 'manufacturer' | 'microphone'
): FieldBreakdownEntry[] {
  return db
    .prepare(
      `SELECT ${field} as value, COUNT(*) as count
       FROM ir_item
       JOIN item ON item.id = ir_item.item_id
       WHERE ${itemWhere} AND ${field} IS NOT NULL
       GROUP BY ${field}
       ORDER BY count DESC
       LIMIT ?`
    )
    .all(...itemParams, BREAKDOWN_LIMIT) as Array<{ value: string; count: number }>
}

/**
 * @param folderId Omit (or null) for whole-library scope. Pass a folder id to scope every stat to
 * that folder and its full subtree instead.
 */
export function getLibraryOverview(db: DatabaseSync, libraryRootId: number, folderId?: number | null): LibraryOverview {
  const { where: itemWhere, params: itemParams } = scopeWhereAndParams(db, libraryRootId, folderId)

  const totalItems = (
    db.prepare(`SELECT COUNT(*) c FROM item WHERE ${itemWhere}`).get(...itemParams) as { c: number }
  ).c

  let totalFolders: number
  if (folderId == null) {
    totalFolders = (db.prepare(`SELECT COUNT(*) c FROM folder WHERE library_root_id = ?`).get(libraryRootId) as { c: number }).c
  } else {
    totalFolders = resolveFolderScopeIds(db, folderId).length
  }

  const favoriteCount = (
    db.prepare(`SELECT COUNT(*) c FROM item WHERE ${itemWhere} AND is_favorite = 1`).get(...itemParams) as { c: number }
  ).c
  const ratedCount = (
    db.prepare(`SELECT COUNT(*) c FROM item WHERE ${itemWhere} AND rating IS NOT NULL`).get(...itemParams) as { c: number }
  ).c

  const folderWhere = folderId == null ? 'folder.library_root_id = ?' : itemWhere.replace(/item\.folder_id/g, 'folder_document.folder_id')
  const documentParams = folderId == null ? [libraryRootId] : itemParams
  const documentCount = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM folder_document JOIN folder ON folder.id = folder_document.folder_id WHERE ${folderWhere}`
      )
      .get(...documentParams) as { c: number }
  ).c

  const taggedCount = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT item_id) c FROM ir_item_field_source
         JOIN item ON item.id = ir_item_field_source.item_id
         WHERE ${itemWhere}`
      )
      .get(...itemParams) as { c: number }
  ).c

  return {
    totalItems,
    totalFolders,
    favoriteCount,
    ratedCount,
    documentCount,
    taggedCount,
    manufacturerBreakdown: fieldBreakdown(db, itemWhere, itemParams, 'manufacturer'),
    microphoneBreakdown: fieldBreakdown(db, itemWhere, itemParams, 'microphone')
  }
}

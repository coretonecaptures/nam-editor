/**
 * "Library overview" — a lightweight summary shown when no folder is selected (the right panel's
 * default state), not a full report/dashboard. Total counts plus a couple of breakdown bars
 * (manufacturer, microphone) using whatever Phase 3's vendor parsers have already populated —
 * no new data collection, just aggregating what's there.
 */
import type { DatabaseSync } from 'node:sqlite'

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

function fieldBreakdown(db: DatabaseSync, libraryRootId: number, field: 'manufacturer' | 'microphone'): FieldBreakdownEntry[] {
  const rows = db
    .prepare(
      `SELECT ${field} as value, COUNT(*) as count
       FROM ir_item
       JOIN item ON item.id = ir_item.item_id
       WHERE item.library_root_id = ? AND ${field} IS NOT NULL
       GROUP BY ${field}
       ORDER BY count DESC
       LIMIT ?`
    )
    .all(libraryRootId, BREAKDOWN_LIMIT) as Array<{ value: string; count: number }>
  return rows
}

export function getLibraryOverview(db: DatabaseSync, libraryRootId: number): LibraryOverview {
  const totalItems = (db.prepare(`SELECT COUNT(*) c FROM item WHERE library_root_id = ?`).get(libraryRootId) as { c: number }).c
  const totalFolders = (db.prepare(`SELECT COUNT(*) c FROM folder WHERE library_root_id = ?`).get(libraryRootId) as { c: number }).c
  const favoriteCount = (
    db.prepare(`SELECT COUNT(*) c FROM item WHERE library_root_id = ? AND is_favorite = 1`).get(libraryRootId) as { c: number }
  ).c
  const ratedCount = (
    db.prepare(`SELECT COUNT(*) c FROM item WHERE library_root_id = ? AND rating IS NOT NULL`).get(libraryRootId) as { c: number }
  ).c
  const documentCount = (
    db
      .prepare(`SELECT COUNT(*) c FROM folder_document JOIN folder ON folder.id = folder_document.folder_id WHERE folder.library_root_id = ?`)
      .get(libraryRootId) as { c: number }
  ).c
  const taggedCount = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT item_id) c FROM ir_item_field_source
         JOIN item ON item.id = ir_item_field_source.item_id
         WHERE item.library_root_id = ?`
      )
      .get(libraryRootId) as { c: number }
  ).c

  return {
    totalItems,
    totalFolders,
    favoriteCount,
    ratedCount,
    documentCount,
    taggedCount,
    manufacturerBreakdown: fieldBreakdown(db, libraryRootId, 'manufacturer'),
    microphoneBreakdown: fieldBreakdown(db, libraryRootId, 'microphone')
  }
}

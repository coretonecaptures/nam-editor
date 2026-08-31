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
import { resolveFolderScopeIds, IR_BROWSABLE_ITEM_SQL } from './queryLibrary'
import { formatSampleRate } from '../../shared/wavFormat'

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
  speakerBreakdown: FieldBreakdownEntry[]
  cabinetBreakdown: FieldBreakdownEntry[]
  /** Technical make-up of the scope, from the WAV headers read at scan time. Entries are the
   * distinct values with their counts, so the UI can show "how much of this library is 48k?"
   * without a second query per value. */
  sampleRateBreakdown: FieldBreakdownEntry[]
  bitDepthBreakdown: FieldBreakdownEntry[]
  channelsBreakdown: FieldBreakdownEntry[]
  /** Bytes on disk across the scope, and how many items have no WAV header read yet (i.e. were
   * imported before that existed and haven't been re-scanned). The second number is what makes
   * an otherwise-empty format section explainable rather than looking broken. */
  totalBytes: number
  missingAudioInfoCount: number
  /** IR Lab Projects anchored anywhere in this scope. */
  projectCount: number
}

const BREAKDOWN_LIMIT = 8

/** Either "every item under this library_root" (root/whole-library scope) or "every item in this
 * folder and its descendants" (folder scope) — same `item` WHERE shape either way so every stat
 * query below can stay a single flat prepared statement. */
function scopeWhereAndParams(db: DatabaseSync, libraryRootId: number, folderId: number | null | undefined): { where: string; params: number[] } {
  // The IR Library overview counts IRs only — a promoted nam_capture item (namCaptureEnrichment.ts)
  // is a NAM Projects thing, not an IR. Every caller AND-joins this onto its own WHERE.
  const kind = IR_BROWSABLE_ITEM_SQL
  if (folderId == null) {
    return { where: `${kind} AND item.library_root_id = ?`, params: [libraryRootId] }
  }
  const ids = resolveFolderScopeIds(db, folderId)
  if (ids.length === 0) return { where: '0 = 1', params: [] }
  return { where: `${kind} AND item.folder_id IN (${ids.map(() => '?').join(',')})`, params: ids }
}

/** Distinct values + counts for one ir_item column, biggest first. Shares fieldBreakdown's shape
 * so the UI renders both kinds of row identically; kept separate only because these columns are
 * numeric and want no folder-inheritance fallback. */
function numericBreakdown(
  db: DatabaseSync,
  itemWhere: string,
  itemParams: number[],
  column: 'sample_rate' | 'bit_depth' | 'channels',
  render: (value: number) => string
): FieldBreakdownEntry[] {
  const rows = db
    .prepare(
      `SELECT ${column} as value, COUNT(*) as count
       FROM ir_item JOIN item ON item.id = ir_item.item_id
       WHERE ${itemWhere} AND ${column} IS NOT NULL
       GROUP BY ${column}
       ORDER BY count DESC
       LIMIT ?`
    )
    .all(...itemParams, BREAKDOWN_LIMIT) as Array<{ value: number; count: number }>
  return rows.map((r) => ({ value: render(r.value), count: r.count }))
}

function fieldBreakdown(
  db: DatabaseSync,
  itemWhere: string,
  itemParams: number[],
  field: 'manufacturer' | 'microphone' | 'speaker' | 'cabinet'
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

  // folder_document has no `item` to filter on — scope it by folder id directly (the same
  // resolved subtree). Deriving it from itemWhere by string-replace left `item.kind = 'ir'` and
  // the `_excitations` NOT IN referencing a table that isn't in this query's FROM.
  const docFolderIds = folderId == null ? [] : resolveFolderScopeIds(db, folderId)
  const folderWhere =
    folderId == null
      ? 'folder.library_root_id = ?'
      : `folder_document.folder_id IN (${docFolderIds.map(() => '?').join(',') || 'NULL'})`
  const documentParams = folderId == null ? [libraryRootId] : docFolderIds
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

  const totalBytes = (
    db.prepare(`SELECT COALESCE(SUM(file_size), 0) c FROM item WHERE ${itemWhere}`).get(...itemParams) as { c: number }
  ).c
  // Items with no ir_item row at all, or one whose header columns are still null — both mean
  // "not scanned since WAV-header reading existed".
  const missingAudioInfoCount = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM item
         WHERE ${itemWhere}
           AND NOT EXISTS (
             SELECT 1 FROM ir_item WHERE ir_item.item_id = item.id AND ir_item.sample_rate IS NOT NULL
           )`
      )
      .get(...itemParams) as { c: number }
  ).c
  const projectCount = (
    db
      .prepare(
        folderId == null
          ? `SELECT COUNT(*) c FROM collection WHERE kind = 'ir_project' AND library_root_id = ?`
          : `SELECT COUNT(*) c FROM collection WHERE kind = 'ir_project' AND folder_id IN (${resolveFolderScopeIds(db, folderId).map(() => '?').join(',') || 'NULL'})`
      )
      .get(...(folderId == null ? [libraryRootId] : resolveFolderScopeIds(db, folderId))) as { c: number }
  ).c

  return {
    totalItems,
    totalFolders,
    favoriteCount,
    ratedCount,
    documentCount,
    taggedCount,
    manufacturerBreakdown: fieldBreakdown(db, itemWhere, itemParams, 'manufacturer'),
    microphoneBreakdown: fieldBreakdown(db, itemWhere, itemParams, 'microphone'),
    speakerBreakdown: fieldBreakdown(db, itemWhere, itemParams, 'speaker'),
    cabinetBreakdown: fieldBreakdown(db, itemWhere, itemParams, 'cabinet'),
    sampleRateBreakdown: numericBreakdown(db, itemWhere, itemParams, 'sample_rate', formatSampleRate),
    bitDepthBreakdown: numericBreakdown(db, itemWhere, itemParams, 'bit_depth', (v) => `${v}-bit`),
    channelsBreakdown: numericBreakdown(db, itemWhere, itemParams, 'channels', (v) =>
      v === 1 ? 'mono' : v === 2 ? 'stereo' : `${v}ch`
    ),
    totalBytes,
    missingAudioInfoCount,
    projectCount
  }
}

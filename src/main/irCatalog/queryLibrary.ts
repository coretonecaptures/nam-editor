/**
 * Read paths for Phase 2's browse/search screen — paginated, optionally scoped to one
 * library_root, optionally filtered by an FTS5 search query. This is also what the Phase 1
 * benchmark measured latency against (docs/ir-lab-manager-build-plan.md section 12).
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

export interface ItemRow {
  id: string
  relative_path: string
  display_name: string
  file_size: number | null
  is_favorite: number
  rating: number | null
  // Phase 3 (vendor parsers) fields — all null until applyVendorParsers has run for this item's
  // library_root. `*_source` is the confidence-ladder provenance (section 3) for the UI badge;
  // null alongside a null value means "no parser touched this field," not "checked and blank."
  manufacturer: string | null
  manufacturer_source: string | null
  cabinet: string | null
  cabinet_source: string | null
  speaker: string | null
  speaker_source: string | null
  microphone: string | null
  microphone_source: string | null
  /** The owning library_root's filesystem path — join with relative_path (via node:path, not
   * string concat, for correct separators) to get an absolute path for reading the file's audio
   * bytes. Phase 4 (audition) is the first caller that needs this. */
  library_root_path: string
}

export interface QueryOptions {
  /** Omit (or null) to browse across every library_root at once. */
  libraryRootId?: number | null
  /** Free-text query; empty/omitted means "no filter" (plain paginated browse). */
  search?: string
  offset: number
  limit: number
}

/**
 * Turns free-typed user input into a safe FTS5 MATCH expression: each whitespace-separated
 * token is quoted (so punctuation/hyphens/colons in a filename can't be parsed as FTS5 query
 * syntax and throw) and given a trailing `*` for prefix matching, so results appear while the
 * user is still typing rather than only once a whole word is complete. Tokens are ANDed
 * (FTS5's default when multiple quoted strings appear with no explicit OR).
 */
function toFts5MatchExpression(rawQuery: string): string | null {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
  return tokens.length > 0 ? tokens.join(' ') : null
}

function buildWhereAndParams(options: QueryOptions, matchExpr: string | null): { where: string; params: SQLInputValue[] } {
  const clauses: string[] = []
  const params: SQLInputValue[] = []
  if (options.libraryRootId != null) {
    clauses.push('item.library_root_id = ?')
    params.push(options.libraryRootId)
  }
  if (matchExpr !== null) {
    clauses.push('item.id IN (SELECT item_id FROM item_search WHERE item_search MATCH ?)')
    params.push(matchExpr)
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function queryItems(db: DatabaseSync, options: QueryOptions): ItemRow[] {
  const matchExpr = options.search ? toFts5MatchExpression(options.search) : null
  const { where, params } = buildWhereAndParams(options, matchExpr)
  return db
    .prepare(
      `SELECT item.id as id, item.relative_path as relative_path, item.display_name as display_name,
              item.file_size as file_size, item.is_favorite as is_favorite, item.rating as rating,
              COALESCE(ir_item.manufacturer, mfr_fme.value) as manufacturer,
              COALESCE(mfr_src.source, mfr_fme.source) as manufacturer_source,
              COALESCE(ir_item.cabinet, cab_fme.value) as cabinet,
              COALESCE(cab_src.source, cab_fme.source) as cabinet_source,
              COALESCE(ir_item.speaker, spk_fme.value) as speaker,
              COALESCE(spk_src.source, spk_fme.source) as speaker_source,
              COALESCE(ir_item.microphone, mic_fme.value) as microphone,
              COALESCE(mic_src.source, mic_fme.source) as microphone_source,
              library_root.path as library_root_path
       FROM item
       JOIN library_root ON library_root.id = item.library_root_id
       LEFT JOIN ir_item ON ir_item.item_id = item.id
       LEFT JOIN ir_item_field_source mfr_src ON mfr_src.item_id = item.id AND mfr_src.field = 'manufacturer'
       LEFT JOIN ir_item_field_source cab_src ON cab_src.item_id = item.id AND cab_src.field = 'cabinet'
       LEFT JOIN ir_item_field_source spk_src ON spk_src.item_id = item.id AND spk_src.field = 'speaker'
       LEFT JOIN ir_item_field_source mic_src ON mic_src.item_id = item.id AND mic_src.field = 'microphone'
       -- Folder-inheritance fallback (section 2d: resolve-at-query) -- only consulted when the
       -- item itself has no value for that field, via COALESCE above.
       LEFT JOIN folder_metadata_effective mfr_fme ON mfr_fme.folder_id = item.folder_id AND mfr_fme.field = 'manufacturer'
       LEFT JOIN folder_metadata_effective cab_fme ON cab_fme.folder_id = item.folder_id AND cab_fme.field = 'cabinet'
       LEFT JOIN folder_metadata_effective spk_fme ON spk_fme.folder_id = item.folder_id AND spk_fme.field = 'speaker'
       LEFT JOIN folder_metadata_effective mic_fme ON mic_fme.folder_id = item.folder_id AND mic_fme.field = 'microphone'
       ${where}
       ORDER BY item.relative_path
       LIMIT ? OFFSET ?`
    )
    .all(...params, options.limit, options.offset) as unknown as ItemRow[]
}

export function countItems(db: DatabaseSync, options: Omit<QueryOptions, 'offset' | 'limit'>): number {
  const matchExpr = options.search ? toFts5MatchExpression(options.search) : null
  const { where, params } = buildWhereAndParams(options as QueryOptions, matchExpr)
  const row = db.prepare(`SELECT COUNT(*) as c FROM item ${where}`).get(...params) as { c: number }
  return row.c
}

export function setFavorite(db: DatabaseSync, itemId: string, isFavorite: boolean): void {
  db.prepare('UPDATE item SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, itemId)
}

export function setRating(db: DatabaseSync, itemId: string, rating: number | null): void {
  db.prepare('UPDATE item SET rating = ? WHERE id = ?').run(rating, itemId)
}

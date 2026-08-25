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
  /** Scopes to this folder AND every descendant (clicking a pack folder should show everything
   * nested under it, not just files directly inside it) — resolved once per call via
   * `resolveFolderScopeIds`, not a nested WITH RECURSIVE inside this query. */
  folderId?: number | null
  /** Free-text query; empty/omitted means "no filter" (plain paginated browse). */
  search?: string
  /** Quick filters for the browse/search bar — client-side filtering would break under
   * pagination (a page's worth of raw rows might contain zero favorites), so these are real
   * WHERE clauses, not a post-fetch JS filter. */
  favoritesOnly?: boolean
  minRating?: number
  /** Named group filter (tag.ts) — works across every folder/root, per the group concept: "put a
   * bunch of IRs in a named group for recall/filter later, across anywhere in your library." */
  tagId?: number
  offset: number
  limit: number
}

/** `folderId` and every one of its descendants, via the same recursive-CTE shape used
 * elsewhere (folderMetadata.ts) — resolved as a single small array (folder count stays in the
 * hundreds even under a huge pack) so the main query's WHERE can do a plain indexed `IN (...)`
 * rather than nesting a recursive CTE inside another statement. */
export function resolveFolderScopeIds(db: DatabaseSync, folderId: number): number[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE d(id) AS (
         SELECT id FROM folder WHERE id = ?
         UNION ALL
         SELECT folder.id FROM folder JOIN d ON folder.parent_id = d.id
       )
       SELECT id FROM d`
    )
    .all(folderId) as Array<{ id: number }>
  return rows.map((r) => r.id)
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

function buildWhereAndParams(
  db: DatabaseSync,
  options: QueryOptions,
  matchExpr: string | null
): { where: string; params: SQLInputValue[] } {
  const clauses: string[] = []
  const params: SQLInputValue[] = []
  if (options.libraryRootId != null) {
    clauses.push('item.library_root_id = ?')
    params.push(options.libraryRootId)
  }
  if (options.folderId != null) {
    const ids = resolveFolderScopeIds(db, options.folderId)
    // An empty result (folderId doesn't exist) must still filter to nothing, not fall through to
    // "no folder filter" — `IN ()` is invalid SQL, so guard it explicitly.
    if (ids.length === 0) {
      clauses.push('0 = 1')
    } else {
      clauses.push(`item.folder_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
  }
  if (matchExpr !== null) {
    clauses.push('item.id IN (SELECT item_id FROM item_search WHERE item_search MATCH ?)')
    params.push(matchExpr)
  }
  if (options.favoritesOnly) {
    clauses.push('item.is_favorite = 1')
  }
  if (options.minRating != null) {
    clauses.push('item.rating >= ?')
    params.push(options.minRating)
  }
  if (options.tagId != null) {
    clauses.push('item.id IN (SELECT item_id FROM item_tag WHERE tag_id = ?)')
    params.push(options.tagId)
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function queryItems(db: DatabaseSync, options: QueryOptions): ItemRow[] {
  const matchExpr = options.search ? toFts5MatchExpression(options.search) : null
  const { where, params } = buildWhereAndParams(db, options, matchExpr)
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
  const { where, params } = buildWhereAndParams(db, options as QueryOptions, matchExpr)
  const row = db.prepare(`SELECT COUNT(*) as c FROM item ${where}`).get(...params) as { c: number }
  return row.c
}

export function setFavorite(db: DatabaseSync, itemId: string, isFavorite: boolean): void {
  db.prepare('UPDATE item SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, itemId)
}

export function setRating(db: DatabaseSync, itemId: string, rating: number | null): void {
  db.prepare('UPDATE item SET rating = ? WHERE id = ?').run(rating, itemId)
}

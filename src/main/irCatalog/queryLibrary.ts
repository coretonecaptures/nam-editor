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
  // Measured from each file's own WAV header at scan time (wavHeader.ts). Null for anything that
  // wasn't a parseable WAV, and for rows imported before this existed and not yet re-scanned.
  sample_rate: number | null
  bit_depth: number | null
  channels: number | null
  duration_seconds: number | null
  audio_format: string | null
  // IR Lab's 2026-08-26 CaptureMetadata additions (labProjectEnrichment.ts writes these). Free
  // text / auto-populated, not exposed here with their own *_source column: unlike manufacturer/
  // cabinet/speaker/microphone above, nothing else in this app ever guesses these fields, so
  // there's no "which source won" question for the browse row to show.
  speaker_position: string | null
  modeled_microphone: string | null
  preset_kind: string | null
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
  /** Faceted filter chips — click a row's manufacturer/cabinet/speaker/microphone badge to narrow
   * to exactly that value. Exact match (not a search token), and matched against the SAME
   * item-or-inherited-folder-value COALESCE the browse SELECT itself uses (see
   * facetClause below), so filtering by a folder-inherited badge behaves identically to
   * filtering by an item-level one. An array is OR'd together (the filter bar's multiselect
   * checklists — "Suhr or Mesa", not "Suhr and Mesa"); a bare string is still accepted for the
   * single-value click-to-filter badges. `cabinet` stays single-value only: nothing in the UI
   * offers a cabinet multiselect (vocabulary.ts has no cabinet term list, so it's rarely populated
   * — see IrLibraryOverview's own note on this). */
  manufacturer?: string | string[]
  cabinet?: string
  speaker?: string | string[]
  microphone?: string | string[]
  /** Technical-format filters, from the same badges the row shows. Exact matches against ir_item's
   * WAV-header columns — no folder-inheritance fallback, unlike the descriptive facets above:
   * these are measured per file, so there is no meaningful "inherited from the folder" value. */
  sampleRate?: number | number[]
  bitDepth?: number | number[]
  channels?: number
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

export interface FacetOption<T> {
  value: T
  count: number
}

/**
 * Every distinct value currently on file for one field, scoped to a library root and/or folder
 * subtree — populates the filter bar's multiselect checklists ("what we have in our list, not all
 * in the world"), so the choices offered can never fail to match anything. Reads `ir_item`
 * directly rather than folding in `folder_metadata_effective` inheritance the way `facetClause`
 * does for the WHERE clause: the picker is meant to show what's actually recorded on files, not
 * every folder-level default a click-to-filter badge might also match.
 */
export function listFacetOptions(
  db: DatabaseSync,
  field: 'manufacturer' | 'speaker' | 'microphone',
  libraryRootId: number | null,
  folderId: number | null
): FacetOption<string>[] {
  const clauses = [`${field} IS NOT NULL`]
  const params: SQLInputValue[] = []
  if (libraryRootId != null) {
    clauses.push('item.library_root_id = ?')
    params.push(libraryRootId)
  }
  if (folderId != null) {
    const ids = resolveFolderScopeIds(db, folderId)
    if (ids.length === 0) {
      clauses.push('0 = 1')
    } else {
      clauses.push(`item.folder_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
  }
  return db
    .prepare(
      `SELECT ${field} as value, COUNT(*) as count
       FROM ir_item JOIN item ON item.id = ir_item.item_id
       WHERE ${clauses.join(' AND ')}
       GROUP BY ${field}
       ORDER BY count DESC, value ASC`
    )
    .all(...params) as unknown as FacetOption<string>[]
}

/** Same idea as `listFacetOptions`, for the two numeric WAV-header columns. */
export function listNumericFacetOptions(
  db: DatabaseSync,
  field: 'sampleRate' | 'bitDepth',
  libraryRootId: number | null,
  folderId: number | null
): FacetOption<number>[] {
  const column = field === 'sampleRate' ? 'sample_rate' : 'bit_depth'
  const clauses = [`${column} IS NOT NULL`]
  const params: SQLInputValue[] = []
  if (libraryRootId != null) {
    clauses.push('item.library_root_id = ?')
    params.push(libraryRootId)
  }
  if (folderId != null) {
    const ids = resolveFolderScopeIds(db, folderId)
    if (ids.length === 0) {
      clauses.push('0 = 1')
    } else {
      clauses.push(`item.folder_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
  }
  return db
    .prepare(
      `SELECT ${column} as value, COUNT(*) as count
       FROM ir_item JOIN item ON item.id = ir_item.item_id
       WHERE ${clauses.join(' AND ')}
       GROUP BY ${column}
       ORDER BY value ASC`
    )
    .all(...params) as unknown as FacetOption<number>[]
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

/** Mirrors the browse SELECT's own `COALESCE(ir_item.field, folder_metadata_effective.value)`
 * ladder (queryItems below) as a WHERE-safe expression, so a facet-chip filter on a
 * folder-inherited badge value matches exactly the rows that badge is actually shown on —
 * a plain `ir_item.field = ?` would silently miss every item inheriting that value from its
 * folder rather than having it set directly. */
/** cabinet/speaker also fall back to the owning ir_project collection's value (2026-08-26 metadata
 * model) — same 3-way ladder the browse SELECT's own COALESCE uses, so filtering by a
 * project-inherited badge narrows to exactly what's displayed. manufacturer/microphone have no
 * project-level field at all, so they stay the plain 2-way item-or-folder-default fallback. */
function facetClause(field: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone', count: number): string {
  const placeholders = Array(count).fill('?').join(',')
  const projectFallback =
    field === 'cabinet' || field === 'speaker'
      ? `,
    (SELECT MAX(collection.${field}) FROM collection_item JOIN collection ON collection.id = collection_item.collection_id
     WHERE collection_item.item_id = item.id AND collection.kind = 'ir_project')`
      : ''
  return `COALESCE(
    (SELECT ${field} FROM ir_item WHERE ir_item.item_id = item.id)${projectFallback},
    (SELECT value FROM folder_metadata_effective WHERE folder_id = item.folder_id AND field = '${field}')
  ) IN (${placeholders})`
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
  for (const field of ['manufacturer', 'cabinet', 'speaker', 'microphone'] as const) {
    const value = options[field]
    if (value == null) continue
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) continue
    clauses.push(facetClause(field, values.length))
    params.push(...values)
  }
  for (const [option, column] of [
    ['sampleRate', 'sample_rate'],
    ['bitDepth', 'bit_depth'],
    ['channels', 'channels']
  ] as const) {
    const value = options[option]
    if (value == null) continue
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) continue
    clauses.push(`(SELECT ${column} FROM ir_item WHERE ir_item.item_id = item.id) IN (${values.map(() => '?').join(',')})`)
    params.push(...values)
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
              -- 3-way fallback (2026-08-26 metadata model): the item's own value, then the owning
              -- IR Lab Project's value (collection.cabinet/speaker — a real value IR Lab itself
              -- recorded), then IR Lab Manager's own manual per-folder default. Project comes
              -- before the folder default because it's the more specific, authoritative source
              -- for exactly this item, not a blunt default someone typed for a whole folder.
              COALESCE(ir_item.cabinet, proj.cabinet, cab_fme.value) as cabinet,
              COALESCE(cab_src.source, CASE WHEN proj.cabinet IS NOT NULL THEN 'ir_lab_project' END, cab_fme.source) as cabinet_source,
              COALESCE(ir_item.speaker, proj.speaker, spk_fme.value) as speaker,
              COALESCE(spk_src.source, CASE WHEN proj.speaker IS NOT NULL THEN 'ir_lab_project' END, spk_fme.source) as speaker_source,
              COALESCE(ir_item.microphone, mic_fme.value) as microphone,
              COALESCE(mic_src.source, mic_fme.source) as microphone_source,
              library_root.path as library_root_path,
              ir_item.sample_rate as sample_rate,
              ir_item.bit_depth as bit_depth,
              ir_item.channels as channels,
              ir_item.duration_seconds as duration_seconds,
              ir_item.audio_format as audio_format,
              ir_item.speaker_position as speaker_position,
              ir_item.modeled_microphone as modeled_microphone,
              ir_item.preset_kind as preset_kind
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
       LEFT JOIN (
         SELECT collection_item.item_id as item_id, MAX(collection.cabinet) as cabinet, MAX(collection.speaker) as speaker
         FROM collection_item JOIN collection ON collection.id = collection_item.collection_id
         WHERE collection.kind = 'ir_project'
         GROUP BY collection_item.item_id
       ) proj ON proj.item_id = item.id
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

/**
 * Spreadsheet import for bulk IR metadata (parity backlog item 19) — the round-trip half of
 * item 18's export: edit the exported sheet in Excel, import it back, preview exactly what would
 * change, then apply at the `user_entered` tier (same writer/ladder every other manual edit in
 * this app already goes through — `fieldConfidence.ts`).
 *
 * Matches rows by absolute path (the export's own "Path" column) rather than adding a new id
 * column to round-trip: every item's `(library_root_id, relative_path)` pair is already UNIQUE and
 * indexed, so resolving a row is one `path.relative()` call plus an indexed lookup, not a
 * whole-catalog scan. A row whose path no longer matches anything (moved/renamed/deleted between
 * export and import) is reported `notFound`, never silently skipped or guessed at.
 */
import type { DatabaseSync } from 'node:sqlite'
import { relative, isAbsolute } from 'node:path'
import { createIrFieldWriter } from './fieldConfidence'

export interface ImportRow {
  absPath: string
  manufacturer?: string
  cabinet?: string
  speaker?: string
  microphone?: string
}

const EDITABLE_FIELDS = ['manufacturer', 'cabinet', 'speaker', 'microphone'] as const
type ImportField = (typeof EDITABLE_FIELDS)[number]
const FIELD_LABELS: Record<ImportField, string> = {
  manufacturer: 'Manufacturer',
  cabinet: 'Cabinet',
  speaker: 'Speaker',
  microphone: 'Microphone'
}

export interface ImportDiffField {
  field: ImportField
  label: string
  oldValue: string
  newValue: string
}

export interface ImportDiffRow {
  absPath: string
  itemId: string | null
  displayName: string | null
  changes: ImportDiffField[]
  notFound: boolean
}

/** Resolves an absolute path back to its item by finding which library_root it falls under, then
 * an indexed (library_root_id, relative_path) lookup — never a full-table scan. The containment
 * check is case-insensitive (Windows paths commonly differ in drive-letter/segment casing between
 * however a user's OS displays a path and how it was originally scanned); the relative path handed
 * to the actual DB lookup uses the ORIGINAL casing from the sheet, matching how relative_path was
 * stored at scan time.
 *
 * `roots` and `itemLookup` are supplied by the caller (fetched/prepared ONCE, outside the per-row
 * loop) rather than re-queried here on every call — this ran inside `previewSpreadsheetImport`'s
 * own `.map()` over every sheet row, so re-fetching the same small, static root list per row wasted
 * a DB round-trip proportional to import size for a multi-thousand-row sheet. */
function resolveItemByAbsPath(
  roots: Array<{ id: number; path: string }>,
  itemLookup: ReturnType<DatabaseSync['prepare']>,
  absPath: string
): { itemId: string; displayName: string } | null {
  if (!isAbsolute(absPath)) return null
  const normalizedTarget = absPath.replace(/\\/g, '/').toLowerCase()

  for (const root of roots) {
    const normalizedRoot = root.path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    if (!normalizedTarget.startsWith(`${normalizedRoot}/`) && normalizedTarget !== normalizedRoot) continue

    const rel = relative(root.path, absPath).replace(/\\/g, '/')
    if (rel.startsWith('..')) continue // outside this root despite the string prefix match (rare edge case)

    const row = itemLookup.get(root.id, rel) as { id: string; display_name: string } | undefined
    if (row) return { itemId: row.id, displayName: row.display_name }
  }
  return null
}

/** Diffs each sheet row against the catalog's current value — no writes yet. A field is only
 * flagged changed when the sheet actually provided a non-blank value that differs from what's
 * stored; a blank cell in the sheet is "leave alone," not "clear this field" (clearing already has
 * its own explicit action elsewhere in the UI — an import shouldn't silently wipe fields the sheet
 * simply didn't carry). */
export function previewSpreadsheetImport(db: DatabaseSync, rows: ImportRow[]): ImportDiffRow[] {
  const roots = db.prepare(`SELECT id, path FROM library_root`).all() as Array<{ id: number; path: string }>
  const itemLookup = db.prepare(`SELECT id, display_name FROM item WHERE library_root_id = ? AND relative_path = ?`)
  const currentValuesLookup = db.prepare(`SELECT manufacturer, cabinet, speaker, microphone FROM ir_item WHERE item_id = ?`)

  return rows.map((row): ImportDiffRow => {
    const resolved = resolveItemByAbsPath(roots, itemLookup, row.absPath)
    if (!resolved) return { absPath: row.absPath, itemId: null, displayName: null, changes: [], notFound: true }

    const current = currentValuesLookup.get(resolved.itemId) as Record<ImportField, string | null> | undefined

    const changes: ImportDiffField[] = []
    for (const field of EDITABLE_FIELDS) {
      const newValue = (row[field] ?? '').trim()
      const oldValue = current?.[field] ?? ''
      if (newValue && newValue !== oldValue) {
        changes.push({ field, label: FIELD_LABELS[field], oldValue, newValue })
      }
    }
    return { absPath: row.absPath, itemId: resolved.itemId, displayName: resolved.displayName, changes, notFound: false }
  })
}

/** Applies exactly the diff rows handed back from a preview call — never recomputes the diff
 * itself, so a catalog change landing in the gap between preview and apply can't silently change
 * what gets written (same "apply exactly what the preview showed" guarantee libraryCleanup.ts's
 * runLibraryCleanup already makes for its own preview/run split). Every write goes through the
 * normal user_entered ladder, so it can be overwritten by a later manual edit but never by
 * automation. */
export function applySpreadsheetImport(db: DatabaseSync, diffRows: ImportDiffRow[]): { applied: number; failed: number } {
  const writer = createIrFieldWriter(db)
  let applied = 0
  let failed = 0
  for (const row of diffRows) {
    if (!row.itemId) continue
    for (const change of row.changes) {
      if (writer.write(row.itemId, change.field, change.newValue, 'user_entered')) applied++
      else failed++
    }
  }
  return { applied, failed }
}

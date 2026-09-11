/**
 * Library Cleanup / Build Library for IR — parity backlog item 12, the IR equivalent of NAM
 * mode's `LibraryCleanupModal.tsx` ("collect files from a chosen root into a cleaner structure,
 * with preview-first safety rails").
 *
 * Scope trim from the NAM reference, stated rather than silently matched: NAM's version has a
 * fixed 5-layout enum, a per-folder checklist with a saved-ignore-list, and CSV/XLSX export of the
 * needs-review rows. This ports the CORE interaction (preview before anything moves, ready vs
 * needs-review, copy-vs-move) using a free-text FOLDER TEMPLATE instead of a fixed enum — the same
 * token vocabulary `IrBatchRenameModal.tsx` (item 6) already established
 * (`{manufacturer}/{cabinet}/{speaker}/{microphone}/{rate}/{depth}`), which is strictly more
 * flexible than a fixed set of layouts and reuses code already written and reviewed for item 6,
 * rather than inventing a second template language. No per-folder checklist or saved-ignore-list:
 * scope is the same folder+subtree selector every other IR action already uses
 * (`resolveFolderScopeIds`), and no CSV export of needs-review rows — a real, considered trim
 * given the size this item already is, not an oversight.
 *
 * Destination is a folder path WITHIN THE SAME LIBRARY ROOT, built from each item's own resolved
 * facts — not a separate destination root on a different drive the way NAM's version allows. Every
 * primitive underneath (`fileOps.ts`'s `moveItems`/`copyItems`) already refuses a cross-root
 * operation, and IR mode's whole worldview is organizing within one library, not merging two.
 */
import type { DatabaseSync } from 'node:sqlite'
import { resolveFolderScopeIds, IR_BROWSABLE_ITEM_SQL } from './queryLibrary'
import { ensureDestinationFolder, moveItems, copyItems, type FileOpResult } from './fileOps'

export interface CleanupPreviewRow {
  itemId: string
  currentRelativePath: string
  /** Null when the template resolved to nothing usable — the item is left where it is, not moved
   * into a guessed-wrong location. */
  newRelativePath: string | null
  needsReview: boolean
  missingTokens: string[]
}

export interface CleanupPreview {
  rows: CleanupPreviewRow[]
  readyCount: number
  needsReviewCount: number
  unchangedCount: number
}

const TOKEN_FIELDS = ['manufacturer', 'cabinet', 'speaker', 'microphone'] as const

interface CandidateRow {
  id: string
  relative_path: string
  manufacturer: string | null
  cabinet: string | null
  speaker: string | null
  microphone: string | null
  sample_rate: number | null
  bit_depth: number | null
  missing_since: string | null
}

/** Resolves a folder template against one item's facts. Returns the resolved path segments AND
 * which named tokens the template referenced but the item had no value for — a template segment
 * that resolves to '' is dropped (not left as a blank path segment), matching how
 * `IrBatchRenameModal.tsx` treats a blank token in a filename template. */
function resolveTemplate(template: string, row: CandidateRow): { path: string; missingTokens: string[] } {
  const missingTokens: string[] = []
  const tokenValue = (name: string, value: string | null): string => {
    if (!value) missingTokens.push(name)
    return value ?? ''
  }
  const segments = template
    .split('/')
    .map((segment) =>
      segment
        .replace(/\{manufacturer\}/g, () => tokenValue('manufacturer', row.manufacturer))
        .replace(/\{cabinet\}/g, () => tokenValue('cabinet', row.cabinet))
        .replace(/\{speaker\}/g, () => tokenValue('speaker', row.speaker))
        .replace(/\{microphone\}/g, () => tokenValue('microphone', row.microphone))
        .replace(/\{rate\}/g, () => (row.sample_rate ? `${(row.sample_rate / 1000).toFixed(row.sample_rate % 1000 ? 1 : 0)}k` : ''))
        .replace(/\{depth\}/g, () => (row.bit_depth ? `${row.bit_depth}-bit` : ''))
        .trim()
    )
    .filter((segment) => segment.length > 0)
  return { path: segments.join('/'), missingTokens: [...new Set(missingTokens)] }
}

function scopeWhereAndParams(db: DatabaseSync, libraryRootId: number, folderId: number | null): { where: string; params: unknown[] } {
  if (folderId != null) {
    const ids = resolveFolderScopeIds(db, folderId)
    if (ids.length === 0) return { where: '0 = 1', params: [] }
    return { where: `${IR_BROWSABLE_ITEM_SQL} AND item.folder_id IN (${ids.map(() => '?').join(',')})`, params: ids }
  }
  return { where: `${IR_BROWSABLE_ITEM_SQL} AND item.library_root_id = ?`, params: [libraryRootId] }
}

/** `folderId` given resolves the library root FROM the folder itself (a folder id is unique
 * across the whole catalog, unlike the browse list's optional root filter) — the caller doesn't
 * need to separately track "which root is this folder under" just to open this dialog on a
 * folder-scoped selection. `libraryRootId` is only actually required for a whole-root scope
 * (`folderId: null`). */
function resolveLibraryRootId(db: DatabaseSync, libraryRootId: number | null, folderId: number | null): number {
  if (folderId != null) {
    const row = db.prepare(`SELECT library_root_id as libraryRootId FROM folder WHERE id = ?`).get(folderId) as { libraryRootId: number } | undefined
    if (row) return row.libraryRootId
  }
  if (libraryRootId != null) return libraryRootId
  throw new Error('Library Cleanup needs either a folderId or a libraryRootId to scope to.')
}

export function previewLibraryCleanup(
  db: DatabaseSync,
  options: { libraryRootId: number | null; folderId: number | null; structureTemplate: string }
): CleanupPreview {
  const libraryRootId = resolveLibraryRootId(db, options.libraryRootId, options.folderId)
  const { where, params } = scopeWhereAndParams(db, libraryRootId, options.folderId)
  const candidates = db
    .prepare(
      `SELECT item.id as id, item.relative_path as relative_path, item.missing_since as missing_since,
              ir_item.manufacturer as manufacturer, ir_item.cabinet as cabinet, ir_item.speaker as speaker,
              ir_item.microphone as microphone, ir_item.sample_rate as sample_rate, ir_item.bit_depth as bit_depth
       FROM item LEFT JOIN ir_item ON ir_item.item_id = item.id
       WHERE ${where} AND item.missing_since IS NULL`
    )
    .all(...(params as never[])) as unknown as CandidateRow[]

  const rows: CleanupPreviewRow[] = []
  let readyCount = 0
  let needsReviewCount = 0
  let unchangedCount = 0

  for (const row of candidates) {
    const fileName = row.relative_path.split('/').pop() as string
    const { path: folderPath, missingTokens } = resolveTemplate(options.structureTemplate, row)
    const newRelativePath = folderPath ? `${folderPath}/${fileName}` : fileName
    const needsReview = missingTokens.length > 0

    if (newRelativePath === row.relative_path) {
      unchangedCount++
      rows.push({ itemId: row.id, currentRelativePath: row.relative_path, newRelativePath: null, needsReview, missingTokens })
      continue
    }
    if (needsReview) needsReviewCount++
    else readyCount++
    rows.push({ itemId: row.id, currentRelativePath: row.relative_path, newRelativePath, needsReview, missingTokens })
  }

  return { rows, readyCount, needsReviewCount, unchangedCount }
}

export interface RunCleanupResult {
  moved: number
  copied: number
  failed: Array<{ itemId: string; error: string }>
}

/** Applies a previously-computed preview. Takes the SAME rows the preview produced (not a fresh
 * recompute) so what actually runs is exactly what the user reviewed — re-querying at apply time
 * could silently pick up a metadata edit that happened in the gap between preview and Run. Groups
 * items by their computed destination folder (`fileOps.ts`'s `moveItems`/`copyItems` each take one
 * destination for a whole batch, not a per-item one), creates each destination folder once, then
 * moves/copies each group in a single batched call. */
export async function runLibraryCleanup(
  db: DatabaseSync,
  options: { libraryRootId: number | null; folderId: number | null },
  rows: CleanupPreviewRow[],
  mode: 'move' | 'copy'
): Promise<RunCleanupResult> {
  const libraryRootId = resolveLibraryRootId(db, options.libraryRootId, options.folderId)
  const actionable = rows.filter((r) => !r.needsReview && r.newRelativePath)
  const byDestFolder = new Map<string, string[]>() // destination folder relative path -> item ids
  for (const row of actionable) {
    const destFolderPath = (row.newRelativePath as string).split('/').slice(0, -1).join('/')
    const bucket = byDestFolder.get(destFolderPath) ?? []
    bucket.push(row.itemId)
    byDestFolder.set(destFolderPath, bucket)
  }

  const result: RunCleanupResult = { moved: 0, copied: 0, failed: [] }
  for (const [destFolderPath, itemIds] of byDestFolder) {
    const destFolderId = ensureDestinationFolder(db, libraryRootId, destFolderPath)
    const opResults: FileOpResult[] = mode === 'move' ? await moveItems(db, itemIds, destFolderId) : await copyItems(db, itemIds, destFolderId)
    for (const r of opResults) {
      if (r.success) {
        if (mode === 'move') result.moved++
        else result.copied++
      } else {
        result.failed.push({ itemId: r.itemId, error: r.error ?? 'Unknown error' })
      }
    }
  }
  return result
}

export { TOKEN_FIELDS }

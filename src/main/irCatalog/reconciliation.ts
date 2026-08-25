/**
 * Reconciliation / move detection — docs/ir-lab-manager-build-plan.md section 5, fully designed
 * there but never implemented until now (tracked as a gap in section 12's Phase notes).
 *
 * Runs as a POST-scan pass, not inline during the batched importer: `importLibrary.ts` already
 * treats a newly-discovered relative_path as a brand-new item (fresh UUID) and separately marks
 * anything it didn't re-find as `missing_since` (see that file). By the time this runs, a moved
 * file exists as TWO rows — the old one, missing, and a new one, freshly inserted with no
 * ratings/tags/favorites yet. This function finds those pairs and merges them: the OLD row's id
 * (and everything attached to it) wins, updated to the new path; the duplicate new row is deleted.
 *
 * Doing this post-scan rather than inline is deliberate: reliable lookups need the quick_hash/
 * content_hash indexes, which per the Phase 1 fix don't exist during bulk import — only after
 * `finalizeIndexes()` runs. Call this after that, not before.
 */
import type { DatabaseSync } from 'node:sqlite'

export interface ReconcileSuggestion {
  missingItemId: string
  missingPath: string
  candidateItemId: string
  candidatePath: string
}

export interface ReconcileResult {
  /** Tier 1 (content_hash) or tier 2 (quick_hash) exact match — silently relinked. */
  relinked: number
  /** Tier 3: filename+size match, folder-name-similarity gated — surfaced, never auto-merged. */
  suggestions: ReconcileSuggestion[]
}

type Row = { id: string; relative_path: string; folder_id: number | null }

/**
 * Tier 3's folder-name-similarity gate (section 5): plain filename+size at vendor-pack scale is
 * a flood of coincidences (thousands of files literally named "SM57.wav" at identical sizes
 * across a library, unrelated to each other) — this is what keeps tier 3 from matching all of
 * them. A real similarity metric (Jaro-Winkler, as the plan suggests) was skipped for a simpler,
 * documented stand-in: normalize each path's immediate parent folder name to lowercase
 * alphanumeric tokens and require at least one shared token. Cruder than Jaro-Winkler, but keeps
 * "SM57.wav in an unrelated folder" from matching while still catching "SM57.wav" moved between
 * two similarly-named pack folders (e.g. "Ownhammer 412" -> "Ownhammer 412 v2").
 */
function parentFolderTokens(relativePath: string): Set<string> {
  const parts = relativePath.split('/')
  parts.pop() // filename
  const parent = parts.pop() ?? ''
  return new Set(parent.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

function foldersShareToken(pathA: string, pathB: string): boolean {
  const tokensA = parentFolderTokens(pathA)
  const tokensB = parentFolderTokens(pathB)
  for (const t of tokensA) if (tokensB.has(t)) return true
  return false
}

export function reconcileMissingItems(db: DatabaseSync, libraryRootId: number): ReconcileResult {
  const missingItems = db
    .prepare(
      `SELECT id, relative_path, display_name, file_size, quick_hash, content_hash
       FROM item WHERE library_root_id = ? AND missing_since IS NOT NULL`
    )
    .all(libraryRootId) as Array<{
    id: string
    relative_path: string
    display_name: string
    file_size: number | null
    quick_hash: string | null
    content_hash: string | null
  }>

  const findByContentHash = db.prepare(
    `SELECT id, relative_path, folder_id FROM item WHERE library_root_id = ? AND missing_since IS NULL AND content_hash = ?`
  )
  const findByQuickHash = db.prepare(
    `SELECT id, relative_path, folder_id FROM item WHERE library_root_id = ? AND missing_since IS NULL AND quick_hash = ?`
  )
  const findByNameSize = db.prepare(
    `SELECT id, relative_path, folder_id FROM item WHERE library_root_id = ? AND missing_since IS NULL AND display_name = ? AND file_size = ?`
  )
  const relink = db.prepare(
    `UPDATE item SET relative_path = ?, folder_id = ?, display_name = ?, missing_since = NULL WHERE id = ?`
  )
  const deleteDuplicate = db.prepare(`DELETE FROM item WHERE id = ?`)

  const claimed = new Set<string>()
  let relinked = 0
  const suggestions: ReconcileSuggestion[] = []

  const pickUnclaimed = (rows: Row[]): Row | null => {
    const unclaimed = rows.filter((r) => !claimed.has(r.id))
    // Ambiguous (more than one candidate shares this hash) — ambiguity here means ANOTHER
    // missing item could equally claim the same candidate, so this is left for tier 3 / manual
    // resolution rather than guessing which one is right.
    return unclaimed.length === 1 ? unclaimed[0] : null
  }

  for (const missing of missingItems) {
    let candidate: Row | null = null

    if (missing.content_hash) {
      candidate = pickUnclaimed(findByContentHash.all(libraryRootId, missing.content_hash) as Row[])
    }
    if (!candidate && missing.quick_hash) {
      candidate = pickUnclaimed(findByQuickHash.all(libraryRootId, missing.quick_hash) as Row[])
    }

    if (candidate) {
      claimed.add(candidate.id)
      const displayName = candidate.relative_path.slice(candidate.relative_path.lastIndexOf('/') + 1)
      // Delete the duplicate FIRST — it currently owns (library_root_id, relative_path), and the
      // UNIQUE constraint on that pair would reject the missing row's UPDATE onto the same path
      // while both rows still exist.
      deleteDuplicate.run(candidate.id)
      relink.run(candidate.relative_path, candidate.folder_id, displayName, missing.id)
      relinked++
      continue
    }

    if (missing.file_size != null) {
      const rows = (findByNameSize.all(libraryRootId, missing.display_name, missing.file_size) as Row[]).filter(
        (r) => !claimed.has(r.id)
      )
      for (const row of rows) {
        if (foldersShareToken(missing.relative_path, row.relative_path)) {
          suggestions.push({
            missingItemId: missing.id,
            missingPath: missing.relative_path,
            candidateItemId: row.id,
            candidatePath: row.relative_path
          })
        }
      }
    }
  }

  return { relinked, suggestions }
}

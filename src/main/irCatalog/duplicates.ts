/**
 * Duplicate-set report over `item.content_hash` — computed and stored for every item during the
 * scan (contentHash.ts) but never read back for this until now (raised in the 2026-09-11 IR Lab
 * integration audit as backlog item 17, and idea 6: "you're holding 1.4 GB of byte-identical IRs
 * across three packs" is a `GROUP BY` and a bytes total away, not a new subsystem).
 *
 * Scoped to report only, not delete: this app doesn't yet have a catalog-transactional trash for
 * IR items (parity backlog item 1) — the existing `irLibrary:removeItemFromCatalog` only forgets
 * the catalog row and leaves the file on disk. Wiring a real "trash the extra copies" action here
 * would either silently misuse that catalog-only primitive as if it deleted the file, or duplicate
 * item 1's disk+catalog transaction ahead of when it's built correctly. Once item 1 lands, this
 * report is the natural first consumer of the resulting `trashItems`.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { join } from 'node:path'
import { resolveFolderScopeIds, IR_BROWSABLE_ITEM_SQL } from './queryLibrary'

export interface DuplicateSetMember {
  itemId: string
  relativePath: string
  displayName: string
  absPath: string
  fileSize: number | null
  isFavorite: boolean
  rating: number | null
  /** How many of manufacturer/cabinet/speaker/microphone are populated — the richest copy in a
   * set is suggested first as the one worth keeping, same "keep the one with more known about it"
   * idea NAM mode's own DuplicatesModal uses via its completeness() scorer. */
  metadataCompleteness: number
}

export interface DuplicateSet {
  contentHash: string
  fileSize: number | null
  members: DuplicateSetMember[]
  /** Bytes recoverable by keeping exactly one copy — (members.length - 1) * fileSize. 0 when
   * fileSize is unknown (pre-quickHash-era rows never re-scanned). */
  reclaimableBytes: number
}

export interface DuplicateReport {
  sets: DuplicateSet[]
  totalReclaimableBytes: number
  /** Items scanned but never re-hashed (quickHash.ts runs opportunistically, not eagerly on
   * every item) — these are invisible to this report, not confirmed duplicate-free. Surfaced so
   * the UI can say "N items not yet checked" instead of implying a complete scan. */
  unhashedCount: number
}

function scopeWhereAndParams(db: DatabaseSync, libraryRootId: number | null | undefined, folderId: number | null | undefined): { where: string; params: SQLInputValue[] } {
  const kind = IR_BROWSABLE_ITEM_SQL
  if (folderId != null) {
    const ids = resolveFolderScopeIds(db, folderId)
    if (ids.length === 0) return { where: '0 = 1', params: [] }
    return { where: `${kind} AND item.folder_id IN (${ids.map(() => '?').join(',')})`, params: ids }
  }
  if (libraryRootId != null) {
    return { where: `${kind} AND item.library_root_id = ?`, params: [libraryRootId] }
  }
  return { where: kind, params: [] }
}

export function findDuplicates(
  db: DatabaseSync,
  options: { libraryRootId?: number | null; folderId?: number | null } = {}
): DuplicateReport {
  const { where, params } = scopeWhereAndParams(db, options.libraryRootId, options.folderId)

  const unhashedCount = (
    db
      .prepare(`SELECT COUNT(*) as n FROM item WHERE ${where} AND content_hash IS NULL AND missing_since IS NULL`)
      .get(...params) as { n: number }
  ).n

  const hashRows = db
    .prepare(
      `SELECT item.content_hash as contentHash, COUNT(*) as n
       FROM item
       WHERE ${where} AND content_hash IS NOT NULL AND missing_since IS NULL
       GROUP BY item.content_hash
       HAVING COUNT(*) > 1`
    )
    .all(...params) as Array<{ contentHash: string; n: number }>

  if (hashRows.length === 0) {
    return { sets: [], totalReclaimableBytes: 0, unhashedCount }
  }

  const memberStmt = db.prepare(
    `SELECT item.id as itemId, item.relative_path as relativePath, item.display_name as displayName,
            item.file_size as fileSize, item.is_favorite as isFavorite, item.rating as rating,
            library_root.path as libraryRootPath,
            (CASE WHEN ir_item.manufacturer IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN ir_item.cabinet IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN ir_item.speaker IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN ir_item.microphone IS NOT NULL THEN 1 ELSE 0 END) as metadataCompleteness
     FROM item
     JOIN library_root ON library_root.id = item.library_root_id
     LEFT JOIN ir_item ON ir_item.item_id = item.id
     WHERE item.content_hash = ? AND ${where}
     ORDER BY metadataCompleteness DESC, item.relative_path ASC`
  )

  let totalReclaimableBytes = 0
  const sets: DuplicateSet[] = hashRows.map((row) => {
    const rawMembers = memberStmt.all(row.contentHash, ...params) as Array<{
      itemId: string
      relativePath: string
      displayName: string
      fileSize: number | null
      isFavorite: number
      rating: number | null
      libraryRootPath: string
      metadataCompleteness: number
    }>
    const members: DuplicateSetMember[] = rawMembers.map((m) => ({
      itemId: m.itemId,
      relativePath: m.relativePath,
      displayName: m.displayName,
      absPath: join(m.libraryRootPath, ...m.relativePath.split('/')),
      fileSize: m.fileSize,
      isFavorite: !!m.isFavorite,
      rating: m.rating,
      metadataCompleteness: m.metadataCompleteness
    }))
    const fileSize = members[0]?.fileSize ?? null
    const reclaimableBytes = fileSize != null ? fileSize * (members.length - 1) : 0
    totalReclaimableBytes += reclaimableBytes
    return { contentHash: row.contentHash, fileSize, members, reclaimableBytes }
  })

  // Biggest recoverable space first — that's the ordering someone doing cleanup actually wants.
  sets.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes)

  return { sets, totalReclaimableBytes, unhashedCount }
}

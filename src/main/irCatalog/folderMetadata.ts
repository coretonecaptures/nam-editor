/**
 * Folder-metadata inheritance — docs/ir-lab-manager-build-plan.md section 2d's decision
 * (resolve-at-query, not snapshot-at-ingest) and section 4's cascade-invalidation requirement,
 * implemented here for the first time (previously designed only, per section 12's Phase notes).
 *
 * `folder_metadata` is what a user (or, later, an imported vendor document) declares for a
 * folder — "this whole pack is a Marshall 412." `folder_metadata_effective` is the resolved
 * result after walking up to the root, nearest declaration wins, recomputed here rather than at
 * query time so a query is an O(1) join per item, not a walk. Items themselves never store
 * inherited values (queryLibrary.ts's COALESCE(ir_item.field, folder_metadata_effective.value)
 * is where inheritance actually shows up for a browse/search row).
 */
import type { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

interface FolderMetadataRow {
  folder_id: number
  field: string
  value: string
  source: string
}

/** Folder itself first (depth 0, nearest), then parent, grandparent, ... to the root. */
function ancestorChainNearestFirst(db: DatabaseSync, folderId: number): number[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE ancestors(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM folder WHERE id = ?
         UNION ALL
         SELECT folder.id, folder.parent_id, ancestors.depth + 1
         FROM folder JOIN ancestors ON folder.id = ancestors.parent_id
       )
       SELECT id FROM ancestors ORDER BY depth ASC`
    )
    .all(folderId) as Array<{ id: number }>
  return rows.map((r) => r.id)
}

function descendantsIncludingSelf(db: DatabaseSync, folderId: number): number[] {
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

/** Recomputes folder_metadata_effective for exactly one folder — nearest declaration per field
 * wins across its own row and every ancestor's. Called once per folder in a cascade, not
 * recursively itself (the cascade in setFolderMetadata handles the "and every descendant" part). */
function recomputeEffectiveForOneFolder(db: DatabaseSync, folderId: number): void {
  const chain = ancestorChainNearestFirst(db, folderId)
  if (chain.length === 0) return
  const depthOf = new Map(chain.map((id, i) => [id, i]))
  const placeholders = chain.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT folder_id, field, value, source FROM folder_metadata WHERE folder_id IN (${placeholders})`)
    .all(...chain) as unknown as FolderMetadataRow[]

  const bestByField = new Map<string, { value: string; source: string; depth: number }>()
  for (const row of rows) {
    const depth = depthOf.get(row.folder_id)
    if (depth === undefined) continue
    const existing = bestByField.get(row.field)
    if (!existing || depth < existing.depth) {
      bestByField.set(row.field, { value: row.value, source: row.source, depth })
    }
  }

  db.prepare(`DELETE FROM folder_metadata_effective WHERE folder_id = ?`).run(folderId)
  const insert = db.prepare(
    `INSERT INTO folder_metadata_effective (folder_id, field, value, source) VALUES (?, ?, ?, ?)`
  )
  for (const [field, { value, source }] of bestByField) {
    insert.run(folderId, field, value, source)
  }
}

/**
 * Declares (or overwrites) one field on one folder, then recomputes folder_metadata_effective
 * for that folder AND every descendant — a descendant's effective value can change even though
 * its own folder_metadata didn't, if it was inheriting this field from further up and this
 * folder is nearer. Cheap at folder-count scale (hundreds, even under a 226K-file pack — plan
 * section 2/2a), not item-count scale.
 */
export function setFolderMetadata(db: DatabaseSync, folderId: number, field: string, value: string, source: string): void {
  db.prepare(
    `INSERT INTO folder_metadata (folder_id, field, value, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(folder_id, field) DO UPDATE SET value = excluded.value, source = excluded.source`
  ).run(folderId, field, value, source)

  for (const id of descendantsIncludingSelf(db, folderId)) {
    recomputeEffectiveForOneFolder(db, id)
  }
}

export function removeFolderMetadata(db: DatabaseSync, folderId: number, field: string): void {
  db.prepare(`DELETE FROM folder_metadata WHERE folder_id = ? AND field = ?`).run(folderId, field)
  for (const id of descendantsIncludingSelf(db, folderId)) {
    recomputeEffectiveForOneFolder(db, id)
  }
}

/** Freeform notes are a plain column on `folder` itself (not a `folder_metadata` field — they're
 * prose for a human, not a structured, inheritable, confidence-ranked fact). No cascade needed. */
export function setFolderNotes(db: DatabaseSync, folderId: number, notes: string): void {
  db.prepare(`UPDATE folder SET notes = ? WHERE id = ?`).run(notes, folderId)
}

export interface FolderTreeRow {
  id: number
  parent_id: number | null
  relative_path: string
  /** Items directly in this folder (not counting subfolders) — recursive/subtree totals (NAM
   * Lab's FolderTree "totalCount" convention) are rolled up client-side from this during tree
   * building, same pattern as the totals nam-editor's own FolderTree.tsx already uses. */
  direct_item_count: number
  /** Derived, never stored (plan section 8c/§1): true iff labProjectEnrichment.ts found an
   * ir_project collection anchored to this folder — never goes stale independently of the actual
   * collection row, since it's just an EXISTS check, not a separate flag. */
  is_lab_project: number
}

export function listFolders(db: DatabaseSync, libraryRootId: number): FolderTreeRow[] {
  return db
    .prepare(
      `SELECT folder.id as id, folder.parent_id as parent_id, folder.relative_path as relative_path,
              COALESCE(counts.c, 0) as direct_item_count,
              EXISTS (
                SELECT 1 FROM collection WHERE collection.folder_id = folder.id AND collection.kind = 'ir_project'
              ) as is_lab_project
       FROM folder
       LEFT JOIN (
         SELECT folder_id, COUNT(*) as c FROM item WHERE library_root_id = ? GROUP BY folder_id
       ) counts ON counts.folder_id = folder.id
       WHERE folder.library_root_id = ?
       ORDER BY folder.relative_path`
    )
    .all(libraryRootId, libraryRootId) as unknown as FolderTreeRow[]
}

export interface AllRootsFolderRow extends FolderTreeRow {
  library_root_id: number
  /** root.label, falling back to the last path segment — same fallback IrModeShell's root
   * switcher already uses, so a root reads identically whether picked from that dropdown or seen
   * here as a virtual top-level tree node. */
  library_root_label: string
}

/** Every folder across EVERY library_root, each tagged with which root it belongs to — backs the
 * folder tree's virtual "Library" wrapper (docs/ir-lab-manager-build-plan.md section 13's
 * root-switcher follow-up): a user who's added several roots (e.g. five separate IR Lab Projects,
 * each its own root) should see all of them in the tree at once, not only whichever one root
 * happens to be selected. `folder.id` is a single global auto-increment PK across every root, so
 * there is no cross-root id collision risk building one combined tree from this. */
export function listAllFolders(db: DatabaseSync): AllRootsFolderRow[] {
  return db
    .prepare(
      `SELECT folder.id as id, folder.parent_id as parent_id, folder.relative_path as relative_path,
              folder.library_root_id as library_root_id,
              library_root.label as library_root_label_raw,
              library_root.path as library_root_path,
              COALESCE(counts.c, 0) as direct_item_count,
              EXISTS (
                SELECT 1 FROM collection WHERE collection.folder_id = folder.id AND collection.kind = 'ir_project'
              ) as is_lab_project
       FROM folder
       JOIN library_root ON library_root.id = folder.library_root_id
       LEFT JOIN (
         SELECT folder_id, COUNT(*) as c FROM item GROUP BY folder_id
       ) counts ON counts.folder_id = folder.id
       ORDER BY library_root.id, folder.relative_path`
    )
    .all()
    .map((row) => {
      const r = row as {
        id: number
        parent_id: number | null
        relative_path: string
        library_root_id: number
        library_root_label_raw: string | null
        library_root_path: string
        direct_item_count: number
        is_lab_project: number
      }
      const label =
        r.library_root_label_raw && r.library_root_label_raw.trim().length > 0
          ? r.library_root_label_raw
          : r.library_root_path.split(/[\\/]/).filter(Boolean).pop() || r.library_root_path
      return {
        id: r.id,
        parent_id: r.parent_id,
        relative_path: r.relative_path,
        library_root_id: r.library_root_id,
        library_root_label: label,
        direct_item_count: r.direct_item_count,
        is_lab_project: r.is_lab_project
      }
    })
}

export interface FolderDetail {
  id: number
  relativePath: string
  notes: string | null
  declared: Array<{ field: string; value: string; source: string }>
  /** library_root.path + relative_path, joined via node:path (not string concat, for correct
   * separators) — the renderer has no filesystem access under contextIsolation, so any tab that
   * needs the folder's real on-disk location (Gallery, Read Me — plan section 8a) reads it here
   * rather than reconstructing it client-side. */
  absPath: string
  /** Same derived EXISTS check as listFolders()'s is_lab_project — the right panel's tab bar
   * (IrRightPanel.tsx) needs this alongside absPath to decide whether to show the Project tab. */
  isLabProject: boolean
}

export function getFolderDetail(db: DatabaseSync, folderId: number): FolderDetail | null {
  const folder = db
    .prepare(
      `SELECT folder.id as id, folder.relative_path as relative_path, folder.notes as notes,
              library_root.path as root_path,
              EXISTS (
                SELECT 1 FROM collection WHERE collection.folder_id = folder.id AND collection.kind = 'ir_project'
              ) as is_lab_project
       FROM folder JOIN library_root ON library_root.id = folder.library_root_id
       WHERE folder.id = ?`
    )
    .get(folderId) as
    | { id: number; relative_path: string; notes: string | null; root_path: string; is_lab_project: number }
    | undefined
  if (!folder) return null
  const declared = db
    .prepare(`SELECT field, value, source FROM folder_metadata WHERE folder_id = ?`)
    .all(folderId) as Array<{ field: string; value: string; source: string }>
  return {
    id: folder.id,
    relativePath: folder.relative_path,
    notes: folder.notes,
    declared,
    absPath: path.join(folder.root_path, folder.relative_path),
    isLabProject: !!folder.is_lab_project
  }
}

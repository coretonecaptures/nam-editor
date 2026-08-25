/**
 * Vendor document import (docs/ir-lab-manager-build-plan.md section 2's `folder_document`) —
 * store-only for now, per the TODO on that table: this copies the file and links it to a folder,
 * it does not extract any fields from it. See that TODO for the two ways to close that gap later.
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export interface FolderDocumentRow {
  id: number
  folder_id: number
  stored_path: string
  original_filename: string | null
  imported_at: string
}

/** Copies `sourceAbsPath` into `storageDir` (created if missing) under a collision-proof name,
 * then records it against `folderId`. The original file is never modified or moved. */
export function importFolderDocument(
  db: DatabaseSync,
  folderId: number,
  sourceAbsPath: string,
  storageDir: string
): FolderDocumentRow {
  fs.mkdirSync(storageDir, { recursive: true })
  const original = basename(sourceAbsPath)
  const storedName = `${randomUUID()}${extname(original)}`
  const storedPath = join(storageDir, storedName)
  fs.copyFileSync(sourceAbsPath, storedPath)

  const now = new Date().toISOString()
  const row = db
    .prepare(
      `INSERT INTO folder_document (folder_id, stored_path, original_filename, imported_at)
       VALUES (?, ?, ?, ?) RETURNING id, folder_id, stored_path, original_filename, imported_at`
    )
    .get(folderId, storedPath, original, now) as unknown as FolderDocumentRow
  return row
}

export function listFolderDocuments(db: DatabaseSync, folderId: number): FolderDocumentRow[] {
  return db
    .prepare(`SELECT id, folder_id, stored_path, original_filename, imported_at FROM folder_document WHERE folder_id = ? ORDER BY imported_at`)
    .all(folderId) as unknown as FolderDocumentRow[]
}

/** Removes the DB row AND the copied file — the one place this module deletes from disk, and
 * only ever a file it copied itself (storageDir), never anything in the user's library. */
export function deleteFolderDocument(db: DatabaseSync, documentId: number): void {
  const row = db.prepare(`SELECT stored_path FROM folder_document WHERE id = ?`).get(documentId) as
    | { stored_path: string }
    | undefined
  db.prepare(`DELETE FROM folder_document WHERE id = ?`).run(documentId)
  if (row) {
    try {
      fs.unlinkSync(row.stored_path)
    } catch {
      // Already gone, or never existed — the DB row is the source of truth for the UI either way.
    }
  }
}

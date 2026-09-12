/**
 * Saved searches (audit finding B6) — a named, reusable filter/facet combination for the IR
 * browse view. Distinct from a group/tag (tag.ts): a group is a static list of specific items,
 * a saved search re-runs the same query against whatever the catalog looks like right now, so
 * new imports matching an old search show up in it automatically.
 */
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

export interface SavedSearchRow {
  id: string
  name: string
  filterJson: string
  position: number
}

export function listSavedSearches(db: DatabaseSync): SavedSearchRow[] {
  return db
    .prepare(`SELECT id, name, filter_json as filterJson, position FROM saved_search ORDER BY position ASC, created_at ASC`)
    .all() as unknown as SavedSearchRow[]
}

/** `filterJson` is the caller's already-serialized current filter state (queryItems' options
 * shape minus offset/limit) — this module doesn't parse or validate its contents, since the
 * filter shape is the browse view's concern, not the persistence layer's. */
export function createSavedSearch(db: DatabaseSync, name: string, filterJson: string): SavedSearchRow {
  const id = randomUUID()
  const position = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 as next FROM saved_search`).get() as {
    next: number
  }).next
  db.prepare(
    `INSERT INTO saved_search (id, name, filter_json, created_at, position) VALUES (?, ?, ?, ?, ?)`
  ).run(id, name.trim(), filterJson, new Date().toISOString(), position)
  return { id, name: name.trim(), filterJson, position }
}

export function renameSavedSearch(db: DatabaseSync, id: string, name: string): void {
  db.prepare(`UPDATE saved_search SET name = ? WHERE id = ?`).run(name.trim(), id)
}

export function deleteSavedSearch(db: DatabaseSync, id: string): void {
  db.prepare(`DELETE FROM saved_search WHERE id = ?`).run(id)
}

/**
 * Groups (docs/ir-lab-manager-build-plan.md section 8, item 8) — named, cross-folder recall/filter
 * for IRs, reusing the `tag`/`item_tag` tables that were part of the schema from the start
 * (section 2's organization tables) but never populated until this feature. Deliberately a flat
 * list, not hierarchical or folder-scoped — "put a bunch of IRs in a named group for recall/filter
 * later, across anywhere in your library" was the explicit ask, so a tag has no relation to the
 * folder tree at all; `queryLibrary.ts`'s `tagId` filter is a plain `item_tag` join, same shape as
 * favoritesOnly/minRating.
 */
import type { DatabaseSync } from 'node:sqlite'

export interface TagRow {
  id: number
  name: string
  itemCount: number
}

export function listTags(db: DatabaseSync): TagRow[] {
  return db
    .prepare(
      `SELECT tag.id as id, tag.name as name, COUNT(item_tag.item_id) as itemCount
       FROM tag
       LEFT JOIN item_tag ON item_tag.tag_id = tag.id
       GROUP BY tag.id
       ORDER BY tag.name COLLATE NOCASE`
    )
    .all() as unknown as TagRow[]
}

/** Creates the tag if it doesn't already exist (name is UNIQUE), returns its id either way — the
 * UI's "Add to Group..." flow is free-typed, so "create or reuse" is one action from the user's
 * point of view, not two. */
export function getOrCreateTag(db: DatabaseSync, name: string): number {
  const trimmed = name.trim()
  db.prepare(`INSERT INTO tag (name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(trimmed)
  const row = db.prepare(`SELECT id FROM tag WHERE name = ?`).get(trimmed) as { id: number }
  return row.id
}

export function renameTag(db: DatabaseSync, tagId: number, name: string): void {
  db.prepare(`UPDATE tag SET name = ? WHERE id = ?`).run(name.trim(), tagId)
}

/** Also drops every item_tag row referencing it via ON DELETE CASCADE (schema.ts). */
export function deleteTag(db: DatabaseSync, tagId: number): void {
  db.prepare(`DELETE FROM tag WHERE id = ?`).run(tagId)
}

export function addItemToTag(db: DatabaseSync, itemId: string, tagId: number): void {
  db.prepare(`INSERT INTO item_tag (item_id, tag_id) VALUES (?, ?) ON CONFLICT(item_id, tag_id) DO NOTHING`).run(
    itemId,
    tagId
  )
}

export function removeItemFromTag(db: DatabaseSync, itemId: string, tagId: number): void {
  db.prepare(`DELETE FROM item_tag WHERE item_id = ? AND tag_id = ?`).run(itemId, tagId)
}

export function listTagsForItem(db: DatabaseSync, itemId: string): TagRow[] {
  return db
    .prepare(
      `SELECT tag.id as id, tag.name as name, 0 as itemCount
       FROM tag JOIN item_tag ON item_tag.tag_id = tag.id
       WHERE item_tag.item_id = ?
       ORDER BY tag.name COLLATE NOCASE`
    )
    .all(itemId) as unknown as TagRow[]
}

/**
 * Read paths exercised by the Phase 1 benchmark: paginated browse and FTS5 search.
 * docs/ir-lab-manager-build-plan.md Phase 1 measures query latency against the finished catalog,
 * not just import speed — this is what Phase 2's browse/search screen would actually call.
 */
import type { DatabaseSync } from 'node:sqlite'

export interface ItemRow {
  id: string
  relative_path: string
  display_name: string
  file_size: number | null
}

export function queryPage(db: DatabaseSync, libraryRootId: number, offset: number, limit: number): ItemRow[] {
  return db
    .prepare(
      `SELECT id, relative_path, display_name, file_size FROM item
       WHERE library_root_id = ? ORDER BY relative_path LIMIT ? OFFSET ?`
    )
    .all(libraryRootId, limit, offset) as unknown as ItemRow[]
}

export function searchItems(db: DatabaseSync, query: string, limit: number): ItemRow[] {
  return db
    .prepare(
      `SELECT item.id as id, item.relative_path as relative_path,
              item.display_name as display_name, item.file_size as file_size
       FROM item_search
       JOIN item ON item.id = item_search.item_id
       WHERE item_search MATCH ?
       LIMIT ?`
    )
    .all(query, limit) as unknown as ItemRow[]
}

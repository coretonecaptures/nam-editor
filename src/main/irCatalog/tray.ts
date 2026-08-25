/**
 * The tray → Send to IR Lab — docs/ir-lab-manager-build-plan.md section 9. A `collection` row
 * with kind='tray', capped at 8 slots to match `LiveAuditionEngine::blendPreviewSlotCount = 8`
 * in the private ir-lab repo (confirmed live against the real app, 2026-08-24) — not an
 * arbitrary UI limit. One global tray (not per library_root) — IR Lab's Blender takes up to 8
 * items regardless of which vendor pack or root they came from.
 *
 * Add/remove from the tray is a deliberate action, separate from favoriting (item.is_favorite) —
 * auditioning and collecting are two different verbs, per the plan.
 */
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const TRAY_CAPACITY = 8

export interface TrayItemRow {
  id: string
  relative_path: string
  display_name: string
  abs_path: string
  position: number
}

function getOrCreateTrayId(db: DatabaseSync): string {
  const existing = db.prepare(`SELECT id FROM collection WHERE kind = 'tray' AND is_builtin = 1`).get() as
    | { id: string }
    | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare(
    `INSERT INTO collection (id, kind, name, created_at, is_builtin) VALUES (?, 'tray', 'Tray', ?, 1)`
  ).run(id, new Date().toISOString())
  return id
}

export interface TrayAddResult {
  success: boolean
  reason?: string
}

export function addToTray(db: DatabaseSync, itemId: string): TrayAddResult {
  const trayId = getOrCreateTrayId(db)
  const already = db
    .prepare(`SELECT 1 FROM collection_item WHERE collection_id = ? AND item_id = ?`)
    .get(trayId, itemId)
  if (already) return { success: true }

  const count = (db.prepare(`SELECT COUNT(*) c FROM collection_item WHERE collection_id = ?`).get(trayId) as {
    c: number
  }).c
  if (count >= TRAY_CAPACITY) {
    return { success: false, reason: `Tray is full (max ${TRAY_CAPACITY})` }
  }

  const usedPositions = new Set(
    (db.prepare(`SELECT position FROM collection_item WHERE collection_id = ?`).all(trayId) as Array<{
      position: number | null
    }>).map((r) => r.position)
  )
  let position = 0
  while (usedPositions.has(position)) position++

  db.prepare(
    `INSERT INTO collection_item (collection_id, item_id, position, included) VALUES (?, ?, ?, 1)`
  ).run(trayId, itemId, position)
  return { success: true }
}

export function removeFromTray(db: DatabaseSync, itemId: string): void {
  const trayId = getOrCreateTrayId(db)
  db.prepare(`DELETE FROM collection_item WHERE collection_id = ? AND item_id = ?`).run(trayId, itemId)
}

export function isInTray(db: DatabaseSync, itemId: string): boolean {
  const trayId = getOrCreateTrayId(db)
  return Boolean(
    db.prepare(`SELECT 1 FROM collection_item WHERE collection_id = ? AND item_id = ?`).get(trayId, itemId)
  )
}

export function listTray(db: DatabaseSync): TrayItemRow[] {
  const trayId = getOrCreateTrayId(db)
  const rows = db
    .prepare(
      `SELECT item.id as id, item.relative_path as relative_path, item.display_name as display_name,
              library_root.path as library_root_path, collection_item.position as position
       FROM collection_item
       JOIN item ON item.id = collection_item.item_id
       JOIN library_root ON library_root.id = item.library_root_id
       WHERE collection_item.collection_id = ?
       ORDER BY collection_item.position ASC`
    )
    .all(trayId) as Array<{
    id: string
    relative_path: string
    display_name: string
    library_root_path: string
    position: number
  }>
  return rows.map((row) => ({
    id: row.id,
    relative_path: row.relative_path,
    display_name: row.display_name,
    abs_path: join(row.library_root_path, ...row.relative_path.split('/')),
    position: row.position
  }))
}

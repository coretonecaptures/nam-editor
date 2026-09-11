import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createCoreSchema } from './schema'
import { createIrFieldWriter } from './fieldConfidence'
import { hasFts5 } from './sqliteCapabilities'

function makeDbWithOneItem(): { db: DatabaseSync; itemId: string } {
  const db = new DatabaseSync(':memory:')
  createCoreSchema(db)
  db.exec(`INSERT INTO library_root (id, path, label, watch_mode, created_at) VALUES (1, '/x', NULL, 'manual', '2026-01-01')`)
  db.exec(
    `INSERT INTO item (id, kind, library_root_id, folder_id, relative_path, display_name, indexed_at, last_seen_at)
     VALUES ('item-1', 'ir', 1, NULL, 'a.wav', 'a.wav', '2026-01-01', '2026-01-01')`
  )
  db.exec(`INSERT INTO ir_item (item_id) VALUES ('item-1')`)
  return { db, itemId: 'item-1' }
}

function cabinetOf(db: DatabaseSync, itemId: string): string | null {
  return (db.prepare(`SELECT cabinet FROM ir_item WHERE item_id = ?`).get(itemId) as { cabinet: string | null }).cabinet
}

describe.skipIf(!hasFts5())('createIrFieldWriter', () => {
  it('writes a field with no existing source', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    expect(writer.write(itemId, 'cabinet', 'Marshall 412', 'vendor_parser')).toBe(true)
    expect(cabinetOf(db, itemId)).toBe('Marshall 412')
  })

  it('a higher-ranked automated source overwrites a lower-ranked one', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'Guessed From Filename', 'filename_inferred') // rank 5
    expect(writer.write(itemId, 'cabinet', 'From Vendor Doc', 'vendor_documentation')).toBe(true) // rank 3
    expect(cabinetOf(db, itemId)).toBe('From Vendor Doc')
  })

  it('a lower-ranked automated source does NOT overwrite a higher-ranked one', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'From Vendor Doc', 'vendor_documentation') // rank 3
    expect(writer.write(itemId, 'cabinet', 'Guessed From Filename', 'filename_inferred')).toBe(false) // rank 5
    expect(cabinetOf(db, itemId)).toBe('From Vendor Doc')
  })

  it('user_entered blocks every automated source, regardless of rank', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'User Correction', 'user_entered')
    expect(writer.write(itemId, 'cabinet', 'IR Lab Native Value', 'ir_lab_native')).toBe(false) // rank 1, the highest
    expect(cabinetOf(db, itemId)).toBe('User Correction')
  })

  it('a second user_entered write DOES overwrite the first — the user editing their own correction again', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'First Correction', 'user_entered')
    expect(writer.write(itemId, 'cabinet', 'Fixed Typo', 'user_entered')).toBe(true)
    expect(cabinetOf(db, itemId)).toBe('Fixed Typo')
  })

  it('user_entered overwrites any prior automated value regardless of its rank', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'IR Lab Native Value', 'ir_lab_native') // rank 1
    expect(writer.write(itemId, 'cabinet', 'User Override', 'user_entered')).toBe(true)
    expect(cabinetOf(db, itemId)).toBe('User Override')
  })

  it('refuses an empty/null value', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    expect(writer.write(itemId, 'cabinet', '', 'user_entered')).toBe(false)
    expect(writer.write(itemId, 'cabinet', null, 'user_entered')).toBe(false)
  })

  it('clear() nulls the value and removes the source row', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'User Correction', 'user_entered')
    writer.clear(itemId, 'cabinet')
    expect(cabinetOf(db, itemId)).toBeNull()
    const sourceRow = db.prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = 'cabinet'`).get(itemId)
    expect(sourceRow).toBeUndefined()
  })

  it('after clear(), a lower-ranked automated source can write again', () => {
    const { db, itemId } = makeDbWithOneItem()
    const writer = createIrFieldWriter(db)
    writer.write(itemId, 'cabinet', 'User Correction', 'user_entered')
    writer.clear(itemId, 'cabinet')
    // Before the fix this would matter: a leftover 'user_entered' source row would still block
    // this write even after the value itself was cleared.
    expect(writer.write(itemId, 'cabinet', 'Filename Guess', 'filename_inferred')).toBe(true)
    expect(cabinetOf(db, itemId)).toBe('Filename Guess')
  })
})

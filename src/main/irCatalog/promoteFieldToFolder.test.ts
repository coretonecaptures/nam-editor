import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { createIrFieldWriter, promoteFieldToFolder } from './fieldConfidence'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-promote-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function folderId(db: DatabaseSync, relativePath: string): number {
  return (db.prepare(`SELECT id FROM folder WHERE relative_path = ?`).get(relativePath) as { id: number }).id
}

function itemIdFor(db: DatabaseSync, suffix: string): string {
  return (db.prepare(`SELECT id FROM item WHERE relative_path LIKE ?`).get(`%${suffix}`) as { id: string }).id
}

function cabinetOf(db: DatabaseSync, itemId: string): string | null {
  return (db.prepare(`SELECT cabinet FROM ir_item WHERE item_id = ?`).get(itemId) as { cabinet: string | null }).cabinet
}

describe.skipIf(!hasFts5())('promoteFieldToFolder', () => {
  it('writes a folder_metadata row so a sibling with no item-level value now inherits it', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA'), { recursive: true })
    fs.writeFileSync(join(root, 'PackA', 'a.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'PackA', 'b.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const aId = itemIdFor(db, 'a.wav')
    createIrFieldWriter(db).write(aId, 'cabinet', 'Marshall 1960A', 'user_entered')

    promoteFieldToFolder(db, folderId(db, 'PackA'), 'cabinet', 'Marshall 1960A')

    const effective = db
      .prepare(`SELECT value FROM folder_metadata_effective WHERE folder_id = ? AND field = 'cabinet'`)
      .get(folderId(db, 'PackA')) as { value: string } | undefined
    expect(effective?.value).toBe('Marshall 1960A')
  })

  it('clears a per-item override that now matches the promoted value (redundant)', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA'), { recursive: true })
    fs.writeFileSync(join(root, 'PackA', 'a.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'PackA', 'b.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const aId = itemIdFor(db, 'a.wav')
    const bId = itemIdFor(db, 'b.wav')
    const writer = createIrFieldWriter(db)
    writer.write(aId, 'cabinet', 'Marshall 1960A', 'user_entered')
    writer.write(bId, 'cabinet', 'Marshall 1960A', 'user_entered') // same value, independently set

    const result = promoteFieldToFolder(db, folderId(db, 'PackA'), 'cabinet', 'Marshall 1960A')

    // b's override is redundant now — inheritance gives the same value — so it gets cleared.
    expect(result.itemsCleared).toBe(1)
    expect(cabinetOf(db, bId)).toBeNull()
    const bSource = db.prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = 'cabinet'`).get(bId)
    expect(bSource).toBeUndefined()
  })

  it('does NOT clear an item deliberately overridden to a DIFFERENT value', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA'), { recursive: true })
    fs.writeFileSync(join(root, 'PackA', 'a.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'PackA', 'b.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const aId = itemIdFor(db, 'a.wav')
    const bId = itemIdFor(db, 'b.wav')
    const writer = createIrFieldWriter(db)
    writer.write(aId, 'cabinet', 'Marshall 1960A', 'user_entered')
    writer.write(bId, 'cabinet', 'Fender Deluxe', 'user_entered') // deliberately different

    const result = promoteFieldToFolder(db, folderId(db, 'PackA'), 'cabinet', 'Marshall 1960A')

    expect(result.itemsCleared).toBe(0)
    expect(cabinetOf(db, bId)).toBe('Fender Deluxe')
  })

  it('cascades into a subfolder — a descendant with no override inherits the promoted value', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA', 'Sub'), { recursive: true })
    fs.writeFileSync(join(root, 'PackA', 'a.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'PackA', 'Sub', 'nested.wav'), 'z'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const aId = itemIdFor(db, 'a.wav')
    createIrFieldWriter(db).write(aId, 'cabinet', 'Marshall 1960A', 'user_entered')
    promoteFieldToFolder(db, folderId(db, 'PackA'), 'cabinet', 'Marshall 1960A')

    const subEffective = db
      .prepare(`SELECT value FROM folder_metadata_effective WHERE folder_id = ? AND field = 'cabinet'`)
      .get(folderId(db, 'PackA/Sub')) as { value: string } | undefined
    expect(subEffective?.value).toBe('Marshall 1960A')
  })
})

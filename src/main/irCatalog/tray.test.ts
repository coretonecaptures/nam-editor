import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join, sep } from 'node:path'
import { createCoreSchema } from './schema'
import { importLibrary } from './importLibrary'
import { addToTray, removeFromTray, isInTray, listTray, TRAY_CAPACITY } from './tray'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-tray-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function seedItems(db: DatabaseSync, count: number): Promise<string[]> {
  const root = makeTmpDir()
  for (let i = 0; i < count; i++) fs.writeFileSync(join(root, `item-${i}.wav`), `content-${i}`)
  await importLibrary(db, root, 'test-root', { skipQuickHash: true })
  const rows = db.prepare(`SELECT id FROM item ORDER BY relative_path`).all() as Array<{ id: string }>
  return rows.map((r) => r.id)
}

describe.skipIf(!hasFts5())('tray', () => {
  it('adds and removes an item, reflected in isInTray and listTray', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [itemId] = await seedItems(db, 1)

    expect(isInTray(db, itemId)).toBe(false)
    addToTray(db, itemId)
    expect(isInTray(db, itemId)).toBe(true)
    expect(listTray(db).map((r) => r.id)).toEqual([itemId])

    removeFromTray(db, itemId)
    expect(isInTray(db, itemId)).toBe(false)
    expect(listTray(db)).toHaveLength(0)

    db.close()
  })

  it('adding the same item twice is a no-op, not a duplicate slot', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [itemId] = await seedItems(db, 1)

    addToTray(db, itemId)
    addToTray(db, itemId)
    expect(listTray(db)).toHaveLength(1)

    db.close()
  })

  it('rejects a 9th item once the tray is full, matching IR Lab\'s 8-slot Blender', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const ids = await seedItems(db, TRAY_CAPACITY + 1)

    for (let i = 0; i < TRAY_CAPACITY; i++) {
      const result = addToTray(db, ids[i])
      expect(result.success).toBe(true)
    }
    const overflow = addToTray(db, ids[TRAY_CAPACITY])
    expect(overflow.success).toBe(false)
    expect(listTray(db)).toHaveLength(TRAY_CAPACITY)

    db.close()
  })

  it('reuses a freed slot position after a removal rather than growing unboundedly', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const ids = await seedItems(db, TRAY_CAPACITY + 1)

    for (let i = 0; i < TRAY_CAPACITY; i++) addToTray(db, ids[i])
    removeFromTray(db, ids[0])
    const result = addToTray(db, ids[TRAY_CAPACITY])
    expect(result.success).toBe(true)
    expect(listTray(db)).toHaveLength(TRAY_CAPACITY)

    db.close()
  })

  it('listTray returns items ordered by slot position with a resolved abs_path', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const ids = await seedItems(db, 3)

    addToTray(db, ids[2])
    addToTray(db, ids[0])
    addToTray(db, ids[1])

    const tray = listTray(db)
    expect(tray.map((r) => r.position)).toEqual([0, 1, 2])
    for (const row of tray) {
      expect(row.abs_path).toContain(row.relative_path.replace(/\//g, sep))
    }

    db.close()
  })
})

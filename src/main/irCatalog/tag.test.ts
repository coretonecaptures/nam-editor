import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema } from './schema'
import { importLibrary } from './importLibrary'
import { getOrCreateTag, renameTag, deleteTag, addItemToTag, removeItemFromTag, listTags, listTagsForItem } from './tag'
import { queryItems } from './queryLibrary'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-tag-'))
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

describe.skipIf(!hasFts5())('tag (Groups)', () => {
  it('creates a tag once, reuses it on a second call with the same name', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    const id1 = getOrCreateTag(db, 'Live Rig')
    const id2 = getOrCreateTag(db, 'Live Rig')
    expect(id1).toBe(id2)
    expect(listTags(db)).toHaveLength(1)

    db.close()
  })

  it('adds/removes items from a tag, reflected in listTagsForItem and per-tag itemCount', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [a, b] = await seedItems(db, 2)
    const tagId = getOrCreateTag(db, 'Shortlist')

    addItemToTag(db, a, tagId)
    addItemToTag(db, b, tagId)
    expect(listTags(db)[0].itemCount).toBe(2)
    expect(listTagsForItem(db, a).map((t) => t.name)).toEqual(['Shortlist'])

    removeItemFromTag(db, a, tagId)
    expect(listTags(db)[0].itemCount).toBe(1)
    expect(listTagsForItem(db, a)).toHaveLength(0)

    db.close()
  })

  it('adding the same item to the same tag twice is a no-op', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [a] = await seedItems(db, 1)
    const tagId = getOrCreateTag(db, 'Shortlist')

    addItemToTag(db, a, tagId)
    addItemToTag(db, a, tagId)
    expect(listTags(db)[0].itemCount).toBe(1)

    db.close()
  })

  it('renameTag changes the visible name without changing membership', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [a] = await seedItems(db, 1)
    const tagId = getOrCreateTag(db, 'Old Name')
    addItemToTag(db, a, tagId)

    renameTag(db, tagId, 'New Name')
    expect(listTags(db)[0].name).toBe('New Name')
    expect(listTags(db)[0].itemCount).toBe(1)

    db.close()
  })

  it('deleteTag cascades to item_tag rows (ON DELETE CASCADE)', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [a] = await seedItems(db, 1)
    const tagId = getOrCreateTag(db, 'Temp Group')
    addItemToTag(db, a, tagId)

    deleteTag(db, tagId)
    expect(listTags(db)).toHaveLength(0)
    expect(listTagsForItem(db, a)).toHaveLength(0)

    db.close()
  })

  it('queryLibrary tagId filter scopes results to exactly the tagged items, across folders', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const [a, b, c] = await seedItems(db, 3)
    const tagId = getOrCreateTag(db, 'Cross-folder Group')
    addItemToTag(db, a, tagId)
    addItemToTag(db, c, tagId)

    const results = queryItems(db, { tagId, offset: 0, limit: 100 })
    expect(results.map((r) => r.id).sort()).toEqual([a, c].sort())
    expect(results.map((r) => r.id)).not.toContain(b)

    db.close()
  })
})

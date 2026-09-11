import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { setFavorite, setRating } from './queryLibrary'
import { getOrCreateTag, addItemToTag, listTagsForItem } from './tag'
import { renameItem, moveItems, trashItems, copyItems, ensureDestinationFolder } from './fileOps'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-fileops-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function setUpLibrary(): Promise<{ db: DatabaseSync; root: string; libraryRootId: number }> {
  const root = makeTmpDir()
  fs.mkdirSync(join(root, 'PackA'), { recursive: true })
  fs.writeFileSync(join(root, 'PackA', 'Marshall412.wav'), 'x'.repeat(500))
  const db = new DatabaseSync(':memory:')
  createCoreSchema(db)
  const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
  finalizeIndexes(db)
  return { db, root, libraryRootId: stats.libraryRootId }
}

function itemIdFor(db: DatabaseSync, suffix: string): string {
  return (db.prepare(`SELECT id FROM item WHERE relative_path LIKE ?`).get(`%${suffix}`) as { id: string }).id
}

describe.skipIf(!hasFts5())('fileOps', () => {
  it('rename-in-place: renames the file and updates the catalog row, preserving id/rating/tags', async () => {
    const { db, root } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')
    setRating(db, itemId, 5)
    const tagId = getOrCreateTag(db, 'Favorites')
    addItemToTag(db, itemId, tagId)

    const result = await renameItem(db, itemId, 'Marshall 412 SM57')
    expect(result.success).toBe(true)
    expect(fs.existsSync(join(root, 'PackA', 'Marshall 412 SM57.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(false)

    const row = db.prepare(`SELECT id, relative_path as relativePath, rating FROM item WHERE id = ?`).get(itemId) as {
      id: string
      relativePath: string
      rating: number | null
    }
    expect(row.id).toBe(itemId) // same identity, not a new row
    expect(row.relativePath).toBe('PackA/Marshall 412 SM57.wav')
    expect(row.rating).toBe(5)
    expect(listTagsForItem(db, itemId).map((t) => t.name)).toEqual(['Favorites'])
  })

  it('rename refuses a destination that already exists, without force', async () => {
    const { db, root } = await setUpLibrary()
    fs.writeFileSync(join(root, 'PackA', 'Taken.wav'), 'y'.repeat(10))
    const itemId = itemIdFor(db, 'Marshall412.wav')

    const result = await renameItem(db, itemId, 'Taken')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already exists/)
    // Nothing moved.
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(true)
  })

  it('move-to-new-folder: creates the destination folder and updates folder_id + relative_path', async () => {
    const { db, root, libraryRootId } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')
    setFavorite(db, itemId, true)

    const destFolderId = ensureDestinationFolder(db, libraryRootId, 'ByManufacturer/Marshall')
    const [result] = await moveItems(db, [itemId], destFolderId)
    expect(result.success).toBe(true)
    expect(fs.existsSync(join(root, 'ByManufacturer', 'Marshall', 'Marshall412.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(false)

    const row = db.prepare(`SELECT folder_id as folderId, relative_path as relativePath, is_favorite as isFavorite FROM item WHERE id = ?`).get(
      itemId
    ) as { folderId: number; relativePath: string; isFavorite: number }
    expect(row.folderId).toBe(destFolderId)
    expect(row.relativePath).toBe('ByManufacturer/Marshall/Marshall412.wav')
    expect(row.isFavorite).toBe(1)
  })

  it('move-to-existing-folder: reuses the folder row rather than creating a duplicate', async () => {
    const { db, libraryRootId } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')
    const firstId = ensureDestinationFolder(db, libraryRootId, 'Existing')
    const secondId = ensureDestinationFolder(db, libraryRootId, 'Existing')
    expect(secondId).toBe(firstId)

    await moveItems(db, [itemId], firstId)
    const folderCount = (db.prepare(`SELECT COUNT(*) as n FROM folder WHERE relative_path = 'Existing'`).get() as { n: number }).n
    expect(folderCount).toBe(1)
  })

  it('trash: sends the file to the OS trash and removes the catalog row entirely (not missing_since)', async () => {
    const { db, root } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')

    const [result] = await trashItems(db, [itemId])
    expect(result.success).toBe(true)
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(false)
    const row = db.prepare(`SELECT id FROM item WHERE id = ?`).get(itemId)
    expect(row).toBeUndefined()
  })

  it('copy: creates a new file and a new catalog row with a different id, source untouched', async () => {
    const { db, root, libraryRootId } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')
    const destFolderId = ensureDestinationFolder(db, libraryRootId, 'Copies')

    const [result] = await copyItems(db, [itemId], destFolderId)
    expect(result.success).toBe(true)
    expect(result.newItemId).toBeDefined()
    expect(result.newItemId).not.toBe(itemId)
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(true) // source untouched
    expect(fs.existsSync(join(root, 'Copies', 'Marshall412.wav'))).toBe(true)

    const rowCount = (db.prepare(`SELECT COUNT(*) as n FROM item`).get() as { n: number }).n
    expect(rowCount).toBe(2)
  })

  it('disk-failure rollback: a DB error after a successful rename restores the original filename', async () => {
    const { db, root } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')

    // Force the catalog UPDATE to fail by dropping the item row out from under it mid-operation --
    // simulates "disk succeeded, DB failed" without needing to fake a real SQLite error.
    db.exec(`DROP TABLE item`)

    const result = await renameItem(db, itemId, 'WontStick')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/catalog update failed/)
    // Rolled back: the original file is back, the renamed one is gone.
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'PackA', 'WontStick.wav'))).toBe(false)
  })

  it('refuses to operate on an item marked missing_since', async () => {
    const { db } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')
    db.prepare(`UPDATE item SET missing_since = ? WHERE id = ?`).run(new Date().toISOString(), itemId)

    const result = await renameItem(db, itemId, 'ShouldNotWork')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/missing/)
  })

  it('rejects a cross-library-root move', async () => {
    const { db, libraryRootId } = await setUpLibrary()
    const itemId = itemIdFor(db, 'Marshall412.wav')

    const otherRoot = makeTmpDir()
    db.exec(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('${otherRoot.replace(/'/g, "''")}', NULL, 'manual', '2026-01-01')`)
    const otherRootId = (db.prepare(`SELECT id FROM library_root WHERE path != (SELECT path FROM library_root WHERE id = ?)`).get(libraryRootId) as {
      id: number
    }).id
    const otherFolderId = ensureDestinationFolder(db, otherRootId, 'Elsewhere')

    const [result] = await moveItems(db, [itemId], otherFolderId)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/across library roots/)
  })
})

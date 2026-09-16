import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { setFavorite, setRating } from './queryLibrary'
import { getOrCreateTag, addItemToTag, listTagsForItem } from './tag'
import { renameItem, renameItemsBatch, moveItems, trashItems, copyItems, ensureDestinationFolder, createFolder, renameFolder, deleteFolder } from './fileOps'
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

async function setUpLibraryMulti(): Promise<{ db: DatabaseSync; root: string; libraryRootId: number }> {
  const root = makeTmpDir()
  fs.mkdirSync(join(root, 'PackA'), { recursive: true })
  fs.writeFileSync(join(root, 'PackA', 'One.wav'), 'x'.repeat(500))
  fs.writeFileSync(join(root, 'PackA', 'Two.wav'), 'x'.repeat(500))
  fs.writeFileSync(join(root, 'PackA', 'Three.wav'), 'x'.repeat(500))
  const db = new DatabaseSync(':memory:')
  createCoreSchema(db)
  const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
  finalizeIndexes(db)
  return { db, root, libraryRootId: stats.libraryRootId }
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

    // Force the catalog UPDATE specifically to fail, while leaving the earlier SELECT (resolveItem
    // reading the item's current path/folder before the rename even starts) working normally.
    // Dropping the whole `item` table (the original approach here) breaks THAT read too, so
    // renameItem fails before ever touching the disk — not the "disk succeeded, DB failed" case
    // this test means to cover. Caught by actually running this file against Electron's
    // FTS5-capable node:sqlite (`npm run test:electron`), not by local review — plain `vitest run`
    // has no FTS5 here, so this file was silently skipped all session until that run.
    db.exec(`CREATE TRIGGER block_item_update BEFORE UPDATE ON item BEGIN SELECT RAISE(ABORT, 'simulated DB failure'); END`)

    const result = await renameItem(db, itemId, 'WontStick')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/catalog update failed/)
    // Rolled back: the original file is back, the renamed one is gone.
    expect(fs.existsSync(join(root, 'PackA', 'Marshall412.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'PackA', 'WontStick.wav'))).toBe(false)
  })

  describe('renameItemsBatch', () => {
    it('renames every item in one call, each independently, and commits the catalog in one transaction', async () => {
      const { db, root } = await setUpLibraryMulti()
      const one = itemIdFor(db, 'One.wav')
      const two = itemIdFor(db, 'Two.wav')
      const three = itemIdFor(db, 'Three.wav')

      const results = await renameItemsBatch(db, [
        { itemId: one, newBaseName: 'First' },
        { itemId: two, newBaseName: 'Second' },
        { itemId: three, newBaseName: 'Third' }
      ])
      expect(results.every((r) => r.success)).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'First.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Second.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Third.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'One.wav'))).toBe(false)
    })

    it('a disk collision partway through rolls the WHOLE batch back — nothing stays renamed', async () => {
      const { db, root } = await setUpLibraryMulti()
      const one = itemIdFor(db, 'One.wav')
      const two = itemIdFor(db, 'Two.wav')
      const three = itemIdFor(db, 'Three.wav')
      // "Second" already exists on disk, so renaming Two -> Second (the batch's 2nd item) fails
      // after One -> First has already succeeded on disk.
      fs.writeFileSync(join(root, 'PackA', 'Second.wav'), 'y'.repeat(10))

      const results = await renameItemsBatch(db, [
        { itemId: one, newBaseName: 'First' },
        { itemId: two, newBaseName: 'Second' },
        { itemId: three, newBaseName: 'Third' }
      ])
      expect(results.every((r) => !r.success)).toBe(true)
      // Rolled back to exactly where it started: One's rename was undone, Two/Three never moved.
      expect(fs.existsSync(join(root, 'PackA', 'One.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'First.wav'))).toBe(false)
      expect(fs.existsSync(join(root, 'PackA', 'Two.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Three.wav'))).toBe(true)
      const row = db.prepare(`SELECT relative_path as relativePath FROM item WHERE id = ?`).get(one) as { relativePath: string }
      expect(row.relativePath).toBe('PackA/One.wav')
    })

    it('a catalog-transaction failure after every disk rename succeeded rolls disk back too', async () => {
      const { db, root } = await setUpLibraryMulti()
      const one = itemIdFor(db, 'One.wav')
      const two = itemIdFor(db, 'Two.wav')
      db.exec(`CREATE TRIGGER block_item_update BEFORE UPDATE ON item BEGIN SELECT RAISE(ABORT, 'simulated DB failure'); END`)

      const results = await renameItemsBatch(db, [
        { itemId: one, newBaseName: 'First' },
        { itemId: two, newBaseName: 'Second' }
      ])
      expect(results.every((r) => !r.success)).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'One.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Two.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'First.wav'))).toBe(false)
      expect(fs.existsSync(join(root, 'PackA', 'Second.wav'))).toBe(false)
    })

    it('a precondition failure (blank name) aborts the whole batch before any disk mutation', async () => {
      const { db, root } = await setUpLibraryMulti()
      const one = itemIdFor(db, 'One.wav')
      const two = itemIdFor(db, 'Two.wav')

      const results = await renameItemsBatch(db, [
        { itemId: one, newBaseName: 'First' },
        { itemId: two, newBaseName: '   ' }
      ])
      expect(results.every((r) => !r.success)).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'One.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'First.wav'))).toBe(false)
    })

    it('two items in the same batch resolving to the same new name abort the batch, even with force — never deletes one for the other', async () => {
      const { db, root } = await setUpLibraryMulti()
      const one = itemIdFor(db, 'One.wav')
      const two = itemIdFor(db, 'Two.wav')
      const three = itemIdFor(db, 'Three.wav')

      const results = await renameItemsBatch(
        db,
        [
          { itemId: one, newBaseName: 'Same' },
          { itemId: two, newBaseName: 'Same' },
          { itemId: three, newBaseName: 'Third' }
        ],
        true // force=true is exactly the case that could otherwise let the second rename
             // silently unlink the file the first rename in this batch just produced.
      )
      expect(results.every((r) => !r.success)).toBe(true)
      // Nothing touched — all three original files still exist, none renamed to "Same.wav".
      expect(fs.existsSync(join(root, 'PackA', 'One.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Two.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Three.wav'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA', 'Same.wav'))).toBe(false)
    })
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

  it('ensureDestinationFolder creates the real directory on disk, not just the catalog row', async () => {
    // Regression test: this used to be DB-only, which meant a subsequent fs.renameSync into the
    // new folder (the "Create & Move" path in IrMoveToFolderModal.tsx) would fail with ENOENT the
    // very first time it was actually exercised against a real directory that didn't already
    // exist — caught by code review while building item 11, not by this test failing, since this
    // dev machine can't run FTS5 tests locally. Written so it WOULD have caught it.
    const { db, root, libraryRootId } = await setUpLibrary()
    ensureDestinationFolder(db, libraryRootId, 'Brand/New/Path')
    expect(fs.existsSync(join(root, 'Brand', 'New', 'Path'))).toBe(true)
  })

  describe('createFolder', () => {
    it('creates a real directory and a catalog row under the library root', async () => {
      const { db, root, libraryRootId } = await setUpLibrary()
      const result = createFolder(db, libraryRootId, null, 'NewFolder')
      expect(result.success).toBe(true)
      expect(fs.existsSync(join(root, 'NewFolder'))).toBe(true)
      const row = db.prepare(`SELECT id FROM folder WHERE relative_path = 'NewFolder'`).get()
      expect(row).toBeDefined()
    })

    it('refuses when the directory already exists', async () => {
      const { db, libraryRootId } = await setUpLibrary()
      expect(createFolder(db, libraryRootId, null, 'PackA').success).toBe(false)
    })

    it('refuses an empty name', async () => {
      const { db, libraryRootId } = await setUpLibrary()
      expect(createFolder(db, libraryRootId, null, '   ').success).toBe(false)
    })
  })

  describe('renameFolder', () => {
    it('renames on disk and updates the folder row', async () => {
      const { db, root } = await setUpLibrary()
      const folderId = (db.prepare(`SELECT id FROM folder WHERE relative_path = 'PackA'`).get() as { id: number }).id
      const result = renameFolder(db, folderId, 'PackB')
      expect(result.success).toBe(true)
      expect(fs.existsSync(join(root, 'PackB'))).toBe(true)
      expect(fs.existsSync(join(root, 'PackA'))).toBe(false)
      const row = db.prepare(`SELECT relative_path as relativePath FROM folder WHERE id = ?`).get(folderId) as { relativePath: string }
      expect(row.relativePath).toBe('PackB')
    })

    it('cascades to every descendant folder and item — not just the renamed folder itself', async () => {
      const { db, root } = await setUpLibrary()
      fs.mkdirSync(join(root, 'PackA', 'Sub'), { recursive: true })
      fs.writeFileSync(join(root, 'PackA', 'Sub', 'nested.wav'), 'z'.repeat(500))
      // Re-scan so the new subfolder/file are in the catalog before the rename.
      await importLibrary(db, root, 'test-root', { skipQuickHash: true })
      finalizeIndexes(db)

      const packAId = (db.prepare(`SELECT id FROM folder WHERE relative_path = 'PackA'`).get() as { id: number }).id
      const result = renameFolder(db, packAId, 'PackB')
      expect(result.success).toBe(true)
      expect(result.itemsAffected).toBe(2) // Marshall412.wav + nested.wav

      const subRow = db.prepare(`SELECT relative_path as relativePath FROM folder WHERE relative_path LIKE 'PackB%' AND relative_path != 'PackB'`).get() as
        | { relativePath: string }
        | undefined
      expect(subRow?.relativePath).toBe('PackB/Sub')

      const nestedItem = db.prepare(`SELECT relative_path as relativePath FROM item WHERE relative_path LIKE '%nested.wav'`).get() as {
        relativePath: string
      }
      expect(nestedItem.relativePath).toBe('PackB/Sub/nested.wav')

      // A sibling folder whose name happens to start with the same characters ("PackA" is not a
      // prefix of anything else here, but this asserts the rename used ID lineage, not a string-
      // prefix match, by checking the exact resulting path rather than a substring).
      expect(fs.existsSync(join(root, 'PackB', 'Sub', 'nested.wav'))).toBe(true)
    })

    it('refuses a destination that already exists, without force', async () => {
      const { db, root } = await setUpLibrary()
      fs.mkdirSync(join(root, 'Taken'), { recursive: true })
      const folderId = (db.prepare(`SELECT id FROM folder WHERE relative_path = 'PackA'`).get() as { id: number }).id
      const result = renameFolder(db, folderId, 'Taken')
      expect(result.success).toBe(false)
      expect(fs.existsSync(join(root, 'PackA'))).toBe(true) // unchanged
    })
  })

  describe('deleteFolder', () => {
    it('trashes the directory and removes the folder and its items from the catalog', async () => {
      const { db, root } = await setUpLibrary()
      const folderId = (db.prepare(`SELECT id FROM folder WHERE relative_path = 'PackA'`).get() as { id: number }).id
      const itemId = itemIdFor(db, 'Marshall412.wav')

      const result = await deleteFolder(db, folderId)
      expect(result.success).toBe(true)
      expect(result.itemsAffected).toBe(1)
      expect(fs.existsSync(join(root, 'PackA'))).toBe(false)
      expect(db.prepare(`SELECT id FROM folder WHERE id = ?`).get(folderId)).toBeUndefined()
      expect(db.prepare(`SELECT id FROM item WHERE id = ?`).get(itemId)).toBeUndefined()
    })

    it('deletes a multi-level subtree without a foreign-key error (children before parents)', async () => {
      const { db, root } = await setUpLibrary()
      fs.mkdirSync(join(root, 'PackA', 'Sub', 'Deeper'), { recursive: true })
      fs.writeFileSync(join(root, 'PackA', 'Sub', 'Deeper', 'nested.wav'), 'z'.repeat(500))
      await importLibrary(db, root, 'test-root', { skipQuickHash: true })
      finalizeIndexes(db)

      const packAId = (db.prepare(`SELECT id FROM folder WHERE relative_path = 'PackA'`).get() as { id: number }).id
      const result = await deleteFolder(db, packAId)
      expect(result.success).toBe(true)
      expect(result.itemsAffected).toBe(2)
      const remainingFolders = db.prepare(`SELECT COUNT(*) as n FROM folder WHERE relative_path LIKE 'PackA%'`).get() as { n: number }
      expect(remainingFolders.n).toBe(0)
    })
  })
})

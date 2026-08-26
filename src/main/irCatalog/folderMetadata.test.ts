import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { queryItems } from './queryLibrary'
import { setFolderMetadata, removeFolderMetadata, listFolders, listAllFolders } from './folderMetadata'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-foldermeta-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeNestedFixture(): string {
  const root = makeTmpDir()
  fs.mkdirSync(join(root, 'PackA', 'Sub'), { recursive: true })
  fs.writeFileSync(join(root, 'PackA', 'file.wav'), 'a'.repeat(500))
  fs.writeFileSync(join(root, 'PackA', 'Sub', 'nested.wav'), 'b'.repeat(500))
  return root
}

function folderId(db: DatabaseSync, relativePath: string): number {
  return (db.prepare(`SELECT id FROM folder WHERE relative_path = ?`).get(relativePath) as { id: number }).id
}

describe.skipIf(!hasFts5())('folderMetadata', () => {
  it('a folder declaration is inherited by items with no item-level value', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Marshall', 'user_entered')

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    for (const row of rows) {
      expect(row.manufacturer).toBe('Marshall')
      expect(row.manufacturer_source).toBe('user_entered')
    }

    db.close()
  })

  it('inheritance cascades down to a nested descendant folder', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Marshall', 'user_entered')

    const nested = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 }).find((r) =>
      r.relative_path.includes('nested.wav')
    )
    expect(nested?.manufacturer).toBe('Marshall')

    db.close()
  })

  it('a nearer (child folder) declaration overrides an ancestor for that field', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Marshall', 'user_entered')
    setFolderMetadata(db, folderId(db, 'PackA/Sub'), 'manufacturer', 'Mesa', 'user_entered')

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    const topLevel = rows.find((r) => r.relative_path === 'PackA/file.wav')
    const nested = rows.find((r) => r.relative_path.includes('nested.wav'))
    expect(topLevel?.manufacturer).toBe('Marshall')
    expect(nested?.manufacturer).toBe('Mesa')

    db.close()
  })

  it('an item-level (vendor-parsed) value always wins over folder inheritance', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const item = db.prepare(`SELECT id FROM item WHERE relative_path = 'PackA/file.wav'`).get() as { id: string }
    db.exec(`INSERT OR IGNORE INTO ir_item (item_id) VALUES ('${item.id}')`)
    db.prepare(`UPDATE ir_item SET manufacturer = 'Bogner' WHERE item_id = ?`).run(item.id)
    db.prepare(
      `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, 'manufacturer', 'vendor_parser')`
    ).run(item.id)

    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Marshall', 'user_entered')

    const row = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 }).find(
      (r) => r.relative_path === 'PackA/file.wav'
    )
    expect(row?.manufacturer).toBe('Bogner')
    expect(row?.manufacturer_source).toBe('vendor_parser')

    db.close()
  })

  it('cascades correctly when an ancestor declaration changes after a descendant already inherited it', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Marshall', 'user_entered')
    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Friedman', 'user_entered') // changed mind

    const nested = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 }).find((r) =>
      r.relative_path.includes('nested.wav')
    )
    expect(nested?.manufacturer).toBe('Friedman')

    db.close()
  })

  it('removeFolderMetadata falls back to whatever the next ancestor (or nothing) provides', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    setFolderMetadata(db, folderId(db, 'PackA'), 'manufacturer', 'Marshall', 'user_entered')
    setFolderMetadata(db, folderId(db, 'PackA/Sub'), 'manufacturer', 'Mesa', 'user_entered')
    removeFolderMetadata(db, folderId(db, 'PackA/Sub'), 'manufacturer')

    const nested = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 }).find((r) =>
      r.relative_path.includes('nested.wav')
    )
    expect(nested?.manufacturer).toBe('Marshall') // falls back to the ancestor

    db.close()
  })

  it('listFolders reports the direct (non-recursive) item count per folder', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const rows = listFolders(db, stats.libraryRootId)
    const packA = rows.find((r) => r.relative_path === 'PackA')
    const sub = rows.find((r) => r.relative_path === 'PackA/Sub')
    const top = rows.find((r) => r.relative_path === '')
    expect(packA?.direct_item_count).toBe(1) // file.wav only -- nested.wav is one level deeper
    expect(sub?.direct_item_count).toBe(1)
    expect(top?.direct_item_count).toBe(0) // no items sit directly at the root

    db.close()
  })

  it('listAllFolders returns folders from every library_root, each tagged with its own root', async () => {
    const rootA = makeTmpDir()
    fs.mkdirSync(join(rootA, 'ProjectA'), { recursive: true })
    fs.writeFileSync(join(rootA, 'ProjectA', 'a.wav'), 'x'.repeat(500))
    const rootB = makeTmpDir()
    fs.mkdirSync(join(rootB, 'ProjectB'), { recursive: true })
    fs.writeFileSync(join(rootB, 'ProjectB', 'b.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const statsA = await importLibrary(db, rootA, 'Alpha')
    const statsB = await importLibrary(db, rootB, 'Beta')
    finalizeIndexes(db)

    const rows = listAllFolders(db)
    const fromA = rows.filter((r) => r.library_root_id === statsA.libraryRootId)
    const fromB = rows.filter((r) => r.library_root_id === statsB.libraryRootId)
    expect(fromA.some((r) => r.relative_path === 'ProjectA')).toBe(true)
    expect(fromB.some((r) => r.relative_path === 'ProjectB')).toBe(true)
    expect(fromA.find((r) => r.relative_path === 'ProjectA')?.library_root_label).toBe('Alpha')
    expect(fromB.find((r) => r.relative_path === 'ProjectB')?.library_root_label).toBe('Beta')

    db.close()
  })

  it('listAllFolders falls back to the root path basename when no label was set', async () => {
    const root = makeNestedFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, null)
    finalizeIndexes(db)

    const rows = listAllFolders(db)
    const expectedBasename = root.split(/[\\/]/).filter(Boolean).pop()
    expect(rows[0]?.library_root_label).toBe(expectedBasename)

    db.close()
  })
})

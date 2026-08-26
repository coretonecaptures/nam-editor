import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { enrichLabProjects } from './labProjectEnrichment'
import {
  previewFolderRemoval,
  removeFolderFromCatalog,
  previewLibraryRootRemoval,
  removeLibraryRoot,
  removeItemFromCatalog
} from './removeFromCatalog'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-remove-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeFixture(): string {
  const root = makeTmpDir()
  fs.mkdirSync(join(root, 'Ownhammer', 'Mesa V30'), { recursive: true })
  fs.mkdirSync(join(root, 'RedWirez', 'Marshall G12M'), { recursive: true })
  fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'SM57 Cone.wav'), 'a'.repeat(1000))
  fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'MD421 Edge.wav'), 'b'.repeat(2000))
  fs.writeFileSync(join(root, 'RedWirez', 'Marshall G12M', 'Combo.wav'), 'c'.repeat(500))
  return root
}

describe.skipIf(!hasFts5())('removeFromCatalog', () => {
  it('previewFolderRemoval counts a folder and its whole subtree, not siblings', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    void stats

    const ownhammerFolder = db.prepare(`SELECT id FROM folder WHERE relative_path = 'Ownhammer'`).get() as { id: number }
    const preview = previewFolderRemoval(db, ownhammerFolder.id)
    expect(preview.itemCount).toBe(2) // Ownhammer/Mesa V30's two files, not RedWirez's

    db.close()
  })

  it('removeFolderFromCatalog deletes only that subtree, leaving siblings and the root intact', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const ownhammerFolder = db.prepare(`SELECT id FROM folder WHERE relative_path = 'Ownhammer'`).get() as { id: number }
    const result = removeFolderFromCatalog(db, ownhammerFolder.id)
    expect(result.itemsRemoved).toBe(2)

    const remaining = db.prepare(`SELECT relative_path FROM item`).all() as Array<{ relative_path: string }>
    expect(remaining.map((r) => r.relative_path)).toEqual(['RedWirez/Marshall G12M/Combo.wav'])
    // The library_root itself and its sibling folder survive.
    expect((db.prepare(`SELECT COUNT(*) c FROM library_root WHERE id = ?`).get(stats.libraryRootId) as { c: number }).c).toBe(1)
    expect(db.prepare(`SELECT 1 FROM folder WHERE relative_path = 'RedWirez'`).get()).toBeTruthy()

    db.close()
  })

  it('removeFolderFromCatalog also removes an IR Lab Project collection anchored inside the subtree', async () => {
    const root = makeTmpDir()
    const projectDir = join(root, 'Projects', 'Marshall Session')
    const sessionDataDir = join(projectDir, '.SessionData')
    const captureDir = join(sessionDataDir, 'capture-1')
    fs.mkdirSync(join(captureDir, 'captures', 'capture-1'), { recursive: true })
    fs.writeFileSync(join(projectDir, 'Marshall 412.wav'), 'x'.repeat(1000))
    fs.writeFileSync(
      join(sessionDataDir, 'project.json'),
      JSON.stringify({ name: 'Marshall Session', captureIndex: [{ captureId: 'capture-1', outputFileName: 'Marshall 412.wav' }] })
    )
    fs.writeFileSync(join(captureDir, 'session.json'), JSON.stringify({ metadata: { cabinet: 'Marshall 1960A' } }))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)
    expect((db.prepare(`SELECT COUNT(*) c FROM collection WHERE kind = 'ir_project'`).get() as { c: number }).c).toBe(1)

    const projectsFolder = db.prepare(`SELECT id FROM folder WHERE relative_path = 'Projects'`).get() as { id: number }
    removeFolderFromCatalog(db, projectsFolder.id)

    expect((db.prepare(`SELECT COUNT(*) c FROM collection`).get() as { c: number }).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c).toBe(0)

    db.close()
  })

  it('removeLibraryRoot deletes the whole root, all its folders/items, and the root row itself', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const preview = previewLibraryRootRemoval(db, stats.libraryRootId)
    expect(preview.itemCount).toBe(3)

    const result = removeLibraryRoot(db, stats.libraryRootId)
    expect(result.itemsRemoved).toBe(3)

    expect((db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) c FROM folder`).get() as { c: number }).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) c FROM library_root WHERE id = ?`).get(stats.libraryRootId) as { c: number }).c).toBe(0)
    // item_search is kept in sync live by the existing item_search_ad trigger -- not by a
    // finalizeIndexes() call this function never makes.
    expect((db.prepare(`SELECT COUNT(*) c FROM item_search`).get() as { c: number }).c).toBe(0)

    db.close()
  })

  it('removeItemFromCatalog removes just the one item, leaving siblings intact', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const target = db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%Combo.wav'`).get() as { id: string }
    removeItemFromCatalog(db, target.id)

    const remaining = db.prepare(`SELECT relative_path FROM item`).all() as Array<{ relative_path: string }>
    expect(remaining.map((r) => r.relative_path).sort()).toEqual(['Ownhammer/Mesa V30/MD421 Edge.wav', 'Ownhammer/Mesa V30/SM57 Cone.wav'])

    db.close()
  })

  it('removeLibraryRoot cleans up ir_item/ir_item_field_source via the item cascade, not orphaning rows', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer', 'Cab'), { recursive: true })
    fs.writeFileSync(join(root, 'Ownhammer', 'Cab', 'V30 SM57.wav'), 'a'.repeat(1000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const item = db.prepare(`SELECT id FROM item`).get() as { id: string }
    db.prepare(`INSERT INTO ir_item (item_id, manufacturer) VALUES (?, 'Ownhammer')`).run(item.id)
    db.prepare(`INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, 'manufacturer', 'vendor_parser')`).run(item.id)

    removeLibraryRoot(db, stats.libraryRootId)

    expect((db.prepare(`SELECT COUNT(*) c FROM ir_item`).get() as { c: number }).c).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) c FROM ir_item_field_source`).get() as { c: number }).c).toBe(0)

    db.close()
  })
})

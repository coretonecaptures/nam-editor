import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { checkItemAvailability } from './missingFileCheck'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-missing-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!hasFts5())('checkItemAvailability', () => {
  it('reports not missing, and touches nothing, when the file is right where the catalog says', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer', 'Mesa V30'), { recursive: true })
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'SM57.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const item = db.prepare(`SELECT id FROM item`).get() as { id: string }

    const result = checkItemAvailability(db, item.id)
    expect(result.fileMissing).toBe(false)
    const row = db.prepare(`SELECT missing_since FROM item WHERE id = ?`).get(item.id) as { missing_since: string | null }
    expect(row.missing_since).toBeNull()

    db.close()
  })

  it("scope 'item': just the file itself is gone, folder structure intact", async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer', 'Mesa V30'), { recursive: true })
    const filePath = join(root, 'Ownhammer', 'Mesa V30', 'SM57.wav')
    fs.writeFileSync(filePath, 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const item = db.prepare(`SELECT id FROM item`).get() as { id: string }

    fs.rmSync(filePath) // only the file disappears — the folders stay

    const result = checkItemAvailability(db, item.id)
    expect(result.fileMissing).toBe(true)
    expect(result.missingScope).toBe('item')
    expect(result.affectedItemCount).toBe(1)
    const row = db.prepare(`SELECT missing_since FROM item WHERE id = ?`).get(item.id) as { missing_since: string | null }
    expect(row.missing_since).not.toBeNull()

    db.close()
  })

  it("scope 'folder': reports the SHALLOWEST missing ancestor, not the deepest, when several levels are gone", async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer', 'Mesa V30', 'Close'), { recursive: true })
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'Close', 'SM57.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'Close', 'MD421.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const item = db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%SM57.wav'`).get() as { id: string }

    // Delete "Mesa V30" (and everything under it, including "Close") -- the whole subtree, not
    // just the leaf folder.
    fs.rmSync(join(root, 'Ownhammer', 'Mesa V30'), { recursive: true, force: true })

    const result = checkItemAvailability(db, item.id)
    expect(result.fileMissing).toBe(true)
    expect(result.missingScope).toBe('folder')
    expect(result.missingFolderName).toBe('Mesa V30') // NOT "Close" -- the topmost missing ancestor
    expect(result.affectedItemCount).toBe(2) // both files under Mesa V30/Close

    const missingFolder = db.prepare(`SELECT relative_path FROM folder WHERE id = ?`).get(result.missingFolderId ?? -1) as {
      relative_path: string
    }
    expect(missingFolder.relative_path).toBe('Ownhammer/Mesa V30')

    db.close()
  })

  it("scope 'root': the whole added library folder is gone", async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer', 'Mesa V30'), { recursive: true })
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'SM57.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'MD421.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const item = db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%SM57.wav'`).get() as { id: string }

    fs.rmSync(root, { recursive: true, force: true })

    const result = checkItemAvailability(db, item.id)
    expect(result.fileMissing).toBe(true)
    expect(result.missingScope).toBe('root')
    expect(result.affectedItemCount).toBe(2)

    db.close()
  })
})

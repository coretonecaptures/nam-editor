import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { queryPage, searchItems } from './queryLibrary'
import { hasFts5 } from './sqliteCapabilities'

// This schema uses an FTS5 virtual table, which the plain Node.js this repo's devDependency
// ships does not compile in (only Electron's embedded node:sqlite does — see
// sqliteCapabilities.ts). `npm test` runs under plain Node, so these specs no-op there with a
// clear pointer to the command that actually exercises them; `npm run test:electron` runs the
// full suite under Electron's own Node build instead.
if (!hasFts5()) {
  // eslint-disable-next-line no-console
  console.warn(
    'importLibrary.test.ts: skipped (no FTS5 in this Node build) — run `npm run test:electron` for full coverage.'
  )
}

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-import-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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

describe.skipIf(!hasFts5())('importLibrary', () => {
  it('inserts folders, items, and item_search rows matching the walked files', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    expect(stats.itemsInserted).toBe(3)
    // root + Ownhammer + Ownhammer/Mesa V30 + RedWirez + RedWirez/Marshall G12M
    expect(stats.foldersInserted).toBe(5)

    const itemCount = (db.prepare('SELECT COUNT(*) as c FROM item').get() as { c: number }).c
    const searchCount = (db.prepare('SELECT COUNT(*) as c FROM item_search').get() as { c: number }).c
    expect(itemCount).toBe(3)
    expect(searchCount).toBe(3)

    db.close()
  })

  it('computes quick_hash and file_size for every item', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root')

    const rows = db.prepare('SELECT file_size, quick_hash FROM item').all() as Array<{
      file_size: number
      quick_hash: string
    }>
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.file_size).toBeGreaterThan(0)
      expect(row.quick_hash).toMatch(/^[0-9a-f]{40}$/)
    }

    db.close()
  })

  it('is safe to re-run against the same root: no duplicate item or item_search rows', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    await importLibrary(db, root, 'test-root')
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const itemCount = (db.prepare('SELECT COUNT(*) as c FROM item').get() as { c: number }).c
    const searchCount = (db.prepare('SELECT COUNT(*) as c FROM item_search').get() as { c: number }).c
    expect(itemCount).toBe(3)
    expect(searchCount).toBe(3)

    db.close()
  })

  it('supports paginated browse and FTS5 search over the imported catalog', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const page = queryPage(db, stats.libraryRootId, 0, 10)
    expect(page).toHaveLength(3)
    // Stored relative_path is posix-normalized regardless of host platform (toPosixRel).
    expect(page.map((r) => r.relative_path).sort()).toEqual(
      [
        'Ownhammer/Mesa V30/MD421 Edge.wav',
        'Ownhammer/Mesa V30/SM57 Cone.wav',
        'RedWirez/Marshall G12M/Combo.wav'
      ].sort()
    )

    const results = searchItems(db, 'SM57', 10)
    expect(results).toHaveLength(1)
    expect(results[0].display_name).toBe('SM57 Cone.wav')

    db.close()
  })

  it('splits a small library across multiple batches without dropping rows', async () => {
    const root = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    // batchSize smaller than folder+item event count forces multiple transactions.
    const stats = await importLibrary(db, root, 'test-root', { batchSize: 1 })

    expect(stats.itemsInserted).toBe(3)
    const itemCount = (db.prepare('SELECT COUNT(*) as c FROM item').get() as { c: number }).c
    expect(itemCount).toBe(3)

    db.close()
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema } from './schema'
import { importLibrary } from './importLibrary'
import { runContentHashQueue, computeContentHash } from './contentHash'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-contenthash-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!hasFts5())('runContentHashQueue', () => {
  it('fills content_hash for every item missing one', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'a.wav'), 'a'.repeat(1000))
    fs.writeFileSync(join(root, 'b.wav'), 'b'.repeat(2000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })

    const before = db.prepare(`SELECT COUNT(*) c FROM item WHERE content_hash IS NULL`).get() as { c: number }
    expect(before.c).toBe(2)

    const result = await runContentHashQueue(db, stats.libraryRootId)
    expect(result.processed).toBe(2)

    const after = db.prepare(`SELECT COUNT(*) c FROM item WHERE content_hash IS NULL`).get() as { c: number }
    expect(after.c).toBe(0)

    const rows = db.prepare(`SELECT content_hash FROM item`).all() as Array<{ content_hash: string }>
    for (const row of rows) expect(row.content_hash).toMatch(/^[0-9a-f]{40}$/)

    db.close()
  })

  it('is idempotent — re-running does not re-hash items that already have one', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'a.wav'), 'a'.repeat(1000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })

    await runContentHashQueue(db, stats.libraryRootId)
    const second = await runContentHashQueue(db, stats.libraryRootId)
    expect(second.processed).toBe(0)

    db.close()
  })

  it('leaves content_hash null for a file that vanished before hashing ran, rather than throwing', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'a.wav'), 'a'.repeat(1000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })

    fs.unlinkSync(join(root, 'a.wav'))
    const result = await runContentHashQueue(db, stats.libraryRootId)
    expect(result.processed).toBe(1)

    const row = db.prepare(`SELECT content_hash FROM item`).get() as { content_hash: string | null }
    expect(row.content_hash).toBeNull()

    db.close()
  })
})

describe('computeContentHash', () => {
  it('produces a stable hash for the same content and different hashes for different content', async () => {
    const dir = makeTmpDir()
    const pathA = join(dir, 'a.wav')
    const pathB = join(dir, 'b.wav')
    fs.writeFileSync(pathA, 'identical content')
    fs.writeFileSync(pathB, 'different content')

    const hashA1 = await computeContentHash(pathA)
    const hashA2 = await computeContentHash(pathA)
    const hashB = await computeContentHash(pathB)

    expect(hashA1).toBe(hashA2)
    expect(hashA1).not.toBe(hashB)
    expect(hashA1).toMatch(/^[0-9a-f]{40}$/)
  })
})

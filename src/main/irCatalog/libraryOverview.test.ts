import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { applyVendorParsers } from './vendorParsers/applyVendorParsers'
import { setFavorite, setRating } from './queryLibrary'
import { getLibraryOverview } from './libraryOverview'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-overview-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!hasFts5())('getLibraryOverview', () => {
  it('reports totals, favorites/ratings, and a manufacturer/microphone breakdown', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Custom'), { recursive: true })
    fs.writeFileSync(join(root, 'Custom', 'Marshall Greenback SM57.wav'), 'a'.repeat(500))
    fs.writeFileSync(join(root, 'Custom', 'Marshall V30 SM57.wav'), 'b'.repeat(500))
    fs.writeFileSync(join(root, 'Custom', 'Fender G12M MD421.wav'), 'c'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const items = db.prepare(`SELECT id FROM item`).all() as Array<{ id: string }>
    setFavorite(db, items[0].id, true)
    setRating(db, items[1].id, 5)

    const overview = getLibraryOverview(db, stats.libraryRootId)
    expect(overview.totalItems).toBe(3)
    expect(overview.favoriteCount).toBe(1)
    expect(overview.ratedCount).toBe(1)
    expect(overview.documentCount).toBe(0)
    expect(overview.taggedCount).toBe(3) // all three got at least one vendor-parsed field

    const marshall = overview.manufacturerBreakdown.find((e) => e.value === 'Marshall')
    expect(marshall?.count).toBe(2)
    const sm57 = overview.microphoneBreakdown.find((e) => e.value === 'SM57')
    expect(sm57?.count).toBe(2)

    db.close()
  })
})

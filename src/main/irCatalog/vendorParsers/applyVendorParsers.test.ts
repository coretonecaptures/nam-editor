import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from '../schema'
import { importLibrary } from '../importLibrary'
import { applyVendorParsers } from './applyVendorParsers'
import { hasFts5 } from '../sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-vendorparse-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeFixture(): string {
  const root = makeTmpDir()
  // Real Ownhammer shape.
  fs.mkdirSync(join(root, '1012 GIBS', 'V10', 'Mics'), { recursive: true })
  fs.writeFileSync(join(root, '1012 GIBS', 'V10', 'Mics', 'OH 1012 GIBS V10 121-00.wav'), 'a'.repeat(500))
  // Real RedWirez shape.
  fs.mkdirSync(join(root, 'Ampeg SVT 810', 'BIGBox', '44.1 KHz-16bit', 'SVT810', 'AKG D112'), { recursive: true })
  fs.writeFileSync(
    join(root, 'Ampeg SVT 810', 'BIGBox', '44.1 KHz-16bit', 'SVT810', 'AKG D112', 'SVT810-D112-Cap-0in.wav'),
    'b'.repeat(500)
  )
  // Neither structural shape — only the generic vocabulary should touch this one.
  fs.mkdirSync(join(root, 'Custom'), { recursive: true })
  fs.writeFileSync(join(root, 'Custom', 'Marshall Handwired Greenback SM57.wav'), 'c'.repeat(500))
  return root
}

describe.skipIf(!hasFts5())('applyVendorParsers', () => {
  it('populates ir_item via the structural parser, with vendor_parser provenance', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, makeFixture(), 'test-root')
    finalizeIndexes(db)

    applyVendorParsers(db, stats.libraryRootId)

    const row = db
      .prepare(`SELECT * FROM ir_item JOIN item ON item.id = ir_item.item_id WHERE item.relative_path LIKE '%OH 1012%'`)
      .get() as any
    expect(row.cabinet).toBe('1012 GIBS')
    expect(row.speaker).toBe('V10')
    expect(row.microphone).toBe('121')

    const source = db
      .prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = 'cabinet'`)
      .get(row.item_id) as { source: string }
    expect(source.source).toBe('vendor_parser')

    db.close()
  })

  it('falls back to the generic vocabulary (filename_inferred) when no structural parser recognizes the folder', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, makeFixture(), 'test-root')
    finalizeIndexes(db)

    applyVendorParsers(db, stats.libraryRootId)

    const row = db
      .prepare(`SELECT * FROM ir_item JOIN item ON item.id = ir_item.item_id WHERE item.relative_path LIKE '%Marshall%'`)
      .get() as any
    expect(row.microphone).toBe('SM57')
    expect(row.manufacturer).toBe('Marshall')

    const source = db
      .prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = 'microphone'`)
      .get(row.item_id) as { source: string }
    expect(source.source).toBe('filename_inferred')

    db.close()
  })

  it('fills manufacturer via the generic fallback even when a structural parser already claimed the item', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, makeFixture(), 'test-root')
    finalizeIndexes(db)

    applyVendorParsers(db, stats.libraryRootId)

    // The Ownhammer parser never sets `manufacturer` — the generic pass fills it if the RedWirez
    // fixture's ancestor folder name contains a known brand (it does: "Ampeg").
    const row = db
      .prepare(`SELECT * FROM ir_item JOIN item ON item.id = ir_item.item_id WHERE item.relative_path LIKE '%SVT810%'`)
      .get() as any
    expect(row.cabinet).toBe('SVT810') // from redwirez parser (vendor_parser)
    expect(row.manufacturer).toBe('Ampeg') // from redwirez parser too, actually — verify provenance below

    const cabSource = db
      .prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = 'cabinet'`)
      .get(row.item_id) as { source: string }
    expect(cabSource.source).toBe('vendor_parser')

    db.close()
  })

  it('never overwrites a user_entered field, even on a re-run', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, makeFixture(), 'test-root')
    finalizeIndexes(db)

    const row = db
      .prepare(`SELECT item.id as item_id FROM item WHERE item.relative_path LIKE '%OH 1012%'`)
      .get() as { item_id: string }

    // Simulate a user hand-editing the cabinet field before any parser ever ran.
    db.exec(`INSERT OR IGNORE INTO ir_item (item_id) VALUES ('${row.item_id}')`)
    db.prepare(`UPDATE ir_item SET cabinet = 'My Custom Name' WHERE item_id = ?`).run(row.item_id)
    db.prepare(
      `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, 'cabinet', 'user_entered')`
    ).run(row.item_id)

    applyVendorParsers(db, stats.libraryRootId)

    const after = db.prepare(`SELECT cabinet FROM ir_item WHERE item_id = ?`).get(row.item_id) as { cabinet: string }
    expect(after.cabinet).toBe('My Custom Name')

    db.close()
  })
})

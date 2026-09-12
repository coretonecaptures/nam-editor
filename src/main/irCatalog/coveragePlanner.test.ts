import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { getCoverageMatrix } from './coveragePlanner'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-coverage-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

// See promoteFieldToFolder.test.ts's own comment on why this is needed — fixtures write
// placeholder bytes, not real WAV data, so importLibrary's WAV-header parse never creates the
// ir_item row on its own.
function ensureIrItem(db: DatabaseSync, itemId: string): void {
  db.prepare(`INSERT OR IGNORE INTO ir_item (item_id) VALUES (?)`).run(itemId)
}

function itemIdFor(db: DatabaseSync, suffix: string): string {
  return (db.prepare(`SELECT id FROM item WHERE relative_path LIKE ?`).get(`%${suffix}`) as { id: string }).id
}

interface Fixture {
  file: string
  cabinet: string
  speaker: string
  microphone?: string
  micATargetZone?: string
}

async function seedLibrary(fixtures: Fixture[]): Promise<{ db: DatabaseSync; ids: Record<string, string> }> {
  const root = makeTmpDir()
  for (const f of fixtures) fs.writeFileSync(join(root, f.file), 'x'.repeat(500))

  const db = new DatabaseSync(':memory:')
  createCoreSchema(db)
  await importLibrary(db, root, 'test-root')
  finalizeIndexes(db)

  const ids: Record<string, string> = {}
  for (const f of fixtures) {
    const id = itemIdFor(db, f.file)
    ids[f.file] = id
    ensureIrItem(db, id)
    db.prepare(`UPDATE ir_item SET cabinet = ?, speaker = ?, microphone = ?, mic_a_target_zone = ? WHERE item_id = ?`).run(
      f.cabinet,
      f.speaker,
      f.microphone ?? null,
      f.micATargetZone ?? null,
      id
    )
  }
  return { db, ids }
}

function insertProject(db: DatabaseSync, id: string, name: string, createdAt: string, itemIds: string[]): void {
  db.prepare(
    `INSERT INTO collection (id, kind, name, created_at) VALUES (?, 'ir_project', ?, ?)`
  ).run(id, name, createdAt)
  for (const itemId of itemIds) {
    db.prepare(`INSERT INTO collection_item (collection_id, item_id) VALUES (?, ?)`).run(id, itemId)
  }
}

describe.skipIf(!hasFts5())('getCoverageMatrix', () => {
  it('flags a combo missing from one rig when 2+ other rigs have it', async () => {
    const { db } = await seedLibrary([
      { file: 'a1.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'a2.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cap Edge' },
      { file: 'b1.wav', cabinet: 'Mesa 4x12', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'b2.wav', cabinet: 'Mesa 4x12', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cap Edge' },
      { file: 'b3.wav', cabinet: 'Mesa 4x12', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cone' },
      { file: 'c1.wav', cabinet: 'Fender Twin', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'c2.wav', cabinet: 'Fender Twin', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cap Edge' },
      { file: 'c3.wav', cabinet: 'Fender Twin', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cone' }
    ])

    const rigs = getCoverageMatrix(db)
    const marshall = rigs.find((r) => r.cabinet === 'Marshall 1960A')!
    expect(marshall.gaps).toEqual([{ microphone: 'R121', position: 'Cone', presentInOtherRigCount: 2 }])

    const mesa = rigs.find((r) => r.cabinet === 'Mesa 4x12')!
    expect(mesa.gaps).toEqual([])

    db.close()
  })

  it('does not flag a combo present in only one other rig', async () => {
    const { db } = await seedLibrary([
      { file: 'a1.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'b1.wav', cabinet: 'Mesa 4x12', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'b2.wav', cabinet: 'Mesa 4x12', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cone' }
    ])

    const rigs = getCoverageMatrix(db)
    const marshall = rigs.find((r) => r.cabinet === 'Marshall 1960A')!
    // R121/Cone exists in exactly one other rig (Mesa) — below the 2-other-rigs threshold.
    expect(marshall.gaps).toEqual([])

    db.close()
  })

  it('matches cabinet/speaker/mic/position case-insensitively after trimming', async () => {
    const { db } = await seedLibrary([
      { file: 'a1.wav', cabinet: '  Marshall 1960A  ', speaker: 'v30', microphone: 'sm57', micATargetZone: 'cap edge' },
      { file: 'b1.wav', cabinet: 'MARSHALL 1960A', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'b2.wav', cabinet: 'MARSHALL 1960A', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cone' },
      { file: 'c1.wav', cabinet: 'Fender Twin', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cone' }
    ])

    const rigs = getCoverageMatrix(db)
    // a1 and b1/b2 all fold into ONE rig (same cabinet+speaker, case/whitespace-insensitive).
    expect(rigs).toHaveLength(2)
    const marshall = rigs.find((r) => r.cabinet.toLowerCase().includes('marshall'))!
    expect(marshall.combosPresent).toHaveLength(2)

    db.close()
  })

  it('falls back to mic_b_target_zone when mic_a_target_zone is blank', async () => {
    const { db } = await seedLibrary([
      { file: 'a1.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'SM57' }
    ])
    const id = itemIdFor(db, 'a1.wav')
    db.prepare(`UPDATE ir_item SET mic_b_target_zone = 'Cone' WHERE item_id = ?`).run(id)

    const rigs = getCoverageMatrix(db)
    expect(rigs[0].combosPresent).toEqual([{ microphone: 'SM57', position: 'Cone' }])

    db.close()
  })

  it('picks the ir_project owning the most of a rig\'s items as the send-to-IR-Lab target', async () => {
    const { db, ids } = await seedLibrary([
      { file: 'a1.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' },
      { file: 'a2.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cap Edge' },
      { file: 'a3.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'R121', micATargetZone: 'Cone' }
    ])
    insertProject(db, 'small-project', 'Small Session', '2026-01-01T00:00:00.000Z', [ids['a1.wav']])
    insertProject(db, 'big-project', 'Big Session', '2026-02-01T00:00:00.000Z', [ids['a2.wav'], ids['a3.wav']])

    const rigs = getCoverageMatrix(db)
    expect(rigs[0].targetProjectId).toBe('big-project')
    expect(rigs[0].targetProjectName).toBe('Big Session')

    db.close()
  })

  it("prefers naming_template (IR Lab's real project id) over this app's own collection.id", async () => {
    const { db, ids } = await seedLibrary([
      { file: 'a1.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' }
    ])
    db.prepare(`INSERT INTO collection (id, kind, name, naming_template, created_at) VALUES (?, 'ir_project', ?, ?, ?)`).run(
      'local-invented-uuid',
      'Session',
      'real-ir-lab-project-id',
      '2026-01-01T00:00:00.000Z'
    )
    db.prepare(`INSERT INTO collection_item (collection_id, item_id) VALUES (?, ?)`).run('local-invented-uuid', ids['a1.wav'])

    const rigs = getCoverageMatrix(db)
    expect(rigs[0].targetProjectId).toBe('real-ir-lab-project-id')

    db.close()
  })

  it('reports no target project for a rig with no linked IR Lab project', async () => {
    const { db } = await seedLibrary([
      { file: 'a1.wav', cabinet: 'Marshall 1960A', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' }
    ])

    const rigs = getCoverageMatrix(db)
    expect(rigs[0].targetProjectId).toBeNull()
    expect(rigs[0].targetProjectName).toBeNull()

    db.close()
  })

  it('skips items missing a cabinet or speaker entirely — nothing to attribute them to', async () => {
    const { db } = await seedLibrary([
      { file: 'a1.wav', cabinet: '', speaker: 'V30', microphone: 'SM57', micATargetZone: 'Cap Edge' }
    ])

    const rigs = getCoverageMatrix(db)
    expect(rigs).toEqual([])

    db.close()
  })
})

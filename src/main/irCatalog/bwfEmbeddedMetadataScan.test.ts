/**
 * End-to-end: a real scan of a real WAV carrying IR Lab's own BWF bext chunk must land
 * cabinet/speaker/microphone/position/capture_type/notes in the DB with source='ir_lab_embedded',
 * and must never let that downgrade an already-native or already-user-entered field. Writes
 * genuine WAV+bext bytes rather than mocking the parser, same reasoning as audioInfoScan.test.ts.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { applyVendorParsers } from './vendorParsers/applyVendorParsers'
import { queryItems } from './queryLibrary'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-bwf-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Real WAV bytes: RIFF/WAVE + bext (IR Lab's own bext layout) + fmt + data. */
function writeWavWithBext(
  path: string,
  opts: { sampleRate?: number; channels?: number; bitDepth?: number; seconds?: number; description: string; originator: string }
): void {
  const { sampleRate = 44100, channels = 1, bitDepth = 24, seconds = 0.1, description, originator } = opts
  const byteRate = (sampleRate * channels * bitDepth) / 8
  const dataBytes = Math.round(byteRate * seconds)

  const bextBody = Buffer.alloc(602)
  bextBody.write(description, 0, 'ascii')
  bextBody.write(originator, 256, 'ascii')
  const bext = Buffer.alloc(8 + bextBody.length)
  bext.write('bext', 0, 'ascii')
  bext.writeUInt32LE(bextBody.length, 4)
  bextBody.copy(bext, 8)

  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(channels, 10)
  fmt.writeUInt32LE(sampleRate, 12)
  fmt.writeUInt32LE(byteRate, 16)
  fmt.writeUInt16LE((channels * bitDepth) / 8, 20)
  fmt.writeUInt16LE(bitDepth, 22)

  const data = Buffer.alloc(8 + dataBytes)
  data.write('data', 0, 'ascii')
  data.writeUInt32LE(dataBytes, 4)

  const body = Buffer.concat([bext, fmt, data])
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8, 'ascii')
  fs.writeFileSync(path, Buffer.concat([riff, body]))
}

describe.skipIf(!hasFts5())('BWF-embedded capture metadata through a real scan', () => {
  it('lands cabinet/speaker/microphone/position/captureType/notes with source ir_lab_embedded', async () => {
    const root = makeTmpDir()
    writeWavWithBext(join(root, 'tagged.wav'), {
      description: 'Cabinet: Mesa 4x12 | Speaker: V30 | Microphone: SM57 | Position: Cap edge | Notes: bright | CaptureType: Hardware',
      originator: 'IR Lab'
    })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0].cabinet).toBe('Mesa 4x12')
    expect(rows[0].speaker).toBe('V30')
    expect(rows[0].microphone).toBe('SM57')

    const sources = db
      .prepare(`SELECT field, source FROM ir_item_field_source WHERE item_id = ?`)
      .all(rows[0].id) as Array<{ field: string; source: string }>
    expect(sources.find((s) => s.field === 'cabinet')?.source).toBe('ir_lab_embedded')

    const item = db.prepare(`SELECT notes FROM item WHERE id = ?`).get(rows[0].id) as { notes: string | null }
    expect(item.notes).toBe('bright')

    const irItem = db.prepare(`SELECT capture_type FROM ir_item WHERE item_id = ?`).get(rows[0].id) as { capture_type: string | null }
    expect(irItem.capture_type).toBe('Hardware')

    db.close()
  })

  it('ignores a bext chunk from anything other than IR Lab', async () => {
    const root = makeTmpDir()
    writeWavWithBext(join(root, 'foreign.wav'), { description: 'Cabinet: Should Not Land', originator: 'Some Other Tool' })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    expect(rows[0].cabinet).toBeNull()

    db.close()
  })

  it("a vendor-parser guess afterward never downgrades an ir_lab_embedded value", async () => {
    const root = makeTmpDir()
    // Filename alone would make the generic vocabulary parser guess a DIFFERENT speaker (Greenback)
    // than what the file's own embedded metadata says (V30) — the embedded value must survive.
    writeWavWithBext(join(root, 'Greenback SM57.wav'), {
      description: 'Cabinet: Mesa 4x12 | Speaker: V30',
      originator: 'IR Lab'
    })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    expect(rows[0].speaker).toBe('V30')
    expect(rows[0].speaker_source).toBe('ir_lab_embedded')

    db.close()
  })
})

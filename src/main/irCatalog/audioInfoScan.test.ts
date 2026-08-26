/**
 * End-to-end: a real scan of real .wav bytes must land WAV-header facts in the DB, expose them
 * through queryItems, make them filterable, and make them findable in the search box.
 *
 * Deliberately writes genuine WAV bytes rather than mocking the parser — the whole point of the
 * feature is that the scan reads the actual file, and a test that stubbed that away would pass
 * even if the header never reached the database.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { queryItems, countItems } from './queryLibrary'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-audioinfo-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function writeWav(
  path: string,
  { sampleRate, channels, bitDepth, seconds }: { sampleRate: number; channels: number; bitDepth: number; seconds: number }
): void {
  const byteRate = (sampleRate * channels * bitDepth) / 8
  const dataBytes = Math.round(byteRate * seconds)
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE((channels * bitDepth) / 8, 32)
  buf.writeUInt16LE(bitDepth, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  fs.writeFileSync(path, buf)
}

describe.skipIf(!hasFts5())('WAV header facts through a real scan', () => {
  it('stores rate/depth/channels/duration/format and returns them from queryItems', async () => {
    const root = makeTmpDir()
    writeWav(join(root, 'a.wav'), { sampleRate: 44100, channels: 1, bitDepth: 24, seconds: 0.5 })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0].sample_rate).toBe(44100)
    expect(rows[0].bit_depth).toBe(24)
    expect(rows[0].channels).toBe(1)
    expect(rows[0].audio_format).toBe('pcm')
    expect(rows[0].duration_seconds).toBeCloseTo(0.5, 3)

    db.close()
  })

  it('filters by sample rate, bit depth and channel count', async () => {
    const root = makeTmpDir()
    writeWav(join(root, '44k-mono.wav'), { sampleRate: 44100, channels: 1, bitDepth: 24, seconds: 0.2 })
    writeWav(join(root, '48k-stereo.wav'), { sampleRate: 48000, channels: 2, bitDepth: 16, seconds: 0.2 })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const base = { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 }

    expect(queryItems(db, { ...base, sampleRate: 44100 }).map((r) => r.display_name)).toEqual(['44k-mono.wav'])
    expect(queryItems(db, { ...base, bitDepth: 16 }).map((r) => r.display_name)).toEqual(['48k-stereo.wav'])
    expect(queryItems(db, { ...base, channels: 2 }).map((r) => r.display_name)).toEqual(['48k-stereo.wav'])
    expect(countItems(db, { libraryRootId: stats.libraryRootId, sampleRate: 48000 })).toBe(1)

    db.close()
  })

  it('makes the format searchable in the FTS index, in either spelling', async () => {
    const root = makeTmpDir()
    writeWav(join(root, 'cab.wav'), { sampleRate: 96000, channels: 2, bitDepth: 32, seconds: 0.1 })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const base = { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 }

    expect(queryItems(db, { ...base, search: '96k' })).toHaveLength(1)
    expect(queryItems(db, { ...base, search: '96000' })).toHaveLength(1)
    expect(queryItems(db, { ...base, search: '32-bit' })).toHaveLength(1)
    expect(queryItems(db, { ...base, search: 'stereo' })).toHaveLength(1)
    // A rate the file isn't must not match it.
    expect(queryItems(db, { ...base, search: '44.1k' })).toHaveLength(0)

    db.close()
  })

  it('re-scanning updates the same item row rather than orphaning its audio info', async () => {
    const root = makeTmpDir()
    const file = join(root, 'a.wav')
    writeWav(file, { sampleRate: 44100, channels: 1, bitDepth: 24, seconds: 0.2 })

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)
    const firstId = (db.prepare(`SELECT id FROM item`).get() as { id: string }).id

    // Same path, different format — the re-scan must overwrite in place.
    writeWav(file, { sampleRate: 48000, channels: 2, bitDepth: 16, seconds: 0.2 })
    await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    expect((db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) c FROM ir_item`).get() as { c: number }).c).toBe(1)
    expect((db.prepare(`SELECT id FROM item`).get() as { id: string }).id).toBe(firstId)

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    expect(rows[0].sample_rate).toBe(48000)
    expect(rows[0].channels).toBe(2)
    expect(rows[0].bit_depth).toBe(16)

    db.close()
  })

  it('a non-WAV file is imported without audio info instead of failing the scan', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'broken.wav'), 'this is definitely not a wav file')

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const rows = queryItems(db, { libraryRootId: stats.libraryRootId, offset: 0, limit: 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0].sample_rate).toBeNull()
    expect(rows[0].audio_format).toBeNull()

    db.close()
  })
})

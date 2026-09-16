import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { buildBwfDescription, embedBwfMetadata } from './wavMetadataWriter'
import { parseWavHeader } from './wavHeader'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'wav-metadata-writer-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** A minimal real WAV: RIFF/WAVE + fmt + a tiny data chunk — no bext, so every test exercises the
 * "insert a fresh chunk" full-rewrite path unless noted otherwise. */
function makeWavFile(dir: string, name: string): string {
  const fmt = Buffer.alloc(8 + 16)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8) // PCM
  fmt.writeUInt16LE(1, 10) // mono
  fmt.writeUInt32LE(44100, 12)
  fmt.writeUInt32LE(44100 * 2, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)

  const samples = Buffer.alloc(8) // 4 samples of silence
  const data = Buffer.alloc(8 + samples.length)
  data.write('data', 0, 'ascii')
  data.writeUInt32LE(samples.length, 4)
  samples.copy(data, 8)

  const body = Buffer.concat([fmt, data])
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8, 'ascii')
  const buf = Buffer.concat([riff, body])

  const path = join(dir, name)
  fs.writeFileSync(path, buf)
  return path
}

describe('buildBwfDescription', () => {
  it('joins only the fields that are set, in order, with " | "', () => {
    expect(buildBwfDescription({ cabinet: 'Mesa 4x12', speaker: 'V30', notes: 'nice and bright' })).toBe(
      'Cabinet: Mesa 4x12 | Speaker: V30 | Notes: nice and bright'
    )
  })

  it('omits blank/unset fields entirely rather than emitting an empty pair', () => {
    expect(buildBwfDescription({ cabinet: 'Mesa 4x12', speaker: null })).toBe('Cabinet: Mesa 4x12')
  })
})

describe('embedBwfMetadata', () => {
  it('embeds and round-trips plain ASCII metadata through parseWavHeader', () => {
    const dir = makeTmpDir()
    const path = makeWavFile(dir, 'plain.wav')

    const result = embedBwfMetadata(path, { cabinet: 'Mesa 4x12', speaker: 'V30' })
    expect(result.success).toBe(true)
    expect(result.truncatedDescription).toBe(false)

    const header = parseWavHeader(fs.readFileSync(path))
    expect(header!.bwfDescription).toBe('Cabinet: Mesa 4x12 | Speaker: V30')
    expect(header!.bwfOriginator).toBe('IR Lab')
  })

  it('round-trips non-ASCII text instead of silently corrupting it', () => {
    const dir = makeTmpDir()
    const path = makeWavFile(dir, 'unicode.wav')

    const result = embedBwfMetadata(path, { cabinet: 'Böhm 4x12', notes: 'ギター — “warm”' })
    expect(result.success).toBe(true)

    const header = parseWavHeader(fs.readFileSync(path))
    expect(header!.bwfDescription).toBe('Cabinet: Böhm 4x12 | Notes: ギター — “warm”')
  })

  it('never touches the audio data — the sample bytes are byte-identical after a full rewrite', () => {
    const dir = makeTmpDir()
    const path = makeWavFile(dir, 'audio-preserved.wav')
    const before = fs.readFileSync(path)
    const beforeData = before.subarray(before.length - 8) // this fixture's 8 sample bytes

    const result = embedBwfMetadata(path, { cabinet: 'Mesa 4x12' })
    expect(result.success).toBe(true)

    const after = fs.readFileSync(path)
    const afterData = after.subarray(after.length - 8)
    expect(afterData.equals(beforeData)).toBe(true)
  })

  it('patches an existing adequately-sized bext chunk in place without resizing the file', () => {
    const dir = makeTmpDir()
    const path = makeWavFile(dir, 'has-bext.wav')
    embedBwfMetadata(path, { cabinet: 'First' })
    const sizeAfterFirst = fs.statSync(path).size

    const result = embedBwfMetadata(path, { cabinet: 'Second' })
    expect(result.success).toBe(true)
    expect(fs.statSync(path).size).toBe(sizeAfterFirst) // patch-in-place, no resize

    const header = parseWavHeader(fs.readFileSync(path))
    expect(header!.bwfDescription).toBe('Cabinet: Second')
  })

  it('truncates a too-long description at a whole-character boundary, never mid multi-byte sequence', () => {
    const dir = makeTmpDir()
    const path = makeWavFile(dir, 'long-notes.wav')
    // Every character here is a 3-byte UTF-8 sequence (U+30AB..) — a naive byte-count slice would
    // very likely land mid-character. 100 of them is comfortably past the 256-byte field.
    const longNote = 'ｶ'.repeat(100)

    const result = embedBwfMetadata(path, { notes: longNote })
    expect(result.success).toBe(true)
    expect(result.truncatedDescription).toBe(true)

    const header = parseWavHeader(fs.readFileSync(path))
    // Every character in the stored text should be a WHOLE 'ｶ' — a split multi-byte sequence would
    // decode as the U+FFFD replacement character instead.
    expect(header!.bwfDescription).not.toContain('�')
    expect(Buffer.byteLength(header!.bwfDescription!, 'utf8')).toBeLessThanOrEqual(256)
  })

  it('fails cleanly on a non-WAV file rather than corrupting it', () => {
    const dir = makeTmpDir()
    const path = join(dir, 'not-a-wav.wav')
    fs.writeFileSync(path, 'this is not a wav file')

    const result = embedBwfMetadata(path, { cabinet: 'Mesa 4x12' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/RIFF\/WAVE/)
  })
})

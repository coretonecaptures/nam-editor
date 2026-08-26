import { describe, it, expect } from 'vitest'
import { parseWavHeader, describeWavHeader, formatSampleRate } from './wavHeader'

/** Builds a real, spec-shaped `bext` chunk (EBU Tech 3285): fixed-width ASCII fields, NUL-padded,
 * for the two IR Lab actually writes into. Field sizes match ir-lab's own WavIO.cpp/JUCE's
 * createBWAVMetadata layout: Description 256 bytes, Originator 32 bytes, then the rest of the
 * fixed 602-byte body zeroed (OriginatorReference/OriginationDate/etc. — irrelevant here). */
function makeBextChunk(description: string, originator: string): { id: string; size: number; body: Buffer } {
  const body = Buffer.alloc(602)
  body.write(description, 0, 'ascii')
  body.write(originator, 256, 'ascii')
  return { id: 'bext', size: body.length, body }
}

/** Builds a minimal but REAL wav header: RIFF/WAVE + fmt + data, optionally with extra chunks
 * ahead of fmt (which real vendor packs do contain — LIST/INFO, JUNK, bext). */
function makeWav(opts: {
  audioFormat?: number
  channels?: number
  sampleRate?: number
  bitDepth?: number
  dataBytes?: number
  leadingChunks?: Array<{ id: string; size: number; body?: Buffer }>
  byteRateOverride?: number
}): Buffer {
  const {
    audioFormat = 1,
    channels = 1,
    sampleRate = 44100,
    bitDepth = 24,
    dataBytes = 0,
    leadingChunks = []
  } = opts
  const byteRate = opts.byteRateOverride ?? (sampleRate * channels * bitDepth) / 8

  const lead = Buffer.concat(
    leadingChunks.map((c) => {
      const b = Buffer.alloc(8 + c.size + (c.size % 2))
      b.write(c.id, 0, 'ascii')
      b.writeUInt32LE(c.size, 4)
      if (c.body) c.body.copy(b, 8)
      return b
    })
  )

  const fmt = Buffer.alloc(8 + 16)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(audioFormat, 8)
  fmt.writeUInt16LE(channels, 10)
  fmt.writeUInt32LE(sampleRate, 12)
  fmt.writeUInt32LE(byteRate, 16)
  fmt.writeUInt16LE((channels * bitDepth) / 8, 20)
  fmt.writeUInt16LE(bitDepth, 22)

  const data = Buffer.alloc(8)
  data.write('data', 0, 'ascii')
  data.writeUInt32LE(dataBytes, 4)

  const body = Buffer.concat([lead, fmt, data])
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8, 'ascii')
  return Buffer.concat([riff, body])
}

describe('parseWavHeader', () => {
  it('reads format, rate, channels, bit depth and duration from a plain PCM header', () => {
    // 44100 * 1ch * 3 bytes = 132300 bytes/sec; 66150 bytes = 0.5s exactly.
    const h = parseWavHeader(makeWav({ dataBytes: 66150 }))
    expect(h).not.toBeNull()
    expect(h!.audioFormat).toBe('pcm')
    expect(h!.sampleRate).toBe(44100)
    expect(h!.channels).toBe(1)
    expect(h!.bitDepth).toBe(24)
    expect(h!.durationSeconds).toBeCloseTo(0.5, 6)
  })

  it('finds fmt even when other chunks come first — the reason offsets are not hard-coded', () => {
    const h = parseWavHeader(
      makeWav({ leadingChunks: [{ id: 'JUNK', size: 40 }, { id: 'bext', size: 60 }], dataBytes: 132300 })
    )
    expect(h).not.toBeNull()
    expect(h!.sampleRate).toBe(44100)
    expect(h!.durationSeconds).toBeCloseTo(1, 6)
  })

  it('handles an odd-sized leading chunk, which carries a pad byte', () => {
    const h = parseWavHeader(makeWav({ leadingChunks: [{ id: 'LIST', size: 13 }], sampleRate: 48000 }))
    expect(h).not.toBeNull()
    expect(h!.sampleRate).toBe(48000)
  })

  it('labels float and extensible formats distinctly from PCM', () => {
    expect(parseWavHeader(makeWav({ audioFormat: 3, bitDepth: 32 }))!.audioFormat).toBe('float')
    expect(parseWavHeader(makeWav({ audioFormat: 0xfffe }))!.audioFormat).toBe('extensible')
    expect(parseWavHeader(makeWav({ audioFormat: 7 }))!.audioFormat).toBe('fmt-7')
  })

  it('falls back to a computed byte rate when the file declares zero', () => {
    const h = parseWavHeader(makeWav({ byteRateOverride: 0, dataBytes: 132300 }))
    expect(h!.durationSeconds).toBeCloseTo(1, 6)
  })

  it('reports stereo channel counts', () => {
    const h = parseWavHeader(makeWav({ channels: 2, dataBytes: 264600 }))
    expect(h!.channels).toBe(2)
    expect(h!.durationSeconds).toBeCloseTo(1, 6)
  })

  it('returns null for non-WAV, truncated and empty buffers rather than throwing', () => {
    expect(parseWavHeader(Buffer.alloc(0))).toBeNull()
    expect(parseWavHeader(Buffer.from('not a wav file at all, just some bytes here'))).toBeNull()
    expect(parseWavHeader(makeWav({}).subarray(0, 20))).toBeNull()
  })

  it('does not hang or throw on a corrupt chunk size', () => {
    const buf = makeWav({ leadingChunks: [{ id: 'JUNK', size: 4 }] })
    buf.writeUInt32LE(0xfffffff0, 16) // absurd size on the leading chunk
    expect(() => parseWavHeader(buf)).not.toThrow()
  })

  it('has null bwfDescription/bwfOriginator when there is no bext chunk — the common case', () => {
    const h = parseWavHeader(makeWav({}))
    expect(h!.bwfDescription).toBeNull()
    expect(h!.bwfOriginator).toBeNull()
  })

  it('reads an IR Lab bext chunk regardless of what comes before it', () => {
    const bext = makeBextChunk('Cabinet: Mesa 4x12 | Speaker: V30', 'IR Lab')
    const h = parseWavHeader(makeWav({ leadingChunks: [{ id: 'JUNK', size: 20 }, bext] }))
    expect(h!.bwfDescription).toBe('Cabinet: Mesa 4x12 | Speaker: V30')
    expect(h!.bwfOriginator).toBe('IR Lab')
  })

  it('trims NUL padding rather than returning trailing garbage', () => {
    const bext = makeBextChunk('Short', 'IR Lab')
    const h = parseWavHeader(makeWav({ leadingChunks: [bext] }))
    expect(h!.bwfDescription).toBe('Short')
    expect(h!.bwfDescription!.length).toBe(5)
  })
})

describe('describeWavHeader', () => {
  it('renders the compact row summary', () => {
    expect(
      describeWavHeader({ sampleRate: 44100, bitDepth: 24, channels: 1, durationSeconds: 0.522 })
    ).toBe('44.1k · 24-bit · mono · 0.52s')
  })

  it('renders stereo and multi-channel', () => {
    expect(describeWavHeader({ sampleRate: 48000, bitDepth: 32, channels: 2, durationSeconds: 1 })).toBe(
      '48k · 32-bit · stereo · 1.00s'
    )
    expect(describeWavHeader({ sampleRate: 48000, bitDepth: 24, channels: 4, durationSeconds: null })).toBe(
      '48k · 24-bit · 4ch'
    )
  })

  it('omits whatever is unknown instead of showing blanks', () => {
    expect(describeWavHeader({ sampleRate: null, bitDepth: null, channels: null, durationSeconds: null })).toBe('')
    expect(describeWavHeader({ sampleRate: 96000, bitDepth: null, channels: null, durationSeconds: null })).toBe('96k')
  })
})

describe('formatSampleRate', () => {
  it('keeps a decimal only when one is needed', () => {
    expect(formatSampleRate(44100)).toBe('44.1k')
    expect(formatSampleRate(48000)).toBe('48k')
    expect(formatSampleRate(96000)).toBe('96k')
  })
})

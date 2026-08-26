/**
 * WAV header parsing — format, sample rate, bit depth, channels and duration.
 *
 * Deliberately parses from a Buffer the caller ALREADY has rather than opening the file itself:
 * `quickHash.ts` reads the first 64KB of every file during the scan to fingerprint it, and the
 * header lives in the first few hundred bytes of exactly that buffer. Parsing it there costs no
 * additional disk I/O at all, which matters at this library's scale (a real one measured 282K
 * files) — a second open+read per file just to learn the sample rate would be a whole extra pass
 * over the library for information we already had in hand.
 *
 * Chunks are walked rather than assumed to sit at fixed offsets: `fmt ` is conventionally at byte
 * 12, but the spec doesn't require it, and real vendor packs contain files with LIST/INFO or
 * JUNK/bext chunks ahead of it. A parser that hard-codes offset 12 silently misreads those.
 */

/** WAVE format tag values we distinguish. Anything else is reported as its raw numeric tag. */
const FORMAT_PCM = 1
const FORMAT_IEEE_FLOAT = 3
const FORMAT_EXTENSIBLE = 0xfffe

export interface WavHeader {
  /** 'pcm' | 'float' | 'extensible' | `fmt-<tag>` for anything else. */
  audioFormat: string
  sampleRate: number
  channels: number
  bitDepth: number
  /** Seconds, from the data chunk's declared size. Null when the data chunk header wasn't inside
   * the buffer we were given (very unusual — it implies >64KB of leading chunks). */
  durationSeconds: number | null
}

export function parseWavHeader(buf: Buffer): WavHeader | null {
  // Smallest meaningful header: RIFF(12) + fmt chunk header(8) + PCM fmt body(16).
  if (buf.length < 36) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null

  let offset = 12
  let audioFormat: string | null = null
  let sampleRate = 0
  let channels = 0
  let bitDepth = 0
  let byteRate = 0
  let dataBytes: number | null = null

  // 8 = chunk id (4) + chunk size (4); a chunk header must fit entirely for the walk to continue.
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)

    if (chunkId === 'fmt ' && offset + 8 + 16 <= buf.length) {
      const body = offset + 8
      const tag = buf.readUInt16LE(body)
      audioFormat =
        tag === FORMAT_PCM
          ? 'pcm'
          : tag === FORMAT_IEEE_FLOAT
            ? 'float'
            : tag === FORMAT_EXTENSIBLE
              ? 'extensible'
              : `fmt-${tag}`
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      byteRate = buf.readUInt32LE(body + 8)
      bitDepth = buf.readUInt16LE(body + 14)
    } else if (chunkId === 'data') {
      dataBytes = chunkSize
      // Everything after `data` is audio, not more chunk headers — stop rather than walking into
      // sample data and reading it as garbage chunk ids.
      break
    }

    // Chunk bodies are word-aligned: an odd size is followed by a single pad byte.
    offset += 8 + chunkSize + (chunkSize % 2)
    // A corrupt/absurd size would otherwise loop or run away; treat it as end-of-parse.
    if (chunkSize < 0 || offset <= 0) break
  }

  if (audioFormat === null || sampleRate <= 0 || channels <= 0) return null

  // byteRate is what the file itself declares; fall back to computing it when a writer left it
  // zero (seen in the wild) so duration doesn't silently become Infinity/NaN.
  const effectiveByteRate = byteRate > 0 ? byteRate : (sampleRate * channels * bitDepth) / 8
  const durationSeconds = dataBytes !== null && effectiveByteRate > 0 ? dataBytes / effectiveByteRate : null

  return { audioFormat, sampleRate, channels, bitDepth, durationSeconds }
}

export { describeWavHeader, formatSampleRate, wavSearchText } from '../../shared/wavFormat'

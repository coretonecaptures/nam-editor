/**
 * Writes IR Lab's own BWF `bext`-chunk capture metadata into a WAV file — the write-side
 * counterpart to `bwfCaptureMetadata.ts` (parser) / `wavHeader.ts` (chunk layout). Nothing in this
 * app wrote into a WAV's own bytes before this; see
 * docs/ir-metadata-full-parity-proposal-2026-09-13.md's G3 for why this exists at all (the
 * catalog's metadata doesn't travel with a file that leaves the tracked library) and its own risk
 * discussion (this is gated behind `AppSettings.irAllowEmbedMetadataInFile`, off by default —
 * see SettingsPanel.tsx's own warning copy).
 *
 * Format matches ir-lab's `WavIO.cpp::buildBwavMetadata` exactly (confirmed against that source in
 * IR Lab's own private source repo, not guessed) — "Key: value | Key: value | ..." in Description, Originator
 * fixed to "IR Lab" — so a file embedded here round-trips through IR Lab's own parser and vice
 * versa, rather than drifting into a second dialect of the same chunk.
 *
 * Never touches the `data` chunk (the actual audio samples): a patch-in-place when an
 * adequately-sized `bext` chunk already exists (pure byte-range overwrite, zero resize), otherwise
 * a full rewrite via a temp file + atomic rename (never truncate-and-rewrite the original in
 * place) that inserts a fresh chunk and streams the audio payload straight through untouched,
 * however large — the payload is never loaded into memory.
 */
import * as fs from 'node:fs'

export interface BwfEmbedFields {
  cabinet?: string | null
  speaker?: string | null
  microphone?: string | null
  position?: string | null
  captureType?: string | null
  micADistance?: number | null
  micADistanceUnit?: string | null
  notes?: string | null
}

/** BWF bext chunk layout (EBU Tech 3285) — fixed portion only, no CodingHistory (matches ir-lab's
 * own writer, which passes an empty history string). */
const BEXT_BODY_SIZE = 602
const DESC_OFFSET = 0
const DESC_LEN = 256
const ORIG_OFFSET = 256
const ORIG_LEN = 32
const ORIGINATOR = 'IR Lab'

/** Same "Key: value | ..." shape and field order as ir-lab's buildBwavMetadata, so this app and IR
 * Lab always read each other's embedded metadata identically. */
export function buildBwfDescription(fields: BwfEmbedFields): string {
  const parts: string[] = []
  if (fields.cabinet) parts.push(`Cabinet: ${fields.cabinet}`)
  if (fields.speaker) parts.push(`Speaker: ${fields.speaker}`)
  if (fields.microphone) parts.push(`Microphone: ${fields.microphone}`)
  if (fields.position) parts.push(`Position: ${fields.position}`)
  if (fields.captureType) parts.push(`CaptureType: ${fields.captureType}`)
  if (fields.micADistance) {
    parts.push(`MicADistance: ${fields.micADistance.toFixed(2)}${fields.micADistanceUnit || 'in'}`)
  }
  if (fields.notes) parts.push(`Notes: ${fields.notes}`)
  return parts.join(' | ')
}

function buildBextBody(descriptionAlreadyTruncated: string): Buffer {
  const body = Buffer.alloc(BEXT_BODY_SIZE) // zero-filled; every field this app doesn't set (dates, UMID, loudness, ...) stays zero, same as an unset/blank field elsewhere in this chunk
  const descBuf = Buffer.from(descriptionAlreadyTruncated, 'ascii')
  descBuf.copy(body, DESC_OFFSET, 0, Math.min(descBuf.length, DESC_LEN))
  const origBuf = Buffer.from(ORIGINATOR, 'ascii')
  origBuf.copy(body, ORIG_OFFSET, 0, Math.min(origBuf.length, ORIG_LEN))
  return body
}

export interface EmbedResult {
  success: boolean
  error?: string
  truncatedDescription?: boolean
}

/**
 * Chunk layout note: `bext` is BWF convention near the front of the file, well inside a modest
 * header read — 8MB is a generous cap for "haven't found `data` yet," which should never actually
 * be approached in practice (real header regions are a few hundred bytes to a few KB).
 */
const HEADER_READ_CAP = 8 * 1024 * 1024

export function embedBwfMetadata(absPath: string, fields: BwfEmbedFields): EmbedResult {
  const rawDescription = buildBwfDescription(fields)
  const truncatedDescription = rawDescription.length > DESC_LEN
  const description = rawDescription.slice(0, DESC_LEN)
  const newBody = buildBextBody(description)

  let fd: number | undefined
  try {
    fd = fs.openSync(absPath, 'r+')
    const stat = fs.fstatSync(fd)

    let buf = Buffer.alloc(Math.min(65536, stat.size))
    fs.readSync(fd, buf, 0, buf.length, 0)
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
      return { success: false, error: 'Not a RIFF/WAVE file.' }
    }

    const ensure = (need: number): boolean => {
      if (need <= buf.length) return true
      if (need > HEADER_READ_CAP || need > stat.size) return false
      const grown = Buffer.alloc(Math.min(HEADER_READ_CAP, Math.max(need, buf.length * 2)))
      fs.readSync(fd!, grown, 0, grown.length, 0)
      buf = grown
      return true
    }

    let offset = 12
    let fmtEnd = -1
    let bextOffset = -1
    let bextBodyOffset = -1
    let bextChunkSize = -1
    let dataOffset = -1

    while (ensure(offset + 8)) {
      const chunkId = buf.toString('ascii', offset, offset + 4)
      const chunkSize = buf.readUInt32LE(offset + 4)
      if (chunkSize < 0) return { success: false, error: 'Corrupt chunk size while parsing the WAV header.' }
      if (chunkId === 'fmt ') fmtEnd = offset + 8 + chunkSize + (chunkSize % 2)
      if (chunkId === 'bext') {
        bextOffset = offset
        bextBodyOffset = offset + 8
        bextChunkSize = chunkSize
      }
      if (chunkId === 'data') {
        dataOffset = offset
        break
      }
      offset += 8 + chunkSize + (chunkSize % 2)
    }

    if (dataOffset === -1) return { success: false, error: 'Could not find the audio data chunk within a reasonable header size.' }
    if (fmtEnd === -1) return { success: false, error: 'Could not find the fmt chunk.' }
    if (!ensure(dataOffset)) return { success: false, error: 'Header region too large to parse safely.' }

    if (bextOffset !== -1 && bextChunkSize >= BEXT_BODY_SIZE) {
      // Patch in place — pure byte-range overwrite. Never touches chunk size/position or anything
      // after it, so this can't disturb the data chunk regardless of file size.
      fs.writeSync(fd, newBody, 0, newBody.length, bextBodyOffset)
      return { success: true, truncatedDescription }
    }

    // No existing bext chunk (or one too small to hold the fixed body) — full rewrite via a temp
    // file + atomic rename, same "never leave the original half-written" discipline this app's
    // .nam patcher already follows for a different file format.
    const bextChunkHeader = Buffer.alloc(8)
    bextChunkHeader.write('bext', 0, 'ascii')
    bextChunkHeader.writeUInt32LE(BEXT_BODY_SIZE, 4)
    const newBextChunk = Buffer.concat([bextChunkHeader, newBody])

    const tmpPath = `${absPath}.embedtmp`
    const outFd = fs.openSync(tmpPath, 'w')
    try {
      // RIFF header (12 bytes) — the size field (bytes 4-8) gets patched once the final size is
      // known, after this file is fully written.
      fs.writeSync(outFd, buf, 0, 12, 0)
      // fmt chunk (and anything preceding it, in the unusual case something does) verbatim.
      fs.writeSync(outFd, buf, 12, fmtEnd - 12)
      fs.writeSync(outFd, newBextChunk)
      // Every remaining chunk between fmt and data EXCEPT the old bext (if present), verbatim.
      if (bextOffset !== -1) {
        if (bextOffset > fmtEnd) fs.writeSync(outFd, buf, fmtEnd, bextOffset - fmtEnd)
        const afterOldBext = bextOffset + 8 + bextChunkSize + (bextChunkSize % 2)
        if (dataOffset > afterOldBext) fs.writeSync(outFd, buf, afterOldBext, dataOffset - afterOldBext)
      } else {
        fs.writeSync(outFd, buf, fmtEnd, dataOffset - fmtEnd)
      }
      // The data chunk and everything after it (the actual audio) — streamed straight from the
      // original file, never loaded into memory regardless of how large the IR is.
      const CHUNK = 1024 * 1024
      const tail = Buffer.alloc(CHUNK)
      let pos = dataOffset
      while (pos < stat.size) {
        const toRead = Math.min(CHUNK, stat.size - pos)
        const read = fs.readSync(fd, tail, 0, toRead, pos)
        if (read <= 0) break
        fs.writeSync(outFd, tail, 0, read)
        pos += read
      }
    } finally {
      fs.closeSync(outFd)
    }

    const finalSize = fs.statSync(tmpPath).size
    const sizeFd = fs.openSync(tmpPath, 'r+')
    try {
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeUInt32LE(finalSize - 8, 0)
      fs.writeSync(sizeFd, sizeBuf, 0, 4, 4)
    } finally {
      fs.closeSync(sizeFd)
    }

    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmpPath, absPath)
    return { success: true, truncatedDescription }
  } catch (err) {
    return { success: false, error: String(err) }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

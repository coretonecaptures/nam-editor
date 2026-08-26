/**
 * Pure WAV-format formatting shared by BOTH processes.
 *
 * Lives in src/shared (included by tsconfig.web.json AND tsconfig.node.json) because the main
 * process needs it at scan time to build the search text, and the renderer needs the identical
 * wording to display on a row. Duplicating a "format a sample rate" helper across the process
 * boundary is exactly how the two drift — one says "44.1k" while the other indexes "44100" — so
 * it's defined once here instead. Nothing in this file may import from electron, node: builtins,
 * or React: it has to be loadable from either side.
 */
/** "44.1k · 24-bit · mono · 0.52s" — the compact one-line summary shown on a browse row. Built
 * here rather than in the renderer so the same wording is available anywhere it's needed. */
export function describeWavHeader(h: {
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  durationSeconds: number | null
}): string {
  const parts: string[] = []
  if (h.sampleRate) parts.push(formatSampleRate(h.sampleRate))
  if (h.bitDepth) parts.push(`${h.bitDepth}-bit`)
  if (h.channels) parts.push(h.channels === 1 ? 'mono' : h.channels === 2 ? 'stereo' : `${h.channels}ch`)
  if (h.durationSeconds) parts.push(`${h.durationSeconds.toFixed(2)}s`)
  return parts.join(' · ')
}

/** 44100 -> "44.1k", 48000 -> "48k", 96000 -> "96k". */
export function formatSampleRate(rate: number): string {
  const k = rate / 1000
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
}

/**
 * The text indexed into `item_search.audio`, so the search box finds files by format.
 *
 * Built here, in TypeScript, rather than assembled in `finalizeIndexes`' SQL: an earlier version
 * did the string math in SQLite and produced "96.0k" for 96000 (integer division dressed up as a
 * float), which FTS5 tokenizes as "96" + "0k" — so searching "96k" matched nothing. Keeping the
 * formatting in one place next to `formatSampleRate` removes that whole class of mismatch between
 * what's displayed and what's indexed.
 *
 * Each fact is written in both spellings a person might type: "44.1k" and "44100", "24-bit" and
 * "24bit". FTS5's default tokenizer splits on punctuation, so "24-bit" indexes as `24` + `bit`
 * and a query of "24-bit" becomes the same two tokens ANDed — they match.
 */
export function wavSearchText(h: {
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  audioFormat: string | null
}): string {
  const parts: string[] = []
  if (h.sampleRate) parts.push(formatSampleRate(h.sampleRate), String(h.sampleRate))
  if (h.bitDepth) parts.push(`${h.bitDepth}-bit`, `${h.bitDepth}bit`)
  if (h.channels) parts.push(h.channels === 1 ? 'mono' : h.channels === 2 ? 'stereo' : `${h.channels}ch`)
  if (h.audioFormat) parts.push(h.audioFormat)
  return parts.join(' ')
}

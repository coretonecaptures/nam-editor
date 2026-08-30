/**
 * nam-lab-result.json — the one-way status file NAM Lab writes once it has trained a model from
 * an IR Lab NAM Capture. docs/nam-capture-import-plan-2026-08-29.md §3.
 *
 * schemaVersion 2 layout: the sidecar sits NEXT TO the recording WAV, named after the capture —
 * `<dir>/<CaptureName>.nam-lab-result.json` beside `<dir>/<CaptureName>.wav` and
 * `<dir>/<CaptureName>.nam-capture.json` — not inside a per-capture folder. Both helpers take the
 * recording WAV path and derive the sidecar name from it.
 *
 * Single-writer by design: ONLY this app writes it, and only from the trainer-completion hook
 * (src/main/index.ts, sourceMode === 'nam-capture-import'). IR Lab may read it for its own
 * "trained" badge but never writes it. Presence = trained, absence = untrained.
 */
import * as fs from 'node:fs'
import { dirname, join, basename, extname } from 'node:path'

export const NAM_LAB_RESULT_SUFFIX = '.nam-lab-result.json'
export const NAM_LAB_RESULT_SCHEMA_VERSION = 1

export interface NamLabResult {
  schemaVersion: number
  trainedAt: string
  modelName: string
  architecture: string // 'a1' | 'a2' in practice, stored verbatim
  validationEsr: number | null
  outputModelPath: string
  trainerJobId: string
}

/** `<dir>/<CaptureName>.nam-lab-result.json` for a given recording WAV path. */
export function namLabResultPathFor(recordingWavPath: string): string {
  const stem = basename(recordingWavPath, extname(recordingWavPath))
  return join(dirname(recordingWavPath), `${stem}${NAM_LAB_RESULT_SUFFIX}`)
}

/** Parsed result, or null when the sidecar is absent or unreadable/corrupt (treated as "not
 * trained" — a corrupt sidecar must never make a capture look trained). */
export function readNamLabResult(recordingWavPath: string): NamLabResult | null {
  try {
    const raw = fs.readFileSync(namLabResultPathFor(recordingWavPath), 'utf8')
    const parsed = JSON.parse(raw) as Partial<NamLabResult>
    if (!parsed || typeof parsed.trainedAt !== 'string') return null
    return {
      schemaVersion: parsed.schemaVersion ?? NAM_LAB_RESULT_SCHEMA_VERSION,
      trainedAt: parsed.trainedAt,
      modelName: parsed.modelName ?? '',
      architecture: parsed.architecture ?? '',
      validationEsr: typeof parsed.validationEsr === 'number' ? parsed.validationEsr : null,
      outputModelPath: parsed.outputModelPath ?? '',
      trainerJobId: parsed.trainerJobId ?? ''
    }
  } catch {
    return null
  }
}

/** Writes (or overwrites) the sidecar beside the recording WAV. Best-effort: a failure here must
 * never fail the training run that produced the model — the caller logs and moves on. */
export function writeNamLabResult(recordingWavPath: string, result: Omit<NamLabResult, 'schemaVersion'>): void {
  const payload: NamLabResult = { schemaVersion: NAM_LAB_RESULT_SCHEMA_VERSION, ...result }
  fs.writeFileSync(namLabResultPathFor(recordingWavPath), JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

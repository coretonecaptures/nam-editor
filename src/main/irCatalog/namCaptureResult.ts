/**
 * nam-lab-result.json — the one-way status file NAM Lab writes once it has trained a model from
 * an IR Lab NAM Capture. docs/nam-capture-import-plan-2026-08-29.md §3,
 * docs/nam-projects-detail-design-2026-08-31.md §6.
 *
 * Layout: sits NEXT TO the recording WAV, named after the capture —
 * `<dir>/<CaptureName>.nam-lab-result.json` beside `<dir>/<CaptureName>.wav`. Both helpers take
 * the recording WAV path and derive the sidecar name from it.
 *
 * Single-writer by design: ONLY this app writes it, and only from the trainer-completion hook
 * (src/main/index.ts, sourceMode === 'nam-capture-import') — plus relinkNamLabResult below, which
 * only rewrites outputModelPath when the user points NAM Lab at a moved model file. IR Lab may
 * read it for its own "trained" badge but never writes it. Presence = trained, absence = untrained.
 *
 * schemaVersion 2 (2026-08-31) adds graphPath / validationEsrFull / validationEsrLite /
 * sourceCaptureId so the NAM Projects detail view has the training graph and A2 sub-model ESRs
 * without reaching into the (capped, pruned) trainer history.
 */
import * as fs from 'node:fs'
import { dirname, join, basename, extname } from 'node:path'

export const NAM_LAB_RESULT_SUFFIX = '.nam-lab-result.json'
export const NAM_LAB_RESULT_SCHEMA_VERSION = 2

export interface NamLabResult {
  schemaVersion: number
  trainedAt: string
  modelName: string
  architecture: string // 'a1' | 'a2' in practice, stored verbatim
  validationEsr: number | null
  /** A2 only — the Full (channels_8) and Lite (channels_3) sub-model ESRs. */
  validationEsrFull: number | null
  validationEsrLite: number | null
  outputModelPath: string
  /** Training-loss plot PNG the trainer promoted for this run, if any. */
  graphPath: string | null
  trainerJobId: string
  /** The IR Lab capture id this model was trained from — also embedded in the .nam's
   * metadata.nam_lab.source_capture_id, so a future model-library scan can match by id. */
  sourceCaptureId: string | null
}

/** `<dir>/<CaptureName>.nam-lab-result.json` for a given recording WAV path. */
export function namLabResultPathFor(recordingWavPath: string): string {
  const stem = basename(recordingWavPath, extname(recordingWavPath))
  return join(dirname(recordingWavPath), `${stem}${NAM_LAB_RESULT_SUFFIX}`)
}

/** Parsed result, or null when the sidecar is absent or unreadable/corrupt (treated as "not
 * trained" — a corrupt sidecar must never make a capture look trained). Absent v2 fields read
 * back null (a v1 sidecar parses fine). */
export function readNamLabResult(recordingWavPath: string): NamLabResult | null {
  try {
    const raw = fs.readFileSync(namLabResultPathFor(recordingWavPath), 'utf8')
    const parsed = JSON.parse(raw) as Partial<NamLabResult>
    if (!parsed || typeof parsed.trainedAt !== 'string') return null
    return {
      schemaVersion: parsed.schemaVersion ?? 1,
      trainedAt: parsed.trainedAt,
      modelName: parsed.modelName ?? '',
      architecture: parsed.architecture ?? '',
      validationEsr: typeof parsed.validationEsr === 'number' ? parsed.validationEsr : null,
      validationEsrFull: typeof parsed.validationEsrFull === 'number' ? parsed.validationEsrFull : null,
      validationEsrLite: typeof parsed.validationEsrLite === 'number' ? parsed.validationEsrLite : null,
      outputModelPath: parsed.outputModelPath ?? '',
      graphPath: typeof parsed.graphPath === 'string' && parsed.graphPath ? parsed.graphPath : null,
      trainerJobId: parsed.trainerJobId ?? '',
      sourceCaptureId: typeof parsed.sourceCaptureId === 'string' && parsed.sourceCaptureId ? parsed.sourceCaptureId : null
    }
  } catch {
    return null
  }
}

/** Writes (or overwrites) the sidecar beside the recording WAV. The v2 fields
 * (validationEsrFull/Lite, graphPath, sourceCaptureId) are optional and default to null.
 * Best-effort: a failure here must never fail the training run that produced the model. */
export function writeNamLabResult(
  recordingWavPath: string,
  result: Omit<NamLabResult, 'schemaVersion' | 'validationEsrFull' | 'validationEsrLite' | 'graphPath' | 'sourceCaptureId'> &
    Partial<Pick<NamLabResult, 'validationEsrFull' | 'validationEsrLite' | 'graphPath' | 'sourceCaptureId'>>
): void {
  const payload: NamLabResult = {
    schemaVersion: NAM_LAB_RESULT_SCHEMA_VERSION,
    validationEsrFull: null,
    validationEsrLite: null,
    graphPath: null,
    sourceCaptureId: null,
    ...result
  }
  fs.writeFileSync(namLabResultPathFor(recordingWavPath), JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

/** Point an existing result sidecar at a moved/renamed .nam. Returns the updated result, or null
 * if there's no sidecar to relink. */
export function relinkNamLabResult(recordingWavPath: string, newOutputModelPath: string): NamLabResult | null {
  const current = readNamLabResult(recordingWavPath)
  if (!current) return null
  const updated: NamLabResult = { ...current, outputModelPath: newOutputModelPath }
  fs.writeFileSync(namLabResultPathFor(recordingWavPath), JSON.stringify(updated, null, 2) + '\n', 'utf8')
  return updated
}

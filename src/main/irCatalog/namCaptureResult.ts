/**
 * nam-lab-result.json — the one-way status file NAM Lab writes next to each IR Lab NAM Capture
 * once it has trained a model from that capture. docs/nam-capture-import-plan-2026-08-29.md §3.
 *
 * Single-writer by design: ONLY this app ever writes it, and only from the trainer-completion
 * hook (src/main/index.ts, sourceMode === 'nam-capture-import'). IR Lab may read it later for its
 * own "trained" badge but never writes it — zero coupling beyond this one JSON file, no shared
 * DB, no IPC. Presence = trained, absence = untrained.
 */
import * as fs from 'node:fs'
import { join } from 'node:path'

export const NAM_LAB_RESULT_FILENAME = 'nam-lab-result.json'
export const NAM_LAB_RESULT_SCHEMA_VERSION = 1

export interface NamLabResult {
  schemaVersion: number
  trainedAt: string
  modelName: string
  architecture: string // 'a1' | 'a2' in practice, but stored verbatim
  validationEsr: number | null
  outputModelPath: string
  trainerJobId: string
}

/** Returns the parsed result, or null when the file is absent or unreadable/corrupt (treated as
 * "not trained" — a corrupt sidecar must never make a capture look trained). */
export function readNamLabResult(captureFolderPath: string): NamLabResult | null {
  try {
    const raw = fs.readFileSync(join(captureFolderPath, NAM_LAB_RESULT_FILENAME), 'utf8')
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

/** Writes (or overwrites) the sidecar. Best-effort: a failure here must never fail the training
 * run that produced the model — the caller logs and moves on. */
export function writeNamLabResult(captureFolderPath: string, result: Omit<NamLabResult, 'schemaVersion'>): void {
  const payload: NamLabResult = { schemaVersion: NAM_LAB_RESULT_SCHEMA_VERSION, ...result }
  fs.writeFileSync(join(captureFolderPath, NAM_LAB_RESULT_FILENAME), JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

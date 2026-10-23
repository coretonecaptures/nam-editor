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
import { createHash } from 'node:crypto'
import { dirname, join, basename, extname, relative, resolve, isAbsolute } from 'node:path'

export const NAM_LAB_RESULT_SUFFIX = '.nam-lab-result.json'
export const NAM_LAB_RESULT_SCHEMA_VERSION = 2

export interface NamLabResult {
  schemaVersion: number
  trainedAt: string
  modelName: string
  architecture: string // the trainer architecture id ('standard', 'lite', 'a2', ...); 'a1'/'a2' in older files
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
  /** Every model trained from this capture, one per architecture (2026-10-23). The top-level
   * fields are the most recent one, which is all IR Lab reads; before this a preset that trains
   * several architectures left only the last to finish on record. Absent in older files. */
  models?: NamLabResultModel[]
  /** The model inside the capture's own project, relative to the recording's folder ('/'-separated,
   * e.g. "../Trained Models/Clean.nam"). Travels with the project, unlike outputModelPath. Null
   * when no copy could be made. */
  projectModelPath?: string | null
}

export interface NamLabResultModel {
  architecture: string
  modelName: string
  outputModelPath: string
  validationEsr: number | null
  trainedAt: string
  trainerJobId: string
  projectModelPath?: string | null
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
      sourceCaptureId: typeof parsed.sourceCaptureId === 'string' && parsed.sourceCaptureId ? parsed.sourceCaptureId : null,
      models: Array.isArray(parsed.models) ? parsed.models.filter(isModelEntry) : undefined,
      projectModelPath: typeof parsed.projectModelPath === 'string' && parsed.projectModelPath ? parsed.projectModelPath : null
    }
  } catch {
    return null
  }
}

function isModelEntry(v: unknown): v is NamLabResultModel {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return typeof m.architecture === 'string' && typeof m.outputModelPath === 'string'
}

/** Temp file + rename, so IR Lab (which reads this to show TRAINED) never sees half a file. */
function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, path)
}

/** Writes the sidecar beside the recording WAV. The v2 fields (validationEsrFull/Lite, graphPath,
 * sourceCaptureId) are optional and default to null. The top level is this run; `models` keeps
 * one entry per architecture from earlier runs of the SAME capture (a different capture id, e.g.
 * a re-take reusing the file name, starts the list over). Best-effort: a failure here must never
 * fail the training run that produced the model. */
export function writeNamLabResult(
  recordingWavPath: string,
  result: Omit<NamLabResult, 'schemaVersion' | 'validationEsrFull' | 'validationEsrLite' | 'graphPath' | 'sourceCaptureId' | 'models' | 'projectModelPath'> &
    Partial<Pick<NamLabResult, 'validationEsrFull' | 'validationEsrLite' | 'graphPath' | 'sourceCaptureId' | 'projectModelPath'>>
): void {
  const previous = readNamLabResult(recordingWavPath)
  const sameCapture = previous != null && previous.sourceCaptureId === (result.sourceCaptureId ?? null)
  const earlier: NamLabResultModel[] = !sameCapture
    ? []
    : previous.models ??
      (previous.outputModelPath
        ? [{ architecture: previous.architecture, modelName: previous.modelName, outputModelPath: previous.outputModelPath,
             validationEsr: previous.validationEsr, trainedAt: previous.trainedAt, trainerJobId: previous.trainerJobId }]
        : [])
  const current: NamLabResultModel = {
    architecture: result.architecture,
    modelName: result.modelName,
    outputModelPath: result.outputModelPath,
    validationEsr: result.validationEsr,
    trainedAt: result.trainedAt,
    trainerJobId: result.trainerJobId,
    projectModelPath: result.projectModelPath ?? null
  }
  const payload: NamLabResult = {
    schemaVersion: NAM_LAB_RESULT_SCHEMA_VERSION,
    validationEsrFull: null,
    validationEsrLite: null,
    graphPath: null,
    sourceCaptureId: null,
    ...result,
    models: [...earlier.filter((m) => m.architecture !== current.architecture), current]
  }
  writeAtomically(namLabResultPathFor(recordingWavPath), JSON.stringify(payload, null, 2) + '\n')
}

/** Point an existing result sidecar at a moved/renamed .nam. Returns the updated result, or null
 * if there's no sidecar to relink. */
export function relinkNamLabResult(recordingWavPath: string, newOutputModelPath: string): NamLabResult | null {
  const current = readNamLabResult(recordingWavPath)
  if (!current) return null
  const updated: NamLabResult = {
    ...current,
    outputModelPath: newOutputModelPath,
    models: current.models?.map((m) => (m.outputModelPath === current.outputModelPath ? { ...m, outputModelPath: newOutputModelPath } : m))
  }
  writeAtomically(namLabResultPathFor(recordingWavPath), JSON.stringify(updated, null, 2) + '\n')
  return updated
}

// ── Training status for IR Lab (2026-10-23) ─────────────────────────────────────────────────────
// `<dir>/<CaptureName>.nam-lab-status.json` beside the recording, while a capture is queued,
// training, or its last run failed: { schemaVersion, state, jobId, sourceCaptureId, message,
// updatedAt }. Removed when nothing is pending and the last run did not fail (a finished run is
// the result file above). Written whenever the training queue changes state.

export const NAM_LAB_STATUS_SUFFIX = '.nam-lab-status.json'

export type CaptureTrainingState = 'queued' | 'training' | 'failed'

export interface CaptureTrainingJob {
  jobId: string
  status: string
  outputPath: string
  sourceMode?: string
  error?: string
  finishedAt?: string | null
  namCaptureId?: string | null
}

export interface CaptureTrainingStatus {
  state: CaptureTrainingState
  jobId: string
  sourceCaptureId: string | null
  message: string
}

export function namLabStatusPathFor(recordingWavPath: string): string {
  const stem = basename(recordingWavPath, extname(recordingWavPath))
  return join(dirname(recordingWavPath), `${stem}${NAM_LAB_STATUS_SUFFIX}`)
}

/** One state per IR Lab capture recording, from every queue job trained from it. Training beats
 * queued beats a failed last run; a capture whose jobs all finished well (or were cancelled) has
 * no entry. Pure, for the tests. */
export function captureTrainingStates(jobs: CaptureTrainingJob[]): Map<string, CaptureTrainingStatus> {
  const byRecording = new Map<string, CaptureTrainingJob[]>()
  for (const job of jobs) {
    if (job.sourceMode !== 'nam-capture-import' || !job.outputPath) continue
    byRecording.set(job.outputPath, [...(byRecording.get(job.outputPath) ?? []), job])
  }
  const out = new Map<string, CaptureTrainingStatus>()
  for (const [recording, list] of byRecording) {
    const pick = (statuses: string[]) => list.find((j) => statuses.includes(j.status))
    const running = pick(['starting', 'running'])
    const waiting = pick(['queued', 'staged'])
    const finished = list
      .filter((j) => ['success', 'error', 'canceled'].includes(j.status))
      .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''))
    const last = finished[finished.length - 1]
    const chosen = running
      ? { job: running, state: 'training' as const }
      : waiting
        ? { job: waiting, state: 'queued' as const }
        : last?.status === 'error'
          ? { job: last, state: 'failed' as const }
          : null
    if (!chosen) continue
    out.set(recording, {
      state: chosen.state,
      jobId: chosen.job.jobId,
      sourceCaptureId: chosen.job.namCaptureId ?? null,
      message: chosen.state === 'failed' ? (chosen.job.error ?? '').split('\n')[0].trim().slice(0, 200) : ''
    })
  }
  return out
}

/** Writes / removes the status files to match `jobs`. `written` remembers which recordings have a
 * file from this app, so one whose jobs left the queue is cleared. Best-effort: never throws. */
export function syncCaptureTrainingStatusFiles(jobs: CaptureTrainingJob[], written: Set<string>, now = new Date()): void {
  const states = captureTrainingStates(jobs)
  for (const [recording, status] of states) {
    try {
      writeAtomically(
        namLabStatusPathFor(recording),
        JSON.stringify({ schemaVersion: 1, ...status, updatedAt: now.toISOString() }, null, 2) + '\n'
      )
      written.add(recording)
    } catch {
      // capture folder gone or read-only: nothing to tell IR Lab there
    }
  }
  for (const recording of [...written]) {
    if (states.has(recording)) continue
    fs.rmSync(namLabStatusPathFor(recording), { force: true })
    written.delete(recording)
  }
}

// ── The model's copy in the capture's project (2026-10-23) ──────────────────────────────────────

function sha256Of(path: string): string {
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

/**
 * Makes sure a trained model lives inside the capture's own project and returns where, relative to
 * the recording's folder ('/'-separated, e.g. "../Trained Models/Clean.nam"), so it travels with the
 * project. The project is the folder holding the recording's folder (IR Lab: <project>/NAM
 * Captures/<capture>.wav). A model already inside it (the Train dialog's default output folder) is
 * only referenced, never copied: a second copy would show twice in the library. One outside it is
 * copied to <project>/Trained Models/<architecture>/<file>: temp file, SHA-256 checked against the
 * source, then renamed, so a half copy never replaces a good one. Null when that fails
 * (best-effort: the model itself is unaffected).
 */
export function copyModelIntoCaptureFolder(recordingWavPath: string, modelPath: string, architecture: string): string | null {
  try {
    const recordingFolder = dirname(recordingWavPath)
    const projectRoot = dirname(recordingFolder)
    const toPosix = (p: string): string => p.split(/[\\/]+/).join('/')
    const real = (p: string): string => {
      try {
        return fs.realpathSync(p)
      } catch {
        return resolve(p)
      }
    }
    const inside = relative(real(projectRoot), real(modelPath))
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) return toPosix(relative(real(recordingFolder), real(modelPath)))

    const folder = (architecture || 'model').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'model'
    const target = join(projectRoot, 'Trained Models', folder, basename(modelPath))
    fs.mkdirSync(dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    fs.copyFileSync(modelPath, tmp)
    if (sha256Of(tmp) !== sha256Of(modelPath)) {
      fs.rmSync(tmp, { force: true })
      return null
    }
    fs.renameSync(tmp, target)
    return toPosix(relative(recordingFolder, target))
  } catch {
    return null
  }
}

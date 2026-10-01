/**
 * IR Lab NAM Capture -> trainer payloads (docs/nam-capture-import-plan-2026-08-29.md §4).
 *
 * Extracted from index.ts so it can be unit-tested without booting Electron. The mirror image of
 * buildTrainerPayloadsForProfile: that one loops one shared DI (`inputPath`) against many
 * `outputPath`s; here every capture brings its OWN excitation+recording pair, so pairing is
 * per-item and the DI can't be hoisted out of the loop.
 *
 * Pure except for an on-disk existence check on each pair. Everything index.ts holds as
 * module-level trainer state (the `trainerConfigured*` vars, the capture-profile lookup) is
 * passed in via `defaults` / `resolveProfile`.
 */
import * as fs from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { NamCaptureNameConflict } from '../shared/namProjects'
import type { TrainerHistoryEntry, TrainerStartPayload, WaveNetConfig } from '../shared/trainer'

export interface NamCaptureImportItem {
  excitationPath: string
  recordingPath: string
  captureId: string
  captureName: string
  captureFolderPath: string
  projectName: string
  synthetic: boolean
  // schemaVersion 2: calibration dBu -> the .nam's input/output_level_dbu (wanted pre-train);
  // modelMetadataSuggested hints -> seeded into the .nam post-train. All optional.
  inputLevelDbu?: number | null
  outputLevelDbu?: number | null
  suggested?: {
    modeledBy?: string | null
    gearMake?: string | null
    gearModel?: string | null
    gearType?: string | null
    toneType?: string | null
  } | null
}

export interface NamCaptureImportConfig {
  pythonPath: string
  finalModelRoot: string
  architecture: string
  epochs: number
  thresholdEsr: number | null
  latency: number | null
  includeSynthetic: boolean
  /** When set, every built payload carries this submission so the jobs group as one named batch. */
  submission?: { id: string; label: string; createdAt: string }
}

/** The trainer-tab "configured" defaults a payload falls back to when the capture itself has no value. */
export interface NamCaptureImportDefaults {
  normalizeWav: boolean
  normalizeWavTargetDb: number
  modeledBy: string | null
  inputLevelDbu: number | null
  outputLevelDbu: number | null
}

export type CaptureProfileConfig = {
  waveNetConfig: WaveNetConfig
  lr: number
  lrDecay: number
  batchSize: number
  ny: number
  fitMrstft: boolean
}

/** Resolve an architecture id to its WaveNet/optimiser config, or null (A2 / unknown). */
export type ProfileResolver = (architecture: string) => CaptureProfileConfig | null

export interface BuildResult {
  payloads: TrainerStartPayload[]
  /** Per-capture reasons a capture produced no payload — surfaced by the caller / asserted in tests. */
  skipped: Array<{ captureName: string; reason: 'synthetic' | 'missing-path' | 'not-on-disk' }>
}

async function existsOnDisk(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

export async function buildNamCaptureImportPayloads(
  captures: NamCaptureImportItem[],
  config: NamCaptureImportConfig,
  defaults: NamCaptureImportDefaults,
  resolveProfile: ProfileResolver
): Promise<BuildResult> {
  const payloads: TrainerStartPayload[] = []
  const skipped: BuildResult['skipped'] = []

  const pythonPath = config.pythonPath.trim()
  const finalModelRoot = config.finalModelRoot.trim()
  if (!pythonPath || !finalModelRoot || !config.architecture) return { payloads, skipped }

  const isA2 = config.architecture === 'a2'
  const profileCfg = isA2 ? null : resolveProfile(config.architecture)

  for (const capture of captures) {
    if (capture.synthetic && !config.includeSynthetic) {
      skipped.push({ captureName: capture.captureName, reason: 'synthetic' })
      continue
    }
    const excitationPath = capture.excitationPath?.trim()
    const recordingPath = capture.recordingPath?.trim()
    if (!excitationPath || !recordingPath) {
      skipped.push({ captureName: capture.captureName, reason: 'missing-path' })
      continue
    }
    if (!(await existsOnDisk(excitationPath)) || !(await existsOnDisk(recordingPath))) {
      skipped.push({ captureName: capture.captureName, reason: 'not-on-disk' })
      continue
    }
    payloads.push({
      pythonPath,
      // Per-capture DI/return pair — the whole point of the sibling builder.
      inputPath: excitationPath,
      outputPath: recordingPath,
      trainPath: finalModelRoot,
      namMode: isA2 ? 'a2' : 'a1',
      normalizeWav: defaults.normalizeWav,
      normalizeWavTargetDb: defaults.normalizeWavTargetDb,
      architecture: config.architecture,
      waveNetConfig: profileCfg?.waveNetConfig ?? null,
      lr: profileCfg?.lr ?? 0.004,
      lrDecay: profileCfg?.lrDecay ?? 0.002,
      batchSize: profileCfg?.batchSize ?? 16,
      ny: profileCfg?.ny ?? 8192,
      fitMrstft: profileCfg?.fitMrstft ?? true,
      captureProfileId: isA2 ? null : config.architecture,
      epochs: config.epochs,
      latency: config.latency,
      thresholdEsr: config.thresholdEsr,
      savePlot: true,
      silent: true,
      ignoreChecks: false,
      // Capture's own calibration/hints win over the trainer-tab defaults when present.
      modeledBy: capture.suggested?.modeledBy ?? defaults.modeledBy,
      inputLevelDbu: capture.inputLevelDbu ?? defaults.inputLevelDbu,
      outputLevelDbu: capture.outputLevelDbu ?? defaults.outputLevelDbu,
      profileId: null,
      profileName: capture.projectName || null,
      sourceMode: 'nam-capture-import',
      finalModelRoot,
      processedWavRoot: '',
      graphRoot: finalModelRoot,
      graphRootResolved: false,
      sourcePostProcess: 'keep',
      // captureName has no {tokens}, so fillTrainerNamingTemplate passes it straight through
      // sanitizeTrainerPathPart — the .nam is named after the capture, not "recording".
      namingTemplate: capture.captureName || '{basename}',
      namCaptureFolderPath: capture.captureFolderPath,
      namCaptureId: capture.captureId,
      namCaptureName: capture.captureName,
      namProjectName: capture.projectName,
      namSuggestedModeledBy: capture.suggested?.modeledBy ?? null,
      namSuggestedGearMake: capture.suggested?.gearMake ?? null,
      namSuggestedGearModel: capture.suggested?.gearModel ?? null,
      namSuggestedGearType: capture.suggested?.gearType ?? null,
      namSuggestedToneType: capture.suggested?.toneType ?? null,
      submissionId: config.submission?.id ?? null,
      submissionLabel: config.submission?.label ?? null,
      submissionCreatedAt: config.submission?.createdAt ?? null,
      appendModelArchitectureFolder: false,
      appendGraphArchitectureFolder: false,
      appendProcessedArchitectureFolder: false,
    })
  }
  return { payloads, skipped }
}

/** Filesystem-safe model/folder name part — the trainer's own rule for every .nam it writes. */
export function sanitizeTrainerPathPart(value: string): string {
  return value
    .replace(/[\\/]+/g, ' - ')
    .replace(/[:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

/** The .nam basename a capture-import job will be named (before ensureUniqueFilePath adds " (1)"):
 * buildNamCaptureImportPayloads uses captureName as the naming template, and
 * fillTrainerNamingTemplate falls back to the recording's basename when that sanitizes to empty. */
export function expectedCaptureModelName(captureName: string, recordingPath: string): string {
  return sanitizeTrainerPathPart(captureName) || basename(recordingPath, extname(recordingPath)).trim() || 'model'
}

/** Case-insensitive, and ignores the " (1)" / " (2)" suffix ensureUniqueFilePath appends — so
 * "Clean (1)" from an earlier retrain still matches a new "Clean". */
export function modelNameKey(name: string): string {
  return sanitizeTrainerPathPart(name).replace(/\s\(\d+\)$/, '').toLowerCase()
}

export type ModelNameConflict = NamCaptureNameConflict

/** Flags captures whose model NAME suggests it has been trained before, independent of the
 * capture's own nam-lab-result.json (which only knows about this exact capture). Only returns
 * captures with at least one reason. */
export function findModelNameConflicts(
  items: Array<{ captureId: string; captureName: string; recordingPath: string }>,
  finalModelRoot: string,
  history: Array<Pick<TrainerHistoryEntry, 'status' | 'finalModelName' | 'finalModelPath' | 'timestamp' | 'sourcePath'>>,
  fileExists: (p: string) => boolean
): ModelNameConflict[] {
  const latestByKey = new Map<string, { finalModelPath: string; timestamp: string; sourcePath: string }>()
  for (const h of history) {
    if (h.status !== 'success' || !h.finalModelName) continue
    const key = modelNameKey(h.finalModelName)
    const prev = latestByKey.get(key)
    if (!prev || h.timestamp > prev.timestamp) {
      latestByKey.set(key, { finalModelPath: h.finalModelPath, timestamp: h.timestamp, sourcePath: h.sourcePath })
    }
  }

  const names = items.map((it) => expectedCaptureModelName(it.captureName, it.recordingPath))
  const batchCounts = new Map<string, number>()
  for (const n of names) batchCounts.set(modelNameKey(n), (batchCounts.get(modelNameKey(n)) ?? 0) + 1)

  const root = finalModelRoot.trim()
  const out: ModelNameConflict[] = []
  items.forEach((it, i) => {
    const modelName = names[i]
    const key = modelNameKey(modelName)
    const target = root ? join(root, `${modelName}.nam`) : ''
    // A history hit on this capture's own recording is still a "you trained this before" signal.
    const conflict: ModelNameConflict = {
      captureId: it.captureId,
      modelName,
      existingFilePath: target && fileExists(target) ? target : null,
      historyMatch: latestByKey.get(key) ?? null,
      duplicateInBatch: (batchCounts.get(key) ?? 0) > 1
    }
    if (conflict.existingFilePath || conflict.historyMatch || conflict.duplicateInBatch) out.push(conflict)
  })
  return out
}

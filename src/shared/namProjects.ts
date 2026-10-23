/**
 * Renderer-side mirror of namCaptureEnrichment.ts's read models (main process). Kept as its own
 * file so both App.tsx's window.api typing and NamProjectsShell can share one definition.
 * docs/nam-capture-import-plan-2026-08-29.md §1, docs/nam-projects-detail-design-2026-08-31.md.
 */

export interface NamLabResult {
  schemaVersion: number
  trainedAt: string
  modelName: string
  architecture: string
  validationEsr: number | null
  validationEsrFull: number | null
  validationEsrLite: number | null
  outputModelPath: string
  graphPath: string | null
  trainerJobId: string
  sourceCaptureId: string | null
  /** Every model trained from this capture, one per architecture (2026-10-23). The top-level
   * fields are the most recent one, which is all IR Lab reads; before this a preset that trains
   * several architectures left only the last to finish on record. Absent in older files. */
  models?: NamLabResultModel[]
}

export interface NamLabResultModel {
  architecture: string
  modelName: string
  outputModelPath: string
  validationEsr: number | null
  trainedAt: string
  trainerJobId: string
}

export interface NamCaptureSuggestedMetadata {
  name: string | null
  modeledBy: string | null
  gearMake: string | null
  gearModel: string | null
  gearType: string | null
  toneType: string | null
}

export interface NamCaptureCalibration {
  inputLevelDbu: number | null
  outputLevelDbu: number | null
  method: string | null
  confidence: string | null
  profileName: string | null
  calibratedAt: string | null
}

export interface NamCaptureEffectiveMetadata {
  modeledBy: string | null
  gearMake: string | null
  gearModel: string | null
  gearType: string | null
  toneType: string | null
  inputLevelDbu: number | null
  outputLevelDbu: number | null
}

export interface FileFacts {
  path: string
  bytes: number
  mtimeMs: number
}

export interface NamCaptureRow {
  itemId: string
  captureId: string | null
  captureName: string
  captureScope: string | null
  sampleRate: number | null
  measuredLatencySamples: number | null
  synthetic: boolean
  syntheticSourceIrName: string | null
  createdAt: string | null
  excitationPath: string | null
  excitationSourceName: string | null
  stimulusSha256: string | null
  recordingPath: string | null
  captureFolderPath: string | null
  recordingBitDepth: number | null
  recordingChannels: number | null
  recordingDurationSec: number | null
  audioFormat: string | null
  recordingFile: FileFacts | null
  calibration: NamCaptureCalibration | null
  suggested: NamCaptureSuggestedMetadata | null
  effective: NamCaptureEffectiveMetadata
  metadataEdited: boolean
  trained: boolean
  result: NamLabResult | null
  modelFile: FileFacts | null
  graphExists: boolean
  /** IR Lab's own pre-save check: 'pass' | 'warn' | 'block' (silent, clipped, misaligned...), with
   * its reasons. Null when the sidecar predates it. A 'block' capture is not ticked for training
   * by default, matching IR Lab's own "Train N untrained" count. */
  readiness: { level: string; reasons: string[] } | null
}

export interface NamProjectSummary {
  collectionId: string
  projectId: string
  name: string
  createdAt: string | null
  libraryRootId: number
  folderId: number | null
  captureCount: number
  trainedCount: number
  syntheticCount: number
  /** Project Details fields, cheap to include in the list query (already a plain column read) —
   * the Projects index card needs them for its gear/tone-style chip row. */
  cabinet: string | null
  speaker: string | null
  /** First image found in the project's own folder or its NAM Captures/ dir, or null — same
   * search `NamProjectDetail.imagePaths` does, just stopping at one for a lightweight cover. */
  coverImagePath: string | null
  /** Distinct effective gearType/toneType values across this project's captures (dedup, non-null
   * only) — the Projects index card/row's gear/tone dot-chip row. */
  gearTypes: string[]
  toneTypes: string[]
  /** Most common non-null captureScope across this project's captures, or null. */
  scope: string | null
  /** "48 kHz · 24-bit" summarizing every distinct sample rate / bit depth across this project's
   * captures, or null if neither is known. */
  rateDepth: string | null
  /** Minimal per-capture facts — just enough for `deriveCaptureStatus` to compute a live
   * queued/training/failed/missing breakdown client-side (against the live `queueJobs` stream)
   * without a full per-project detail fetch for every row in the index. */
  captures: Array<{
    itemId: string
    captureId: string | null
    trained: boolean
    excitationPath: string | null
    recordingPath: string | null
  }>
}

export interface NamProjectDetail extends NamProjectSummary {
  room: string | null
  signalChain: string | null
  description: string | null
  projectNotes: string | null
  namCapturesDir: string | null
  excitationsDir: string | null
  imagePaths: string[]
  captures: NamCaptureRow[]
}

export interface NamLibraryOverview {
  totalProjects: number
  totalCaptures: number
  trainedCaptures: number
  untrainedCaptures: number
  syntheticCaptures: number
  avgTrainedEsr: number | null
  byScope: Array<{ key: string; count: number }>
  bySampleRate: Array<{ key: string; count: number }>
  byArchitecture: Array<{ key: string; count: number }>
  projects: Array<{
    collectionId: string
    name: string
    captureCount: number
    trainedCount: number
    syntheticCount: number
    avgTrainedEsr: number | null
  }>
}

/** Patch shape for irLibrary:setNamCaptureMetadata. */
export type NamCaptureMetadataPatch = Partial<{
  modeledBy: string | null
  gearMake: string | null
  gearModel: string | null
  gearType: string | null
  toneType: string | null
  inputLevelDbu: number | null
  outputLevelDbu: number | null
}>

/** IR Lab's "Train in NAM Lab" hand-off (namlab://train?...), main -> renderer. `projectId` is IR
 * Lab's project id (the sidecars' projectId, stored as collection.naming_template), NOT a
 * collectionId. scope 'untrained' = every capture this app's result files say is untrained. */
export interface NamLabTrainIntent {
  projectId: string
  captureIds: string[]
  scope: 'selected' | 'untrained'
  /** The IR Lab project's folder, so a project NAM Lab has never catalogued can be added on the spot. */
  projectFolder: string | null
}

/** One capture whose would-be model NAME suggests it was trained before (main/namCaptureTraining.ts
 * findModelNameConflicts). Only captures with at least one reason are returned. */
export interface NamCaptureNameConflict {
  captureId: string
  modelName: string
  /** `<finalModelRoot>/<modelName>.nam` already exists — training again writes "<name> (1).nam". */
  existingFilePath: string | null
  /** Most recent successful run (any source) that produced a model of the same name. */
  historyMatch: { finalModelPath: string; timestamp: string; sourcePath: string } | null
  /** Another capture in this same batch resolves to the same model name. */
  duplicateInBatch: boolean
}

/**
 * The input level from a sidecar's calibration block that may go into a trained .nam. IR Lab's
 * Guided (no meter) method cannot establish the send level and, since 2026-10-22 (ir-lab
 * 13632549), leaves inputLevelDbu out. A Guided sidecar written before then still carries one,
 * derived from a bare loopback (it could be 4 dB off) and labelled "interface-spec-verified"; IR
 * Lab now downgrades those profiles to an estimate on load but never rewrote the sidecars. So a
 * Guided input level is shown as provenance but not seeded into the model. Precision passes.
 */
export function trainableInputLevelDbu(cal: { inputLevelDbu?: unknown; method?: unknown }): number | null {
  const value = cal.inputLevelDbu
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return cal.method === 'guided' ? null : value
}

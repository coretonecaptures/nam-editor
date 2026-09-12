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

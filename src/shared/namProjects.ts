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
}

export interface NamProjectDetail extends NamProjectSummary {
  cabinet: string | null
  speaker: string | null
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

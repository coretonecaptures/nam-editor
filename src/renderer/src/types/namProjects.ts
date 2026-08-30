/**
 * Renderer-side mirror of namCaptureEnrichment.ts's read models (main process). Kept as its own
 * file so both App.tsx's window.api typing and NamProjectsShell can share one definition.
 * docs/nam-capture-import-plan-2026-08-29.md §1.
 */

export interface NamLabResult {
  schemaVersion: number
  trainedAt: string
  modelName: string
  architecture: string
  validationEsr: number | null
  outputModelPath: string
  trainerJobId: string
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
  recordingPath: string | null
  captureFolderPath: string | null
  trained: boolean
  result: NamLabResult | null
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
  captures: NamCaptureRow[]
}

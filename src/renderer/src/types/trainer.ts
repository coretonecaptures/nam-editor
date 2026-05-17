export const TRAINER_ARCHITECTURES = [
  'standard',
  'complex',
  'lite',
  'feather',
  'nano',
  'revystd',
  'revyhi',
  'revxstd',
] as const

export type TrainerArchitecture = typeof TRAINER_ARCHITECTURES[number]

export interface TrainerPresetDefinition {
  id: string
  label: string
  architecture: TrainerArchitecture
  epochs: number
  thresholdEsr: number | null
}

export const TRAINER_PRESETS: TrainerPresetDefinition[] = [
  { id: 'standard', label: 'Standard', architecture: 'standard', epochs: 1000, thresholdEsr: null },
  { id: 'complex', label: 'Complex', architecture: 'complex', epochs: 1000, thresholdEsr: null },
  { id: 'revyhi', label: 'REVyHI', architecture: 'revyhi', epochs: 1500, thresholdEsr: null },
  { id: 'revxstd', label: 'REVxSTD', architecture: 'revxstd', epochs: 1000, thresholdEsr: null },
] as const

export interface TrainerStartPayload {
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: TrainerArchitecture
  epochs: number
  latency: number | null
  thresholdEsr: number | null
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
}

export type TrainerStatus = 'idle' | 'starting' | 'running' | 'success' | 'error' | 'canceled'
export type TrainerQueueJobStatus = 'queued' | 'starting' | 'running' | 'success' | 'error' | 'canceled'

export interface TrainerQueueJob {
  jobId: string
  status: TrainerQueueJobStatus
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: TrainerArchitecture
  epochs: number
  latency: number | null
  thresholdEsr: number | null
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
  modelName: string
  outputModelPath: string
  checkpointModelPath: string
  attempts: number
  startedAt: string | null
  finishedAt: string | null
  error: string
  validationEsr: number | null
  progressPercent: number | null
  progressEpochCurrent: number | null
  progressEpochTotal: number | null
  progressBatchCurrent: number | null
  progressBatchTotal: number | null
  progressRate: number | null
  progressLatestLine: string
}

export interface TrainerStateSnapshot {
  status: TrainerStatus
  runId: string | null
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: TrainerArchitecture | ''
  epochs: number | null
  latency: number | null
  thresholdEsr: number | null
  modelName: string
  outputModelPath: string
  checkpointModelPath: string
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
  startedAt: string | null
  finishedAt: string | null
  logs: string[]
  error: string
  validationEsr: number | null
  progressPhase: string
  progressPercent: number | null
  progressEpochCurrent: number | null
  progressEpochTotal: number | null
  progressBatchCurrent: number | null
  progressBatchTotal: number | null
  progressRate: number | null
  progressLatestLine: string
  activeJobId: string | null
  pauseAfterCurrent: boolean
  queue: TrainerQueueJob[]
}

export const IDLE_TRAINER_STATE: TrainerStateSnapshot = {
  status: 'idle',
  runId: null,
  pythonPath: '',
  inputPath: '',
  outputPath: '',
  trainPath: '',
  architecture: '',
  epochs: null,
  latency: null,
  thresholdEsr: null,
  modelName: '',
  outputModelPath: '',
  checkpointModelPath: '',
  savePlot: true,
  silent: false,
  ignoreChecks: false,
  startedAt: null,
  finishedAt: null,
  logs: [],
  error: '',
  validationEsr: null,
  progressPhase: '',
  progressPercent: null,
  progressEpochCurrent: null,
  progressEpochTotal: null,
  progressBatchCurrent: null,
  progressBatchTotal: null,
  progressRate: null,
  progressLatestLine: '',
  activeJobId: null,
  pauseAfterCurrent: false,
  queue: [],
}

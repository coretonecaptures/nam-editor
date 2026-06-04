export const TRAINER_ARCHITECTURES = [
  'standard',
  'complex',
  'lite',
  'feather',
  'nano',
  'revystd',
  'revyhi',
  'revxstd',
  'a2',
] as const

export type TrainerArchitecture = typeof TRAINER_ARCHITECTURES[number]

export interface WaveNetLayerConfig {
  input_size: number
  condition_size: number
  channels: number
  head_size: number
  kernel_size: number
  dilations: number[]
  activation: 'Tanh'
  gated: boolean
  head_bias: boolean
}

export interface WaveNetConfig {
  layers_configs: WaveNetLayerConfig[]
  head_scale: number
}

export interface CaptureProfile {
  id: string
  name: string
  description: string
  builtIn: boolean
  waveNetConfig: WaveNetConfig | null  // null for A2 (PackedWaveNet) — config is fixed in trainer
  lr: number
  lrDecay: number
  defaultEpochs: number
  batchSize: number
  ny: number
  fitMrstft: boolean
}

// A2 is a fixed architecture — no WaveNet layer config applies.
// Training uses nam.train.core.train() with the built-in config_model_packed.json.
// One run produces a SlimmableContainer .nam with both channels_3 (lite) and channels_8 (standard).
export const A2_CAPTURE_PROFILE: CaptureProfile = {
  id: 'a2',
  name: 'A2',
  description: 'NAM Architecture 2 — produces a single .nam file containing both lite and standard submodels (SlimmableContainer). Requires NAM ≥ 0.13.0.',
  builtIn: true,
  waveNetConfig: null,
  lr: 0.004,
  lrDecay: 0.006,
  defaultEpochs: 1000,
  batchSize: 16,
  ny: 8192,
  fitMrstft: true,
}

export const BUILT_IN_CAPTURE_PROFILES: CaptureProfile[] = [
  {
    id: 'standard', name: 'Standard', description: 'Full WaveNet — highest quality, largest file, slowest training', builtIn: true,
    waveNetConfig: { head_scale: 0.02, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 16, head_size: 8, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 16, condition_size: 1, channels: 8, head_size: 1, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.004, lrDecay: 0.002, defaultEpochs: 1000, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'lite', name: 'Lite', description: 'Lighter WaveNet — good balance of quality and speed', builtIn: true,
    waveNetConfig: { head_scale: 0.02, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 12, head_size: 6, kernel_size: 3, dilations: [1,2,4,8,16,32,64], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 12, condition_size: 1, channels: 6, head_size: 1, kernel_size: 3, dilations: [128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.004, lrDecay: 0.002, defaultEpochs: 1000, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'feather', name: 'Feather', description: 'Very lightweight — fastest training, smallest file', builtIn: true,
    waveNetConfig: { head_scale: 0.02, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 8, head_size: 4, kernel_size: 3, dilations: [1,2,4,8,16,32,64], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 4, head_size: 1, kernel_size: 3, dilations: [128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.004, lrDecay: 0.002, defaultEpochs: 1000, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'nano', name: 'Nano', description: 'Minimal footprint — lowest resource use', builtIn: true,
    waveNetConfig: { head_scale: 0.02, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 4, head_size: 2, kernel_size: 3, dilations: [1,2,4,8,16,32,64], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 4, condition_size: 1, channels: 2, head_size: 1, kernel_size: 3, dilations: [128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.004, lrDecay: 0.002, defaultEpochs: 1000, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'complex', name: 'Complex', description: 'Extended WaveNet — richer frequency detail, slower training', builtIn: true,
    waveNetConfig: { head_scale: 0.02, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 32, head_size: 8, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 32, condition_size: 1, channels: 8, head_size: 1, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.001, lrDecay: 0.001, defaultEpochs: 1000, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'revystd', name: 'REVySTD', description: 'Revy standard — 5-layer variant, reversed power-of-2 dilations', builtIn: true,
    waveNetConfig: { head_scale: 0.99, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 1, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.002, lrDecay: 0.0015, defaultEpochs: 1500, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'revyhi', name: 'REVyHI', description: 'Revy high-fidelity — 5-layer, 10-channel variant', builtIn: true,
    waveNetConfig: { head_scale: 0.99, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 10, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 10, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 10, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 10, condition_size: 1, channels: 10, head_size: 1, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.002, lrDecay: 0.0015, defaultEpochs: 1500, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  {
    id: 'revxstd', name: 'REVxSTD', description: 'RevX standard — 4-layer, powers-of-3 dilations', builtIn: true,
    waveNetConfig: { head_scale: 0.99, layers_configs: [
      { input_size: 1, condition_size: 1, channels: 8, head_size: 8, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: false },
      { input_size: 8, condition_size: 1, channels: 8, head_size: 1, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: true },
    ] },
    lr: 0.004, lrDecay: 0.002, defaultEpochs: 1000, batchSize: 16, ny: 8192, fitMrstft: true,
  },
  A2_CAPTURE_PROFILE,
]

export function isA2Architecture(arch: string): boolean {
  return arch === 'a2'
}

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
  namMode?: 'a1' | 'a2'
  architecture: string
  epochs: number
  latency: number | null
  thresholdEsr: number | null
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
  waveNetConfig?: WaveNetConfig | null
  lr?: number | null
  lrDecay?: number | null
  batchSize?: number | null
  ny?: number | null
  fitMrstft?: boolean | null
  normalizeWav?: boolean
  normalizeWavTargetDb?: number
  captureProfileId?: string | null
  profileId?: string | null
  profileName?: string | null
  modeledBy?: string | null
  inputLevelDbu?: number | null
  outputLevelDbu?: number | null
  sourceMode?: 'watcher' | 'manual-folder-run' | 'manual-direct'
  finalModelRoot?: string | null
  processedWavRoot?: string | null
  graphRoot?: string | null
  graphRootResolved?: boolean
  sourcePostProcess?: 'move' | 'copy' | 'keep'
  namingTemplate?: string | null
  modelNameSuffix?: string | null
  submissionId?: string | null
  submissionLabel?: string | null
  submissionCreatedAt?: string | null
}

export type TrainerStatus = 'idle' | 'starting' | 'running' | 'success' | 'error' | 'canceled'
export type TrainerQueueJobStatus = 'staged' | 'queued' | 'starting' | 'running' | 'success' | 'error' | 'canceled'

export interface TrainerQueueJob {
  jobId: string
  status: TrainerQueueJobStatus
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  namMode: 'a1' | 'a2'
  architecture: string
  waveNetConfig: WaveNetConfig | null
  lr: number
  lrDecay: number
  batchSize: number
  ny: number
  fitMrstft: boolean
  normalizeWav: boolean
  normalizeWavTargetDb: number
  captureProfileId: string | null
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
  profileId: string | null
  profileName: string | null
  modeledBy: string | null
  inputLevelDbu: number | null
  outputLevelDbu: number | null
  sourceMode: 'watcher' | 'manual-folder-run' | 'manual-direct'
  finalModelRoot: string
  processedWavRoot: string
  graphRoot: string
  graphRootResolved: boolean
  sourcePostProcess: 'move' | 'copy' | 'keep'
  workspacePath: string
  graphPath: string
  sourceSizeBytes: number | null
  sourceMtimeMs: number | null
  submissionId: string | null
  submissionLabel: string | null
  submissionCreatedAt: string | null
  backupExisting?: boolean
}

export interface TrainerHistoryEntry {
  historyId: string
  timestamp: string
  profileId: string | null
  profileName: string | null
  sourceMode: 'watcher' | 'manual-folder-run' | 'manual-direct'
  sourcePath: string
  sourceSizeBytes: number | null
  sourceMtimeMs: number | null
  namMode?: 'a1' | 'a2'
  architecture: string
  finalModelPath: string
  processedWavPath: string
  graphPath: string
  status: 'success' | 'error' | 'canceled' | 'skipped'
  attempts: number
  validationEsr: number | null
  thresholdEsr: number | null
  epochs: number
  latencyMode: 'auto' | 'manual'
  latencyValue: number | null
  finalModelName: string
  failureReason: string
  submissionId: string | null
  submissionLabel: string | null
  submissionCreatedAt: string | null
  // Wall-clock duration of the run in seconds — measured from job start to finish. Null when missing (older entries / canceled before start).
  durationSec?: number | null
  // A2-only: ESR of the Lite (channels_3) sub-model. The main validationEsr above is the
  // Full (channels_8) sub-model. Both sub-models live inside the same A2 .nam file.
  validationEsrLite?: number | null
}

export type WatcherFileStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'skipped'

export interface WatcherFileEntry {
  filePath: string
  fileName: string
  sizeBytes: number
  mtimeMs: number
  statuses: Array<{ architecture: string; status: WatcherFileStatus }>
}

export interface TrainerWatcherRuntime {
  profileId: string
  profileName: string
  enabled: boolean
  autoRun: boolean
  running: boolean
  sourceMode: 'watcher' | 'manual-folder-run'
  watchFolder: string
  pendingCount: number
  skippedCount: number
}

export interface TrainerProfilesStateSnapshot {
  watchers: TrainerWatcherRuntime[]
  graphRetentionEnabled: boolean
}

export interface TrainerStateSnapshot {
  status: TrainerStatus
  runId: string | null
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: string
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
  replicateEsr: number | null
  epochValidationEsr: number | null
  // A2 packed-model breakdown (only populated for A2 runs):
  // - Full = channels_8 sub-model (what the plugin loads by default)
  // - Lite = channels_3 sub-model
  // - Aggregate = NAM's reported val_loss for A2, which is the SUM of both
  epochValidationEsrFull?: number | null
  epochValidationEsrLite?: number | null
  epochValidationEsrAggregate?: number | null
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
  history: TrainerHistoryEntry[]
  watcherState: TrainerProfilesStateSnapshot
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
  replicateEsr: null,
  epochValidationEsr: null,
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
  history: [],
  watcherState: {
    watchers: [],
    graphRetentionEnabled: true,
  },
}

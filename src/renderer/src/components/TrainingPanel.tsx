import { useEffect, useMemo, useRef, useState, useCallback, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import type { AppSettings, TrainingPreset, UserCaptureProfile } from '../types/settings'
import {
  IDLE_TRAINER_STATE,
  TRAINER_ARCHITECTURES,
  BUILT_IN_CAPTURE_PROFILES,
  type TrainerArchitecture,
  type TrainerHistoryEntry,
  type TrainerQueueJob,
  type TrainerStateSnapshot,
  type CaptureProfile,
} from '../types/trainer'
import { ArchitectureProfilePicker } from './ArchitectureProfilePicker'
import { CaptureProfileEditor } from './CaptureProfileEditor'

interface Props {
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => void
  onClose?: () => void
  initialRunMode?: 'files' | 'folder' | 'queue' | 'history'
}

const ARCHITECTURE_LABELS: Record<TrainerArchitecture, string> = {
  standard: 'Standard',
  complex: 'Complex',
  lite: 'Lite',
  feather: 'Feather',
  nano: 'Nano',
  revystd: 'REVySTD',
  revyhi: 'REVyHI',
  revxstd: 'REVxSTD',
}

const CUSTOM_PRESET_ID = 'custom'

function lookupProfileConfig(
  profileId: string,
  userProfiles: UserCaptureProfile[]
): Pick<CaptureProfile, 'waveNetConfig' | 'lr' | 'lrDecay' | 'batchSize' | 'ny' | 'fitMrstft'> | null {
  const builtIn = BUILT_IN_CAPTURE_PROFILES.find((p) => p.id === profileId)
  if (builtIn) return builtIn
  const user = userProfiles.find((p) => p.id === profileId)
  return user ?? null
}

function architectureEpochNote(architecture: TrainerArchitecture): string | null {
  if (architecture === 'complex') return 'Official trainer uses its recommended Complex learning settings.'
  if (architecture === 'revyhi') return 'Official trainer forces the author-recommended REVyHI defaults, including 1500 epochs.'
  if (architecture === 'revxstd') return 'Official trainer forces the author-recommended REVxSTD defaults, including 1000 epochs.'
  return null
}

function effectiveEpochTotal(architecture: TrainerArchitecture | '', configured: number | null): number | null {
  if (architecture === 'revyhi') return 1500
  if (architecture === 'revxstd') return 1000
  return configured
}

function formatThresholdEsr(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : ''
}

function describePreset(preset: TrainingPreset): string {
  const archText =
    preset.architectures.length === 0
      ? 'No architectures'
      : preset.architectures.map((item) => ARCHITECTURE_LABELS[item as TrainerArchitecture] ?? item).join(', ')
  const esrText = typeof preset.thresholdEsr === 'number' ? `Target ESR ${formatThresholdEsr(preset.thresholdEsr)}` : 'No ESR target'
  return `${archText} · ${preset.epochs} epochs · ${esrText}`
}

function makePresetId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `training-preset-${slug || Date.now()}-${Date.now()}`
}

function getEsrTone(esr: number | null): { text: string; classes: string } {
  if (typeof esr !== 'number') {
    return { text: '-', classes: 'text-gray-800 dark:text-gray-200' }
  }
  if (esr < 0.01) {
    return { text: esr.toFixed(6), classes: 'text-emerald-700 dark:text-emerald-300' }
  }
  if (esr < 0.05) {
    return { text: esr.toFixed(6), classes: 'text-amber-700 dark:text-amber-300' }
  }
  return { text: esr.toFixed(6), classes: 'text-red-700 dark:text-red-300' }
}

function showNativeTextContextMenu(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()?.toString().trim() ?? ''
  const target = event.target as HTMLElement | null
  const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]')
  if (!selection && !isEditable) return
  event.preventDefault()
  void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
}

export function TrainingPanel({ settings, onSaveSettings, onClose, initialRunMode }: Props) {
  const [inputPath, setInputPath] = useState(settings.namTrainingInputWav || '')
  const [runMode, setRunMode] = useState<'files' | 'folder' | 'queue' | 'history'>(initialRunMode ?? 'files')
  const [maximized, setMaximized] = useState(false)
  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [trainPath, setTrainPath] = useState('')
  const [manualRoutingMode, setManualRoutingMode] = useState<'root' | 'sibling_processed'>('root')
  const [folderRunPath, setFolderRunPath] = useState('')
  const [folderRunProfileId, setFolderRunProfileId] = useState<'custom' | string>('custom')
  const [selectedPresetId, setSelectedPresetId] = useState<string>(CUSTOM_PRESET_ID)
  const [architectures, setArchitectures] = useState<string[]>(['standard'])
  const [captureProfileEditorOpen, setCaptureProfileEditorOpen] = useState(false)
  const [captureProfileEditorTarget, setCaptureProfileEditorTarget] = useState<UserCaptureProfile | null>(null)
  const [epochs, setEpochs] = useState('1000')
  const [latency, setLatency] = useState('')
  const [thresholdEsr, setThresholdEsr] = useState('')
  const [savePlot, setSavePlot] = useState(true)
  const [ignoreChecks, setIgnoreChecks] = useState(false)
  const [launchError, setLaunchError] = useState('')
  const [queueActionError, setQueueActionError] = useState('')
  const [trainerState, setTrainerState] = useState<TrainerStateSnapshot>(IDLE_TRAINER_STATE)
  const [queueContextMenu, setQueueContextMenu] = useState<{ job: TrainerQueueJob; x: number; y: number } | null>(null)
  const [historyContextMenu, setHistoryContextMenu] = useState<{ entry: TrainerHistoryEntry; x: number; y: number } | null>(null)
  const [graphModalSrc, setGraphModalSrc] = useState<string | null>(null)
  const [queueProfileFilter, setQueueProfileFilter] = useState<string>('all')
  const [queueStatusFilter, setQueueStatusFilter] = useState<string>('all')
  const [queueArchitectureFilter, setQueueArchitectureFilter] = useState<string>('all')
  const [historyProfileFilter, setHistoryProfileFilter] = useState<string>('all')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all')
  const [historyArchitectureFilter, setHistoryArchitectureFilter] = useState<string>('all')
  const [historyTimeFilter, setHistoryTimeFilter] = useState<'all' | 'day' | 'week' | 'month' | 'quarter'>('all')
  const [historyEsrFilter, setHistoryEsrFilter] = useState<'all' | 'green' | 'amber' | 'red' | 'none'>('all')
  const [historySearch, setHistorySearch] = useState('')
  const [showSavePresetModal, setShowSavePresetModal] = useState(false)
  const [presetNameDraft, setPresetNameDraft] = useState('')
  const [presetSaveError, setPresetSaveError] = useState('')
  const [presetSaveNotice, setPresetSaveNotice] = useState('')
  const rawLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (settings.namTrainingInputWav && !inputPath) setInputPath(settings.namTrainingInputWav)
  }, [settings.namTrainingInputWav, inputPath])

  useEffect(() => {
    if (initialRunMode) setRunMode(initialRunMode)
  }, [initialRunMode])

  useEffect(() => {
    let disposed = false
    void window.api.getTrainerState().then((state) => {
      if (!disposed) setTrainerState(state)
    })
    const off = window.api.onTrainerUpdate((state) => setTrainerState(state))
    return () => {
      disposed = true
      off()
    }
  }, [])

  useEffect(() => {
    const node = rawLogRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [trainerState.logs.length])

  useEffect(() => {
    if (!presetSaveNotice) return
    const timer = window.setTimeout(() => setPresetSaveNotice(''), 2500)
    return () => window.clearTimeout(timer)
  }, [presetSaveNotice])

  useEffect(() => {
    if (!queueContextMenu) return
    const close = () => setQueueContextMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [queueContextMenu])

  const isRunning = trainerState.status === 'starting' || trainerState.status === 'running'
  const activeJob = trainerState.activeJobId ? trainerState.queue.find((job) => job.jobId === trainerState.activeJobId) ?? null : null
  const epochNote = architectures.length === 1 ? architectureEpochNote(architectures[0]) : null
  const progressEpochTotal = effectiveEpochTotal(
    (trainerState.architecture || architectures[0] || 'standard') as TrainerArchitecture | '',
    trainerState.progressEpochTotal ?? trainerState.epochs
  )
  const validationEsrTone = getEsrTone(trainerState.validationEsr)

  const resolvedModelName = useMemo(() => {
    const first = outputPaths[0] ?? ''
    const base = first.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '').trim() || 'model'
    return base
  }, [outputPaths])

  const manualRoutingSourceFolder = useMemo(() => {
    if (runMode === 'folder') return folderRunPath.trim()
    const first = outputPaths[0]?.trim() ?? ''
    if (!first) return ''
    return first.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  }, [folderRunPath, outputPaths, runMode])

  const availablePresets = useMemo(
    () => settings.trainingPresets.filter((preset) => preset.architectures.length > 0),
    [settings.trainingPresets]
  )
  const activePreset = useMemo(
    () => selectedPresetId === CUSTOM_PRESET_ID ? null : availablePresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [availablePresets, selectedPresetId]
  )
  const filesPreset = runMode === 'files' ? activePreset : null
  const manualFolderPresets = availablePresets
  const queueProfileOptions = useMemo(
    () => Array.from(new Map(trainerState.queue.filter((job) => job.profileId || job.profileName).map((job) => [job.profileId ?? job.profileName ?? 'manual', job.profileName ?? 'Manual'])).entries()),
    [trainerState.queue]
  )
  const filteredQueue = useMemo(
    () => trainerState.queue.filter((job) => {
      if (queueProfileFilter !== 'all' && (job.profileId ?? 'manual') !== queueProfileFilter) return false
      if (queueStatusFilter !== 'all' && job.status !== queueStatusFilter) return false
      if (queueArchitectureFilter !== 'all' && job.architecture !== queueArchitectureFilter) return false
      return true
    }),
    [queueArchitectureFilter, queueProfileFilter, queueStatusFilter, trainerState.queue]
  )
  const groupedQueue = useMemo(() => {
    const groups: Array<{ key: string; label: string; createdAt: string | null; jobs: TrainerQueueJob[] }> = []
    for (const job of filteredQueue) {
      const key = job.submissionId ?? `ungrouped:${job.jobId}`
      const existing = groups[groups.length - 1]
      if (existing && existing.key === key) {
        existing.jobs.push(job)
      } else {
        groups.push({
          key,
          label: job.submissionLabel ?? (job.profileName ?? (job.sourceMode === 'watcher' ? 'Watcher' : job.sourceMode === 'manual-folder-run' ? 'Folder run' : 'Run WAVs')),
          createdAt: job.submissionCreatedAt ?? null,
          jobs: [job],
        })
      }
    }
    return groups
  }, [filteredQueue])
  const filteredHistory = useMemo(
    () => trainerState.history.filter((entry) => {
      if (historyProfileFilter !== 'all' && (entry.profileId ?? 'manual') !== historyProfileFilter) return false
      if (historyStatusFilter !== 'all' && entry.status !== historyStatusFilter) return false
      if (historyArchitectureFilter !== 'all' && entry.architecture !== historyArchitectureFilter) return false
      if (historyTimeFilter !== 'all') {
        const now = Date.now()
        const entryTime = new Date(entry.timestamp).getTime()
        const maxAgeMs =
          historyTimeFilter === 'day'
            ? 24 * 60 * 60 * 1000
            : historyTimeFilter === 'week'
              ? 7 * 24 * 60 * 60 * 1000
              : historyTimeFilter === 'month'
                ? 30 * 24 * 60 * 60 * 1000
                : 90 * 24 * 60 * 60 * 1000
        if (!Number.isFinite(entryTime) || now - entryTime > maxAgeMs) return false
      }
      if (historyEsrFilter !== 'all') {
        const esr = entry.validationEsr
        if (historyEsrFilter === 'none') {
          if (typeof esr === 'number') return false
        } else if (historyEsrFilter === 'green') {
          if (typeof esr !== 'number' || esr >= 0.01) return false
        } else if (historyEsrFilter === 'amber') {
          if (typeof esr !== 'number' || esr < 0.01 || esr >= 0.05) return false
        } else if (historyEsrFilter === 'red') {
          if (typeof esr !== 'number' || esr < 0.05) return false
        }
      }
      if (historySearch.trim()) {
        const hay = `${entry.finalModelName} ${entry.sourcePath} ${entry.finalModelPath} ${entry.profileName ?? ''}`.toLowerCase()
        if (!hay.includes(historySearch.trim().toLowerCase())) return false
      }
      return true
    }),
    [historyArchitectureFilter, historyEsrFilter, historyProfileFilter, historySearch, historyStatusFilter, historyTimeFilter, trainerState.history]
  )
  const groupedHistory = useMemo(() => {
    const groups: Array<{ key: string; label: string; createdAt: string | null; entries: TrainerHistoryEntry[] }> = []
    for (const entry of filteredHistory) {
      const key = entry.submissionId ?? `ungrouped:${entry.historyId}`
      const existing = groups[groups.length - 1]
      if (existing && existing.key === key) {
        existing.entries.push(entry)
      } else {
        groups.push({
          key,
          label: entry.submissionLabel ?? (entry.profileName ?? (entry.sourceMode === 'watcher' ? 'Watcher' : entry.sourceMode === 'manual-folder-run' ? 'Folder run' : 'Run WAVs')),
          createdAt: entry.submissionCreatedAt ?? entry.timestamp,
          entries: [entry],
        })
      }
    }
    return groups
  }, [filteredHistory])

  const canQueue =
    !!settings.namPythonPath.trim() &&
    !!inputPath.trim() &&
    outputPaths.length > 0 &&
    (
      activePreset
        ? !!trainPath.trim()
        : (architectures.length > 0 && !!trainPath.trim() && Number.isFinite(Number(epochs)) && Number(epochs) > 0)
    )
  const exampleFinalModelPath = useMemo(() => {
    const architectureFolder = 'Standard'
    if (manualRoutingMode === 'sibling_processed') {
      const sourceBase = manualRoutingSourceFolder.replace(/\\/g, '/').replace(/\/+$/, '')
      const root = sourceBase ? `${sourceBase}/_Processed/Models` : '_Processed/Models'
      return `${root}/${architectureFolder}/${resolvedModelName}.nam`
    }
    const root = trainPath.trim().replace(/\\/g, '/')
    return root ? `${root}/${architectureFolder}/${resolvedModelName}.nam` : `${architectureFolder}/${resolvedModelName}.nam`
  }, [manualRoutingMode, manualRoutingSourceFolder, resolvedModelName, trainPath])

  const exampleGraphPath = useMemo(() => {
    const architectureFolder = 'Standard'
    if (manualRoutingMode === 'sibling_processed') {
      const sourceBase = manualRoutingSourceFolder.replace(/\\/g, '/').replace(/\/+$/, '')
      const root = sourceBase ? `${sourceBase}/_Processed/Graphs` : '_Processed/Graphs'
      return `${root}/${architectureFolder}/${resolvedModelName}.png`
    }
    const root = trainPath.trim().replace(/\\/g, '/')
    return root ? `${root}/${resolvedModelName}.png` : `${resolvedModelName}.png`
  }, [manualRoutingMode, manualRoutingSourceFolder, resolvedModelName, trainPath])

  const getManualRoutingForOutput = (outputPath: string) => {
    if (manualRoutingMode === 'sibling_processed') {
      const sourceDir = outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      const processedRoot = `${sourceDir.replace(/\/+$/, '')}/_Processed`
      return {
        finalModelRoot: `${processedRoot}/Models`,
        processedWavRoot: '',
        graphRoot: `${processedRoot}/Graphs`,
        sourcePostProcess: 'keep' as const,
      }
    }
    return {
      finalModelRoot: trainPath.trim(),
      processedWavRoot: '',
      graphRoot: trainPath.trim(),
      sourcePostProcess: 'keep' as const,
    }
  }

  const getManualFolderRouting = () => {
    if (manualRoutingMode === 'sibling_processed') {
      const sourceDir = folderRunPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      const processedRoot = `${sourceDir}/_Processed`
      return {
        finalModelRoot: `${processedRoot}/Models`,
        processedWavRoot: '',
        graphRoot: `${processedRoot}/Graphs`,
        sourcePostProcess: 'keep' as const,
      }
    }
    return {
      finalModelRoot: trainPath.trim(),
      processedWavRoot: '',
      graphRoot: trainPath.trim(),
      sourcePostProcess: 'keep' as const,
    }
  }

  const handleBrowseInput = async () => {
    const path = await window.api.openAudioFile()
    if (!path) return
    setInputPath(path)
    if (path !== settings.namTrainingInputWav) {
      onSaveSettings({ ...settings, namTrainingInputWav: path })
    }
  }

  const handleBrowseOutputs = async () => {
    const paths = await window.api.openAudioFiles()
    if (!paths || paths.length === 0) return
    setOutputPaths(paths)
    if (!trainPath) {
      const normalized = paths[0].replace(/\\/g, '/')
      setTrainPath(normalized.split('/').slice(0, -1).join('/'))
    }
  }

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    if (presetId === CUSTOM_PRESET_ID) return
    const preset = availablePresets.find((item) => item.id === presetId)
    if (!preset) return
    setArchitectures(
      preset.architectures.filter((item): item is TrainerArchitecture =>
        TRAINER_ARCHITECTURES.includes(item as TrainerArchitecture)
      )
    )
    setEpochs(String(preset.epochs))
    setThresholdEsr(formatThresholdEsr(preset.thresholdEsr))
    setLatency(preset.latencyMode === 'manual' && preset.latencyValue != null ? String(preset.latencyValue) : '')
    setSavePlot(preset.savePlot)
    setIgnoreChecks(preset.ignoreChecks)
  }

  const handleQueue = async () => {
    setLaunchError('')
    const parsedEpochs = activePreset ? activePreset.epochs : Number.parseInt(epochs, 10)
    const parsedLatency = activePreset
      ? (activePreset.latencyMode === 'manual' ? activePreset.latencyValue : null)
      : (latency.trim() === '' ? null : Number.parseInt(latency.trim(), 10))
    const parsedThresholdEsr = activePreset
      ? activePreset.thresholdEsr
      : (thresholdEsr.trim() === '' ? null : Number.parseFloat(thresholdEsr.trim()))
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) {
      setLaunchError('Epochs must be a positive whole number.')
      return
    }
    if (!activePreset && latency.trim() !== '' && (!Number.isFinite(parsedLatency) || parsedLatency! < 0)) {
      setLaunchError('Latency must be blank or a non-negative integer sample offset.')
      return
    }
    if (!activePreset && thresholdEsr.trim() !== '' && (!Number.isFinite(parsedThresholdEsr) || parsedThresholdEsr! <= 0)) {
      setLaunchError('Target ESR must be blank or a positive number.')
      return
    }
    const targetArchitectures = activePreset ? activePreset.architectures : architectures
    if (manualRoutingMode === 'root' && !trainPath.trim()) {
      setLaunchError('Choose an output root before queueing captures.')
      return
    }
    const captureDefaultsEnabled = settings.enableCaptureDefaults
    const modeledBy = captureDefaultsEnabled && settings.defaultModeledBy.trim() !== ''
      ? settings.defaultModeledBy.trim()
      : null
    const inputLevelDbu = captureDefaultsEnabled && settings.defaultInputLevel.trim() !== ''
      ? Number.parseFloat(settings.defaultInputLevel.trim())
      : null
    const outputLevelDbu = captureDefaultsEnabled && settings.defaultOutputLevel.trim() !== ''
      ? Number.parseFloat(settings.defaultOutputLevel.trim())
      : null

    const result = await window.api.enqueueTrainerRuns(
      (() => {
        const submissionId = `manual-direct-${Date.now()}`
        const submissionLabel = `Run WAVs - ${outputPaths.length} capture${outputPaths.length === 1 ? '' : 's'}`
        const submissionCreatedAt = new Date().toISOString()
        return outputPaths.flatMap((outputPath) => {
          const routing = getManualRoutingForOutput(outputPath.trim())
          return targetArchitectures.map((architecture) => {
            const profileCfg = lookupProfileConfig(architecture, settings.userCaptureProfiles ?? [])
            return {
              pythonPath: settings.namPythonPath.trim(),
              inputPath: inputPath.trim(),
              outputPath: outputPath.trim(),
              trainPath: routing.finalModelRoot,
              architecture,
              waveNetConfig: profileCfg?.waveNetConfig ?? null,
              lr: profileCfg?.lr ?? 0.004,
              lrDecay: profileCfg?.lrDecay ?? 0.002,
              batchSize: profileCfg?.batchSize ?? 16,
              ny: profileCfg?.ny ?? 8192,
              fitMrstft: profileCfg?.fitMrstft ?? true,
              captureProfileId: architecture,
              epochs: parsedEpochs,
              latency: parsedLatency,
              thresholdEsr: parsedThresholdEsr,
              savePlot: activePreset?.savePlot ?? savePlot,
              silent: true,
              ignoreChecks: activePreset?.ignoreChecks ?? ignoreChecks,
              sourceMode: 'manual-direct',
              finalModelRoot: routing.finalModelRoot,
              processedWavRoot: routing.processedWavRoot,
              graphRoot: routing.graphRoot,
              sourcePostProcess: routing.sourcePostProcess,
              namingTemplate: '{basename}',
              profileId: activePreset?.id ?? null,
              profileName: activePreset?.name ?? null,
              modeledBy,
              inputLevelDbu: Number.isFinite(inputLevelDbu) ? inputLevelDbu : null,
              outputLevelDbu: Number.isFinite(outputLevelDbu) ? outputLevelDbu : null,
              submissionId,
              submissionLabel,
              submissionCreatedAt,
            }
          })
        })
      })()
    )
    if (!result.success) {
      setLaunchError(result.error ?? 'Training jobs could not be queued.')
      return
    }
    setLaunchError('')
    setQueueActionError('')
  }

  const buildCustomFolderRunPreset = (): TrainingPreset | null => {
    const parsedEpochs = Number.parseInt(epochs, 10)
    const parsedLatency = latency.trim() === '' ? null : Number.parseInt(latency.trim(), 10)
    const parsedThresholdEsr = thresholdEsr.trim() === '' ? null : Number.parseFloat(thresholdEsr.trim())
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) {
      setLaunchError('Epochs must be a positive whole number.')
      return null
    }
    if (latency.trim() !== '' && (!Number.isFinite(parsedLatency) || parsedLatency! < 0)) {
      setLaunchError('Latency must be blank or a non-negative integer sample offset.')
      return null
    }
    if (thresholdEsr.trim() !== '' && (!Number.isFinite(parsedThresholdEsr) || parsedThresholdEsr! <= 0)) {
      setLaunchError('Target ESR must be blank or a positive number.')
      return null
    }
    return {
      id: 'manual-folder-run-custom',
      name: 'Custom Folder Run',
      architectures,
      epochs: parsedEpochs,
      thresholdEsr: parsedThresholdEsr,
      latencyMode: parsedLatency == null ? 'auto' : 'manual',
      latencyValue: parsedLatency,
      savePlot,
      ignoreChecks,
    }
  }

  const handleRunFolderOnce = async () => {
    setLaunchError('')
    if (!settings.namPythonPath.trim()) {
      setLaunchError('Set the NAM Python executable in Settings first.')
      return
    }
    if (!inputPath.trim()) {
      setLaunchError('Choose the trainer input WAV before running a folder.')
      return
    }
    if (!folderRunPath.trim()) {
      setLaunchError('Choose a folder of WAV files to run once.')
      return
    }
    const preset = folderRunProfileId === 'custom'
      ? buildCustomFolderRunPreset()
      : manualFolderPresets.find((item) => item.id === folderRunProfileId) ?? null
    if (!preset) {
      setLaunchError('Select a saved training profile or use the current custom settings.')
      return
    }
    if (manualRoutingMode === 'root' && !trainPath.trim()) {
      setLaunchError('Choose an output root before running a folder.')
      return
    }
    const routing = getManualFolderRouting()
    const captureDefaultsEnabled = settings.enableCaptureDefaults
    const modeledBy = captureDefaultsEnabled && settings.defaultModeledBy.trim() !== ''
      ? settings.defaultModeledBy.trim()
      : null
    const inputLevelDbu = captureDefaultsEnabled && settings.defaultInputLevel.trim() !== ''
      ? Number.parseFloat(settings.defaultInputLevel.trim())
      : null
    const outputLevelDbu = captureDefaultsEnabled && settings.defaultOutputLevel.trim() !== ''
      ? Number.parseFloat(settings.defaultOutputLevel.trim())
      : null
    const submissionId = `manual-folder-${Date.now()}`
    const submissionLabel = `Folder Run - ${folderRunPath.trim().replace(/\\/g, '/').split('/').pop() || 'Folder'}`
    const submissionCreatedAt = new Date().toISOString()
    const result = await window.api.runTrainerFolderOnce({
      profile: {
        id: preset.id,
        name: preset.name,
        sourceMode: 'manual-folder-run',
        enabled: true,
        autoRun: false,
        namingTemplate: '{basename}',
        architectures: preset.architectures,
        epochs: preset.epochs,
        thresholdEsr: preset.thresholdEsr,
        latencyMode: preset.latencyMode,
        latencyValue: preset.latencyValue,
        savePlot: preset.savePlot,
        ignoreChecks: preset.ignoreChecks,
        modeledBy,
        inputLevelDbu: Number.isFinite(inputLevelDbu) ? inputLevelDbu : null,
        outputLevelDbu: Number.isFinite(outputLevelDbu) ? outputLevelDbu : null,
        sourcePostProcess: routing.sourcePostProcess,
        watchFolder: '',
        processedWavRoot: routing.processedWavRoot,
        graphRoot: routing.graphRoot,
        finalModelRoot: routing.finalModelRoot,
      },
      folderPath: folderRunPath.trim(),
      pythonPath: settings.namPythonPath.trim(),
      inputPath: inputPath.trim(),
      submissionId,
      submissionLabel,
      submissionCreatedAt,
    })
    if (!result.success) {
      setLaunchError(result.error ?? 'Folder run could not be queued.')
      return
    }
    setLaunchError('')
    setQueueActionError('')
  }

  const queuedCount = trainerState.queue.filter((job) => job.status === 'queued').length
  const successCount = trainerState.queue.filter((job) => job.status === 'success').length
  const failedCount = trainerState.queue.filter((job) => job.status === 'error').length
  const folderRunPreset = folderRunProfileId === 'custom'
    ? null
    : manualFolderPresets.find((item) => item.id === folderRunProfileId) ?? null
  const currentPresetId = runMode === 'files' ? selectedPresetId : folderRunProfileId
  const currentRunPreset = runMode === 'files' ? filesPreset : folderRunPreset
  const showsCustomSettings = runMode !== 'queue' && currentPresetId === CUSTOM_PRESET_ID

  const handleRemoveJob = async (job: TrainerQueueJob) => {
    const result = await window.api.removeTrainerJob(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not remove that training queue item.')
    } else {
      setQueueActionError('')
    }
  }

  const handleMoveJob = async (job: TrainerQueueJob, direction: 'up' | 'down') => {
    const result = await window.api.moveTrainerJob(job.jobId, direction)
    if (!result.success) {
      setQueueActionError(result.error ?? `Could not move that training queue item ${direction}.`)
    } else {
      setQueueActionError('')
    }
  }

  const handleMakeNext = async (job: TrainerQueueJob) => {
    const result = await window.api.makeTrainerJobNext(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not move that training queue item to the front.')
    } else {
      setQueueActionError('')
    }
  }

  const handleShowQueueItemInFolder = (job: TrainerQueueJob) => {
    if (job.outputModelPath) {
      window.api.revealFile(job.outputModelPath)
    }
    setQueueContextMenu(null)
  }

  const handleRetryQueueItem = async (job: TrainerQueueJob) => {
    const result = await window.api.retryTrainerJob(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not retry that training queue item.')
    } else {
      setQueueActionError('')
      setQueueContextMenu(null)
    }
  }

  const handleShowHistoryPath = (filePath: string) => {
    if (filePath) {
      void window.api.revealFile(filePath)
    }
    setHistoryContextMenu(null)
  }

  const handleShowGraphModal = async (graphPath: string) => {
    setHistoryContextMenu(null)
    const result = await window.api.readFileBinary(graphPath)
    if (result.data) {
      setGraphModalSrc(`data:image/png;base64,${result.data}`)
    }
  }

  const handleWatcherQueueAction = async (job: TrainerQueueJob, action: 'remove' | 'skip' | 'move-canceled' | 'retry-now') => {
    const result = await window.api.watcherQueueAction(job.jobId, action)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not update that watcher queue item.')
    } else {
      setQueueActionError('')
      setQueueContextMenu(null)
    }
  }

  const handleRetryHistoryEntry = async (entry: TrainerHistoryEntry) => {
    const result = await window.api.retryTrainerHistoryEntry(entry.historyId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not retry that history item.')
    } else {
      setQueueActionError('')
      setHistoryContextMenu(null)
      setRunMode('queue')
    }
  }

  const handleSaveAsPreset = () => {
    const parsedEpochs = Number.parseInt(epochs, 10)
    const parsedLatency = latency.trim() === '' ? null : Number.parseInt(latency.trim(), 10)
    const parsedThresholdEsr = thresholdEsr.trim() === '' ? null : Number.parseFloat(thresholdEsr.trim())
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) {
      setLaunchError('Epochs must be a positive whole number before saving a preset.')
      return
    }
    if (latency.trim() !== '' && (!Number.isFinite(parsedLatency) || parsedLatency! < 0)) {
      setLaunchError('Latency must be blank or a non-negative integer sample offset before saving a preset.')
      return
    }
    if (thresholdEsr.trim() !== '' && (!Number.isFinite(parsedThresholdEsr) || parsedThresholdEsr! <= 0)) {
      setLaunchError('Target ESR must be blank or a positive number before saving a preset.')
      return
    }
    if (architectures.length === 0) {
      setLaunchError('Choose at least one architecture before saving a preset.')
      return
    }
    setPresetNameDraft(`${architectures.map((item) => ARCHITECTURE_LABELS[item]).join(' + ')} ${parsedEpochs} epoch`)
    setPresetSaveError('')
    setShowSavePresetModal(true)
  }

  const handleConfirmSavePreset = () => {
    const parsedEpochs = Number.parseInt(epochs, 10)
    const parsedLatency = latency.trim() === '' ? null : Number.parseInt(latency.trim(), 10)
    const parsedThresholdEsr = thresholdEsr.trim() === '' ? null : Number.parseFloat(thresholdEsr.trim())
    const name = presetNameDraft.trim()
    if (!name) {
      setPresetSaveError('Enter a preset name.')
      return
    }
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) {
      setPresetSaveError('Epochs must be a positive whole number.')
      return
    }
    if (latency.trim() !== '' && (!Number.isFinite(parsedLatency) || parsedLatency! < 0)) {
      setPresetSaveError('Latency must be blank or a non-negative integer sample offset.')
      return
    }
    if (thresholdEsr.trim() !== '' && (!Number.isFinite(parsedThresholdEsr) || parsedThresholdEsr! <= 0)) {
      setPresetSaveError('Target ESR must be blank or a positive number.')
      return
    }
    if (architectures.length === 0) {
      setPresetSaveError('Choose at least one architecture.')
      return
    }
    const duplicateName = settings.trainingPresets.some((preset) => preset.name.trim().toLowerCase() === name.toLowerCase())
    if (duplicateName) {
      setPresetSaveError('A preset with that name already exists.')
      return
    }
    const preset: TrainingPreset = {
      id: makePresetId(name),
      name,
      architectures,
      epochs: parsedEpochs,
      thresholdEsr: parsedThresholdEsr,
      latencyMode: parsedLatency == null ? 'auto' : 'manual',
      latencyValue: parsedLatency,
      savePlot,
      ignoreChecks,
    }
    onSaveSettings({
      ...settings,
      trainingPresets: [...settings.trainingPresets, preset],
    })
    setSelectedPresetId(preset.id)
    if (runMode === 'folder') setFolderRunProfileId(preset.id)
    setShowSavePresetModal(false)
    setPresetNameDraft('')
    setPresetSaveError('')
    setLaunchError('')
    setPresetSaveNotice(`Saved preset "${preset.name}".`)
  }

  const handleExportHistory = () => {
    const rows = filteredHistory.map((entry) => ({
      Timestamp: new Date(entry.timestamp).toLocaleString(),
      'Model Name': entry.finalModelName,
      Profile: entry.profileName ?? (entry.sourceMode === 'watcher' ? 'Watcher' : entry.sourceMode === 'manual-folder-run' ? 'Folder run' : 'Manual'),
      Architecture: ARCHITECTURE_LABELS[entry.architecture as TrainerArchitecture] ?? entry.architecture,
      Status: entry.status,
      Epochs: entry.epochs,
      'Validation ESR': entry.validationEsr ?? '',
      'Target ESR': entry.thresholdEsr ?? '',
      'Latency Mode': entry.latencyMode,
      'Latency Value': entry.latencyValue ?? '',
      Attempts: entry.attempts,
      Submission: entry.submissionLabel ?? '',
      'Source WAV': entry.sourcePath,
      'Model Path': entry.finalModelPath,
      'Graph Path': entry.graphPath,
      'Failure Reason': entry.failureReason,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Training History')
    const date = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `training-history-${date}.xlsx`)
  }

  return (
    <>
    <div
      className={`overflow-y-auto ${maximized ? 'fixed inset-4 z-[70] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl h-auto' : 'h-full'}`}
      onContextMenu={showNativeTextContextMenu}
    >
      <div className="max-w-5xl mx-auto px-6 py-5 space-y-5">
        <div className="rounded-xl border border-violet-300/60 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-violet-800 dark:text-violet-200">Local Training</div>
              <p className="mt-1 text-xs text-violet-700/80 dark:text-violet-200/85">
                Queue one input DI with multiple reamped WAVs. NAM Lab runs them serially, keeps a local queue, and promotes the final
                .nam back to your chosen destination folder beside the ESR plot. If you have not configured the local trainer yet, refer to the
                official NAM trainer install guide first.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMaximized((v) => !v)}
                title={maximized ? 'Restore training panel' : 'Maximize training panel'}
                className={`p-2 rounded-lg transition-colors ${
                  maximized
                    ? 'bg-indigo-600 text-white'
                    : 'bg-violet-100 dark:bg-violet-950/40 hover:bg-violet-200 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-200 border border-violet-300/60 dark:border-violet-400/20'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {maximized
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  }
                </svg>
              </button>
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-violet-100 dark:bg-violet-950/40 hover:bg-violet-200 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-200 border border-violet-300/60 dark:border-violet-400/20"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-4">
            <div className="border-b border-gray-200 dark:border-gray-800">
              <div className="flex flex-wrap gap-6 -mb-px">
                <button
                  onClick={() => setRunMode('files')}
                  className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${runMode === 'files' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                >
                  Run WAVs
                </button>
                <button
                  onClick={() => setRunMode('folder')}
                  className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${runMode === 'folder' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                >
                  Run Folder
                </button>
                <button
                  onClick={() => setRunMode('queue')}
                  className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${runMode === 'queue' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                >
                  View Queue
                </button>
                <button
                  onClick={() => setRunMode('history')}
                  className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${runMode === 'history' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                >
                  History
                </button>
              </div>
            </div>
            {(isRunning || queuedCount > 0) && (
              <div className={`text-sm font-medium ${isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {isRunning
                  ? `Queue running - ${queuedCount} queued${activeJob ? `, active: ${ARCHITECTURE_LABELS[activeJob.architecture]}` : ''}.`
                  : `Queue waiting - ${queuedCount} queued item${queuedCount === 1 ? '' : 's'}.`}
              </div>
            )}
            {presetSaveNotice && (
              <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                {presetSaveNotice}
              </div>
            )}
            {runMode === 'queue' ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                Monitor the active training queue here. This is useful when watch folders are feeding jobs in the background and you just want to watch progress, errors, and history.
              </div>
            ) : runMode === 'history' ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                Review completed, failed, and canceled training runs here without crowding the live queue and output view.
              </div>
            ) : (
            <>
            {/* ── Captures ── */}
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] dark:bg-cyan-500/[0.04] p-4 space-y-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">Captures</span>
              {runMode === 'files' ? (
                <div className="space-y-4">
                  <Field label="Input DI" hint="Trainer reference / DI file">
                    <PathPicker
                      value={inputPath}
                      placeholder="Select the trainer input WAV"
                      onChange={setInputPath}
                      onBrowse={handleBrowseInput}
                    />
                  </Field>
                  <Field label="Output WAVs">
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => { void handleBrowseOutputs() }}
                          className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                        >
                          Choose WAVs...
                        </button>
                        {outputPaths.length > 0 && (
                          <button
                            onClick={() => setOutputPaths([])}
                            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 min-h-[88px] max-h-[180px] overflow-y-auto font-mono">
                        {outputPaths.length === 0 ? (
                          <span className="italic text-gray-400 dark:text-gray-500">No output WAVs selected yet.</span>
                        ) : (
                          <div className="space-y-1">
                            {outputPaths.map((path) => (
                              <div key={path} className="break-all">{path}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Field>
                </div>
              ) : (
                <div className="space-y-4">
                  <Field label="Input DI" hint="Trainer reference / DI file">
                    <PathPicker
                      value={inputPath}
                      placeholder="Select the trainer input WAV"
                      onChange={setInputPath}
                      onBrowse={handleBrowseInput}
                    />
                  </Field>
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Folder</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">Queue every WAV in a folder using a saved preset or custom settings below.</div>
                    <PathPicker
                      value={folderRunPath}
                      placeholder="Choose a folder containing WAV files"
                      onChange={setFolderRunPath}
                      onBrowse={async () => {
                        const path = await window.api.openFolder(folderRunPath || trainPath || undefined)
                        if (path) setFolderRunPath(path)
                      }}
                      browseLabel="Folder..."
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Training Settings ── */}
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] dark:bg-indigo-500/[0.04] p-4 space-y-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">Training Settings</span>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(110px,0.6fr)_minmax(110px,0.6fr)_minmax(120px,0.7fr)] gap-4">
                <Field label="Preset">
                  <select
                    value={currentPresetId}
                    onChange={(e) => {
                      if (runMode === 'files') applyPreset(e.target.value)
                      else setFolderRunProfileId(e.target.value)
                    }}
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={CUSTOM_PRESET_ID}>Custom</option>
                    {availablePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </Field>

                {currentRunPreset ? (
                  <div className="md:col-span-4 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                    {describePreset(currentRunPreset)}
                  </div>
                ) : (
                  <>
                    <Field label="Architecture(s)">
                      <ArchitectureProfilePicker
                        selectedIds={architectures}
                        onChange={(next) => {
                          setArchitectures(next)
                          if (runMode === 'files') setSelectedPresetId(CUSTOM_PRESET_ID)
                          else setFolderRunProfileId(CUSTOM_PRESET_ID)
                        }}
                        userProfiles={settings.userCaptureProfiles ?? []}
                        onClone={(profile) => {
                          setCaptureProfileEditorTarget(null)
                          setCaptureProfileEditorOpen(true)
                          setTimeout(() => {
                            setCaptureProfileEditorTarget({
                              id: `profile-${Date.now()}`,
                              name: `${profile.name} (copy)`,
                              description: profile.description,
                              waveNetConfig: { ...profile.waveNetConfig, layers_configs: profile.waveNetConfig.layers_configs.map((l) => ({ ...l })) },
                              lr: profile.lr, lrDecay: profile.lrDecay, defaultEpochs: profile.defaultEpochs,
                              batchSize: profile.batchSize, ny: profile.ny, fitMrstft: profile.fitMrstft,
                            })
                          }, 0)
                        }}
                        onEdit={(profile) => { setCaptureProfileEditorTarget(profile); setCaptureProfileEditorOpen(true) }}
                        onDelete={(id) => {
                          onSaveSettings({ ...settings, userCaptureProfiles: (settings.userCaptureProfiles ?? []).filter((p) => p.id !== id) })
                        }}
                        onNew={() => { setCaptureProfileEditorTarget(null); setCaptureProfileEditorOpen(true) }}
                      />
                    </Field>

                    <Field label="Epochs">
                      <input
                        value={epochs}
                        onChange={(e) => setEpochs(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                      />
                    </Field>

                    <Field label="Latency">
                      <input
                        value={latency}
                        onChange={(e) => setLatency(e.target.value)}
                        placeholder="Auto"
                        title="Leave blank to let NAM auto-detect the sample offset between the DI and the captured output."
                        className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                      />
                    </Field>

                    <Field label="Target ESR" hint="Stops training early once this ESR is reached. Quality guide: <0.01 = Great · <0.035 = Good · <0.1 = Acceptable">
                      <input
                        value={thresholdEsr}
                        onChange={(e) => setThresholdEsr(e.target.value)}
                        placeholder="Optional — e.g. 0.01"
                        title="Optional early-stop target. NAM training will stop once validation ESR reaches or beats this value."
                        className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                      />
                    </Field>
                  </>
                )}
              </div>

              {showsCustomSettings && (
                <>
                  {epochNote && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      {epochNote}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-indigo-500/15">
                    <ToggleRow label="Save ESR plot" checked={savePlot} onChange={setSavePlot} />
                    <ToggleRow label="Ignore checks" checked={ignoreChecks} onChange={setIgnoreChecks} />
                    <div className="flex-1" />
                    <button
                      onClick={handleSaveAsPreset}
                      className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                    >
                      Save as Preset
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── Output Routing ── */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Output Routing</span>
              <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4 items-end">
                <Field label="Routing Mode">
                  <select
                    value={manualRoutingMode}
                    onChange={(e) => setManualRoutingMode(e.target.value as 'root' | 'sibling_processed')}
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="root">Choose output root</option>
                    <option value="sibling_processed">Use sibling _Processed</option>
                  </select>
                </Field>
                {manualRoutingMode === 'root' ? (
                  <Field label="Output Root">
                    <PathPicker
                      value={trainPath}
                      placeholder="Select a destination folder"
                      onChange={setTrainPath}
                      onBrowse={async () => {
                        const path = await window.api.openFolder(trainPath || undefined)
                        if (path) setTrainPath(path)
                      }}
                      browseLabel="Folder..."
                    />
                  </Field>
                ) : (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-950/20 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                    Outputs will be promoted relative to the source location using <code>_Processed/Models</code> and <code>_Processed/Graphs</code>.
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Example model: <code>{exampleFinalModelPath}</code>
                <span className="mx-2">·</span>
                Example graph: <code>{exampleGraphPath}</code>
              </div>
            </div>

            <button
              onClick={runMode === 'files' ? handleQueue : () => { void handleRunFolderOnce() }}
              disabled={runMode === 'files' ? !canQueue : false}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white ${
                runMode === 'files'
                  ? 'bg-indigo-600 hover:bg-indigo-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {runMode === 'files'
                ? (() => {
                    const totalJobs = outputPaths.length * (activePreset ? activePreset.architectures.length : architectures.length)
                    return totalJobs === 1 ? 'Queue capture' : `Queue ${totalJobs} captures`
                  })()
                : 'Queue folder'}
            </button>
            </>
            )}

          {runMode === 'history' ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Training History{filteredHistory.length > 0 ? ` (${filteredHistory.length})` : ''}
                  </div>
                  <button
                    onClick={handleExportHistory}
                    disabled={filteredHistory.length === 0}
                    title="Export filtered history to Excel"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Export filtered
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  <select
                    value={historyProfileFilter}
                    onChange={(e) => setHistoryProfileFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All profiles</option>
                    {Array.from(new Map(trainerState.history.filter((entry) => entry.profileId || entry.profileName).map((entry) => [entry.profileId ?? entry.profileName ?? 'manual', entry.profileName ?? 'Manual'])).entries()).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    value={historyStatusFilter}
                    onChange={(e) => setHistoryStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All statuses</option>
                    <option value="success">Success</option>
                    <option value="error">Failed</option>
                    <option value="skipped">Skipped</option>
                    <option value="canceled">Canceled</option>
                  </select>
                  <select
                    value={historyArchitectureFilter}
                    onChange={(e) => setHistoryArchitectureFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All architectures</option>
                    {TRAINER_ARCHITECTURES.map((architecture) => (
                      <option key={architecture} value={architecture}>{ARCHITECTURE_LABELS[architecture]}</option>
                    ))}
                  </select>
                  <select
                    value={historyEsrFilter}
                    onChange={(e) => setHistoryEsrFilter(e.target.value as 'all' | 'green' | 'amber' | 'red' | 'none')}
                    className={`px-2.5 py-1.5 rounded text-xs focus:outline-none bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-2 ${
                      historyEsrFilter === 'green' ? 'border-emerald-500'
                      : historyEsrFilter === 'amber' ? 'border-amber-500'
                      : historyEsrFilter === 'red' ? 'border-red-500'
                      : historyEsrFilter === 'none' ? 'border-gray-400 dark:border-gray-500'
                      : 'border-gray-300 dark:border-gray-700'
                    }`}
                  >
                    <option value="all">All ESR</option>
                    <option value="green">Good — &lt; 0.01</option>
                    <option value="amber">Fair — 0.01–0.05</option>
                    <option value="red">Poor — ≥ 0.05</option>
                    <option value="none">No ESR result</option>
                  </select>
                  <select
                    value={historyTimeFilter}
                    onChange={(e) => setHistoryTimeFilter(e.target.value as 'all' | 'day' | 'week' | 'month' | 'quarter')}
                    className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all">All time</option>
                    <option value="day">Last day</option>
                    <option value="week">Last week</option>
                    <option value="month">Last month</option>
                    <option value="quarter">Last 3 months</option>
                  </select>
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search name or path"
                    className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="p-2 space-y-2">
                {filteredHistory.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-500">Completed, failed, and canceled runs will persist here.</div>
                ) : (
                  groupedHistory.map((group) => (
                    <div key={group.key} className="space-y-1.5">
                      <div className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300 flex items-center justify-between gap-3">
                        <span className="font-medium">{group.label}</span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {group.entries.length} item{group.entries.length === 1 ? '' : 's'}
                          {group.createdAt ? ` · ${new Date(group.createdAt).toLocaleString()}` : ''}
                        </span>
                      </div>
                      {group.entries.map((entry) => (
                        <div key={entry.historyId} className="ml-3">
                          <HistoryRow
                            entry={entry}
                            onContextMenu={(context) => setHistoryContextMenu(context)}
                          />
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
          <div className="space-y-4">
          {runMode !== 'queue' && (
          <details className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300">
              Training details
            </summary>
            <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-3 text-xs text-gray-600 dark:text-gray-400 space-y-1 select-text">
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Selected WAVs:</span> <code>{runMode === 'files' ? outputPaths.length : 'Folder run'}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Selected architectures:</span> <code>{currentRunPreset ? currentRunPreset.architectures.length : architectures.length}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Target ESR:</span> <code>{currentRunPreset ? (formatThresholdEsr(currentRunPreset.thresholdEsr) || 'Off') : (thresholdEsr.trim() || 'Off')}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Example output model name:</span> <code>{resolvedModelName}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Example final file:</span> <code>{exampleFinalModelPath}</code></div>
              <div className="text-[11px] text-gray-500 dark:text-gray-500">
                The official trainer still creates Lightning logs and checkpoint artifacts underneath this folder. NAM Lab promotes the final
                .nam and graph into the routing destination shown above.
              </div>
            </div>
          </details>
          )}

          {launchError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {launchError}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-2.5 flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                const result = await window.api.cancelTrainerRun()
                if (!result.success) setLaunchError(result.error ?? 'Could not cancel the active training run.')
              }}
              disabled={!isRunning}
              title="Hard-stop the current training run. NAM Lab will avoid promoting the final .nam when this is used."
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-red-700 dark:text-red-300 border-red-300/50 dark:border-red-800/60"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              Emergency stop
            </button>
            <button
              onClick={async () => { await window.api.setTrainerPauseAfterCurrent(!trainerState.pauseAfterCurrent) }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                trainerState.pauseAfterCurrent
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400/50 dark:border-amber-700/60'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <rect x="5" y="4" width="3.5" height="12" rx="1" />
                <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
              </svg>
              {trainerState.pauseAfterCurrent ? 'Pause: On' : 'Pause after current'}
            </button>
            <button
              onClick={async () => { await window.api.setTrainerPauseAfterCurrent(false) }}
              disabled={!trainerState.pauseAfterCurrent || queuedCount === 0 || isRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              Resume
            </button>

            <div className="w-px h-5 bg-gray-300 dark:bg-gray-700 mx-0.5 self-center" />

            <button
              onClick={async () => { await window.api.retryFailedTrainerRuns() }}
              disabled={!trainerState.queue.some((job) => job.status === 'error')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Retry failed
            </button>
            <button
              onClick={async () => { await window.api.removeQueuedTrainerRuns() }}
              disabled={!trainerState.queue.some((job) => job.status === 'queued')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Remove queued
            </button>
            <button
              onClick={async () => { await window.api.clearFinishedTrainerRuns() }}
              disabled={!trainerState.queue.some((job) => ['success', 'error', 'canceled'].includes(job.status))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Clear finished
            </button>
            {!!trainerState.outputModelPath && (trainerState.status === 'success' || trainerState.status === 'error' || trainerState.status === 'canceled') && (
              <button
                onClick={() => window.api.revealFile(trainerState.outputModelPath || trainPath)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                Reveal output
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={async () => { await window.api.startQueuedTrainerRuns() }}
              disabled={queuedCount === 0 || isRunning}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              Start queue
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Run Status</div>
                <StatusPill status={trainerState.status} />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5">
                  <svg className="w-7 h-7 flex-shrink-0 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                  </svg>
                  <div>
                    <div className="text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums leading-none">{queuedCount}</div>
                    <div className="text-[10px] font-medium text-amber-700/80 dark:text-amber-400/70 mt-0.5">Queued</div>
                  </div>
                </div>
                <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${isRunning ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50'}`}>
                  <svg className={`w-7 h-7 flex-shrink-0 ${isRunning ? 'text-indigo-500 dark:text-indigo-400' : 'text-gray-300 dark:text-gray-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                  </svg>
                  <div>
                    <div className={`text-xl font-bold tabular-nums leading-none ${isRunning ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-300 dark:text-gray-600'}`}>{isRunning ? 1 : 0}</div>
                    <div className={`text-[10px] font-medium mt-0.5 truncate ${isRunning && activeJob ? 'text-indigo-700/80 dark:text-indigo-400/70' : 'text-gray-400 dark:text-gray-600'}`}>
                      {isRunning && activeJob ? ARCHITECTURE_LABELS[activeJob.architecture] : 'Active'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5">
                  <svg className="w-7 h-7 flex-shrink-0 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums leading-none">{successCount}</div>
                    <div className="text-[10px] font-medium text-emerald-700/80 dark:text-emerald-400/70 mt-0.5">Done</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5">
                  <svg className="w-7 h-7 flex-shrink-0 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <div>
                    <div className="text-xl font-bold text-red-600 dark:text-red-400 tabular-nums leading-none">{failedCount}</div>
                    <div className="text-[10px] font-medium text-red-700/80 dark:text-red-400/70 mt-0.5">Failed</div>
                  </div>
                </div>
              </div>
              {!!trainerState.startedAt && (
                <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-500 space-y-0.5">
                  <div>Started: {new Date(trainerState.startedAt).toLocaleString()}</div>
                  {trainerState.finishedAt && <div>Finished: {new Date(trainerState.finishedAt).toLocaleString()}</div>}
                  {typeof trainerState.validationEsr === 'number' && (
                    <div>
                      Validation ESR:{' '}
                      <span className={`font-semibold ${validationEsrTone.classes}`}>
                        {validationEsrTone.text}
                      </span>
                    </div>
                  )}
                  {typeof trainerState.thresholdEsr === 'number' && (
                    <div>Target ESR: {trainerState.thresholdEsr}</div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/60 px-3 py-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Phase</span>
                    <span className="text-gray-600 dark:text-gray-400">{trainerState.progressPhase || (trainerState.status === 'idle' ? 'Waiting to start' : 'Starting')}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-300 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, trainerState.progressPercent ?? (trainerState.status === 'success' ? 100 : 0)))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-500 dark:text-gray-500">
                    <span>
                      {trainerState.progressEpochCurrent && progressEpochTotal
                        ? `Epoch ${trainerState.progressEpochCurrent} / ${progressEpochTotal}`
                        : trainerState.progressEpochCurrent
                          ? `Epoch ${trainerState.progressEpochCurrent}`
                          : 'Epoch progress will appear once training starts'}
                    </span>
                    <span>
                      {typeof trainerState.progressPercent === 'number'
                        ? `${trainerState.progressPercent.toFixed(1)}%`
                        : trainerState.status === 'success'
                          ? '100%'
                          : '-'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-[11px]">
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Batches</div>
                    <div className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                      {trainerState.progressBatchCurrent && trainerState.progressBatchTotal
                        ? `${trainerState.progressBatchCurrent} / ${trainerState.progressBatchTotal}`
                        : '-'}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Rate</div>
                    <div className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                      {typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(2)} it/s` : '-'}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Validation ESR</div>
                    <div className={`mt-1 font-medium ${validationEsrTone.classes}`}>
                      {validationEsrTone.text}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Final output</div>
                    <div className="mt-1 font-mono text-gray-800 dark:text-gray-200 break-all">
                      {trainerState.outputModelPath || 'Will land in the train destination root'}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Checkpoint export</div>
                    <div className="mt-1 font-mono text-gray-800 dark:text-gray-200 break-all">
                      {trainerState.checkpointModelPath || 'Lightning checkpoint copy will appear here after training starts'}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-500">Latest trainer line</div>
                  <div className="mt-1 text-xs font-mono text-gray-800 dark:text-gray-200 break-words">
                    {trainerState.progressLatestLine || 'No structured progress line yet.'}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 space-y-3">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Queue ({trainerState.queue.length})</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <select
                      value={queueProfileFilter}
                      onChange={(e) => setQueueProfileFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="all">All profiles</option>
                      {queueProfileOptions.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <select
                      value={queueStatusFilter}
                      onChange={(e) => setQueueStatusFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="all">All statuses</option>
                      <option value="queued">Queued</option>
                      <option value="starting">Starting</option>
                      <option value="running">Running</option>
                      <option value="success">Success</option>
                      <option value="error">Failed</option>
                      <option value="canceled">Canceled</option>
                    </select>
                    <select
                      value={queueArchitectureFilter}
                      onChange={(e) => setQueueArchitectureFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="all">All architectures</option>
                      {TRAINER_ARCHITECTURES.map((architecture) => (
                        <option key={architecture} value={architecture}>{ARCHITECTURE_LABELS[architecture]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {!!queueActionError && (
                  <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-700 dark:text-red-300">
                    {queueActionError}
                  </div>
                )}
                <div>
                  {filteredQueue.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-500">Queued jobs will show up here.</div>
                  ) : (
                    <div className="p-2 space-y-2">
                      {groupedQueue.map((group) => (
                        <div key={group.key} className="space-y-1.5">
                          <div className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300 flex items-center justify-between gap-3">
                            <span className="font-medium">{group.label}</span>
                            <span className="text-gray-500 dark:text-gray-400">
                              {group.jobs.length} item{group.jobs.length === 1 ? '' : 's'}
                              {group.createdAt ? ` · ${new Date(group.createdAt).toLocaleString()}` : ''}
                            </span>
                          </div>
                          {group.jobs.map((job, index) => (
                            <div key={job.jobId} className="ml-3">
                              <QueueRow
                                batchIndex={index + 1}
                                job={job}
                                isActive={job.jobId === trainerState.activeJobId}
                                onRemove={handleRemoveJob}
                                onMove={handleMoveJob}
                                onMakeNext={handleMakeNext}
                                onContextMenu={(context) => setQueueContextMenu(context)}
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {queueContextMenu && (
                <div
                  className="fixed z-50 min-w-[220px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
                  style={{ left: queueContextMenu.x, top: queueContextMenu.y }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {queueContextMenu.job.sourceMode === 'watcher' && queueContextMenu.job.status === 'queued' ? (
                    <>
                      <button
                        onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'remove') }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Remove from queue
                      </button>
                      <button
                        onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'skip') }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Skip until manually retried
                      </button>
                      <button
                        onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'move-canceled') }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Move source to _Canceled and remove
                      </button>
                      <button
                        onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'retry-now') }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Retry now
                      </button>
                    </>
                  ) : null}
                  <button
                    onClick={() => handleShowQueueItemInFolder(queueContextMenu.job)}
                    disabled={queueContextMenu.job.status !== 'success' || !queueContextMenu.job.outputModelPath}
                    className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Show in folder
                  </button>
                  <button
                    onClick={() => { void handleRetryQueueItem(queueContextMenu.job) }}
                    disabled={!['error', 'canceled'].includes(queueContextMenu.job.status)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Retry
                  </button>
                </div>
              )}

              <details open className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-950 text-gray-100">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-200">
                  Raw trainer log
                </summary>
                <div ref={rawLogRef} className="border-t border-gray-800 p-3 h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] font-mono">
                  {trainerState.logs.length === 0 ? (
                    <span className="text-gray-500">Training logs will appear here.</span>
                  ) : (
                    trainerState.logs.join('\n')
                  )}
                </div>
              </details>

              {!!trainerState.error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {trainerState.error}
                </div>
              )}
            </div>
          </div>
          </div>
          )}
          {showSavePresetModal && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4">
              <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl">
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Save Preset</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Save the current training recipe so you can reuse it later for Run WAVs, Run Folder, or watch folders.
                  </div>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <Field label="Preset Name">
                    <input
                      value={presetNameDraft}
                      onChange={(e) => {
                        setPresetNameDraft(e.target.value)
                        if (presetSaveError) setPresetSaveError('')
                      }}
                      placeholder="e.g. REVxSTD 1000 epoch"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleConfirmSavePreset()
                        } else if (e.key === 'Escape') {
                          setShowSavePresetModal(false)
                          setPresetSaveError('')
                        }
                      }}
                      className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
                  </Field>
                  <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                    {architectures.map((item) => ARCHITECTURE_LABELS[item]).join(', ')} · {epochs} epochs · {thresholdEsr.trim() ? `Target ESR ${thresholdEsr.trim()}` : 'No ESR target'}
                  </div>
                  {presetSaveError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                      {presetSaveError}
                    </div>
                  )}
                </div>
                <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowSavePresetModal(false)
                      setPresetSaveError('')
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmSavePreset}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    Save Preset
                  </button>
                </div>
              </div>
            </div>
          )}
          {historyContextMenu && (
            <div
              className="fixed z-50 min-w-[200px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
              style={{ left: historyContextMenu.x, top: historyContextMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => handleShowHistoryPath(historyContextMenu.entry.finalModelPath)}
                disabled={!historyContextMenu.entry.finalModelPath}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Show .nam
              </button>
              <button
                onClick={() => { void handleShowGraphModal(historyContextMenu.entry.graphPath) }}
                disabled={!historyContextMenu.entry.graphPath}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                View graph
              </button>
              <button
                onClick={() => handleShowHistoryPath(historyContextMenu.entry.processedWavPath || historyContextMenu.entry.sourcePath)}
                disabled={!(historyContextMenu.entry.processedWavPath || historyContextMenu.entry.sourcePath)}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Show WAV
              </button>
              <button
                onClick={() => { void handleRetryHistoryEntry(historyContextMenu.entry) }}
                disabled={!(historyContextMenu.entry.profileId && ['error', 'canceled', 'skipped'].includes(historyContextMenu.entry.status))}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Retry run
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
    {graphModalSrc && createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75"
        onClick={() => setGraphModalSrc(null)}
      >
        <div
          className="relative max-w-[90vw] max-h-[90vh] rounded-lg overflow-hidden shadow-2xl bg-gray-950"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={graphModalSrc}
            alt="Training graph"
            className="block max-w-[90vw] max-h-[88vh] object-contain"
          />
          <button
            onClick={() => setGraphModalSrc(null)}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>,
      document.body
    )}
    {captureProfileEditorOpen && (
      <CaptureProfileEditor
        profile={captureProfileEditorTarget}
        onSave={(saved) => {
          const existing = settings.userCaptureProfiles ?? []
          const updated = existing.some((p) => p.id === saved.id)
            ? existing.map((p) => p.id === saved.id ? saved : p)
            : [...existing, saved]
          onSaveSettings({ ...settings, userCaptureProfiles: updated })
          setCaptureProfileEditorOpen(false)
          setCaptureProfileEditorTarget(null)
        }}
        onCancel={() => { setCaptureProfileEditorOpen(false); setCaptureProfileEditorTarget(null) }}
      />
    )}
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
        {hint && <span className="ml-2 text-gray-500 dark:text-gray-500 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function ArchitectureMultiSelect({ values, onChange }: { values: TrainerArchitecture[]; onChange: (next: TrainerArchitecture[]) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const label =
    values.length === 0
      ? 'Choose formats'
      : values.length === 1
        ? ARCHITECTURE_LABELS[values[0]]
        : `${values.length} formats selected`

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 px-3 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 flex items-center justify-between gap-3"
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {TRAINER_ARCHITECTURES.map((option) => {
              const checked = values.includes(option)
              return (
                <label
                  key={option}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-sm ${
                    checked
                      ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange([...values, option])
                      } else {
                        const next = values.filter((item) => item !== option)
                        if (next.length > 0) onChange(next)
                      }
                    }}
                    className="accent-indigo-600"
                  />
                  <span>{ARCHITECTURE_LABELS[option]}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PathPicker({
  value,
  placeholder,
  onChange,
  onBrowse,
  browseLabel = 'Browse...',
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBrowse: () => void | Promise<void>
  browseLabel?: string
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
      />
      <button
        onClick={() => { void onBrowse() }}
        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
      >
        {browseLabel}
      </button>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-indigo-600"
      />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  )
}

function HistoryRow({
  entry,
  onContextMenu,
}: {
  entry: TrainerHistoryEntry
  onContextMenu?: (context: { entry: TrainerHistoryEntry; x: number; y: number }) => void
}) {
  const esrTone = getEsrTone(entry.validationEsr)
  const statusClasses =
    entry.status === 'success'
      ? 'text-emerald-700 dark:text-emerald-300'
      : entry.status === 'error'
        ? 'text-red-700 dark:text-red-300'
        : entry.status === 'skipped'
          ? 'text-yellow-700 dark:text-yellow-300'
          : 'text-amber-700 dark:text-amber-300'
  return (
    <div
      className="px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700/90 bg-gray-50 dark:bg-gray-900/50 shadow-sm"
      onContextMenu={onContextMenu ? (event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu({ entry, x: event.clientX, y: event.clientY })
      } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-800 dark:text-gray-200 truncate">{entry.finalModelName}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-500">
            <span className="rounded-full border border-sky-300 dark:border-sky-800 bg-sky-500/10 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">
              {entry.profileName ?? (entry.sourceMode === 'watcher' ? 'Watcher' : entry.sourceMode === 'manual-folder-run' ? 'Folder run' : 'Manual queue')}
            </span>
            <span>{ARCHITECTURE_LABELS[entry.architecture]}</span>
            <span>{new Date(entry.timestamp).toLocaleString()}</span>
            <span>Epochs {entry.epochs}</span>
            {typeof entry.validationEsr === 'number' ? (
              typeof entry.thresholdEsr === 'number' ? (
                entry.validationEsr <= entry.thresholdEsr
                  ? <span className="rounded-full border border-emerald-400/60 dark:border-emerald-700/60 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">ESR {esrTone.text} — stopped early ✓</span>
                  : <span className={esrTone.classes}>ESR {esrTone.text} (target {entry.thresholdEsr})</span>
              ) : (
                <span className={esrTone.classes}>ESR {esrTone.text}</span>
              )
            ) : (
              typeof entry.thresholdEsr === 'number' && <span className="text-gray-400 dark:text-gray-600">Target ESR {entry.thresholdEsr}</span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-500 break-all">
            {entry.finalModelPath || entry.sourcePath}
          </div>
          {!!entry.failureReason && (
            <div className="mt-1 text-[11px] text-red-700 dark:text-red-300 break-words">{entry.failureReason}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className={`font-semibold whitespace-nowrap ${statusClasses}`}>
            {entry.status.toUpperCase()}
          </div>
          <div className="text-[11px] font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
            {new Date(entry.timestamp).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: TrainerStateSnapshot['status'] }) {
  const classes =
    status === 'success'
      ? 'bg-green-500/15 text-green-300 border-green-500/30'
      : status === 'error'
        ? 'bg-red-500/15 text-red-300 border-red-500/30'
        : status === 'canceled'
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          : status === 'running' || status === 'starting'
            ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
            : 'bg-gray-500/15 text-gray-300 border-gray-500/30'
  return (
    <span className={`px-2 py-1 rounded-full border text-[11px] font-medium ${classes}`}>
      {status === 'idle' ? 'Idle' : status === 'starting' ? 'Starting' : status === 'running' ? 'Running' : status === 'success' ? 'Success' : status === 'error' ? 'Failed' : 'Canceled'}
    </span>
  )
}

function QueueRow({
  batchIndex,
  job,
  isActive,
  onRemove,
  onMove,
  onMakeNext,
  onContextMenu,
}: {
  batchIndex: number
  job: TrainerQueueJob
  isActive: boolean
  onRemove: (job: TrainerQueueJob) => void | Promise<void>
  onMove: (job: TrainerQueueJob, direction: 'up' | 'down') => void | Promise<void>
  onMakeNext: (job: TrainerQueueJob) => void | Promise<void>
  onContextMenu: (context: { job: TrainerQueueJob; x: number; y: number }) => void
}) {
  const esrTone = getEsrTone(job.validationEsr)
  const isQueued = job.status === 'queued'
  const statusClasses =
    job.status === 'success'
      ? 'text-emerald-700 dark:text-emerald-300'
      : job.status === 'error'
        ? 'text-red-700 dark:text-red-300'
        : job.status === 'canceled'
          ? 'text-amber-700 dark:text-amber-300'
          : job.status === 'running' || job.status === 'starting'
            ? 'text-indigo-700 dark:text-indigo-300'
            : 'text-gray-700 dark:text-gray-300'

  return (
    <div
      className={`px-3 py-2 rounded-lg border text-xs shadow-sm ${
        isActive
          ? 'bg-indigo-500/10 border-indigo-400/70 dark:border-indigo-600/80'
          : 'bg-gray-50 dark:bg-gray-900/55 border-gray-300 dark:border-gray-700/90'
      }`}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu({ job, x: event.clientX, y: event.clientY })
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => { void onMove(job, 'up') }}
            disabled={!isQueued}
            title="Move up"
            className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
          <button
            onClick={() => { void onMove(job, 'down') }}
            disabled={!isQueued}
            title="Move down"
            className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                  {batchIndex}
                </span>
                <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                {job.outputPath.replace(/\\/g, '/').split('/').pop()}
                </div>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-500">
                <span className="rounded-full border border-sky-300 dark:border-sky-800 bg-sky-500/10 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">
                  {job.profileName ?? (job.sourceMode === 'manual-direct' ? 'Manual queue' : job.sourceMode === 'watcher' ? 'Watcher' : 'Folder run')}
                </span>
                <span>{ARCHITECTURE_LABELS[job.architecture]}</span>
                <span>Attempt {job.attempts}</span>
                {typeof job.progressPercent === 'number' && <span>{job.progressPercent.toFixed(1)}%</span>}
                {typeof job.validationEsr === 'number' && <span className={esrTone.classes}>ESR {esrTone.text}</span>}
                {typeof job.thresholdEsr === 'number' && <span>Target {job.thresholdEsr}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`font-semibold whitespace-nowrap ${statusClasses}`}>
                {job.status.toUpperCase()}
              </div>
              {isQueued && (
                <button
                  onClick={() => { void onMakeNext(job) }}
                  className="px-2 py-1 rounded-md border border-indigo-300 dark:border-indigo-700 text-[11px] text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 whitespace-nowrap"
                >
                  Next
                </button>
              )}
              {job.status === 'success' && !!job.outputModelPath && (
                <button
                  onClick={() => window.api.revealFile(job.outputModelPath)}
                  className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-[11px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
                >
                  Show
                </button>
              )}
              {!isActive && (
                <button
                  onClick={() => { void onRemove(job) }}
                  title="Remove from queue"
                  className="w-6 h-6 flex items-center justify-center rounded-md border border-red-300/60 dark:border-red-800/60 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {!!job.error && (
        <div className="mt-1 text-[11px] text-red-700 dark:text-red-300 break-words">
          {job.error}
        </div>
      )}
    </div>
  )
}


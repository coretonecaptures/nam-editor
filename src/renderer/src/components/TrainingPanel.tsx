import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { AppSettings, TrainingPreset } from '../types/settings'
import {
  IDLE_TRAINER_STATE,
  TRAINER_ARCHITECTURES,
  type TrainerArchitecture,
  type TrainerHistoryEntry,
  type TrainerQueueJob,
  type TrainerStateSnapshot,
} from '../types/trainer'

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
  const [architectures, setArchitectures] = useState<TrainerArchitecture[]>(['standard'])
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
  const [queueProfileFilter, setQueueProfileFilter] = useState<string>('all')
  const [queueStatusFilter, setQueueStatusFilter] = useState<string>('all')
  const [queueArchitectureFilter, setQueueArchitectureFilter] = useState<string>('all')
  const [historyProfileFilter, setHistoryProfileFilter] = useState<string>('all')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all')
  const [historyArchitectureFilter, setHistoryArchitectureFilter] = useState<string>('all')
  const [historyTimeFilter, setHistoryTimeFilter] = useState<'all' | 'day' | 'week' | 'month' | 'quarter'>('all')
  const [historySearch, setHistorySearch] = useState('')
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
      if (historySearch.trim()) {
        const hay = `${entry.finalModelName} ${entry.sourcePath} ${entry.finalModelPath} ${entry.profileName ?? ''}`.toLowerCase()
        if (!hay.includes(historySearch.trim().toLowerCase())) return false
      }
      return true
    }),
    [historyArchitectureFilter, historyProfileFilter, historySearch, historyStatusFilter, historyTimeFilter, trainerState.history]
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
    const targetArchitectures = activePreset
      ? activePreset.architectures.filter((item): item is TrainerArchitecture =>
          TRAINER_ARCHITECTURES.includes(item as TrainerArchitecture)
        )
      : architectures
    if (manualRoutingMode === 'root' && !trainPath.trim()) {
      setLaunchError('Choose an output root before queueing captures.')
      return
    }

    const result = await window.api.enqueueTrainerRuns(
      (() => {
        const submissionId = `manual-direct-${Date.now()}`
        const submissionLabel = `Run WAVs - ${outputPaths.length} capture${outputPaths.length === 1 ? '' : 's'}`
        const submissionCreatedAt = new Date().toISOString()
        return outputPaths.flatMap((outputPath) => {
          const routing = getManualRoutingForOutput(outputPath.trim())
          return targetArchitectures.map((architecture) => ({
            pythonPath: settings.namPythonPath.trim(),
            inputPath: inputPath.trim(),
            outputPath: outputPath.trim(),
            trainPath: routing.finalModelRoot,
            architecture,
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
            submissionId,
            submissionLabel,
            submissionCreatedAt,
          }))
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
        architectures: preset.architectures.filter((item): item is TrainerArchitecture => TRAINER_ARCHITECTURES.includes(item as TrainerArchitecture)),
        epochs: preset.epochs,
        thresholdEsr: preset.thresholdEsr,
        latencyMode: preset.latencyMode,
        latencyValue: preset.latencyValue,
        savePlot: preset.savePlot,
        ignoreChecks: preset.ignoreChecks,
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
    const name = window.prompt('Preset name', `${architectures.map((item) => ARCHITECTURE_LABELS[item]).join(' + ')} ${parsedEpochs} epoch`)
    if (!name || !name.trim()) return
    const preset: TrainingPreset = {
      id: makePresetId(name),
      name: name.trim(),
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
    setLaunchError(`Saved preset "${preset.name}".`)
  }

  return (
    <div
      className={`overflow-y-auto ${maximized ? 'fixed inset-4 z-[70] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl h-auto' : 'h-full'}`}
      onContextMenu={showNativeTextContextMenu}
    >
      <div className="max-w-5xl mx-auto px-6 py-5 space-y-5">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-violet-100">Local Training</div>
              <p className="mt-1 text-xs text-violet-200/85">
                Queue one input DI with multiple reamped WAVs. NAM Lab runs them serially, keeps a local queue, and promotes the final
                .nam back to your chosen destination folder beside the ESR plot.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMaximized((v) => !v)}
                title={maximized ? 'Restore training panel' : 'Maximize training panel'}
                className={`p-2 rounded-lg transition-colors ${
                  maximized
                    ? 'bg-indigo-600 text-white'
                    : 'bg-violet-950/40 hover:bg-violet-900/60 text-violet-100 border border-violet-400/20'
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
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-violet-950/40 hover:bg-violet-900/60 text-violet-100 border border-violet-400/20"
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
            <Field label="Input Audio" hint="Trainer input / DI file">
              <PathPicker
                value={inputPath}
                placeholder="Select the trainer input WAV"
                onChange={setInputPath}
                onBrowse={handleBrowseInput}
              />
            </Field>

            {runMode === 'files' ? (
            <>
            <Field label="Output Audio">
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

            </>
            ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Run Folder Once</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500">Queue every WAV in a folder using a saved preset or custom settings from this page.</div>
                </div>
              </div>
              <Field label="Folder">
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
              </Field>
            </div>
            )}

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
                    <ArchitectureMultiSelect
                      values={architectures}
                      onChange={(next) => {
                        setArchitectures(next)
                        if (runMode === 'files') setSelectedPresetId(CUSTOM_PRESET_ID)
                        else setFolderRunProfileId(CUSTOM_PRESET_ID)
                      }}
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

                  <Field label="Target ESR">
                    <input
                      value={thresholdEsr}
                      onChange={(e) => setThresholdEsr(e.target.value)}
                      placeholder="Optional"
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

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-3 items-center">
              <ToggleRow label="Save ESR plot" checked={savePlot} onChange={setSavePlot} />
              <ToggleRow label="Ignore checks" checked={ignoreChecks} onChange={setIgnoreChecks} />
              <button
                onClick={handleSaveAsPreset}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Save as Preset
              </button>
              {runMode === 'files' ? (
                <button
                  onClick={handleQueue}
                  disabled={!canQueue}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white whitespace-nowrap"
                >
                  {(() => {
                    const totalJobs = outputPaths.length * (activePreset ? activePreset.architectures.length : architectures.length)
                    return totalJobs === 1 ? 'Queue capture' : `Queue ${totalJobs} captures`
                  })()}
                </button>
              ) : (
                <button
                  onClick={() => { void handleRunFolderOnce() }}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap"
                >
                  Queue folder
                </button>
              )}
            </div>
            </>
            )}

            {!showsCustomSettings && (
              <div className="flex justify-end">
                {runMode === 'files' ? (
                  <button
                    onClick={handleQueue}
                    disabled={!canQueue}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                  >
                    {(() => {
                      const totalJobs = outputPaths.length * (activePreset ? activePreset.architectures.length : architectures.length)
                      return totalJobs === 1 ? 'Queue capture' : `Queue ${totalJobs} captures`
                    })()}
                  </button>
                ) : (
                  <button
                    onClick={() => { void handleRunFolderOnce() }}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    Queue folder
                  </button>
                )}
              </div>
            )}

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4 items-end">
                <Field label="Output Routing">
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
            </>
            )}

          {runMode === 'history' ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 space-y-3">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Training History</div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
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

          {launchError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {launchError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={async () => {
                const result = await window.api.cancelTrainerRun()
                if (!result.success) setLaunchError(result.error ?? 'Could not cancel the active training run.')
              }}
              disabled={!isRunning}
              title="Hard-stop the current training run. NAM Lab will avoid promoting the final .nam when this is used."
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-red-700 dark:text-red-300"
            >
              Emergency stop
            </button>
            <button
              onClick={async () => { await window.api.setTrainerPauseAfterCurrent(!trainerState.pauseAfterCurrent) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${trainerState.pauseAfterCurrent ? 'bg-amber-500/20 text-amber-200' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
            >
              {trainerState.pauseAfterCurrent ? 'Pause after current: On' : 'Pause after current'}
            </button>
            <button
              onClick={async () => { await window.api.setTrainerPauseAfterCurrent(false) }}
              disabled={!trainerState.pauseAfterCurrent || queuedCount === 0 || isRunning}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
            >
              Resume queue
            </button>
            <button
              onClick={async () => { await window.api.retryFailedTrainerRuns() }}
              disabled={!trainerState.queue.some((job) => job.status === 'error')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
            >
              Retry failed
            </button>
            <button
              onClick={async () => { await window.api.removeQueuedTrainerRuns() }}
              disabled={!trainerState.queue.some((job) => job.status === 'queued')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
            >
              Remove queued
            </button>
            <button
              onClick={async () => { await window.api.clearFinishedTrainerRuns() }}
              disabled={!trainerState.queue.some((job) => ['success', 'error', 'canceled'].includes(job.status))}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
            >
              Clear finished
            </button>
            {!!trainerState.outputModelPath && (trainerState.status === 'success' || trainerState.status === 'error' || trainerState.status === 'canceled') && (
              <button
                onClick={() => window.api.revealFile(trainerState.outputModelPath || trainPath)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Reveal output
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={async () => { await window.api.startQueuedTrainerRuns() }}
              disabled={queuedCount === 0 || isRunning}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
            >
              Start queue
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Run Status</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    {activeJob
                      ? `${trainerState.status.toUpperCase()} - ${ARCHITECTURE_LABELS[activeJob.architecture]}`
                      : trainerState.queue.length > 0
                        ? `${queuedCount} queued - ${successCount} succeeded - ${failedCount} failed`
                        : 'No active training run'}
                  </div>
                </div>
                <StatusPill status={trainerState.status} />
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
                onClick={() => handleShowHistoryPath(historyContextMenu.entry.graphPath)}
                disabled={!historyContextMenu.entry.graphPath}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Show graph
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
        <span className="text-xs text-gray-500 dark:text-gray-400" aria-hidden="true">{open ? '^' : 'v'}</span>
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
            {typeof entry.thresholdEsr === 'number' && <span>Target {entry.thresholdEsr}</span>}
            {typeof entry.validationEsr === 'number' && <span className={esrTone.classes}>ESR {esrTone.text}</span>}
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
            className="w-5 h-5 rounded border border-gray-300 dark:border-gray-700 text-[10px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ^
          </button>
          <button
            onClick={() => { void onMove(job, 'down') }}
            disabled={!isQueued}
            title="Move down"
            className="w-5 h-5 rounded border border-gray-300 dark:border-gray-700 text-[10px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            v
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
                  className="w-6 h-6 rounded-md border border-red-300 dark:border-red-800 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20"
                >
                  x
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


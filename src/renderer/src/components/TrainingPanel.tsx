import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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
import { CaptureProfileEditor } from './CaptureProfileEditor'
import { WatcherFilesModal } from './WatcherFilesModal'
import { HelpPopover } from './HelpPopover'
import { effectiveFormula, resolveOutputFormula } from '../utils/resolveOutputFormula'
import { EsrCurve, QualityBars, Sparkline, StackedMeter } from './dashboard/Charts'

interface Props {
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => void
  onClose?: () => void
  initialRunMode?: 'files' | 'folder' | 'queue' | 'history'
  onOpenSetupGuide?: () => void
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

function architectureDisplayLabel(arch: string): string {
  if (arch === 'a2') return 'A2'
  return ARCHITECTURE_LABELS[arch as TrainerArchitecture] ?? arch
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
      : preset.architectures.map((item) => architectureDisplayLabel(item)).join(', ')
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

export function TrainingPanel({ settings, onSaveSettings, onClose, initialRunMode, onOpenSetupGuide }: Props) {
  const [inputPath, setInputPath] = useState(settings.namTrainingInputWav || '')
  const [section, setSection] = useState<'live' | 'queue' | 'history' | 'new'>('new')
  const [newRunMode, setNewRunMode] = useState<'files' | 'folder'>(
    initialRunMode === 'folder' ? 'folder' : 'files'
  )
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set())
  const [esrSeries, setEsrSeries] = useState<{ epoch: number; esr: number }[]>([])
  const [queueView, setQueueView] = useState<'batches' | 'compact' | 'board'>('batches')
  const [logExpanded, setLogExpanded] = useState(true)
  const [watchFoldersExpanded, setWatchFoldersExpanded] = useState(false)
  const [watcherFilesModal, setWatcherFilesModal] = useState<{ profileId: string; profileName: string; watchFolder: string; architectures: string[] } | null>(null)
  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [trainPath, setTrainPath] = useState('')
  const [manualRoutingMode, setManualRoutingMode] = useState<'root' | 'sibling_processed'>('root')
  const [formulaOverrideActive, setFormulaOverrideActive] = useState(false)
  const [graphFormulaOverrideActive, setGraphFormulaOverrideActive] = useState(false)
  const [folderRunPath, setFolderRunPath] = useState('')
  const [folderRunProfileId, setFolderRunProfileId] = useState<'custom' | string>('custom')
  const [selectedPresetId, setSelectedPresetId] = useState<string>(CUSTOM_PRESET_ID)
  const [namMode, setNamMode] = useState<'a1' | 'a2'>('a1')
  const [detectedNamVersion, setDetectedNamVersion] = useState<'a1' | 'a2' | 'unknown'>('unknown')
  const [architectures, setArchitectures] = useState<string[]>(['standard'])
  const [normalizeWavOverride, setNormalizeWavOverride] = useState<'global' | 'on' | 'off'>('off')
  const [normalizeWavTargetDb, setNormalizeWavTargetDb] = useState('')
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
  const [cancelBatchConfirm, setCancelBatchConfirm] = useState<{ submissionId: string; label: string } | null>(null)
  const rawLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (settings.namTrainingInputWav && !inputPath) setInputPath(settings.namTrainingInputWav)
  }, [settings.namTrainingInputWav, inputPath])

  useEffect(() => {
    const py = settings.namPythonPath.trim()
    if (!py) { setDetectedNamVersion('unknown'); return }
    setDetectedNamVersion('unknown')
    void window.api.detectNamVersion(py).then(({ version }) => setDetectedNamVersion(version))
  }, [settings.namPythonPath])

  useEffect(() => {
    if (!initialRunMode) return
    if (initialRunMode === 'queue') setSection('queue')
    else if (initialRunMode === 'history') setSection('history')
    else if (initialRunMode === 'folder') { setSection('new'); setNewRunMode('folder') }
    else { setSection('new'); setNewRunMode('files') }
  }, [initialRunMode])

  useEffect(() => {
    let disposed = false
    let lastActiveJobId: string | null = null
    void window.api.getTrainerState().then((state) => {
      if (!disposed) {
        setTrainerState(state)
        if (state.status === 'running' || state.status === 'starting') setSection('live')
        else if (state.queue.some(j => j.status === 'queued')) setSection('queue')
      }
    })
    const off = window.api.onTrainerUpdate((state) => {
      setTrainerState(state)
      if (state.activeJobId !== lastActiveJobId) {
        lastActiveJobId = state.activeJobId ?? null
        if (state.activeJobId) setEsrSeries([])
      }
      if ((state.status === 'running' || state.status === 'starting') && state.progressEpochCurrent && typeof state.validationEsr === 'number') {
        setEsrSeries(prev => {
          const epoch = state.progressEpochCurrent!
          if (prev.length > 0 && prev[prev.length - 1].epoch === epoch) return prev
          return [...prev, { epoch, esr: state.validationEsr as number }]
        })
      }
    })
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

  // Auto-collapse fully-finished batches (no queued/running items)
  useEffect(() => {
    setCollapsedBatches(prev => {
      const next = new Set(prev)
      for (const group of groupedQueue) {
        const hasActive = group.jobs.some(j => j.status === 'queued' || j.status === 'running' || j.status === 'starting')
        if (!hasActive) next.add(group.key)
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedQueue.length])

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
  const replicateEsrTone = getEsrTone(trainerState.replicateEsr)

  const resolvedModelName = useMemo(() => {
    const first = outputPaths[0] ?? ''
    const base = first.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '').trim() || 'model'
    return base
  }, [outputPaths])

  const manualRoutingSourceFolder = useMemo(() => {
    if (newRunMode === 'folder') return folderRunPath.trim()
    const first = outputPaths[0]?.trim() ?? ''
    if (!first) return ''
    return first.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  }, [folderRunPath, outputPaths, newRunMode])

  const availablePresets = useMemo(
    () => settings.trainingPresets.filter((preset) => preset.architectures.length > 0),
    [settings.trainingPresets]
  )
  const activePreset = useMemo(
    () => selectedPresetId === CUSTOM_PRESET_ID ? null : availablePresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [availablePresets, selectedPresetId]
  )
  const filesPreset = newRunMode === 'files' ? activePreset : null
  const manualFolderPresets = availablePresets

  // Output formula: global setting overridable per preset
  const activeFormula = useMemo(
    () => effectiveFormula(settings.trainingOutputFormula ?? '', activePreset?.outputFormulaOverride),
    [settings.trainingOutputFormula, activePreset]
  )
  // Graph formula: global setting overridable per preset
  const activeGraphFormula = useMemo(
    () => effectiveFormula(settings.trainingGraphFormula ?? '', activePreset?.graphOutputFormulaOverride),
    [settings.trainingGraphFormula, activePreset]
  )
  // Staging dir for files mode = parent directory of the first selected WAV
  const filesStagingDir = useMemo(() => {
    if (outputPaths.length === 0) return ''
    return outputPaths[0].replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  }, [outputPaths])
  // Pre-resolve formula for files mode preview (uses first arch)
  const formulaPreviewPath = useMemo(() => {
    if (!activeFormula || !filesStagingDir) return null
    const arch = (activePreset?.architectures[0] ?? architectures[0]) || 'Standard'
    return resolveOutputFormula(activeFormula, filesStagingDir, arch)
  }, [activeFormula, filesStagingDir, activePreset, architectures])
  const graphFormulaPreviewPath = useMemo(() => {
    if (!activeGraphFormula || !filesStagingDir) return null
    const arch = (activePreset?.architectures[0] ?? architectures[0]) || 'Standard'
    return resolveOutputFormula(activeGraphFormula, filesStagingDir, arch)
  }, [activeGraphFormula, filesStagingDir, activePreset, architectures])

  // Pre-resolve formula for folder run mode preview
  const folderFormulaPreviewPath = useMemo(() => {
    if (!activeFormula || !folderRunPath.trim()) return null
    const stagingDir = folderRunPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const arch = (activePreset?.architectures[0] ?? architectures[0]) || 'Standard'
    return resolveOutputFormula(activeFormula, stagingDir, arch)
  }, [activeFormula, folderRunPath, activePreset, architectures])
  const folderGraphFormulaPreviewPath = useMemo(() => {
    if (!activeGraphFormula || !folderRunPath.trim()) return null
    const stagingDir = folderRunPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const arch = (activePreset?.architectures[0] ?? architectures[0]) || 'Standard'
    return resolveOutputFormula(activeGraphFormula, stagingDir, arch)
  }, [activeGraphFormula, folderRunPath, activePreset, architectures])
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
        ? (!!trainPath.trim() || (!!activeFormula && !formulaOverrideActive && !!filesStagingDir))
        : (architectures.length > 0 && (!!trainPath.trim() || (!!activeFormula && !formulaOverrideActive && !!filesStagingDir)) && Number.isFinite(Number(epochs)) && Number(epochs) > 0)
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

  const getManualRoutingForOutput = (outputPath: string, architectureName?: string) => {
    if (manualRoutingMode === 'sibling_processed') {
      const sourceDir = outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      const processedRoot = `${sourceDir.replace(/\/+$/, '')}/_Processed`
      return {
        finalModelRoot: `${processedRoot}/Models`,
        processedWavRoot: '',
        graphRoot: `${processedRoot}/Graphs`,
        graphRootResolved: false,
        sourcePostProcess: 'keep' as const,
      }
    }
    // Formula mode: derive output from staging dir + architecture (unless user explicitly overrode)
    if ((activeFormula && !formulaOverrideActive) || (activeGraphFormula && !graphFormulaOverrideActive)) {
      const stagingDir = outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      const resolvedNam = (activeFormula && !formulaOverrideActive && architectureName)
        ? resolveOutputFormula(activeFormula, stagingDir, architectureName)
        : null
      const resolvedGraph = (activeGraphFormula && !graphFormulaOverrideActive && architectureName)
        ? resolveOutputFormula(activeGraphFormula, stagingDir, architectureName)
        : null
      if (resolvedNam || resolvedGraph) {
        return {
          finalModelRoot: resolvedNam ?? trainPath.trim(),
          processedWavRoot: '',
          graphRoot: resolvedGraph ?? trainPath.trim(),
          graphRootResolved: !!resolvedGraph,
          sourcePostProcess: 'keep' as const,
        }
      }
    }
    return {
      finalModelRoot: trainPath.trim(),
      processedWavRoot: '',
      graphRoot: trainPath.trim(),
      graphRootResolved: false,
      sourcePostProcess: 'keep' as const,
    }
  }

  const getManualFolderRouting = (architectureName?: string) => {
    if (manualRoutingMode === 'sibling_processed') {
      const sourceDir = folderRunPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      const processedRoot = `${sourceDir}/_Processed`
      return {
        finalModelRoot: `${processedRoot}/Models`,
        processedWavRoot: '',
        graphRoot: `${processedRoot}/Graphs`,
        graphRootResolved: false,
        sourcePostProcess: 'keep' as const,
      }
    }
    if ((activeFormula && !formulaOverrideActive) || (activeGraphFormula && !graphFormulaOverrideActive)) {
      const stagingDir = folderRunPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      const resolvedNam = (activeFormula && !formulaOverrideActive && architectureName)
        ? resolveOutputFormula(activeFormula, stagingDir, architectureName)
        : null
      const resolvedGraph = (activeGraphFormula && !graphFormulaOverrideActive && architectureName)
        ? resolveOutputFormula(activeGraphFormula, stagingDir, architectureName)
        : null
      if (resolvedNam || resolvedGraph) {
        return {
          finalModelRoot: resolvedNam ?? trainPath.trim(),
          processedWavRoot: '',
          graphRoot: resolvedGraph ?? trainPath.trim(),
          graphRootResolved: !!resolvedGraph,
          sourcePostProcess: 'keep' as const,
        }
      }
    }
    return {
      finalModelRoot: trainPath.trim(),
      processedWavRoot: '',
      graphRoot: trainPath.trim(),
      graphRootResolved: false,
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

  function resolveNormalize(override: 'global' | 'on' | 'off', targetDbStr: string): { normalizeWav: boolean; normalizeWavTargetDb: number } {
    const globalOn = settings.normalizeWavBeforeTraining ?? true
    const globalDb = settings.normalizeWavTargetDb ?? -5.0
    const on = override === 'on' ? true : override === 'off' ? false : globalOn
    const db = targetDbStr.trim() !== '' ? Number.parseFloat(targetDbStr) : globalDb
    return { normalizeWav: on, normalizeWavTargetDb: Number.isFinite(db) ? db : globalDb }
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
    const activeNamMode = activePreset?.namMode ?? namMode
    const targetArchitectures = activePreset ? activePreset.architectures : architectures
    if (activeNamMode === 'a1' && targetArchitectures.length === 0) {
      setLaunchError('Choose at least one architecture before queueing.')
      return
    }
    if (manualRoutingMode === 'root' && !trainPath.trim() && (!activeFormula || formulaOverrideActive)) {
      setLaunchError('Choose an output root or set an output formula in Settings before queueing.')
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
    const resolvedPythonPath = settings.namPythonPath.trim()
    const activeNormalizeOverride = activePreset?.normalizeWav ?? normalizeWavOverride
    const activeNormalizeTargetDb = activePreset?.normalizeWavTargetDb != null
      ? String(activePreset.normalizeWavTargetDb)
      : normalizeWavTargetDb
    const { normalizeWav: resolvedNormalizeWav, normalizeWavTargetDb: resolvedNormalizeDb } =
      resolveNormalize(activeNormalizeOverride as 'global' | 'on' | 'off', activeNormalizeTargetDb)

    const result = await window.api.enqueueTrainerRuns(
      (() => {
        const submissionId = `manual-direct-${Date.now()}`
        const submissionLabel = `Run WAVs - ${outputPaths.length} capture${outputPaths.length === 1 ? '' : 's'}`
        const submissionCreatedAt = new Date().toISOString()
        const jobArchitectures = activeNamMode === 'a2' ? ['a2'] : targetArchitectures
        return outputPaths.flatMap((outputPath) => {
          return jobArchitectures.map((architecture) => {
            const routing = getManualRoutingForOutput(outputPath.trim(), architecture)
            const profileCfg = activeNamMode === 'a1' ? lookupProfileConfig(architecture, settings.userCaptureProfiles ?? []) : null
            return {
              pythonPath: resolvedPythonPath,
              inputPath: inputPath.trim(),
              outputPath: outputPath.trim(),
              trainPath: routing.finalModelRoot,
              namMode: activeNamMode,
              architecture,
              waveNetConfig: profileCfg?.waveNetConfig ?? null,
              lr: profileCfg?.lr ?? 0.004,
              lrDecay: profileCfg?.lrDecay ?? 0.002,
              batchSize: profileCfg?.batchSize ?? 16,
              ny: profileCfg?.ny ?? 8192,
              fitMrstft: profileCfg?.fitMrstft ?? true,
              normalizeWav: resolvedNormalizeWav,
              normalizeWavTargetDb: resolvedNormalizeDb,
              captureProfileId: activeNamMode === 'a1' ? architecture : null,
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
              graphRootResolved: routing.graphRootResolved,
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
      namMode,
      architectures: namMode === 'a2' ? ['a2'] : architectures,
      epochs: parsedEpochs,
      thresholdEsr: parsedThresholdEsr,
      latencyMode: parsedLatency == null ? 'auto' : 'manual',
      latencyValue: parsedLatency,
      savePlot,
      ignoreChecks,
      normalizeWav: normalizeWavOverride,
      normalizeWavTargetDb: normalizeWavTargetDb.trim() !== '' ? Number.parseFloat(normalizeWavTargetDb) : null,
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
    if (manualRoutingMode === 'root' && !trainPath.trim() && (!activeFormula || formulaOverrideActive)) {
      setLaunchError('Choose an output root or set an output formula in Settings before running a folder.')
      return
    }
    const firstArch = preset.architectures[0] ?? 'Standard'
    const routing = getManualFolderRouting(firstArch)
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
        graphRootResolved: routing.graphRootResolved,
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
  const currentPresetId = newRunMode === 'files' ? selectedPresetId : folderRunProfileId
  const currentRunPreset = newRunMode === 'files' ? filesPreset : folderRunPreset
  const showsCustomSettings = currentPresetId === CUSTOM_PRESET_ID

  const handleRemoveJob = async (job: TrainerQueueJob) => {
    const result = await window.api.removeTrainerJob(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not remove that training queue item.')
    } else {
      setQueueActionError('')
    }
  }

  const handleCancelBatch = async (submissionId: string) => {
    const result = await window.api.cancelTrainerBatch(submissionId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not cancel that batch.')
    } else {
      setQueueActionError('')
    }
    setCancelBatchConfirm(null)
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
      setSection('queue')
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
    if (namMode === 'a1' && architectures.length === 0) {
      setLaunchError('Choose at least one architecture before saving a preset.')
      return
    }
    const autoName = namMode === 'a2'
      ? `A2 ${parsedEpochs} epoch`
      : `${architectures.map((item) => architectureDisplayLabel(item)).join(' + ')} ${parsedEpochs} epoch`
    setPresetNameDraft(autoName)
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
    if (namMode === 'a1' && architectures.length === 0) {
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
      namMode,
      architectures: namMode === 'a2' ? ['a2'] : architectures,
      epochs: parsedEpochs,
      thresholdEsr: parsedThresholdEsr,
      latencyMode: parsedLatency == null ? 'auto' : 'manual',
      latencyValue: parsedLatency,
      savePlot,
      ignoreChecks,
      normalizeWav: normalizeWavOverride,
      normalizeWavTargetDb: normalizeWavTargetDb.trim() !== '' ? Number.parseFloat(normalizeWavTargetDb) : null,
    }
    onSaveSettings({
      ...settings,
      trainingPresets: [...settings.trainingPresets, preset],
    })
    setSelectedPresetId(preset.id)
    if (newRunMode === 'folder') setFolderRunProfileId(preset.id)
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
      Architecture: architectureDisplayLabel(entry.architecture),
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

  // ── "This Session" stats ──────────────────────────────────────────────────
  const todayStats = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    const todayMs = d.getTime()
    const today = trainerState.history.filter(e => new Date(e.timestamp).getTime() >= todayMs)
    const completed = today.filter(e => e.status === 'success').length
    const failed = today.filter(e => e.status === 'error').length
    const esrs = today.filter(e => typeof e.validationEsr === 'number').map(e => e.validationEsr as number)
    const avgEsr = esrs.length > 0 ? esrs.reduce((a, b) => a + b, 0) / esrs.length : null
    const oneHrAgo = Date.now() - 3_600_000
    const throughput = trainerState.history.filter(e => new Date(e.timestamp).getTime() >= oneHrAgo && e.status === 'success').length
    return { completed, failed, avgEsr, throughput }
  }, [trainerState.history])

  const qualityBarsData = useMemo(() => {
    const now = Date.now()
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = now - (6 - i) * 86_400_000
      const d = new Date(dayStart); d.setHours(0, 0, 0, 0)
      const ds = d.getTime()
      const de = ds + 86_400_000
      const entries = trainerState.history.filter(e => {
        const t = new Date(e.timestamp).getTime()
        return t >= ds && t < de && e.status === 'success'
      })
      return {
        label: new Date(ds).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        green: entries.filter(e => typeof e.validationEsr === 'number' && (e.validationEsr as number) < 0.01).length,
        amber: entries.filter(e => typeof e.validationEsr === 'number' && (e.validationEsr as number) >= 0.01 && (e.validationEsr as number) < 0.05).length,
        red: entries.filter(e => typeof e.validationEsr === 'number' && (e.validationEsr as number) >= 0.05).length,
      }
    })
  }, [trainerState.history])

  const throughputData = useMemo(() => {
    const now = Date.now()
    return Array.from({ length: 12 }, (_, i) => {
      const hrStart = now - (11 - i) * 3_600_000
      return trainerState.history.filter(e => {
        const t = new Date(e.timestamp).getTime()
        return t >= hrStart && t < hrStart + 3_600_000 && e.status === 'success'
      }).length
    })
  }, [trainerState.history])

  const esrSparkline = useMemo(() =>
    esrSeries.map(pt => -Math.log10(Math.max(pt.esr, 1e-5))),
    [esrSeries]
  )

  const eta = useMemo(() => {
    if (!isRunning || !trainerState.startedAt || typeof trainerState.progressPercent !== 'number' || trainerState.progressPercent <= 0) return null
    const elapsed = Date.now() - new Date(trainerState.startedAt).getTime()
    const remaining = elapsed / (trainerState.progressPercent / 100) - elapsed
    if (remaining <= 0) return null
    const mins = Math.ceil(remaining / 60_000)
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
  }, [isRunning, trainerState.startedAt, trainerState.progressPercent])

  const activeJobName = activeJob
    ? activeJob.outputPath.replace(/\\/g, '/').split('/').pop() ?? 'Unknown'
    : 'No active run'
  const activeJobIdx = activeJob
    ? trainerState.queue.findIndex(j => j.jobId === activeJob.jobId) + 1
    : 0
  const totalJobs = trainerState.queue.length

  // drag refs for queue reordering
  const dragJobRef = useRef<string | null>(null)
  const dragBatchRef = useRef<string | null>(null)

  const toggleBatchCollapse = (key: string) => {
    setCollapsedBatches(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const navItem = (
    id: 'live' | 'queue' | 'history' | 'new',
    label: string,
    count: number | null,
    icon: React.ReactNode,
    accent = false
  ) => (
    <button
      key={id}
      onClick={() => setSection(id)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-[13px] font-medium transition-colors relative text-left ${
        section === id
          ? 'bg-active-bg text-nm-accent font-semibold'
          : 'text-nm-text-2 hover:bg-hov hover:text-nm-text'
      }`}
    >
      {section === id && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-5 rounded-r bg-nm-accent" />
      )}
      <span className={`w-4 h-4 flex-shrink-0 ${section === id ? 'text-nm-accent' : 'text-nm-text-3'}`}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== null && count > 0 && (
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none ${
          accent ? 'bg-nm-accent text-accent-text' : 'bg-panel-2 text-nm-text-2 border border-nm-border-s'
        }`}>
          {count}
        </span>
      )}
    </button>
  )

  return (
    <>
    <div className="flex h-full overflow-hidden bg-app-bg text-nm-text" onContextMenu={showNativeTextContextMenu}>
      {/* ── Left Rail ─────────────────────────────────────────────────────── */}
      <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-nm-border bg-panel overflow-y-auto">
        <div className="px-4 pt-4 pb-3 border-b border-nm-border">
          <div className="text-[10px] font-bold uppercase tracking-wider text-nm-text-3 mb-1">NAM Lab</div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <span className="text-[16px] font-[680] text-nm-text leading-tight">Local Training</span>
          </div>
        </div>

        <nav className="px-2 py-2 space-y-0.5">
          {navItem('live', 'Live Run', isRunning ? 1 : null, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
          ), isRunning)}
          {navItem('queue', 'Queue', trainerState.queue.length, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
          ))}
          {navItem('history', 'History', trainerState.history.length, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          ))}
          {navItem('new', 'New Run', null, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          ))}
        </nav>

        <div className="mx-3 my-1 border-t border-nm-border-s" />

        {/* This Session */}
        <div className="px-3 py-2 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-nm-text-3 px-1 mb-2">This Session</div>
          {[
            { label: 'Completed', value: String(todayStats.completed), color: 'text-emerald-400' },
            { label: 'Avg ESR', value: todayStats.avgEsr != null ? todayStats.avgEsr.toFixed(5) : '—', color: 'text-nm-text font-mono' },
            { label: 'Throughput', value: `${todayStats.throughput}/hr`, color: 'text-nm-text font-mono' },
            { label: 'Failed', value: String(todayStats.failed), color: todayStats.failed > 0 ? 'text-red-400' : 'text-nm-text-3' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between gap-2 rounded-[10px] border border-nm-border-s bg-panel-2 px-2.5 py-1.5">
              <span className="text-[11px] text-nm-text-3">{label}</span>
              <span className={`text-[13px] font-semibold tabular-nums ${color}`}>{value}</span>
            </div>
          ))}
        </div>

        <div className="mx-3 my-1 border-t border-nm-border-s" />

        {/* Watch Folders */}
        {settings.trainingWatchProfiles.length > 0 && (
          <div className="px-2 py-2">
            <button
              onClick={() => setWatchFoldersExpanded(v => !v)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hov text-nm-text-2 transition-colors"
            >
              <svg className={`w-3 h-3 transition-transform ${watchFoldersExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-wider flex-1 text-left">Watch Folders</span>
              {onOpenSetupGuide && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); onOpenSetupGuide() }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpenSetupGuide() } }}
                  className="text-[9px] text-nm-accent hover:underline cursor-pointer"
                >
                  Setup guide
                </span>
              )}
              {trainerState.watcherState.watchers.some(w => w.skippedCount > 0) && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">skipped</span>
              )}
              <span className="text-[10px] text-nm-text-3">{settings.trainingWatchProfiles.length}</span>
            </button>
            {watchFoldersExpanded && (
              <div className="mt-1 space-y-1">
                {settings.trainingWatchProfiles.map((profile) => {
                  const runtime = trainerState.watcherState.watchers.find(w => w.profileId === profile.id)
                  const running = runtime?.running ?? false
                  const skipped = runtime?.skippedCount ?? 0
                  return (
                    <div key={profile.id} className="px-2 py-1.5 rounded-lg border border-nm-border-s bg-panel-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${running ? 'bg-emerald-400' : 'bg-nm-text-3'}`} />
                        <span className="flex-1 truncate text-nm-text">{profile.name}</span>
                        {skipped > 0 && <span className="text-amber-400 tabular-nums">{skipped}s</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />
        {onClose && (
          <div className="px-3 py-3 border-t border-nm-border-s">
            <button onClick={onClose} className="w-full py-1.5 rounded-lg text-[12px] font-medium bg-panel-2 hover:bg-hov text-nm-text-2 border border-nm-border-s transition-colors">
              Close Training
            </button>
          </div>
        )}
      </div>

      {/* ── Main Column ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Now-Training strip */}
        <div className="flex-shrink-0 border-b border-nm-border bg-panel-2 px-5 py-3 space-y-2.5">
          {/* Top row */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Model thumbnail */}
            <div className="w-10 h-10 rounded-[9px] border border-nm-border bg-panel flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-nm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
              </svg>
            </div>
            {/* Model name + sub */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[16px] font-[660] text-nm-text truncate">{activeJobName}</span>
                {isRunning && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-nm-accent/15 border border-nm-accent/30 text-nm-accent text-[11px] font-semibold flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-nm-accent animate-pulse" />
                    Running
                  </span>
                )}
                {!isRunning && trainerState.pauseAfterCurrent && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-semibold flex-shrink-0">Paused</span>
                )}
                {!isRunning && !trainerState.pauseAfterCurrent && (
                  <span className="px-2 py-0.5 rounded-full bg-panel border border-nm-border-s text-nm-text-3 text-[11px] flex-shrink-0">Idle</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-nm-text-3 truncate">
                {activeJob && (
                  <>
                    <span className="px-1.5 py-0.5 rounded-full border border-nm-border-s bg-panel text-nm-text-2">{architectureDisplayLabel(activeJob.architecture)}</span>
                    {activeJob.profileName && (
                      <span className="px-1.5 py-0.5 rounded-full border border-sky-700/50 bg-sky-500/10 text-sky-400">{activeJob.profileName}</span>
                    )}
                    <span>model {activeJobIdx} of {totalJobs}</span>
                    <span className="font-mono truncate">{activeJob.outputPath.replace(/\\/g, '/').split('/').slice(-2).join('/')}</span>
                  </>
                )}
                {!activeJob && <span>No active run</span>}
              </div>
            </div>
            {/* Control bar */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={async () => {
                  const r = await window.api.cancelTrainerRun()
                  if (!r.success) setQueueActionError(r.error ?? 'Could not cancel.')
                }}
                disabled={!isRunning}
                title="Hard-stop the current run"
                className="h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-medium border bg-red-500/10 hover:bg-red-500/20 disabled:opacity-35 disabled:cursor-not-allowed text-red-400 border-red-500/40 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" rx="2" /></svg>
                Stop
              </button>
              <button
                onClick={async () => { await window.api.setTrainerPauseAfterCurrent(!trainerState.pauseAfterCurrent) }}
                className={`h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-medium border transition-colors ${
                  trainerState.pauseAfterCurrent
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-panel text-nm-text-2 border-nm-border hover:bg-hov'
                }`}
              >
                {trainerState.pauseAfterCurrent ? 'Pause: On' : 'Pause'}
              </button>
              {(trainerState.pauseAfterCurrent && !isRunning) && (
                <button
                  onClick={async () => { await window.api.setTrainerPauseAfterCurrent(false) }}
                  disabled={queuedCount === 0}
                  className="h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-semibold border bg-nm-accent hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed text-accent-text border-transparent transition-colors"
                >
                  Resume
                </button>
              )}
              <div className="w-px h-5 bg-nm-border-s mx-0.5" />
              <button
                onClick={async () => { await window.api.retryFailedTrainerRuns() }}
                disabled={!trainerState.queue.some(j => j.status === 'error')}
                className="h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-medium border bg-panel text-nm-text-2 border-nm-border hover:bg-hov disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                Retry failed
              </button>
              {queuedCount > 0 && !isRunning && (
                <button
                  onClick={async () => { await window.api.startQueuedTrainerRuns() }}
                  className="h-[34px] inline-flex items-center gap-1.5 px-3 rounded-[9px] text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white border-transparent border transition-colors"
                >
                  Start queue
                </button>
              )}
            </div>
          </div>

          {/* Progress row */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[11px] text-nm-text-3 mb-1">
                <span className="font-semibold text-nm-text-2">{trainerState.progressPhase || (isRunning ? 'Starting…' : 'Idle')}</span>
                <span className="font-mono">{trainerState.progressEpochCurrent && progressEpochTotal ? `Epoch ${trainerState.progressEpochCurrent} / ${progressEpochTotal}` : ''}</span>
                <span className="font-mono tabular-nums">{typeof trainerState.progressPercent === 'number' ? `${trainerState.progressPercent.toFixed(1)}%` : '—'}</span>
              </div>
              <div className="h-2 rounded-full bg-field overflow-hidden">
                <div
                  className="h-full bg-nm-accent rounded-full transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, trainerState.progressPercent ?? (trainerState.status === 'success' ? 100 : 0)))}%` }}
                />
              </div>
            </div>
            {/* Mini-stats */}
            <div className="flex items-center gap-3 flex-shrink-0 text-[10px] text-nm-text-3 uppercase font-medium">
              {[
                { label: 'Rate', value: typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(2)} it/s` : '—' },
                { label: 'Batch', value: trainerState.progressBatchCurrent && trainerState.progressBatchTotal ? `${trainerState.progressBatchCurrent}/${trainerState.progressBatchTotal}` : '—' },
                { label: 'Rep ESR', value: replicateEsrTone.text, extra: replicateEsrTone.classes },
                { label: 'Val ESR', value: validationEsrTone.text, extra: validationEsrTone.classes },
                { label: 'ETA', value: eta ?? '—' },
              ].map(({ label, value, extra }) => (
                <div key={label} className="text-center">
                  <div>{label}</div>
                  <div className={`text-[13px] font-semibold font-mono tabular-nums mt-0.5 normal-case ${extra ?? 'text-nm-text'}`}>{value}</div>
                </div>
              ))}
            </div>
            {/* ESR sparkline */}
            {esrSparkline.length > 1 && (
              <div className="flex-shrink-0">
                <Sparkline data={esrSparkline} width={80} height={24} color="var(--nm-accent,#6366f1)" strokeWidth={1.5} fill={true} />
              </div>
            )}
          </div>
        </div>

        {/* Section content */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ── LIVE RUN ───────────────────────────────────────────────────── */}
          {section === 'live' && (
            <div className="p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <h2 className="text-[18px] font-[680] text-nm-text">Live Run</h2>
                  <p className="text-[12px] text-nm-text-3 mt-0.5">Real-time training telemetry for the active model</p>
                </div>
              </div>

              {!isRunning && trainerState.status === 'idle' && (
                <div className="rounded-2xl border border-nm-border bg-panel p-8 text-center text-nm-text-3">
                  <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                  </svg>
                  <p className="text-[13px]">No run in progress. Start from the Queue or New Run tab.</p>
                </div>
              )}

              {(isRunning || esrSeries.length > 0) && (
                <div className="rounded-2xl border border-nm-border bg-panel/60 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13px] font-semibold text-nm-text">ESR over epochs</span>
                    <span className="text-[11px] text-nm-text-3">log scale · lower is better</span>
                  </div>
                  <EsrCurve
                    data={esrSeries}
                    width={600}
                    height={220}
                    target={typeof trainerState.thresholdEsr === 'number' ? trainerState.thresholdEsr : 0.01}
                    labels={true}
                    variant="area"
                    logScale={true}
                  />
                </div>
              )}

              {/* Stat cells */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  {
                    label: 'Epoch',
                    value: trainerState.progressEpochCurrent && progressEpochTotal
                      ? `${trainerState.progressEpochCurrent} / ${progressEpochTotal}`
                      : '—'
                  },
                  { label: 'Rate', value: typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(2)} it/s` : '—' },
                  { label: 'Validation ESR', value: validationEsrTone.text, extra: validationEsrTone.classes },
                  { label: 'Replicate ESR', value: replicateEsrTone.text, extra: replicateEsrTone.classes },
                  { label: 'Started', value: trainerState.startedAt ? new Date(trainerState.startedAt).toLocaleTimeString() : '—' },
                ].map(({ label, value, extra }) => (
                  <div key={label} className="rounded-xl border border-nm-border-s bg-panel-2 px-3 py-2.5">
                    <div className="text-[11px] text-nm-text-3 uppercase font-medium">{label}</div>
                    <div className={`mt-1 font-semibold font-mono tabular-nums ${extra ?? 'text-nm-text'}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Output paths */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-nm-border-s bg-panel-2 px-3 py-2.5">
                  <div className="text-[11px] text-nm-text-3">Final output</div>
                  <div className="mt-1 text-[12px] font-mono text-nm-text break-all">{trainerState.outputModelPath || '—'}</div>
                </div>
                <div className="rounded-xl border border-nm-border-s bg-panel-2 px-3 py-2.5">
                  <div className="text-[11px] text-nm-text-3">Checkpoint</div>
                  <div className="mt-1 text-[12px] font-mono text-nm-text break-all">{trainerState.checkpointModelPath || 'Appears after training starts'}</div>
                </div>
              </div>

              {/* Up next */}
              {groupedQueue.filter(g => g.jobs.some(j => j.status === 'queued')).length > 0 && (
                <div className="rounded-2xl border border-nm-border bg-panel/60 p-4">
                  <div className="text-[12px] font-semibold text-nm-text mb-2">
                    Up next · {groupedQueue.reduce((n, g) => n + g.jobs.filter(j => j.status === 'queued').length, 0)} queued
                  </div>
                  <div className="space-y-1">
                    {groupedQueue.flatMap(g => g.jobs.filter(j => j.status === 'queued')).slice(0, 4).map(job => (
                      <div key={job.jobId} className="flex items-center gap-2 text-[12px] text-nm-text-2">
                        <span className="flex-1 truncate font-mono">{job.outputPath.replace(/\\/g, '/').split('/').pop()}</span>
                        <span className="px-1.5 py-0.5 rounded border border-nm-border-s text-[10px] text-nm-text-3">{architectureDisplayLabel(job.architecture)}</span>
                        <span className="text-nm-text-3 tabular-nums">{job.epochs}ep</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw log */}
              <div className="rounded-2xl border border-nm-border bg-field overflow-hidden">
                <button
                  onClick={() => setLogExpanded(v => !v)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-nm-text-2 hover:bg-hov transition-colors"
                >
                  <svg className={`w-3 h-3 transition-transform ${logExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  Raw trainer log
                </button>
                {logExpanded && (
                  <div ref={rawLogRef} className="border-t border-nm-border p-3 h-[280px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] font-mono text-nm-text-2">
                    {trainerState.logs.length === 0
                      ? <span className="text-nm-text-3">Training logs will appear here.</span>
                      : trainerState.logs.join('\n')}
                  </div>
                )}
              </div>

              {!!trainerState.error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{trainerState.error}</div>
              )}
            </div>
          )}

          {/* ── QUEUE ──────────────────────────────────────────────────────── */}
          {section === 'queue' && (
            <div className="p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[18px] font-[680] text-nm-text">Queue</h2>
                <div className="flex items-center gap-1 rounded-lg border border-nm-border-s bg-panel-2 p-0.5">
                  {(['batches', 'compact', 'board'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setQueueView(v)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors ${queueView === v ? 'bg-active-bg text-nm-accent' : 'text-nm-text-3 hover:text-nm-text'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Metric tiles */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Queued', count: queuedCount, color: 'border-l-amber-500/70 text-amber-400' },
                  { label: 'Running', count: isRunning ? 1 : 0, color: 'border-l-nm-accent text-nm-accent' },
                  { label: 'Done', count: successCount, color: 'border-l-emerald-500/70 text-emerald-400' },
                  { label: 'Failed', count: failedCount, color: 'border-l-red-500/70 text-red-400' },
                ].map(({ label, count, color }) => (
                  <div key={label} className={`rounded-xl border border-nm-border-s bg-panel-2 px-3 py-2.5 border-l-[3px] ${color}`}>
                    <div className="text-[28px] font-[700] tabular-nums leading-none">{count}</div>
                    <div className="text-[10px] uppercase font-medium text-nm-text-3 mt-1">{label}</div>
                  </div>
                ))}
              </div>

              {/* Filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={queueProfileFilter}
                  onChange={e => setQueueProfileFilter(e.target.value)}
                  className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none"
                >
                  <option value="all">All profiles</option>
                  {queueProfileOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select
                  value={queueStatusFilter}
                  onChange={e => setQueueStatusFilter(e.target.value)}
                  className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  {['queued', 'running', 'success', 'error', 'canceled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  value={queueArchitectureFilter}
                  onChange={e => setQueueArchitectureFilter(e.target.value)}
                  className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none"
                >
                  <option value="all">All architectures</option>
                  {TRAINER_ARCHITECTURES.map(a => <option key={a} value={a}>{ARCHITECTURE_LABELS[a]}</option>)}
                </select>
                <span className="text-[11px] text-nm-text-3">drag to reorder · click ▸ to collapse</span>
              </div>

              {!!queueActionError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{queueActionError}</div>
              )}

              {/* Batch cards */}
              {groupedQueue.length === 0 ? (
                <div className="rounded-2xl border border-nm-border bg-panel p-8 text-center text-nm-text-3 text-[13px]">
                  Queue is empty. Add runs from the New Run tab.
                </div>
              ) : queueView === 'board' ? (
                <div className="grid grid-cols-4 gap-3">
                  {(['queued', 'running', 'success', 'error'] as const).map(status => (
                    <div key={status} className="rounded-xl border border-nm-border-s bg-panel-2 p-3 space-y-2">
                      <div className="text-[11px] font-semibold uppercase text-nm-text-3">{status}</div>
                      {filteredQueue.filter(j => j.status === status).map(job => (
                        <div key={job.jobId} className="rounded-lg border border-nm-border-s bg-panel p-2 text-[11px]">
                          <div className="font-mono truncate text-nm-text">{job.outputPath.replace(/\\/g, '/').split('/').pop()}</div>
                          <div className="text-nm-text-3 mt-0.5">{architectureDisplayLabel(job.architecture)}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : queueView === 'compact' ? (
                <div className="space-y-1">
                  {filteredQueue.map((job, idx) => {
                    const esrTone = getEsrTone(job.validationEsr)
                    return (
                      <div key={job.jobId} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] border ${job.jobId === trainerState.activeJobId ? 'border-nm-accent/40 bg-nm-accent/5' : 'border-nm-border-s bg-panel-2'}`}>
                        <span className="w-5 text-center text-nm-text-3 font-mono tabular-nums">{idx + 1}</span>
                        <span className="flex-1 font-mono truncate text-nm-text">{job.outputPath.replace(/\\/g, '/').split('/').pop()}</span>
                        <span className="text-nm-text-3">{architectureDisplayLabel(job.architecture)}</span>
                        {typeof job.validationEsr === 'number' && <span className={`font-mono ${esrTone.classes}`}>{esrTone.text}</span>}
                        <span className={`font-semibold uppercase text-[10px] ${job.status === 'success' ? 'text-emerald-400' : job.status === 'error' ? 'text-red-400' : job.status === 'running' ? 'text-nm-accent' : 'text-nm-text-3'}`}>
                          {job.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Batches view */
                <div className="space-y-3">
                  {groupedQueue.map((group) => {
                    const isCollapsed = collapsedBatches.has(group.key)
                    const hasActive = group.jobs.some(j => j.jobId === trainerState.activeJobId)
                    const doneCount = group.jobs.filter(j => j.status === 'success').length
                    const failCount = group.jobs.filter(j => j.status === 'error' || j.status === 'canceled').length
                    const runCount = group.jobs.filter(j => j.status === 'running' || j.status === 'starting').length
                    const queueCount = group.jobs.filter(j => j.status === 'queued').length
                    const total = group.jobs.length
                    const activeProgress = hasActive && typeof trainerState.progressPercent === 'number' ? trainerState.progressPercent / 100 : 0
                    const meterSegs = [
                      { value: doneCount, color: '#10b981', label: 'done' },
                      { value: failCount, color: '#ef4444', label: 'failed' },
                      { value: runCount * activeProgress, color: 'var(--nm-accent,#6366f1)', label: 'training' },
                      { value: runCount * (1 - activeProgress), color: 'rgba(99,102,241,0.18)', label: 'running' },
                      { value: queueCount, color: 'var(--field,#1e2433)', label: 'queued' },
                    ]
                    const isWatcher = group.jobs[0]?.sourceMode === 'watcher'
                    return (
                      <div
                        key={group.key}
                        className={`rounded-[13px] border ${hasActive ? 'border-nm-accent/50' : 'border-nm-border-s'} bg-panel overflow-hidden`}
                        draggable={queueCount > 0}
                        onDragStart={() => { dragBatchRef.current = group.jobs[0]?.submissionId ?? null }}
                        onDragOver={e => { e.preventDefault() }}
                        onDrop={async () => {
                          const fromId = dragBatchRef.current
                          const toId = group.jobs[0]?.submissionId ?? null
                          if (fromId && toId && fromId !== toId) {
                            await window.api.moveSubmissionBefore(fromId, toId)
                          }
                          dragBatchRef.current = null
                        }}
                      >
                        {/* Batch header */}
                        <div className={`flex items-center gap-2 px-3.5 py-3 bg-panel-2 border-b border-nm-border-s cursor-pointer select-none`}
                          onClick={() => toggleBatchCollapse(group.key)}
                        >
                          <svg className="w-3.5 h-3.5 text-nm-text-3 cursor-grab flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
                          </svg>
                          <svg className={`w-3 h-3 text-nm-text-3 flex-shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                          <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isWatcher ? 'text-amber-400' : 'text-nm-accent'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            {isWatcher
                              ? <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              : <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                            }
                          </svg>
                          <span className="flex-1 min-w-0 text-[13px] font-semibold text-nm-text truncate">{group.label}</span>
                          {hasActive && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-nm-accent/15 text-nm-accent text-[10px] font-semibold flex-shrink-0">
                              <span className="w-1 h-1 rounded-full bg-nm-accent animate-pulse" />active
                            </span>
                          )}
                          <div className="flex items-center gap-1.5 text-[10px] text-nm-text-3 flex-shrink-0">
                            {doneCount > 0 && <span className="text-emerald-400">{doneCount} done</span>}
                            {failCount > 0 && <span className="text-red-400">{failCount} failed</span>}
                            {queueCount > 0 && <span>{queueCount} queued</span>}
                          </div>
                          {queueCount > 0 && (
                            <button
                              onClick={e => { e.stopPropagation(); setCancelBatchConfirm({ submissionId: group.jobs[0]?.submissionId ?? '', label: group.label }) }}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-red-500/30 text-red-400 hover:bg-red-500/10 flex-shrink-0 transition-colors"
                              title="Cancel all queued jobs in this batch"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                              Cancel batch
                            </button>
                          )}
                        </div>
                        {/* Progress meter */}
                        <div className="px-3.5 pt-2 pb-1">
                          <StackedMeter segments={meterSegs} height={6} radius={3} gap={1} />
                          <div className="text-[10px] text-nm-text-3 mt-1">{doneCount}/{total} finished {total > 0 ? `· ${Math.round(doneCount/total*100)}%` : ''}</div>
                        </div>
                        {/* Items */}
                        {!isCollapsed && (
                          <div className="px-3 pb-3 space-y-1 mt-1">
                            {isWatcher && (
                              <div className="text-[11px] text-nm-text-3 font-mono px-2 py-1">{group.jobs[0]?.outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')} · auto-queues new files as they appear</div>
                            )}
                            {group.jobs.map((job, idx) => {
                              const esrTone = getEsrTone(job.validationEsr)
                              const isActive = job.jobId === trainerState.activeJobId
                              const isQueued = job.status === 'queued'
                              return (
                                <div
                                  key={job.jobId}
                                  draggable={isQueued}
                                  onDragStart={() => { if (isQueued) dragJobRef.current = job.jobId }}
                                  onDragOver={e => { if (isQueued) e.preventDefault() }}
                                  onDrop={async () => {
                                    const fromId = dragJobRef.current
                                    if (fromId && fromId !== job.jobId && isQueued) {
                                      await window.api.reorderTrainerJob(fromId, job.jobId)
                                    }
                                    dragJobRef.current = null
                                  }}
                                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] border transition-colors ${
                                    isActive ? 'border-nm-accent/40 bg-nm-accent/5' : 'border-nm-border-s bg-panel-2 hover:bg-hov'
                                  }`}
                                  onContextMenu={e => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setQueueContextMenu({ job, x: e.clientX, y: e.clientY })
                                  }}
                                >
                                  <svg className={`w-3 h-3 flex-shrink-0 ${isQueued ? 'text-nm-text-3 cursor-grab' : 'opacity-30 text-nm-text-3'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
                                  </svg>
                                  <span className="w-5 text-center text-nm-text-3 font-mono tabular-nums text-[10px]">{idx + 1}</span>
                                  {/* Status icon */}
                                  {job.status === 'success' && <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                  {job.status === 'error' && <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>}
                                  {job.status === 'canceled' && <svg className="w-3.5 h-3.5 text-nm-text-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" /></svg>}
                                  {(job.status === 'running' || job.status === 'starting') && <span className="w-3.5 h-3.5 flex-shrink-0 rounded-full bg-nm-accent/30 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-nm-accent animate-pulse" /></span>}
                                  {job.status === 'queued' && <svg className="w-3.5 h-3.5 text-nm-text-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                                  <div className="flex-1 min-w-0">
                                    <div className="font-mono truncate text-nm-text">{job.outputPath.replace(/\\/g, '/').split('/').pop()}</div>
                                    {job.status === 'error' && job.error && <div className="text-red-400 text-[11px] truncate">{job.error} · attempt {job.attempts}</div>}
                                    {(job.status === 'running' || job.status === 'starting') && <div className="text-[11px] text-nm-text-3 font-mono">Epoch {trainerState.progressEpochCurrent ?? '?'}/{progressEpochTotal ?? '?'} · {typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(2)} it/s` : '—'}</div>}
                                    {job.status === 'success' && <div className="text-[11px] text-nm-text-3">{architectureDisplayLabel(job.architecture)}</div>}
                                    {job.status === 'queued' && <div className="text-[11px] text-nm-text-3">Waiting in queue</div>}
                                  </div>
                                  {(job.status === 'running' || job.status === 'starting') && typeof job.progressPercent === 'number' && (
                                    <div className="w-16 h-1 rounded-full bg-field overflow-hidden flex-shrink-0">
                                      <div className="h-full bg-nm-accent rounded-full" style={{ width: `${job.progressPercent}%` }} />
                                    </div>
                                  )}
                                  {typeof job.validationEsr === 'number' && (
                                    <span className={`text-[11px] font-mono font-semibold flex-shrink-0 ${esrTone.classes}`}>{esrTone.text}</span>
                                  )}
                                  {/* Actions */}
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {job.status === 'queued' && job.jobId !== trainerState.queue.find(j => j.status === 'queued')?.jobId && (
                                      <button onClick={() => { void handleMakeNext(job) }} className="px-1.5 py-0.5 rounded text-[10px] border border-nm-border-s text-nm-text-2 hover:bg-hov">Next</button>
                                    )}
                                    {job.status === 'error' && <button onClick={() => { void handleRetryQueueItem(job) }} className="px-1.5 py-0.5 rounded text-[10px] border border-nm-border-s text-nm-text-2 hover:bg-hov">Retry</button>}
                                    {job.status === 'success' && job.outputModelPath && <button onClick={() => window.api.revealFile(job.outputModelPath)} className="px-1.5 py-0.5 rounded text-[10px] border border-nm-border-s text-nm-text-2 hover:bg-hov">Show</button>}
                                    {!isActive && <button onClick={() => { void handleRemoveJob(job) }} className="w-5 h-5 flex items-center justify-center rounded text-red-400 hover:bg-red-500/10 flex-shrink-0"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY ────────────────────────────────────────────────────── */}
          {section === 'history' && (
            <div className="p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <h2 className="text-[18px] font-[680] text-nm-text">History</h2>
                  <p className="text-[12px] text-nm-text-3 mt-0.5">{filteredHistory.length} completed, failed &amp; canceled runs</p>
                </div>
                <button
                  onClick={handleExportHistory}
                  disabled={filteredHistory.length === 0}
                  className="h-8 inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov disabled:opacity-40 disabled:cursor-not-allowed text-nm-text-2 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Export
                </button>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-nm-border bg-panel/60 p-4">
                  <div className="text-[12px] font-semibold text-nm-text mb-1">ESR quality · last 7 days</div>
                  <div className="text-[10px] text-nm-text-3 mb-2 flex gap-3">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> {'<0.01'}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> {'<0.05'}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> {'≥0.05'}</span>
                  </div>
                  <QualityBars groups={qualityBarsData} width={300} height={100} />
                </div>
                <div className="rounded-2xl border border-nm-border bg-panel/60 p-4">
                  <div className="text-[12px] font-semibold text-nm-text mb-3">Throughput · models/hour</div>
                  <Sparkline data={throughputData.map(v => Math.max(v, 0))} width={280} height={80} fill={true} />
                </div>
              </div>

              {/* Filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="Search…"
                  className="h-[34px] px-3 flex-1 min-w-[160px] bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text placeholder-nm-text-3 focus:outline-none"
                />
                <select value={historyStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none">
                  <option value="all">All statuses</option>
                  {['success', 'error', 'skipped', 'canceled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={historyProfileFilter} onChange={e => setHistoryProfileFilter(e.target.value)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none">
                  <option value="all">All profiles</option>
                  {Array.from(new Map(trainerState.history.filter(e => e.profileId || e.profileName).map(e => [e.profileId ?? e.profileName ?? 'manual', e.profileName ?? 'Manual'])).entries()).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={historyTimeFilter} onChange={e => setHistoryTimeFilter(e.target.value as typeof historyTimeFilter)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none">
                  {[['all','All time'],['day','Today'],['week','This week'],['month','This month'],['quarter','This quarter']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={historyEsrFilter} onChange={e => setHistoryEsrFilter(e.target.value as typeof historyEsrFilter)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text focus:outline-none">
                  {[['all','All ESR'],['green','Green (<0.01)'],['amber','Amber (<0.05)'],['red','Red (≥0.05)'],['none','No ESR']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Grouped history list */}
              {groupedHistory.length === 0 ? (
                <div className="rounded-2xl border border-nm-border bg-panel p-8 text-center text-nm-text-3 text-[13px]">No history entries match the current filters.</div>
              ) : (
                <div className="space-y-4">
                  {groupedHistory.map(group => {
                    const doneN = group.entries.filter(e => e.status === 'success').length
                    const failN = group.entries.filter(e => e.status === 'error').length
                    return (
                      <div key={group.key}>
                        <div className="flex items-center gap-2 px-1 mb-2">
                          <span className="text-[13px] font-semibold text-nm-text">{group.label}</span>
                          {doneN > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{doneN} done</span>}
                          {failN > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">{failN} failed</span>}
                          <span className="flex-1" />
                          <span className="text-[11px] text-nm-text-3 font-mono">{group.createdAt ? new Date(group.createdAt).toLocaleString() : ''}</span>
                        </div>
                        <div className="rounded-xl border border-nm-border-s bg-panel overflow-hidden divide-y divide-nm-border-s">
                          {group.entries.map(entry => {
                            const esrTone = getEsrTone(entry.validationEsr)
                            return (
                              <div
                                key={entry.historyId}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-hov transition-colors"
                                onContextMenu={e => {
                                  e.preventDefault()
                                  setHistoryContextMenu({ entry, x: e.clientX, y: e.clientY })
                                }}
                              >
                                {/* Thumbnail */}
                                <div className="w-11 h-8 rounded-lg border border-nm-border-s bg-panel-2 flex items-center justify-center flex-shrink-0">
                                  {entry.status === 'success'
                                    ? <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                                    : entry.status === 'error'
                                    ? <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                                    : <svg className="w-4 h-4 text-nm-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-nm-text truncate text-[13px]">{entry.finalModelName}</span>
                                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded border border-nm-border-s text-[10px] text-nm-text-3">{architectureDisplayLabel(entry.architecture)}</span>
                                    {entry.profileName && <span className="flex-shrink-0 px-1.5 py-0.5 rounded border border-sky-700/40 bg-sky-500/10 text-[10px] text-sky-400">{entry.profileName}</span>}
                                  </div>
                                  {entry.status === 'error' && entry.failureReason && (
                                    <div className="text-[11px] text-red-400 mt-0.5 truncate">{entry.failureReason}</div>
                                  )}
                                  {entry.status !== 'error' && (
                                    <div className="text-[11px] text-nm-text-3 font-mono mt-0.5">{entry.epochs} epochs · {entry.sourcePath.replace(/\\/g, '/').split('/').pop()}</div>
                                  )}
                                </div>
                                {typeof entry.validationEsr === 'number' && (
                                  <span className={`text-[12px] font-mono font-semibold flex-shrink-0 ${esrTone.classes}`}>{esrTone.text}</span>
                                )}
                                <span className="text-[11px] font-mono text-nm-text-3 flex-shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                {/* Hover actions */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {entry.graphPath && (
                                    <button onClick={() => { void handleShowGraphModal(entry.graphPath) }} className="w-7 h-7 flex items-center justify-center rounded-lg border border-nm-border-s hover:bg-hov text-nm-text-3 transition-colors" title="View ESR plot">
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
                                    </button>
                                  )}
                                  <button onClick={() => { void handleRetryHistoryEntry(entry) }} className="w-7 h-7 flex items-center justify-center rounded-lg border border-nm-border-s hover:bg-hov text-nm-text-3 transition-colors" title="Retry">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                  </button>
                                  {entry.finalModelPath && (
                                    <button onClick={() => { void window.api.revealFile(entry.finalModelPath) }} className="w-7 h-7 flex items-center justify-center rounded-lg border border-nm-border-s hover:bg-hov text-nm-text-3 transition-colors" title="Reveal in folder">
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── NEW RUN ────────────────────────────────────────────────────── */}
          {section === 'new' && (
            <div className="p-5 space-y-4 max-w-3xl">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[18px] font-[680] text-nm-text">New Run</h2>
                {presetSaveNotice && <span className="text-[12px] text-emerald-400">{presetSaveNotice}</span>}
              </div>

              {/* Sub-toggle */}
              <div className="flex rounded-xl border border-nm-border-s bg-panel-2 overflow-hidden">
                {(['files', 'folder'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setNewRunMode(mode)}
                    className={`flex-1 py-2.5 px-4 text-[13px] font-medium transition-colors ${newRunMode === mode ? 'bg-active-bg text-nm-accent' : 'text-nm-text-2 hover:bg-hov'}`}
                  >
                    {mode === 'files' ? 'Run WAVs' : 'Run Folder'}
                  </button>
                ))}
              </div>

              {/* Captures card */}
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4 space-y-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-500">Captures</span>
                <Field label="Input DI" hint="Trainer reference / DI file">
                  <PathPicker value={inputPath} placeholder="Select the trainer input WAV" onChange={setInputPath} onBrowse={handleBrowseInput} />
                </Field>
                {newRunMode === 'files' ? (
                  <Field label="Output WAVs">
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button onClick={() => { void handleBrowseOutputs() }} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-field border border-field-bd hover:bg-hov text-nm-text transition-colors">Choose WAVs…</button>
                        {outputPaths.length > 0 && <button onClick={() => setOutputPaths([])} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-field border border-field-bd hover:bg-hov text-nm-text transition-colors">Clear</button>}
                      </div>
                      <div className="rounded-lg border border-field-bd bg-field px-3 py-2 text-[12px] text-nm-text font-mono min-h-[72px] max-h-[160px] overflow-y-auto">
                        {outputPaths.length === 0
                          ? <span className="text-nm-text-3 italic">No output WAVs selected yet.</span>
                          : <div className="space-y-0.5">{outputPaths.map(p => <div key={p} className="break-all">{p}</div>)}</div>
                        }
                      </div>
                    </div>
                  </Field>
                ) : (
                  <div>
                    <div className="text-[12px] font-medium text-nm-text-3 mb-1">Folder</div>
                    <div className="text-[11px] text-nm-text-3 mb-2">Queue every WAV in a folder using a saved preset or custom settings.</div>
                    <PathPicker
                      value={folderRunPath}
                      placeholder="Choose a folder containing WAV files"
                      onChange={setFolderRunPath}
                      onBrowse={async () => {
                        const path = await window.api.openFolder(folderRunPath || trainPath || undefined)
                        if (path) setFolderRunPath(path)
                      }}
                      browseLabel="Folder…"
                    />
                  </div>
                )}
              </div>

              {/* Training settings card */}
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.05] p-4 space-y-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">Training Settings</span>
                  <HelpPopover title="Training Settings" side="right">
                    Configure the architecture, epochs, and model type for this run. Choose a saved <strong>Preset</strong> to load a full configuration in one click, or set <strong>Custom</strong> to adjust each field individually.
                    <br /><br />
                    The <strong>Architecture(s)</strong> picker includes built-in WaveNet sizes and any <strong>Capture Profiles</strong> you have saved in Settings → Training. A Capture Profile lets you store a custom layer config alongside an epoch count so you can reuse it.
                  </HelpPopover>
                </div>

                <div className="grid grid-cols-[1fr_1fr] gap-3">
                  <Field label="Preset">
                    <select
                      value={currentPresetId}
                      onChange={e => {
                        if (newRunMode === 'files') applyPreset(e.target.value)
                        else setFolderRunProfileId(e.target.value)
                      }}
                      className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none"
                    >
                      <option value={CUSTOM_PRESET_ID}>Custom</option>
                      {availablePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>

                  {currentRunPreset ? (
                    <div className="self-end">
                      <div className="h-10 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 text-[12px] text-sky-300 flex items-center">
                        {describePreset(currentRunPreset)}
                      </div>
                    </div>
                  ) : (
                    <Field label="NAM Version">
                      <div className="flex rounded-lg overflow-hidden border border-field-bd text-[12px]">
                        <button onClick={() => setNamMode('a1')} className={`flex-1 py-2 px-3 font-medium transition-colors ${namMode === 'a1' ? 'bg-nm-accent text-accent-text' : 'bg-field text-nm-text-2 hover:bg-hov'}`}>A1 WaveNet</button>
                        <button
                          onClick={() => setNamMode('a2')}
                          disabled={detectedNamVersion !== 'a2'}
                          title={detectedNamVersion === 'a1' ? 'A2 requires NAM ≥ 0.13.0 — your install is A1 only' : detectedNamVersion === 'unknown' ? 'Set a Python path to check A2 support' : undefined}
                          className={`flex-1 py-2 px-3 font-medium transition-colors ${detectedNamVersion !== 'a2' ? 'opacity-40 cursor-not-allowed bg-field text-nm-text-2' : namMode === 'a2' ? 'bg-nm-accent text-accent-text' : 'bg-field text-nm-text-2 hover:bg-hov'}`}
                        >A2</button>
                      </div>
                    </Field>
                  )}
                </div>

                {showsCustomSettings && (
                  <div className={`grid gap-3 ${namMode === 'a2' ? 'grid-cols-[160px_100px_140px]' : 'grid-cols-[1fr_100px_140px_100px]'}`}>
                    {namMode === 'a1' && (
                      <Field label="Architecture(s)" help={<>Each architecture produces a <code>.nam</code> of different size and quality. <strong>Standard</strong> = best quality, more CPU. <strong>Lite/Feather/Nano</strong> = faster but lower fidelity.</>}>
                        <ArchitectureMultiSelect
                          values={architectures}
                          onChange={next => {
                            setArchitectures(next)
                            if (newRunMode === 'files') setSelectedPresetId(CUSTOM_PRESET_ID)
                            else setFolderRunProfileId(CUSTOM_PRESET_ID)
                          }}
                          userProfiles={settings.userCaptureProfiles ?? []}
                          onCreateProfile={() => { setCaptureProfileEditorTarget(null); setCaptureProfileEditorOpen(true) }}
                          onEditProfile={profile => { setCaptureProfileEditorTarget(profile); setCaptureProfileEditorOpen(true) }}
                        />
                      </Field>
                    )}
                    <Field label="Epochs">
                      <input value={epochs} onChange={e => setEpochs(e.target.value)} className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none" />
                    </Field>
                    <Field label="Latency" hint="blank = auto">
                      <input value={latency} onChange={e => setLatency(e.target.value)} className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none" placeholder="Auto" />
                    </Field>
                    <Field label="Target ESR" labelTitle="blank = off">
                      <input value={thresholdEsr} onChange={e => setThresholdEsr(e.target.value)} className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none" placeholder="—" />
                    </Field>
                  </div>
                )}
                {showsCustomSettings && epochNote && (
                  <div className="text-[11px] text-amber-400">{epochNote}</div>
                )}
                {showsCustomSettings && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Normalize"
                      help={<>Normalize the output WAV to a target dBFS before training. <strong>Global</strong> uses the setting in the Training Settings page. On/Off overrides for this run only.</>}
                    >
                      <div className="flex gap-2">
                        <select
                          value={normalizeWavOverride}
                          onChange={e => setNormalizeWavOverride(e.target.value as typeof normalizeWavOverride)}
                          className="flex-1 h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none"
                        >
                          <option value="global">Global ({(settings.normalizeWavBeforeTraining ?? true) ? 'on' : 'off'})</option>
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                        {normalizeWavOverride !== 'off' && (
                          <input
                            value={normalizeWavTargetDb}
                            onChange={e => setNormalizeWavTargetDb(e.target.value)}
                            placeholder={String(settings.normalizeWavTargetDb ?? -5.0)}
                            className="w-20 h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none font-mono"
                          />
                        )}
                      </div>
                    </Field>
                    <div className="flex flex-col gap-2">
                      <ToggleRow label="Save ESR plot" checked={savePlot} onChange={setSavePlot} />
                      <ToggleRow label="Ignore checks" checked={ignoreChecks} onChange={setIgnoreChecks} />
                    </div>
                  </div>
                )}
                {showsCustomSettings && (
                  <button onClick={handleSaveAsPreset} className="text-[12px] text-nm-accent hover:underline">Save as preset…</button>
                )}
              </div>

              {/* Output routing card */}
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4 space-y-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">Output Routing</span>
                  <HelpPopover side="right">
                    NAM Lab routes the final .nam and ESR graph to the configured destination. You can use a <strong>formula</strong> (from Settings → Training → Output Formula) for automatic token-based routing, or specify a fixed folder manually.
                  </HelpPopover>
                </div>

                {activeFormula && manualRoutingMode === 'root' && (() => {
                  const previewPath = newRunMode === 'folder' ? folderFormulaPreviewPath : formulaPreviewPath
                  const hasSource = newRunMode === 'folder' ? !!folderRunPath.trim() : !!filesStagingDir
                  return (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-[11px] font-semibold text-emerald-400">NAM output formula active</span>
                        <code className="text-[10px] font-mono text-emerald-500 bg-emerald-900/30 px-1 rounded">{activeFormula}</code>
                      </div>
                      {previewPath && hasSource && <div className="pl-5 text-[11px] text-emerald-400 font-mono break-all">→ {previewPath}</div>}
                      {!hasSource && <div className="pl-5 text-[11px] text-emerald-500 italic">{newRunMode === 'folder' ? 'Choose a folder to preview' : 'Select WAVs to preview'}</div>}
                      {!formulaOverrideActive && (
                        <div className="pl-5 flex items-center gap-2">
                          <span className="text-[10px] text-nm-text-3">Override for this run:</span>
                          <button onClick={() => setFormulaOverrideActive(true)} className="text-[10px] text-nm-text-3 hover:text-amber-400 border border-nm-border-s hover:border-amber-500/60 rounded px-1.5 py-0.5 transition-colors">Use fixed path…</button>
                        </div>
                      )}
                      {formulaOverrideActive && (
                        <div className="pl-5 flex items-center gap-2">
                          <span className="text-[11px] text-amber-400 font-medium">Override active</span>
                          <button onClick={() => { setFormulaOverrideActive(false); setTrainPath('') }} className="text-[10px] text-nm-text-3 hover:text-nm-text underline">Cancel</button>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {activeGraphFormula && manualRoutingMode === 'root' && (() => {
                  const previewPath = newRunMode === 'folder' ? folderGraphFormulaPreviewPath : graphFormulaPreviewPath
                  const hasSource = newRunMode === 'folder' ? !!folderRunPath.trim() : !!filesStagingDir
                  return (
                    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-[11px] font-semibold text-violet-400">Graph formula active</span>
                        <code className="text-[10px] font-mono text-violet-500 bg-violet-900/30 px-1 rounded">{activeGraphFormula}</code>
                      </div>
                      {previewPath && hasSource && <div className="pl-5 text-[11px] text-violet-400 font-mono break-all">→ {previewPath}</div>}
                      {!hasSource && <div className="pl-5 text-[11px] text-violet-500 italic">{newRunMode === 'folder' ? 'Choose a folder to preview' : 'Select WAVs to preview'}</div>}
                    </div>
                  )
                })()}

                <div className={`grid grid-cols-[200px_1fr] gap-3 items-end ${activeFormula && !formulaOverrideActive ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                  <Field label="Routing Mode">
                    <select
                      value={manualRoutingMode}
                      onChange={e => setManualRoutingMode(e.target.value as typeof manualRoutingMode)}
                      disabled={!!(activeFormula && !formulaOverrideActive)}
                      className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none"
                    >
                      <option value="root">Choose output root</option>
                      <option value="sibling_processed">Use sibling _Processed</option>
                    </select>
                  </Field>
                  {manualRoutingMode === 'root' ? (
                    <Field label="NAM Output Root">
                      <PathPicker value={trainPath} placeholder="Select a destination folder" onChange={setTrainPath} onBrowse={async () => { const p = await window.api.openFolder(trainPath || undefined); if (p) setTrainPath(p) }} browseLabel="Folder…" />
                    </Field>
                  ) : (
                    <div className="rounded-lg border border-nm-border-s bg-field px-3 py-2 text-[12px] text-nm-text-3">
                      Outputs promoted to <code>_Processed/Models</code> and <code>_Processed/Graphs</code> relative to the source.
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-nm-text-3">
                  Example model: <code className="font-mono">{exampleFinalModelPath}</code>
                  <span className="mx-2">·</span>
                  Example graph: <code className="font-mono">{exampleGraphPath}</code>
                </div>
              </div>

              {launchError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{launchError}</div>
              )}

              {/* CTA */}
              <button
                onClick={newRunMode === 'files' ? () => { void handleQueue() } : () => { void handleRunFolderOnce() }}
                disabled={newRunMode === 'files' ? !canQueue : false}
                className="w-full py-3 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white bg-nm-accent hover:opacity-90"
              >
                {newRunMode === 'files' ? (() => {
                  const total = outputPaths.length * (activePreset ? activePreset.architectures.length : architectures.length)
                  return total === 1 ? 'Queue capture' : `Queue ${total} captures`
                })() : 'Queue folder'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>

    {/* ── Context menus ─────────────────────────────────────────────────────── */}
    {queueContextMenu && (
      <div
        className="fixed z-50 min-w-[220px] rounded-xl border border-nm-border bg-panel shadow-xl overflow-hidden"
        style={{ left: queueContextMenu.x, top: queueContextMenu.y }}
        onMouseDown={e => e.stopPropagation()}
      >
        {queueContextMenu.job.sourceMode === 'watcher' && queueContextMenu.job.status === 'queued' && (
          <>
            <button onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'remove') }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Remove from queue</button>
            <button onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'skip') }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Skip until manually retried</button>
            <button onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'move-canceled') }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Move to _Canceled and remove</button>
            <button onClick={() => { void handleWatcherQueueAction(queueContextMenu.job, 'retry-now') }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Retry now</button>
          </>
        )}
        <button
          onClick={() => handleShowQueueItemInFolder(queueContextMenu.job)}
          disabled={queueContextMenu.job.status !== 'success' || !queueContextMenu.job.outputModelPath}
          className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Show in folder
        </button>
        <button
          onClick={() => { void handleRetryQueueItem(queueContextMenu.job) }}
          disabled={!['error', 'canceled'].includes(queueContextMenu.job.status)}
          className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Retry
        </button>
      </div>
    )}

    {historyContextMenu && (
      <div
        className="fixed z-50 min-w-[200px] rounded-xl border border-nm-border bg-panel shadow-xl overflow-hidden"
        style={{ left: historyContextMenu.x, top: historyContextMenu.y }}
        onMouseDown={e => e.stopPropagation()}
      >
        {historyContextMenu.entry.graphPath && (
          <button onClick={() => { void handleShowGraphModal(historyContextMenu.entry.graphPath) }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">View ESR plot</button>
        )}
        <button onClick={() => { void handleRetryHistoryEntry(historyContextMenu.entry) }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Retry</button>
        {historyContextMenu.entry.finalModelPath && (
          <button onClick={() => handleShowHistoryPath(historyContextMenu.entry.finalModelPath)} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Reveal in folder</button>
        )}
      </div>
    )}

    {/* Graph modal */}
    {graphModalSrc && createPortal(
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" onClick={() => setGraphModalSrc(null)}>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <img src={graphModalSrc} alt="Training graph" className="block max-w-[90vw] max-h-[88vh] object-contain rounded-xl" />
          <button onClick={() => setGraphModalSrc(null)} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors" title="Close">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>,
      document.body
    )}

    {/* Save preset modal */}
    {showSavePresetModal && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-nm-border bg-panel shadow-2xl">
          <div className="px-5 py-4 border-b border-nm-border">
            <div className="text-[14px] font-semibold text-nm-text">Save Preset</div>
            <div className="mt-1 text-[12px] text-nm-text-3">Save the current training recipe so you can reuse it later.</div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <Field label="Preset Name">
              <input
                value={presetNameDraft}
                onChange={e => { setPresetNameDraft(e.target.value); if (presetSaveError) setPresetSaveError('') }}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirmSavePreset() }}
                autoFocus
                className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none"
              />
            </Field>
            {presetSaveError && <div className="text-[12px] text-red-400">{presetSaveError}</div>}
          </div>
          <div className="px-5 py-4 border-t border-nm-border flex justify-end gap-2">
            <button onClick={() => { setShowSavePresetModal(false); setPresetSaveError('') }} className="px-4 py-2 rounded-lg text-[13px] font-medium bg-field border border-field-bd hover:bg-hov text-nm-text transition-colors">Cancel</button>
            <button onClick={handleConfirmSavePreset} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-nm-accent hover:opacity-90 text-accent-text transition-colors">Save preset</button>
          </div>
        </div>
      </div>
    )}

    {/* Watcher files modal */}
    {watcherFilesModal && (
      <WatcherFilesModal
        profileId={watcherFilesModal.profileId}
        profileName={watcherFilesModal.profileName}
        watchFolder={watcherFilesModal.watchFolder}
        architectures={watcherFilesModal.architectures}
        onClose={() => setWatcherFilesModal(null)}
      />
    )}

    {captureProfileEditorOpen && (
      <CaptureProfileEditor
        profile={captureProfileEditorTarget}
        onSave={saved => {
          const existing = settings.userCaptureProfiles ?? []
          const updated = existing.some(p => p.id === saved.id)
            ? existing.map(p => p.id === saved.id ? saved : p)
            : [...existing, saved]
          onSaveSettings({ ...settings, userCaptureProfiles: updated })
          setCaptureProfileEditorOpen(false)
          setCaptureProfileEditorTarget(null)
        }}
        onCancel={() => { setCaptureProfileEditorOpen(false); setCaptureProfileEditorTarget(null) }}
      />
    )}

    {/* Cancel batch confirmation */}
    {cancelBatchConfirm && (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-nm-border bg-panel shadow-2xl">
          <div className="px-5 py-4 border-b border-nm-border">
            <div className="text-[14px] font-semibold text-nm-text">Cancel batch?</div>
            <div className="mt-1 text-[12px] text-nm-text-3 break-all">{cancelBatchConfirm.label}</div>
          </div>
          <div className="px-5 py-4 text-[13px] text-nm-text-2">
            All queued jobs in this batch will be canceled. Any currently running job in this batch will also be stopped. Completed jobs are unaffected.
          </div>
          <div className="px-5 pb-4 flex justify-end gap-2">
            <button
              onClick={() => setCancelBatchConfirm(null)}
              className="h-9 px-4 rounded-xl text-[13px] border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
            >Keep</button>
            <button
              onClick={() => { void handleCancelBatch(cancelBatchConfirm.submissionId) }}
              className="h-9 px-4 rounded-xl text-[13px] bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
            >Cancel batch</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function Field({ label, hint, labelTitle, help, children }: { label: string; hint?: string; labelTitle?: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        <label title={labelTitle} className={`text-xs font-medium text-gray-500 dark:text-gray-400 ${labelTitle ? 'cursor-help' : ''}`}>
          {label}
          {labelTitle && <span className="ml-1 text-gray-400 dark:text-gray-600">ⓘ</span>}
          {hint && <span className="ml-2 text-gray-500 dark:text-gray-500 font-normal">{hint}</span>}
        </label>
        {help && <HelpPopover>{help}</HelpPopover>}
      </div>
      {children}
    </div>
  )
}

function ArchitectureMultiSelect({ values, onChange, userProfiles = [], onCreateProfile, onEditProfile }: { values: string[]; onChange: (next: string[]) => void; userProfiles?: import('../types/settings').UserCaptureProfile[]; onCreateProfile?: () => void; onEditProfile?: (profile: import('../types/settings').UserCaptureProfile) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const allOptions = [
    ...TRAINER_ARCHITECTURES.map((id) => ({ id, name: ARCHITECTURE_LABELS[id] ?? id })),
    ...userProfiles.map((p) => ({ id: p.id, name: p.name })),
  ]
  const label =
    values.length === 0
      ? 'Choose profiles'
      : values.length === 1
        ? (allOptions.find((o) => o.id === values[0])?.name ?? values[0])
        : `${values.length} selected`

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
            {TRAINER_ARCHITECTURES.length > 0 && (
              <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Built-in</div>
            )}
            {TRAINER_ARCHITECTURES.map((option) => {
              const checked = values.includes(option)
              return (
                <label key={option} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-sm ${checked ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onChange([...values, option]); else onChange(values.filter((item) => item !== option)) }} className="accent-indigo-600" />
                  <span>{ARCHITECTURE_LABELS[option] ?? option}</span>
                </label>
              )
            })}
            {userProfiles.length > 0 && (
              <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 mt-1">Custom</div>
            )}
            {userProfiles.map((profile) => {
              const checked = values.includes(profile.id)
              return (
                <div key={profile.id} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${checked ? 'bg-indigo-500/10' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <label className="flex items-center gap-2 flex-1 cursor-pointer text-sm">
                    <input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onChange([...values, profile.id]); else onChange(values.filter((item) => item !== profile.id)) }} className="accent-indigo-600" />
                    <span className={checked ? 'text-indigo-700 dark:text-indigo-200' : 'text-gray-800 dark:text-gray-200'}>{profile.name}</span>
                  </label>
                  {onEditProfile && (
                    <button onClick={() => { onEditProfile(profile); setOpen(false) }} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1">Edit</button>
                  )}
                </div>
              )
            })}
            {onCreateProfile && (
              <button onClick={() => { onCreateProfile(); setOpen(false) }} className="w-full text-left px-2.5 py-1.5 text-[11px] text-indigo-500 dark:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 border-t border-gray-100 dark:border-gray-800 mt-1">
                + New capture profile…
              </button>
            )}
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

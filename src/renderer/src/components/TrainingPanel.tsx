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
import { EsrCurve, ProgressRing, QualityBars, Sparkline, StackedMeter } from './dashboard/Charts'

type BatchWavItem = { id: string; path: string; name: string; fromFolder?: string }

interface Props {
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => void
  onClose?: () => void
  initialRunMode?: 'files' | 'folder' | 'queue' | 'history'
  onOpenSetupGuide?: () => void
  onOpenSettings?: (tab?: 'global' | 'defaults' | 'metadata' | 'pack' | 'training') => void
}

const ARCHITECTURE_LABELS: Record<TrainerArchitecture, string> = {
  a2: 'A2',
  standard: 'Standard',
  complex: 'Complex',
  lite: 'Lite',
  feather: 'Feather',
  nano: 'Nano',
  revystd: 'REVySTD',
  revyhi: 'REVyHI',
  revxstd: 'REVxSTD',
}

// Display order for the architecture multi-select — A2 first, then A1 variants in capability order.
const ARCHITECTURE_DISPLAY_ORDER: TrainerArchitecture[] = ['a2', 'standard', 'complex', 'lite', 'feather', 'nano', 'revystd', 'revyhi', 'revxstd']

// "A1 - Standard" / "A2" — used in pickers where the namMode is non-obvious.
function architectureFullLabel(arch: string): string {
  if (arch === 'a2') return 'A2'
  const short = ARCHITECTURE_LABELS[arch as TrainerArchitecture]
  return short ? `A1 - ${short}` : arch
}

// Per-job namMode: 'a2' architecture maps to A2 PackedWaveNet, everything else to A1 WaveNet.
function deriveNamMode(architecture: string): 'a1' | 'a2' {
  return architecture === 'a2' ? 'a2' : 'a1'
}

// Per-architecture identifier color — same palette as ArchitectureProfilePicker so chips read consistently across Queue, Staged Batches, Create Batch, and History.
const ARCHITECTURE_ACCENT_HEX: Record<string, string> = {
  a2:       '#f43f5e', // rose
  standard: '#94a3b8', // slate
  complex:  '#3b82f6', // blue
  lite:     '#10b981', // emerald
  feather:  '#0ea5e9', // sky
  nano:     '#f59e0b', // amber
  revystd:  '#8b5cf6', // violet
  revyhi:   '#a855f7', // purple
  revxstd:  '#d946ef', // fuchsia
}

function architectureAccentHex(arch: string): string {
  return ARCHITECTURE_ACCENT_HEX[arch] ?? 'var(--nm-accent, var(--accent))'
}

// Tinted background + colored dot + label, for the per-architecture pill used in batch/history rows.
function archChipStyle(arch: string): { background: string; color: string; borderColor: string } {
  const c = architectureAccentHex(arch)
  return {
    background: `color-mix(in srgb, ${c} 14%, transparent)`,
    color: c,
    borderColor: `color-mix(in srgb, ${c} 35%, transparent)`,
  }
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

function MiniEsrPlot({ tone, seed }: { tone: 'green' | 'amber' | 'red' | 'none'; seed: number }) {
  const color = tone === 'green' ? '#10b981' : tone === 'amber' ? '#f59e0b' : tone === 'red' ? '#ef4444' : '#9ca3af'
  let s = seed
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  const n = 18, w = 44, h = 34, pad = 3
  const pts: Array<[number, number]> = Array.from({ length: n }, (_, i) => {
    const frac = i / (n - 1)
    const base = 0.1 + 0.85 * Math.exp(-3.2 * frac)
    const v = Math.max(base + base * 0.08 * (rnd() - 0.5), 0.04)
    return [pad + frac * (w - pad * 2), pad + v * (h - pad * 2)]
  })
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0 }}>
      <path d={`${line} L${w - pad} ${h - pad} L${pad} ${h - pad} Z`} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function ChartFit({ minH = 220, children }: { minH?: number; children: (w: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(Math.max(e.contentRect.width, 120)) })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return <div ref={ref} style={{ width: '100%', minHeight: minH }}>{children(w)}</div>
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

function jobDurationSec(job: { startedAt: string | null; finishedAt: string | null }): number | null {
  if (!job.startedAt || !job.finishedAt) return null
  return Math.floor((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)
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

function getEsrTone(esr: number | null): { text: string; classes: string; tone: 'green' | 'amber' | 'red' | 'none' } {
  if (typeof esr !== 'number') {
    return { text: '—', classes: 'text-nm-text-3', tone: 'none' }
  }
  if (esr < 0.01) {
    return { text: esr.toFixed(6), classes: 'text-emerald-400', tone: 'green' }
  }
  if (esr < 0.05) {
    return { text: esr.toFixed(6), classes: 'text-amber-400', tone: 'amber' }
  }
  return { text: esr.toFixed(6), classes: 'text-red-400', tone: 'red' }
}

function esrBadgeClasses(tone: 'green' | 'amber' | 'red' | 'none'): string {
  if (tone === 'green') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (tone === 'amber') return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  if (tone === 'red') return 'bg-red-500/15 text-red-400 border-red-500/30'
  return 'bg-field text-nm-text-3 border-nm-border-s'
}

function showNativeTextContextMenu(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()?.toString().trim() ?? ''
  const target = event.target as HTMLElement | null
  const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]')
  if (!selection && !isEditable) return
  event.preventDefault()
  void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
}

export function TrainingPanel({ settings, onSaveSettings, onClose, initialRunMode, onOpenSetupGuide, onOpenSettings }: Props) {
  const [inputPath, setInputPath] = useState(settings.namTrainingInputWav || '')
  const [section, setSection] = useState<'dashboard' | 'live' | 'queue' | 'batches' | 'history' | 'new'>('dashboard')
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddConfirmed, setQuickAddConfirmed] = useState<{ count: number; label: string }[]>([])
  const [batchWavList, setBatchWavList] = useState<BatchWavItem[]>([])
  const [batchName, setBatchName] = useState('')
  const [separateBatches, setSeparateBatches] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set())
  const [esrSeries, setEsrSeries] = useState<{ epoch: number; esr: number }[]>([])
  const [queueView, setQueueView] = useState<'batches' | 'compact' | 'board'>('batches')
  const [logExpanded, setLogExpanded] = useState(true)
  const [watchFoldersExpanded, setWatchFoldersExpanded] = useState(false)
  const [watcherFilesModal, setWatcherFilesModal] = useState<{ profileId: string; profileName: string; watchFolder: string; architectures: string[] } | null>(null)
  const [trainPath, setTrainPath] = useState('')
  const [manualRoutingMode, setManualRoutingMode] = useState<'root' | 'sibling_processed'>('root')
  const [formulaOverrideActive, setFormulaOverrideActive] = useState(false)
  const [graphFormulaOverrideActive, setGraphFormulaOverrideActive] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => {
    const last = (settings.trainingLastSelectedPresetId ?? '').trim()
    const fav = (settings.trainingFavoritePresetId ?? '').trim()
    return last || fav || CUSTOM_PRESET_ID
  })
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
  const [historyPurgeConfirm, setHistoryPurgeConfirm] = useState<{ ids: string[]; label: string; mode: 'capture' | 'batch' } | null>(null)
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
  const [elapsedSec, setElapsedSec] = useState(0)
  const rawLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (settings.namTrainingInputWav && !inputPath) setInputPath(settings.namTrainingInputWav)
  }, [settings.namTrainingInputWav, inputPath])

  useEffect(() => {
    if (!initialRunMode) return
    if (initialRunMode === 'queue') setSection('queue')
    else if (initialRunMode === 'history') setSection('history')
    else setSection('dashboard')
  }, [initialRunMode])

  useEffect(() => {
    if (selectedPresetId === (settings.trainingLastSelectedPresetId ?? '')) return
    onSaveSettings({ ...settings, trainingLastSelectedPresetId: selectedPresetId })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresetId])

  useEffect(() => {
    let disposed = false
    let lastActiveJobId: string | null = null
    void window.api.getTrainerState().then((state) => {
      if (!disposed) {
        setTrainerState(state)
        if (state.status === 'running' || state.status === 'starting') setSection('live')
        else setSection('dashboard')
      }
    })
    const off = window.api.onTrainerUpdate((state) => {
      setTrainerState(state)
      if (state.activeJobId !== lastActiveJobId) {
        lastActiveJobId = state.activeJobId ?? null
        if (state.activeJobId) setEsrSeries([])
      }
      if (state.status === 'running' && state.progressEpochCurrent && typeof state.epochValidationEsr === 'number') {
        setEsrSeries(prev => {
          const epoch = state.progressEpochCurrent!
          if (prev.length > 0 && prev[prev.length - 1].epoch === epoch) return prev
          return [...prev, { epoch, esr: state.epochValidationEsr as number }]
        })
      }
      if ((state.status === 'success' || state.status === 'error') && typeof state.validationEsr === 'number') {
        setEsrSeries(prev => {
          if (prev.length > 0) return prev
          const epoch = state.progressEpochTotal ?? state.epochs ?? 0
          return [{ epoch, esr: state.validationEsr as number }]
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
      if (job.status === 'staged') return false  // staged jobs shown in Batches section only
      if (queueProfileFilter !== 'all' && (job.profileId ?? 'manual') !== queueProfileFilter) return false
      if (queueStatusFilter !== 'all' && job.status !== queueStatusFilter) return false
      if (queueArchitectureFilter !== 'all' && job.architecture !== queueArchitectureFilter) return false
      return true
    }),
    [queueArchitectureFilter, queueProfileFilter, queueStatusFilter, trainerState.queue]
  )
  const groupedStagedQueue = useMemo(() => {
    const staged = trainerState.queue.filter((job) => job.status === 'staged')
    const groups: Array<{ key: string; label: string; createdAt: string | null; jobs: TrainerQueueJob[] }> = []
    for (const job of staged) {
      const key = job.submissionId ?? `ungrouped:${job.jobId}`
      const existing = groups[groups.length - 1]
      if (existing && existing.key === key) {
        existing.jobs.push(job)
      } else {
        groups.push({
          key,
          label: job.submissionLabel ?? (job.profileName ?? 'Batch'),
          createdAt: job.submissionCreatedAt ?? null,
          jobs: [job],
        })
      }
    }
    return groups
  }, [trainerState.queue])
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

  useEffect(() => {
    if (!isRunning || !trainerState.startedAt) { setElapsedSec(0); return }
    const start = new Date(trainerState.startedAt).getTime()
    const tick = () => setElapsedSec(Math.floor((Date.now() - start) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [isRunning, trainerState.startedAt])
  const activeJob = trainerState.activeJobId ? trainerState.queue.find((job) => job.jobId === trainerState.activeJobId) ?? null : null
  const epochNote = architectures.length === 1 ? architectureEpochNote(architectures[0]) : null
  const progressEpochTotal = effectiveEpochTotal(
    (trainerState.architecture || architectures[0] || 'standard') as TrainerArchitecture | '',
    trainerState.progressEpochTotal ?? trainerState.epochs
  )
  const validationEsrTone = getEsrTone(trainerState.validationEsr)
  const replicateEsrTone = getEsrTone(trainerState.replicateEsr)

  const resolvedModelName = useMemo(() => {
    const first = batchWavList[0]?.path ?? ''
    const base = first.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '').trim() || 'model'
    return base
  }, [batchWavList])

  const manualRoutingSourceFolder = useMemo(() => {
    const first = batchWavList[0]?.path ?? ''
    if (!first) return ''
    return first.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  }, [batchWavList])

  const availablePresets = useMemo(
    () => settings.trainingPresets.filter((preset) => preset.architectures.length > 0),
    [settings.trainingPresets]
  )
  const activePreset = useMemo(
    () => selectedPresetId === CUSTOM_PRESET_ID ? null : availablePresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [availablePresets, selectedPresetId]
  )


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
  // Staging dir = parent directory of the first WAV in the batch list
  const filesStagingDir = useMemo(() => {
    if (batchWavList.length === 0) return ''
    return batchWavList[0].path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  }, [batchWavList])
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
    batchWavList.length > 0 &&
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


  const handleBrowseInput = async () => {
    const path = await window.api.openAudioFile()
    if (!path) return
    setInputPath(path)
    if (path !== settings.namTrainingInputWav) {
      onSaveSettings({ ...settings, namTrainingInputWav: path })
    }
  }

  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const handleInputDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetId(null)
    const files = Array.from(e.dataTransfer.files)
    const wavs = files.filter(f => f.name.toLowerCase().endsWith('.wav'))
    if (wavs.length === 0) return
    const p = window.api.getPathForFile(wavs[0])
    if (!p) return
    setInputPath(p)
    if (p !== settings.namTrainingInputWav) onSaveSettings({ ...settings, namTrainingInputWav: p })
  }

  const addWavsToBatchList = (paths: string[], fromFolder?: string) => {
    setBatchWavList(prev => {
      const existingPaths = new Set(prev.map(item => item.path))
      const newItems = paths
        .filter(p => !existingPaths.has(p))
        .map(p => ({
          id: `${Date.now()}-${Math.random()}`,
          path: p,
          name: p.replace(/\\/g, '/').split('/').pop() ?? p,
          fromFolder,
        }))
      return [...prev, ...newItems]
    })
  }

  const handleOutputWavDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetId(null)
    const files = Array.from(e.dataTransfer.files)
    const wavs = files.filter(f => f.name.toLowerCase().endsWith('.wav'))
    const paths = wavs.map(f => window.api.getPathForFile(f)).filter(Boolean) as string[]
    if (paths.length === 0) return
    addWavsToBatchList(paths)
  }

  const handleFolderDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetId(null)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const p = window.api.getPathForFile(files[0])
    if (!p) return
    const stat = await window.api.statPath(p)
    if (stat.isDirectory) {
      const wavPaths = await window.api.listWavFiles(p)
      addWavsToBatchList(wavPaths, p)
    } else if (p.toLowerCase().endsWith('.wav')) {
      addWavsToBatchList([p])
    }
  }

  const handleBrowseOutputs = async () => {
    const paths = await window.api.openAudioFiles()
    if (!paths || paths.length === 0) return
    addWavsToBatchList(paths)
  }

  const handleBrowseFolder = async () => {
    const p = await window.api.openFolder(trainPath || undefined)
    if (!p) return
    const wavPaths = await window.api.listWavFiles(p)
    addWavsToBatchList(wavPaths, p)
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

  const handleQueue = async (staged = false) => {
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
    if (targetArchitectures.length === 0) {
      setLaunchError('Choose at least one architecture before queueing.')
      return
    }
    if (manualRoutingMode === 'root' && !trainPath.trim() && (!activeFormula || formulaOverrideActive)) {
      setLaunchError('Choose an output root or set an output formula in Settings before queueing.')
      return
    }
    if (batchWavList.length === 0) {
      setLaunchError('Add at least one WAV file before queueing.')
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

    const now = Date.now()
    const sharedSubmissionId = separateBatches ? null : `manual-direct-${now}`
    const folders = new Set(batchWavList.map(w => w.fromFolder).filter(Boolean))
    const autoLabel = batchWavList.length === 1
      ? batchWavList[0].name
      : (folders.size === 1 && batchWavList[0].fromFolder)
        ? (batchWavList[0].fromFolder.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '')
        : `Batch - ${batchWavList.length} capture${batchWavList.length === 1 ? '' : 's'}`
    const sharedLabel = batchName.trim() || autoLabel
    const sharedCreatedAt = new Date().toISOString()
    const jobArchitectures = targetArchitectures

    const payloads = batchWavList.flatMap((wavItem, idx) => {
      const submissionId = separateBatches ? `manual-direct-${now}-${idx}` : sharedSubmissionId!
      const submissionLabel = separateBatches ? wavItem.name : sharedLabel
      return jobArchitectures.map((architecture) => {
        const routing = getManualRoutingForOutput(wavItem.path, architecture)
        const jobMode = deriveNamMode(architecture)
        const profileCfg = jobMode === 'a1' ? lookupProfileConfig(architecture, settings.userCaptureProfiles ?? []) : null
        return {
          pythonPath: resolvedPythonPath,
          inputPath: inputPath.trim(),
          outputPath: wavItem.path,
          trainPath: routing.finalModelRoot,
          namMode: jobMode,
          architecture,
          waveNetConfig: profileCfg?.waveNetConfig ?? null,
          lr: profileCfg?.lr ?? 0.004,
          lrDecay: profileCfg?.lrDecay ?? 0.002,
          batchSize: profileCfg?.batchSize ?? 16,
          ny: profileCfg?.ny ?? 8192,
          fitMrstft: profileCfg?.fitMrstft ?? true,
          normalizeWav: resolvedNormalizeWav,
          normalizeWavTargetDb: resolvedNormalizeDb,
          captureProfileId: jobMode === 'a1' ? architecture : null,
          epochs: parsedEpochs,
          latency: parsedLatency,
          thresholdEsr: parsedThresholdEsr,
          savePlot: activePreset?.savePlot ?? savePlot,
          silent: true,
          ignoreChecks: activePreset?.ignoreChecks ?? ignoreChecks,
          sourceMode: 'manual-direct' as const,
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
          submissionCreatedAt: sharedCreatedAt,
        }
      })
    })

    const result = await window.api.enqueueTrainerRuns(payloads, { staged })
    if (!result.success) {
      setLaunchError(result.error ?? 'Training jobs could not be queued.')
      return
    }
    setLaunchError('')
    setQueueActionError('')
    setBatchWavList([])
    setBatchName('')
    setSection(staged ? 'batches' : 'queue')
  }


  const queuedCount = trainerState.queue.filter((job) => job.status === 'queued').length
  const stagedCount = trainerState.queue.filter((job) => job.status === 'staged').length
  const successCount = trainerState.queue.filter((job) => job.status === 'success').length
  const failedCount = trainerState.queue.filter((job) => job.status === 'error').length
  const currentPresetId = selectedPresetId
  const currentRunPreset = activePreset
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

  const handleUnstageSubmission = async (submissionId: string) => {
    const result = await window.api.unstageTrainerSubmission(submissionId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not queue that batch.')
    } else {
      setQueueActionError('')
      setSection('queue')
    }
  }

  const handleStageJob = async (job: TrainerQueueJob) => {
    const result = await window.api.stageTrainerJob(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not move that job to staged batches.')
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
    // Profile-backed entries (watcher / folder-run / preset) go through the existing main-process handler.
    if (entry.profileId) {
      const result = await window.api.retryTrainerHistoryEntry(entry.historyId)
      if (!result.success) {
        setQueueActionError(result.error ?? 'Could not retry that history item.')
        return
      }
      setQueueActionError('')
      setHistoryContextMenu(null)
      setSection('queue')
      return
    }
    // Manual-direct (no profileId): reconstruct the payload from the entry + current settings.
    await handleRetryHistoryBatch([entry], `Retry - ${entry.finalModelName || 'capture'}`)
  }

  // Re-queue a set of history entries under a single new submission. Used by the per-entry retry
  // for profile-less manual batches AND by the History group-head "Retry failed / Retry batch" actions.
  const handleRetryHistoryBatch = async (entries: TrainerHistoryEntry[], submissionLabel: string) => {
    if (entries.length === 0) return
    const py = settings.namPythonPath.trim()
    if (!py) {
      setQueueActionError('Set the NAM Python path in Settings → Training before retrying.')
      return
    }
    const inputDi = (settings.trainingDefaultInputDi ?? '').trim() || settings.namTrainingInputWav.trim()
    if (!inputDi) {
      setQueueActionError('Set the Input DI (Settings → Training) before retrying — the original DI is not stored in the history entry.')
      return
    }
    const outputFormula = (settings.trainingOutputFormula ?? '').trim() || (settings.trainingFavoriteRouting ?? '').trim()
    const graphFormula = (settings.trainingGraphFormula ?? '').trim()
    const submissionId = `retry-${Date.now()}`
    const createdAt = new Date().toISOString()
    const { normalizeWav: resolvedNormalizeWav, normalizeWavTargetDb: resolvedNormalizeDb } =
      resolveNormalize(normalizeWavOverride, normalizeWavTargetDb)

    const payloads = entries.map((entry) => {
      const arch = entry.architecture
      const jobMode = deriveNamMode(arch)
      const profileCfg = jobMode === 'a1' ? lookupProfileConfig(arch, settings.userCaptureProfiles ?? []) : null
      const stagingDir = entry.sourcePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      // Prefer the entry's actual prior output dir when present (matches what the user already routed to);
      // fall back to the current output formula resolved against the source.
      const priorDir = entry.finalModelPath ? entry.finalModelPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : ''
      const resolvedRoot = priorDir || (outputFormula ? (resolveOutputFormula(outputFormula, stagingDir, arch) ?? outputFormula) : stagingDir)
      const resolvedGraphRoot = graphFormula
        ? (resolveOutputFormula(graphFormula, stagingDir, arch) ?? resolvedRoot)
        : resolvedRoot
      return {
        pythonPath: py,
        inputPath: inputDi,
        outputPath: entry.sourcePath,
        trainPath: resolvedRoot,
        namMode: jobMode,
        architecture: arch,
        waveNetConfig: profileCfg?.waveNetConfig ?? null,
        lr: profileCfg?.lr ?? 0.004,
        lrDecay: profileCfg?.lrDecay ?? 0.002,
        batchSize: profileCfg?.batchSize ?? 16,
        ny: profileCfg?.ny ?? 8192,
        fitMrstft: profileCfg?.fitMrstft ?? true,
        normalizeWav: resolvedNormalizeWav,
        normalizeWavTargetDb: resolvedNormalizeDb,
        captureProfileId: jobMode === 'a1' ? arch : null,
        epochs: entry.epochs,
        latency: entry.latencyValue,
        thresholdEsr: entry.thresholdEsr,
        savePlot: true,
        silent: true,
        ignoreChecks: false,
        sourceMode: 'manual-direct' as const,
        finalModelRoot: resolvedRoot,
        processedWavRoot: '',
        graphRoot: resolvedGraphRoot,
        graphRootResolved: !!outputFormula && !priorDir,
        sourcePostProcess: 'keep' as const,
        namingTemplate: '{basename}',
        profileId: entry.profileId,
        profileName: entry.profileName,
        modeledBy: null,
        inputLevelDbu: null,
        outputLevelDbu: null,
        submissionId,
        submissionLabel,
        submissionCreatedAt: createdAt,
        // Protect any already-trained .nam files in the destination folder — the Python promoter
        // will rename the existing model to <name>.bak.nam before overwriting.
        backupExisting: true,
      }
    })

    const result = await window.api.enqueueTrainerRuns(payloads, { staged: false })
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not re-queue that batch.')
      return
    }
    setQueueActionError('')
    setHistoryContextMenu(null)
    setSection('queue')
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
    const autoName = `${architectures.map((item) => architectureDisplayLabel(item)).join(' + ')} ${parsedEpochs} epoch`
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
    if (architectures.length === 0) {
      setPresetSaveError('Choose at least one architecture.')
      return
    }
    const duplicateName = settings.trainingPresets.some((preset) => preset.name.trim().toLowerCase() === name.toLowerCase())
    if (duplicateName) {
      setPresetSaveError('A preset with that name already exists.')
      return
    }
    // Preset namMode is now derived from its architecture list — 'a2' if any architecture is a2, else 'a1'. Mixed presets keep 'a1' here (each job derives its own mode at queue time).
    const presetNamMode: 'a1' | 'a2' = architectures.every((arch) => arch === 'a2') ? 'a2' : 'a1'
    const preset: TrainingPreset = {
      id: makePresetId(name),
      name,
      namMode: presetNamMode,
      architectures,
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

  const handleQuickAdd = async () => {
    setLaunchError('')
    const paths = await window.api.openAudioFiles()
    if (!paths || paths.length === 0) return
    const inputDi = (settings.trainingDefaultInputDi ?? '').trim() || settings.namTrainingInputWav.trim()
    const outputRoot = (settings.trainingFavoriteRouting ?? '').trim() || (settings.trainingOutputFormula ?? '').trim()
    if (!settings.namPythonPath.trim()) {
      setLaunchError('Set a Python path in Settings → Training before using Quick Add.')
      return
    }
    if (!inputDi) {
      setLaunchError('Set a Default Input DI in Settings → Training before using Quick Add.')
      return
    }
    if (!outputRoot) {
      setLaunchError('Set an output path formula in Settings → Training (NAM output path formula, or Favorite output routing) before using Quick Add.')
      return
    }
    const favPreset = settings.trainingFavoritePresetId
      ? availablePresets.find(p => p.id === settings.trainingFavoritePresetId) ?? null
      : null
    const jobArchitectures: string[] = favPreset ? favPreset.architectures : ['standard']
    const parsedEpochs = favPreset ? favPreset.epochs : 1000
    const parsedLatency = favPreset ? (favPreset.latencyMode === 'manual' ? favPreset.latencyValue : null) : null
    const parsedThresholdEsr = favPreset ? favPreset.thresholdEsr : null
    const { normalizeWav: resolvedNormalizeWav, normalizeWavTargetDb: resolvedNormalizeDb } = resolveNormalize('global', '')
    const now = Date.now()
    const sharedSubmissionId = `quick-add-${now}`
    const sharedLabel = `Quick Add · ${paths.length} capture${paths.length === 1 ? '' : 's'}`
    const sharedCreatedAt = new Date().toISOString()
    const isFormula = outputRoot.includes('{')
    const payloads = paths.flatMap((wavPath) =>
      jobArchitectures.map((architecture) => {
        const profileCfg = lookupProfileConfig(architecture, settings.userCaptureProfiles ?? [])
        const stagingDir = wavPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        const resolvedModelRoot = isFormula
          ? (resolveOutputFormula(outputRoot, stagingDir, architecture) ?? outputRoot)
          : outputRoot
        return {
          pythonPath: settings.namPythonPath.trim(),
          inputPath: inputDi,
          outputPath: wavPath,
          trainPath: resolvedModelRoot,
          namMode: deriveNamMode(architecture),
          architecture,
          waveNetConfig: profileCfg?.waveNetConfig ?? null,
          lr: profileCfg?.lr ?? 0.004,
          lrDecay: profileCfg?.lrDecay ?? 0.002,
          batchSize: profileCfg?.batchSize ?? 16,
          ny: profileCfg?.ny ?? 8192,
          fitMrstft: profileCfg?.fitMrstft ?? true,
          normalizeWav: resolvedNormalizeWav,
          normalizeWavTargetDb: resolvedNormalizeDb,
          captureProfileId: architecture,
          epochs: parsedEpochs,
          latency: parsedLatency,
          thresholdEsr: parsedThresholdEsr,
          savePlot: favPreset?.savePlot ?? true,
          silent: true,
          ignoreChecks: favPreset?.ignoreChecks ?? false,
          sourceMode: 'manual-direct' as const,
          finalModelRoot: resolvedModelRoot,
          processedWavRoot: '',
          graphRoot: resolvedModelRoot,
          graphRootResolved: isFormula,
          sourcePostProcess: 'keep' as const,
          namingTemplate: '{basename}',
          profileId: favPreset?.id ?? null,
          profileName: favPreset?.name ?? null,
          modeledBy: null,
          inputLevelDbu: null,
          outputLevelDbu: null,
          submissionId: sharedSubmissionId,
          submissionLabel: sharedLabel,
          submissionCreatedAt: sharedCreatedAt,
        }
      })
    )
    const result = await window.api.enqueueTrainerRuns(payloads, { staged: false })
    if (!result.success) {
      setLaunchError(result.error ?? 'Could not queue Quick Add batch.')
      return
    }
    setQuickAddConfirmed(prev => [...prev, { count: paths.length, label: favPreset?.name ?? 'Default' }])
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

  const lastSuccessEntry = trainerState.history.filter(e => e.status === 'success')[0] ?? null
  const activeBatchJobs = activeJob ? trainerState.queue.filter(j => j.submissionId === activeJob.submissionId) : []
  const activeBatchIdx = activeJob ? activeBatchJobs.findIndex(j => j.jobId === activeJob.jobId) + 1 : 0
  const activeBatchTotal = activeBatchJobs.length

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
    id: 'dashboard' | 'live' | 'queue' | 'batches' | 'history' | 'new',
    label: string,
    count: number | null,
    icon: React.ReactNode,
    opts: { accent?: boolean; simple?: boolean } = {}
  ) => {
    const isActive = section === id
    const isDashboard = id === 'dashboard'
    return (
      <button
        key={id}
        onClick={() => setSection(id)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-[13px] font-medium transition-colors relative text-left ${
          isActive
            ? isDashboard
              ? 'bg-nm-accent/15 text-nm-accent font-semibold'
              : 'bg-active-bg text-nm-accent font-semibold'
            : 'text-nm-text-2 hover:bg-hov hover:text-nm-text'
        }`}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-5 rounded-r bg-nm-accent" />
        )}
        <span className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-nm-accent' : 'text-nm-text-3'}`}>{icon}</span>
        <span className={`flex-1 truncate ${isDashboard ? 'font-[560]' : ''}`}>{label}</span>
        {opts.simple && (
          <span className={`text-[9px] font-[700] uppercase tracking-[.4px] px-1.5 py-0.5 rounded-[5px] flex-shrink-0 ${
            isActive ? 'bg-nm-accent/25 text-nm-accent' : 'bg-nm-accent/15 text-nm-accent'
          }`}>Simple</span>
        )}
        {!opts.simple && count !== null && count > 0 && (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none flex-shrink-0 ${
            opts.accent ? 'bg-nm-accent text-accent-text' : 'bg-panel-2 text-nm-text-2 border border-nm-border-s'
          }`}>
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <>
    <div className="flex h-full overflow-hidden bg-app-bg text-nm-text select-text" onContextMenu={showNativeTextContextMenu}>
      {/* ── Left Rail ─────────────────────────────────────────────────────── */}
      <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-nm-border bg-panel overflow-y-auto">
        <div className="px-4 pt-3 pb-3 border-b border-nm-border">
          {onClose && (
            <button
              onClick={onClose}
              title="Back to the file library (tree / file list / metadata)"
              className="inline-flex items-center gap-1 text-[10.5px] font-[600] uppercase tracking-[.6px] text-nm-text-3 hover:text-nm-accent transition-colors mb-1.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              NAM Lab
            </button>
          )}
          {!onClose && <div className="text-[10px] font-bold uppercase tracking-wider text-nm-text-3 mb-1">NAM Lab</div>}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <span className="text-[16px] font-[680] text-nm-text leading-tight">Local Training</span>
          </div>
        </div>

        <nav className="px-2 py-2 space-y-0.5">
          {navItem('dashboard', 'Dashboard', null, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
          ), { simple: true })}
          <div className="mx-2 my-1.5 border-t border-nm-border-s" />
          {navItem('live', 'Live Run', isRunning ? 1 : null, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
          ), { accent: isRunning })}
          {navItem('queue', 'Queue', trainerState.queue.filter(j => j.status !== 'staged').length, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
          ))}
          {navItem('batches', 'Batches', stagedCount > 0 ? stagedCount : null, (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3" /></svg>
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

        {/* Dashboard: slim control bar (replaces full strip) */}
        {section === 'dashboard' && (
          <div className="flex-shrink-0 border-b border-nm-border bg-panel-2 px-6 py-3.5 flex items-center gap-4">
            <div className="flex items-center gap-3.5 flex-1 min-w-0">
              <span className={`inline-flex items-center gap-1.5 h-[30px] px-3.5 rounded-full text-[12.5px] font-[650] flex-shrink-0 ${
                isRunning ? 'bg-nm-accent/15 text-nm-accent' : 'bg-field text-nm-text-3'
              }`}>
                <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${isRunning ? 'bg-nm-accent nm-live-dot' : 'bg-nm-text-3'}`} />
                {isRunning ? 'Training' : trainerState.pauseAfterCurrent ? 'Paused' : 'Idle'}
              </span>
              <span className="text-[15px] font-[600] text-nm-text-2 truncate">{isRunning ? activeJobName : 'Queue idle'}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={async () => { const r = await window.api.cancelTrainerRun(); if (!r.success) setQueueActionError(r.error ?? 'Could not cancel.') }}
                disabled={!isRunning && !trainerState.pauseAfterCurrent}
                className="h-10 inline-flex items-center gap-2 px-4 rounded-[9px] text-[13px] font-[580] border bg-red-500/10 hover:bg-red-500/18 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 border-red-500/35 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
                Emergency stop
              </button>
              {isRunning ? (
                <button
                  onClick={async () => { await window.api.setTrainerPauseAfterCurrent(!trainerState.pauseAfterCurrent) }}
                  title={trainerState.pauseAfterCurrent
                    ? 'Click to cancel — queue will keep going after current capture finishes'
                    : 'Pauses the queue after the current capture finishes (training can’t be interrupted mid-capture). Use Emergency stop to kill the current run immediately.'}
                  className={`h-10 inline-flex items-center gap-2 px-4 rounded-[9px] text-[13px] font-[580] border transition-colors ${
                    trainerState.pauseAfterCurrent
                      ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/40'
                      : 'bg-panel hover:bg-hov text-nm-text-2 border-nm-border'
                  }`}
                >
                  {trainerState.pauseAfterCurrent ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
                  )}
                  {trainerState.pauseAfterCurrent ? 'Pausing after current' : 'Pause'}
                </button>
              ) : (
                <button
                  onClick={async () => { await window.api.setTrainerPauseAfterCurrent(false) }}
                  disabled={queuedCount === 0}
                  className="h-10 inline-flex items-center gap-2 px-4 rounded-[9px] text-[13px] font-[580] border bg-nm-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-accent-text border-transparent transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  Resume
                </button>
              )}
            </div>
          </div>
        )}

        {/* Full Now-Training strip (all sections except dashboard) */}
        {section !== 'dashboard' && (
        <div className="flex-shrink-0 border-b border-nm-border px-5 py-3 space-y-2.5" style={{ background: 'linear-gradient(180deg, var(--panel-2), var(--panel))' }}>
          {/* Top row */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Model thumbnail */}
            <div className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 14%, var(--panel-2))', border: '1px solid color-mix(in srgb, var(--nm-accent, var(--accent)) 30%, transparent)' }}>
              <svg className="w-5 h-5 text-nm-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
              </svg>
            </div>
            {/* Model name + sub */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[16px] font-[660] text-nm-text truncate">{activeJobName}</span>
                {isRunning && (
                  <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-[650] flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 16%, transparent)', color: 'var(--accent-text)' }}>
                    <span className="w-[7px] h-[7px] rounded-full bg-nm-accent flex-shrink-0 nm-live-dot" />
                    Running
                  </span>
                )}
                {!isRunning && trainerState.pauseAfterCurrent && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-semibold flex-shrink-0">Paused</span>
                )}
                {!isRunning && !trainerState.pauseAfterCurrent && (
                  <span className="px-2 py-0.5 rounded-full bg-field border border-nm-border-s text-nm-text-3 text-[11px] flex-shrink-0">Idle</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-nm-text-3 truncate">
                {activeJob && (
                  <>
                    <span className="inline-flex items-center h-[19px] px-2 rounded-[5px] text-[10px] font-[700] uppercase tracking-[.3px]" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 16%, transparent)', color: 'var(--accent-text)' }}>{architectureDisplayLabel(activeJob.architecture)}</span>
                    {activeJob.profileName && (
                      <span className="inline-flex items-center h-[19px] px-2 rounded-[5px] text-[10.5px] font-[600] bg-field border border-nm-border-s text-nm-text-2">{activeJob.profileName}</span>
                    )}
                    <span>model {activeJobIdx} of {totalJobs}</span>
                    <span className="font-mono truncate">{activeJob.outputPath.replace(/\\/g, '/').split('/').slice(-2).join('/')}</span>
                  </>
                )}
                {!activeJob && <span>Queue is idle — start a run from New Run or the queue.</span>}
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
                className="h-[34px] inline-flex items-center gap-1.5 px-3 rounded-[9px] text-xs font-[580] border bg-red-500/10 hover:bg-red-500/18 disabled:opacity-35 disabled:cursor-not-allowed text-red-400 border-red-500/35 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
                Emergency stop
              </button>
              {isRunning ? (
                <button
                  onClick={async () => { await window.api.setTrainerPauseAfterCurrent(!trainerState.pauseAfterCurrent) }}
                  title={trainerState.pauseAfterCurrent ? 'Click to cancel — queue will keep going after current run' : 'Stop the queue after the current run finishes'}
                  className={`h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-[580] border transition-colors ${
                    trainerState.pauseAfterCurrent
                      ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/40'
                      : 'bg-panel hover:bg-hov text-nm-text-2 border-nm-border'
                  }`}
                >
                  {trainerState.pauseAfterCurrent ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
                  )}
                  {trainerState.pauseAfterCurrent ? 'Pausing after current' : 'Pause after current'}
                </button>
              ) : (
                <button
                  onClick={async () => { await window.api.setTrainerPauseAfterCurrent(false) }}
                  disabled={queuedCount === 0}
                  className="h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-[580] border bg-nm-accent hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed text-accent-text border-transparent transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  Resume
                </button>
              )}
              <div className="w-px h-5 bg-nm-border-s mx-0.5" />
              <button
                onClick={async () => { await window.api.retryFailedTrainerRuns() }}
                disabled={!trainerState.queue.some(j => j.status === 'error')}
                className="h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-xs font-[580] border bg-panel text-nm-text-2 border-nm-border hover:bg-hov disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                Retry failed
              </button>
              {queuedCount > 0 && !isRunning && (
                <button
                  onClick={async () => { await window.api.startQueuedTrainerRuns() }}
                  className="h-[34px] inline-flex items-center gap-1.5 px-3 rounded-[9px] text-xs font-semibold bg-nm-accent hover:opacity-90 text-accent-text transition-opacity"
                >
                  Start queue
                </button>
              )}
            </div>
          </div>

          {/* Progress row */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[11.5px] text-nm-text-3 mb-1.5">
                <span className="font-[600] text-nm-text">{trainerState.progressPhase || (isRunning ? 'Starting…' : 'Waiting to start')}</span>
                <span className="font-mono text-nm-text-2">{trainerState.progressEpochCurrent && progressEpochTotal ? `Epoch ${trainerState.progressEpochCurrent} / ${progressEpochTotal}` : ''}</span>
                <span className="font-mono tabular-nums text-nm-text-2">{typeof trainerState.progressPercent === 'number' ? `${trainerState.progressPercent.toFixed(1)}%` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-field overflow-hidden">
                <div
                  className="h-full nm-progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, trainerState.progressPercent ?? (trainerState.status === 'success' ? 100 : 0)))}%` }}
                />
              </div>
            </div>
            {/* Mini-stats */}
            <div className="flex items-center gap-5 flex-shrink-0">
              {[
                { label: 'Rate', value: typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(1)}` : '—', unit: ' it/s' },
                { label: 'Batch', value: trainerState.progressBatchCurrent && trainerState.progressBatchTotal ? `${trainerState.progressBatchCurrent}/${trainerState.progressBatchTotal}` : '—', unit: '' },
                (() => { const t = getEsrTone(trainerState.epochValidationEsr ?? trainerState.validationEsr); return { label: 'Val ESR', value: t.text, unit: '', color: t.classes } })(),
                { label: 'ETA', value: eta ?? '—', unit: '' },
              ].map(({ label, value, unit, color }) => (
                <div key={label} className="text-right">
                  <div className="text-[10px] text-nm-text-3 uppercase tracking-[.4px] font-[600]">{label}</div>
                  <div className={`text-[15px] font-[650] font-mono tabular-nums mt-0.5 ${color ?? 'text-nm-text'}`}>{value}<span className="text-[10px] text-nm-text-3">{unit}</span></div>
                </div>
              ))}
            </div>
            {/* ESR sparkline */}
            {esrSparkline.length > 1 && (
              <div className="flex-shrink-0 pl-4 border-l border-nm-border-s">
                <Sparkline data={esrSparkline} width={130} height={40} color="var(--nm-accent,#6366f1)" strokeWidth={1.75} fill={true} />
              </div>
            )}
          </div>
        </div>
        )}

        {/* Section content */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ── DASHBOARD ─────────────────────────────────────────────────── */}
          {section === 'dashboard' && (
            <div className="px-6 py-5 flex flex-col gap-5 max-w-[1400px] mx-auto w-full">

              {/* Hero card */}
              <div className="rounded-[20px] border border-nm-border-s overflow-hidden" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--nm-accent, var(--accent)) 9%, var(--panel-2)), var(--panel-2))' }}>
                {isRunning ? (
                  <div className="flex items-center gap-8 px-8 py-7 min-h-[210px]">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-[700] uppercase tracking-[.55px] text-nm-text-3 mb-1.5">
                        Now training · {activeJob?.submissionLabel ?? activeJob?.profileName ?? 'Manual'}
                      </div>
                      <div className="text-[34px] font-[720] text-nm-text truncate leading-tight mb-2.5">{activeJobName}</div>
                      <div className="flex items-center gap-3 text-[12px] text-nm-text-3 mb-4 flex-wrap">
                        {elapsedSec > 0 && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            running {formatDuration(elapsedSec)}
                          </span>
                        )}
                        {activeJob && (
                          <span className="inline-flex items-center h-[20px] px-2 rounded-[5px] text-[10px] font-[700] uppercase tracking-[.3px]" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 16%, transparent)', color: 'var(--accent-text)' }}>
                            {architectureDisplayLabel(activeJob.architecture)}
                          </span>
                        )}
                        {activeJob?.profileName && (
                          <span className="inline-flex items-center h-[20px] px-2 rounded-[5px] text-[10.5px] font-[600] bg-field border border-nm-border-s text-nm-text-2">{activeJob.profileName}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[11.5px] text-nm-text-3 mb-2">
                        <span className="font-[600] text-nm-text">{trainerState.progressPhase || 'Training…'}</span>
                        <span className="font-mono">
                          {trainerState.progressEpochCurrent && progressEpochTotal ? `Epoch ${trainerState.progressEpochCurrent} / ${progressEpochTotal}` : ''}
                        </span>
                        <span className="font-mono tabular-nums">{typeof trainerState.progressPercent === 'number' ? `${trainerState.progressPercent.toFixed(1)}%` : ''}</span>
                      </div>
                      <div className="h-3.5 rounded-full bg-field overflow-hidden">
                        <div className="h-full nm-progress-fill" style={{ width: `${Math.max(0, Math.min(100, trainerState.progressPercent ?? 0))}%` }} />
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-2.5 flex-shrink-0">
                      <ProgressRing value={trainerState.progressPercent ?? 0} size={168} thickness={13} color="var(--nm-accent, var(--accent))">
                        <div className="text-center">
                          <div className="text-[34px] font-[750] tabular-nums leading-none text-nm-text">
                            {typeof trainerState.progressPercent === 'number' ? Math.round(trainerState.progressPercent) : 0}<span className="text-[18px] text-nm-text-3">%</span>
                          </div>
                          <div className="text-[11px] text-nm-text-3 mt-0.5">epoch {trainerState.progressEpochCurrent ?? 0}</div>
                        </div>
                      </ProgressRing>
                      {eta && <div className="text-[12px] text-nm-text-3">~{eta} remaining</div>}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center min-h-[210px] gap-3 px-8 py-7 text-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 10%, var(--panel-2))', border: '1px solid color-mix(in srgb, var(--nm-accent, var(--accent)) 18%, transparent)' }}>
                      <svg className="w-7 h-7 text-nm-text-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                      </svg>
                    </div>
                    <div className="text-[18px] font-[650] text-nm-text">
                      {trainerState.pauseAfterCurrent ? 'Paused — queue will not advance' : 'Nothing training right now'}
                    </div>
                    <div className="text-[13px] text-nm-text-3 max-w-[420px]">
                      Add captures below to start a quick batch, or use the New Run tab for full control.
                    </div>
                  </div>
                )}
              </div>

              {/* Big stats 4×2 grid */}
              {(() => {
                const queueFinished = successCount + failedCount
                const lastEsrTone = getEsrTone(lastSuccessEntry?.validationEsr ?? null)
                const lastDurSec = lastSuccessEntry
                  ? (typeof lastSuccessEntry.durationSec === 'number' ? lastSuccessEntry.durationSec : null)
                  : null
                const accentColor = 'var(--nm-accent, var(--accent))'
                const bigStats = [
                  {
                    label: 'Current epoch',
                    value: isRunning && trainerState.progressEpochCurrent ? String(trainerState.progressEpochCurrent) : '—',
                    sub: isRunning && progressEpochTotal ? `of ${progressEpochTotal}` : 'idle',
                    color: accentColor,
                    iconColor: accentColor,
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />,
                  },
                  {
                    label: 'Queue progress',
                    value: `${queueFinished} / ${totalJobs}`,
                    sub: `${groupedQueue.length} batches · ${Math.max(totalJobs - queueFinished, 0)} to go`,
                    color: accentColor,
                    iconColor: accentColor,
                    featured: true,
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />,
                  },
                  {
                    label: 'Active batch',
                    value: activeBatchTotal > 0 ? `${activeBatchIdx} / ${activeBatchTotal}` : '—',
                    sub: activeJob?.submissionLabel ?? activeJob?.profileName ?? 'idle',
                    color: accentColor,
                    iconColor: accentColor,
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3" />,
                  },
                  {
                    label: 'Current ETA',
                    value: eta ?? '—',
                    sub: eta && typeof trainerState.progressRate === 'number' ? `at ${trainerState.progressRate.toFixed(0)} it/s` : 'idle',
                    color: 'var(--text-3)',
                    iconColor: 'var(--text-3)',
                    icon: <><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></>,
                  },
                  {
                    label: 'Completed',
                    value: String(successCount),
                    sub: 'across queue · click for history',
                    color: '#10b981',
                    iconColor: '#10b981',
                    valueClass: successCount > 0 ? 'text-emerald-400' : undefined,
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
                    onClick: () => { setHistoryStatusFilter('success'); setSection('history') },
                  },
                  {
                    label: 'Failed',
                    value: String(failedCount),
                    sub: 'across queue · click for history',
                    color: failedCount > 0 ? '#ef4444' : 'var(--text-3)',
                    iconColor: failedCount > 0 ? '#ef4444' : 'var(--text-3)',
                    valueClass: failedCount > 0 ? 'text-red-400' : undefined,
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
                    onClick: () => { setHistoryStatusFilter('error'); setSection('history') },
                  },
                  {
                    label: 'Last ESR',
                    value: lastSuccessEntry ? (lastEsrTone.text !== '—' ? lastEsrTone.text : '—') : '—',
                    sub: lastSuccessEntry ? (lastSuccessEntry.finalModelName ?? '').split(/[/\\]/).pop()?.replace(/\.nam$/, '') ?? '—' : 'no runs yet',
                    valueClass: lastEsrTone.classes,
                    color: lastSuccessEntry && lastEsrTone.classes.includes('emerald') ? '#10b981' : lastEsrTone.classes.includes('amber') ? '#f59e0b' : lastEsrTone.classes.includes('red') ? '#ef4444' : 'var(--text-3)',
                    iconColor: lastSuccessEntry && lastEsrTone.classes.includes('emerald') ? '#10b981' : lastEsrTone.classes.includes('amber') ? '#f59e0b' : lastEsrTone.classes.includes('red') ? '#ef4444' : 'var(--text-3)',
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />,
                    onClick: lastSuccessEntry ? () => { setHistoryStatusFilter('success'); setSection('history') } : undefined,
                  },
                  {
                    label: 'Last item took',
                    value: lastDurSec != null ? formatDuration(lastDurSec) : '—',
                    sub: 'most recent run',
                    color: 'var(--text-3)',
                    iconColor: 'var(--text-3)',
                    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />,
                  },
                ]
                return (
                  <div className="grid grid-cols-4 gap-3">
                    {bigStats.map(({ label, value, sub, color, iconColor, icon, featured, valueClass, onClick }) => {
                      const interactive = typeof onClick === 'function'
                      return (
                        <div
                          key={label}
                          onClick={interactive ? onClick : undefined}
                          className={`rounded-[16px] border border-nm-border-s bg-panel px-4 py-3.5 flex flex-col gap-2 ${featured ? 'border-nm-accent/30' : ''} ${interactive ? 'cursor-pointer hover:border-nm-accent/40 hover:bg-hov transition-colors' : ''}`}
                          style={featured ? { background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 6%, var(--panel))' } : undefined}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${iconColor} 16%, transparent)`, color: iconColor }}>
                              <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>{icon}</svg>
                            </div>
                            <span className="text-[11px] font-[600] uppercase tracking-[.45px] text-nm-text-3">{label}</span>
                          </div>
                          <div className={`text-[38px] font-[730] tabular-nums leading-none ${valueClass ?? ''}`} style={!valueClass && color ? { color } : undefined}>
                            {value}
                          </div>
                          <div className="text-[11.5px] text-nm-text-3 truncate">{sub}</div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Quick Add + Up Next */}
              <div className="grid grid-cols-2 gap-4">

                {/* Quick Add card */}
                <div className="rounded-[16px] border border-nm-border-s bg-panel-2 p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-[660] text-nm-text">Quick add</div>
                      <div className="text-[12px] text-nm-text-3 mt-0.5">Picks your favorite defaults — no setup</div>
                    </div>
                    <button
                      onClick={() => onOpenSettings?.('training')}
                      title="Configure favorites in Settings → Training"
                      className="w-7 h-7 flex items-center justify-center rounded-[7px] border border-nm-border-s bg-field hover:bg-hov text-nm-text-3 hover:text-nm-text transition-colors flex-shrink-0 mt-0.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>
                  </div>

                  {/* Favorite settings preview */}
                  <div className="rounded-[10px] border border-nm-border-s bg-field divide-y divide-nm-border-s text-[12px]">
                    {[
                      {
                        icon: <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
                        label: 'Preset',
                        value: settings.trainingFavoritePresetId
                          ? (availablePresets.find(p => p.id === settings.trainingFavoritePresetId)?.name ?? 'Unknown preset')
                          : <span className="text-nm-text-3 italic">not set — configure in Settings</span>,
                        accent: true,
                      },
                      {
                        icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>,
                        label: 'Routing',
                        value: (settings.trainingFavoriteRouting ?? '').trim()
                          ? <span className="font-mono truncate max-w-[200px] inline-block align-bottom">{settings.trainingFavoriteRouting}</span>
                          : (settings.trainingOutputFormula ?? '').trim()
                            ? <span className="font-mono truncate max-w-[200px] inline-block align-bottom text-nm-text-2">{settings.trainingOutputFormula} <span className="text-nm-text-3">(from Settings)</span></span>
                            : <span className="text-nm-text-3 italic">not set</span>,
                      },
                      {
                        icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" /></svg>,
                        label: 'Input DI',
                        value: (settings.trainingDefaultInputDi ?? '').trim()
                          ? <span className="font-mono truncate max-w-[200px] inline-block align-bottom">…/{(settings.trainingDefaultInputDi ?? '').replace(/\\/g, '/').split('/').pop()}</span>
                          : (settings.namTrainingInputWav?.trim()
                              ? <span className="font-mono truncate max-w-[200px] inline-block align-bottom text-nm-text-2">…/{settings.namTrainingInputWav.replace(/\\/g, '/').split('/').pop()} <span className="text-nm-text-3">(from Settings)</span></span>
                              : <span className="text-nm-text-3 italic">not set</span>),
                      },
                    ].map(({ icon, label, value, accent }) => (
                      <div key={label} className="flex items-center gap-2.5 px-3 py-2">
                        <span className={accent ? 'text-amber-400' : 'text-nm-text-3'}>{icon}</span>
                        <span className="text-nm-text-3 w-14 flex-shrink-0">{label}</span>
                        <span className="text-nm-text flex-1 min-w-0">{value}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleQuickAdd}
                    className="w-full h-11 flex items-center justify-center gap-2 rounded-[11px] text-[14px] font-[650] bg-nm-accent hover:opacity-90 text-accent-text border-transparent border transition-opacity"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    Pick WAVs &amp; queue batch
                  </button>

                  {quickAddConfirmed.length > 0 && (
                    <div className="space-y-1.5">
                      {quickAddConfirmed.slice(-3).map((b, i) => (
                        <div key={i} className="flex items-center gap-2 text-[12px] rounded-[9px] border border-emerald-500/25 bg-emerald-500/8 px-3 py-2">
                          <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <span className="text-emerald-400">Queued <strong>{b.count}</strong> capture{b.count !== 1 ? 's' : ''}</span>
                          <span className="text-nm-text-3">· {b.label} · auto-queued at end</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {launchError && (
                    <div className="text-[12px] text-red-400 rounded-[9px] border border-red-500/25 bg-red-500/8 px-3 py-2">{launchError}</div>
                  )}
                </div>

                {/* Up Next card */}
                <div className="rounded-[16px] border border-nm-border-s bg-panel-2 p-5 flex flex-col gap-4">
                  <div>
                    <div className="text-[15px] font-[660] text-nm-text">Up next</div>
                    <div className="text-[12px] text-nm-text-3 mt-0.5">
                      {queuedCount > 0 ? `${queuedCount} waiting · runs in order` : 'Queue is empty'}
                    </div>
                  </div>

                  {queuedCount === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-8 gap-2 text-center">
                      <svg className="w-8 h-8 text-nm-text-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
                      <div className="text-[12px] text-nm-text-3">Nothing queued yet. Use Quick Add or the New Run tab.</div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {groupedQueue.flatMap(g => g.jobs.filter(j => j.status === 'queued')).slice(0, 8).map((job, i) => (
                        <div key={job.jobId} className="flex items-center gap-2.5 px-3 py-2 rounded-[9px] hover:bg-hov transition-colors text-[12.5px]">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-[700] tabular-nums flex-shrink-0 bg-field border border-nm-border-s text-nm-text-3">{i + 1}</span>
                          <span className="flex-1 truncate text-nm-text font-mono text-[11.5px]">{job.outputPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.wav$/i, '')}</span>
                          <span className="inline-flex items-center h-[18px] px-1.5 rounded-[4px] text-[9.5px] font-[700] uppercase tracking-[.3px] flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 14%, transparent)', color: 'var(--accent-text)' }}>
                            {architectureDisplayLabel(job.architecture)}
                          </span>
                          <span className="text-nm-text-3 tabular-nums text-[11px] flex-shrink-0">{job.epochs}ep</span>
                        </div>
                      ))}
                      {queuedCount > 8 && (
                        <div className="text-center text-[12px] text-nm-text-3 py-2">+{queuedCount - 8} more queued</div>
                      )}
                    </div>
                  )}

                  {queuedCount > 0 && !isRunning && (
                    <button
                      onClick={async () => { await window.api.startQueuedTrainerRuns() }}
                      className="w-full h-10 flex items-center justify-center gap-2 rounded-[11px] text-[13px] font-[650] bg-nm-accent hover:opacity-90 text-accent-text transition-opacity"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      Start queue
                    </button>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* ── LIVE RUN ───────────────────────────────────────────────────── */}
          {section === 'live' && (
            <div className="px-6 py-5 space-y-3.5 max-w-[1400px] mx-auto w-full">
              {/* Section head with legend on the right */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-[680] text-nm-text leading-tight">Live Run</h2>
                  <p className="text-[12px] text-nm-text-3 mt-0.5">Real-time training telemetry for the active model</p>
                </div>
                <span className="flex items-center gap-3 text-[10.5px] text-nm-text-3 flex-shrink-0 pt-1">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: 'var(--nm-accent, var(--accent))' }} />validation ESR</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#10b981' }} />target</span>
                </span>
              </div>

              {!isRunning && trainerState.status === 'idle' && esrSeries.length === 0 && (
                <div className="rounded-2xl border border-nm-border-s bg-panel p-10 flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-[14px] flex items-center justify-center bg-panel-2 text-nm-text-3">
                    <svg className="w-[26px] h-[26px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
                  </div>
                  <div className="text-[14px] font-[650] text-nm-text">No run in progress</div>
                  <div className="text-[12.5px] text-nm-text-3">Start a queue or launch a new run to watch training live here.</div>
                </div>
              )}

              {(isRunning || esrSeries.length > 0) && (
                <div className="rounded-[14px] border border-nm-border-s bg-panel-2">
                  <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                    <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
                    <span className="text-[12.5px] font-[650] text-nm-text">ESR over epochs</span>
                    <span className="flex-1" />
                    <span className="text-[11px] font-mono text-nm-text-3">log scale · lower is better</span>
                  </div>
                  <div className="px-4 pb-4 pt-1">
                    <ChartFit minH={260}>
                      {(w) => (
                        <EsrCurve
                          data={esrSeries}
                          width={w}
                          height={260}
                          target={typeof trainerState.thresholdEsr === 'number' ? trainerState.thresholdEsr : 0.01}
                          labels={true}
                          variant="area"
                          logScale={true}
                        />
                      )}
                    </ChartFit>
                  </div>
                </div>
              )}

              {/* Statline — 4 cells like prototype: Epoch / Rate / Validation ESR / Started */}
              <div className="rounded-[14px] border border-nm-border-s bg-panel overflow-hidden grid grid-cols-4 divide-x divide-nm-border-s">
                {(() => {
                  const liveTone = getEsrTone(trainerState.epochValidationEsr ?? trainerState.validationEsr)
                  return [
                    {
                      label: 'Epoch',
                      value: trainerState.progressEpochCurrent ? String(trainerState.progressEpochCurrent) : '—',
                      suffix: progressEpochTotal ? ` / ${progressEpochTotal}` : null,
                      valueClass: 'text-nm-text',
                    },
                    {
                      label: 'Rate',
                      value: typeof trainerState.progressRate === 'number' ? trainerState.progressRate.toFixed(2) : '—',
                      suffix: typeof trainerState.progressRate === 'number' ? ' it/s' : null,
                      valueClass: 'text-nm-text',
                    },
                    {
                      label: 'Validation ESR',
                      value: liveTone.text,
                      suffix: null,
                      valueClass: liveTone.classes || 'text-nm-text',
                    },
                    {
                      label: 'Started',
                      value: trainerState.startedAt ? new Date(trainerState.startedAt).toLocaleTimeString() : '—',
                      suffix: null,
                      valueClass: 'text-nm-text',
                      smaller: true,
                    },
                  ].map(({ label, value, suffix, valueClass, smaller }) => (
                    <div key={label} className="bg-panel-2 px-4 py-3.5">
                      <div className="text-[10.5px] uppercase font-[600] tracking-[.45px] text-nm-text-3">{label}</div>
                      <div className={`mt-1.5 font-mono tabular-nums font-[680] ${smaller ? 'text-[15px]' : 'text-[19px]'} ${valueClass}`}>
                        {value}{suffix && <span className="text-[11px] font-medium text-nm-text-3">{suffix}</span>}
                      </div>
                    </div>
                  ))
                })()}
              </div>

              {/* Final output + Checkpoint export side by side */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="rounded-[14px] border border-nm-border-s bg-panel">
                  <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                    <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" /></svg>
                    <span className="text-[12.5px] font-[650] text-nm-text">Final output</span>
                  </div>
                  <div className="px-4 pb-3.5 pt-1">
                    <div className="text-[11.5px] font-mono leading-[1.7] text-nm-text-2 break-all">{trainerState.outputModelPath || '—'}</div>
                  </div>
                </div>
                <div className="rounded-[14px] border border-nm-border-s bg-panel">
                  <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                    <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>
                    <span className="text-[12.5px] font-[650] text-nm-text">Checkpoint export</span>
                  </div>
                  <div className="px-4 pb-3.5 pt-1">
                    <div className="text-[11.5px] font-mono leading-[1.7] text-nm-text-3 break-all">{trainerState.checkpointModelPath || 'Lightning checkpoint copy will appear here after training starts.'}</div>
                  </div>
                </div>
              </div>

              {/* Up next */}
              {(() => {
                const upNextJobs = groupedQueue.flatMap(g => g.jobs.filter(j => j.status === 'queued'))
                if (upNextJobs.length === 0) return null
                return (
                  <div className="rounded-[14px] border border-nm-border-s bg-panel">
                    <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                      <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" /></svg>
                      <span className="text-[12.5px] font-[650] text-nm-text">Up next</span>
                      <span className="flex-1" />
                      <span className="text-[11px] text-nm-text-3">{upNextJobs.length} queued</span>
                    </div>
                    <div className="px-3 pb-3 pt-1 space-y-1.5">
                      {upNextJobs.slice(0, 3).map((job, i) => (
                        <div key={job.jobId} className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] border border-nm-border-s bg-panel-2">
                          <span className="w-6 h-6 rounded-full bg-field border border-nm-border-s flex items-center justify-center text-[11px] font-[650] text-nm-text-3 flex-shrink-0">{i + 1}</span>
                          <span className="flex-1 min-w-0 text-[12.5px] font-[560] text-nm-text truncate">{job.modelName || job.outputPath.replace(/\\/g, '/').split('/').pop()}</span>
                          <span className="inline-flex items-center h-[19px] px-2 rounded-[5px] text-[10px] font-[700] uppercase tracking-[.3px]" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 16%, transparent)', color: 'var(--accent-text)' }}>{architectureDisplayLabel(job.architecture)}</span>
                          <span className="text-[11px] font-mono text-nm-text-3 tabular-nums flex-shrink-0">{job.epochs} ep</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Raw log */}
              <div className="rounded-[14px] border border-nm-border-s bg-panel overflow-hidden">
                <button
                  onClick={() => setLogExpanded(v => !v)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[12.5px] font-[650] text-nm-text hover:bg-hov transition-colors"
                >
                  <svg className={`w-3 h-3 text-nm-text-3 transition-transform ${logExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
                  Raw trainer log
                </button>
                {logExpanded && (
                  <div ref={rawLogRef} className="border-t border-nm-border-s bg-field p-3.5 h-[280px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] font-mono leading-[1.55] text-nm-text-2">
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
            <div className="px-6 py-5 space-y-4 max-w-[1400px] mx-auto w-full">
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
              {(() => {
                const batchesByStatus = (status: string) => {
                  const ids = new Set<string>()
                  for (const j of trainerState.queue) if (j.status === status) ids.add(j.submissionId ?? j.jobId)
                  return ids.size
                }
                const queuedBatches = batchesByStatus('queued')
                const doneBatches = batchesByStatus('success')
                const failedBatches = batchesByStatus('error') + batchesByStatus('canceled')
                const runningBatches = isRunning && trainerState.activeJobId
                  ? 1
                  : 0
                const tiles = [
                  { label: 'Queued', count: queuedCount, batches: queuedBatches, color: 'border-l-amber-500/70 text-amber-400' },
                  { label: 'Running', count: isRunning ? 1 : 0, batches: runningBatches, color: 'border-l-nm-accent text-nm-accent' },
                  { label: 'Done', count: successCount, batches: doneBatches, color: 'border-l-emerald-500/70 text-emerald-400' },
                  { label: 'Failed', count: failedCount, batches: failedBatches, color: 'border-l-red-500/70 text-red-400' },
                ]
                return (
                  <div className="grid grid-cols-4 gap-3">
                    {tiles.map(({ label, count, batches, color }) => {
                      const showBatches = label !== 'Running'
                      return (
                        <div key={label} className={`rounded-xl border border-nm-border-s bg-panel-2 px-3 py-2.5 border-l-[3px] ${color}`}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[28px] font-[700] tabular-nums leading-none">{count}</span>
                            <span className="text-[11px] font-medium text-nm-text-3 leading-none">capture{count === 1 ? '' : 's'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] uppercase font-medium text-nm-text-3">{label}</span>
                            {showBatches && (
                              <>
                                <span className="text-[10px] text-nm-text-3 opacity-60">·</span>
                                <span className="text-[10px] font-medium text-nm-text-3 tabular-nums">{batches} batch{batches === 1 ? '' : 'es'}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

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
                <span className="flex-1" />
                <button
                  onClick={() => setCollapsedBatches(new Set())}
                  className="h-[26px] px-2 rounded-md text-[11px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                >
                  Expand all
                </button>
                <button
                  onClick={() => setCollapsedBatches(new Set(groupedQueue.map(g => g.key)))}
                  className="h-[26px] px-2 rounded-md text-[11px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                >
                  Collapse all
                </button>
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
                              : <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" />
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
                                    {(job.status === 'running' || job.status === 'starting') && <div className="text-[11px] text-nm-text-2 font-mono">Epoch {trainerState.progressEpochCurrent ?? '?'}/{progressEpochTotal ?? '?'} · {typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(2)} it/s` : '—'} · {formatDuration(elapsedSec)}</div>}
                                    {job.status === 'success' && <div className="text-[11px] text-nm-text-2">{architectureDisplayLabel(job.architecture)}{(() => { const d = jobDurationSec(job); return d ? ` · ${formatDuration(d)}` : '' })()}</div>}
                                    {job.status === 'queued' && <div className="text-[11px] text-nm-text-2">Waiting in queue</div>}
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
                                    {job.status === 'queued' && job.sourceMode !== 'watcher' && (
                                      <button onClick={() => { void handleStageJob(job) }} title="Move to Batches (staged)" className="px-1.5 py-0.5 rounded text-[10px] border border-nm-border-s text-nm-text-2 hover:bg-hov">⇦</button>
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

          {/* ── BATCHES ────────────────────────────────────────────────────── */}
          {section === 'batches' && (() => {
            const totalCaptures = groupedStagedQueue.reduce((a, g) => a + g.jobs.length, 0)
            return (
              <div className="px-6 py-5 space-y-4 max-w-[1400px] mx-auto w-full">
                {/* Page header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-[680] text-nm-text leading-tight">Staged Batches</h2>
                    <p className="text-[12px] text-nm-text-3 mt-0.5">
                      {groupedStagedQueue.length === 0
                        ? 'Nothing staged'
                        : `${groupedStagedQueue.length} batch${groupedStagedQueue.length === 1 ? '' : 'es'} · ${totalCaptures} capture${totalCaptures === 1 ? '' : 's'} saved, ready to queue`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {groupedStagedQueue.length > 1 && (
                      <>
                        <button
                          onClick={() => setCollapsedBatches(prev => { const next = new Set(prev); for (const g of groupedStagedQueue) next.delete(`staged:${g.key}`); return next })}
                          className="h-9 inline-flex items-center px-2.5 rounded-[9px] text-[11.5px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                        >
                          Expand all
                        </button>
                        <button
                          onClick={() => setCollapsedBatches(prev => { const next = new Set(prev); for (const g of groupedStagedQueue) next.add(`staged:${g.key}`); return next })}
                          className="h-9 inline-flex items-center px-2.5 rounded-[9px] text-[11.5px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                        >
                          Collapse all
                        </button>
                      </>
                    )}
                    {groupedStagedQueue.length > 0 && (
                      <button
                        onClick={() => setSection('new')}
                        className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-[9px] text-[12.5px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        New batch
                      </button>
                    )}
                    {groupedStagedQueue.length > 1 && (
                      <button
                        onClick={() => { groupedStagedQueue.forEach(g => { void handleUnstageSubmission(g.jobs[0]?.submissionId ?? '') }) }}
                        className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-[9px] text-[12.5px] font-semibold bg-nm-accent hover:opacity-90 text-accent-text transition-opacity"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg>
                        Queue all
                      </button>
                    )}
                  </div>
                </div>

                {!!queueActionError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{queueActionError}</div>
                )}

                {groupedStagedQueue.length === 0 ? (
                  <div className="rounded-2xl border border-nm-border-s bg-panel p-10 flex flex-col items-center gap-3 text-center">
                    <div className="w-11 h-11 rounded-[11px] flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 10%, transparent)', color: 'var(--nm-accent, var(--accent))' }}>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[14px] font-[650] text-nm-text mb-1">No staged batches</div>
                      <div className="text-[12.5px] text-nm-text-3 max-w-[340px]">Build a batch in New Run and choose <span className="font-semibold text-nm-text-2">Stage (save, don&apos;t run)</span> to park it here until you&apos;re ready to queue.</div>
                    </div>
                    <button
                      onClick={() => setSection('new')}
                      className="mt-1 h-9 inline-flex items-center gap-1.5 px-4 rounded-[9px] text-[12.5px] font-medium border border-nm-accent/50 text-nm-accent hover:bg-nm-accent/10 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      Create a batch
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedStagedQueue.map((group) => {
                      const isCollapsed = collapsedBatches.has(`staged:${group.key}`)
                      const firstJob = group.jobs[0]
                      const sourceMode = firstJob?.sourceMode ?? 'manual-direct'
                      const typeIcon =
                        sourceMode === 'watcher' ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        ) : sourceMode === 'manual-folder-run' ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" />
                        )
                      const diBasename = (firstJob?.inputPath ?? '').replace(/\\/g, '/').split('/').pop() ?? ''
                      const routingLabel = firstJob ? (
                        firstJob.sourcePostProcess === 'move' ? 'Move to output' :
                        firstJob.sourcePostProcess === 'copy' ? 'Copy to output' : 'Keep in place'
                      ) : '—'
                      const uniqueArchitectures = Array.from(new Set(group.jobs.map(j => j.architecture)))
                      const normalizeLabel = firstJob?.normalizeWav ? 'On' : 'Off'
                      const epochCount = firstJob?.epochs ?? 0
                      const createdLabel = group.createdAt ? new Date(group.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

                      return (
                        <div key={group.key} className="rounded-[13px] border border-nm-border-s bg-panel overflow-hidden">
                          {/* Card header */}
                          <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2.5">
                            {/* Collapse caret */}
                            <button
                              className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 text-nm-text-3 hover:text-nm-text-2 transition-colors"
                              onClick={() => setCollapsedBatches(prev => {
                                const next = new Set(prev)
                                const k = `staged:${group.key}`
                                if (next.has(k)) { next.delete(k) } else { next.add(k) }
                                return next
                              })}
                            >
                              <svg className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                              </svg>
                            </button>
                            {/* Amber type-icon chip */}
                            <div
                              className="w-8 h-8 rounded-[9px] flex items-center justify-center flex-shrink-0"
                              style={{ background: 'color-mix(in srgb, #f59e0b 16%, transparent)', color: '#fbbf24' }}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>{typeIcon}</svg>
                            </div>
                            {/* Label + meta */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13.5px] font-[660] text-nm-text truncate">{group.label}</span>
                                {/* Staged pill */}
                                <span
                                  className="inline-flex items-center gap-1 h-[19px] px-2 rounded-full text-[10px] font-semibold flex-shrink-0"
                                  style={{ background: 'color-mix(in srgb, #f59e0b 16%, transparent)', color: '#fbbf24' }}
                                >
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>
                                  Staged
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-[11px] text-nm-text-3">{group.jobs.length} capture{group.jobs.length === 1 ? '' : 's'}</span>
                                <span className="text-nm-text-3 text-[10px]">·</span>
                                {firstJob?.profileName && (
                                  <>
                                    <span className="inline-flex items-center h-[17px] px-1.5 rounded-[5px] text-[10px] font-medium border border-nm-border-s bg-field text-nm-text-2">{firstJob.profileName}</span>
                                    <span className="text-nm-text-3 text-[10px]">·</span>
                                  </>
                                )}
                                {uniqueArchitectures.map(arch => (
                                  <span key={arch} className="inline-flex items-center gap-1 h-[17px] px-1.5 rounded-[5px] text-[10px] font-[650] border" style={archChipStyle(arch)}>
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                                    {architectureDisplayLabel(arch)}
                                  </span>
                                ))}
                                <span className="text-nm-text-3 text-[10px]">·</span>
                                <span className="text-[11px] text-nm-text-3">{epochCount} epochs</span>
                                <span className="text-nm-text-3 text-[10px]">·</span>
                                <span className="text-[11px] text-nm-text-3">norm {normalizeLabel}</span>
                                {createdLabel && (
                                  <>
                                    <span className="text-nm-text-3 text-[10px]">·</span>
                                    <span className="text-[11px] text-nm-text-3">{createdLabel}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            {/* Action buttons */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => setSection('new')}
                                className="h-7 inline-flex items-center gap-1 px-2 rounded-[7px] text-[11px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
                                Edit
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setCancelBatchConfirm({ submissionId: group.jobs[0]?.submissionId ?? '', label: group.label }) }}
                                className="h-7 inline-flex items-center gap-1 px-2 rounded-[7px] text-[11px] font-medium border border-red-500/25 hover:bg-red-500/10 text-red-400 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                Delete
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); void handleUnstageSubmission(group.jobs[0]?.submissionId ?? '') }}
                                className="h-7 inline-flex items-center gap-1 px-2.5 rounded-[7px] text-[11px] font-semibold bg-nm-accent hover:opacity-90 text-accent-text transition-opacity"
                              >
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg>
                                Queue now
                              </button>
                            </div>
                          </div>
                          {/* Routing line */}
                          <div className="flex items-center gap-1.5 px-[52px] pb-2.5 text-[11px] text-nm-text-3 font-mono">
                            <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                            <span>{routingLabel}</span>
                            <span className="opacity-40">·</span>
                            <span>DI <span className="opacity-70">…/{diBasename}</span></span>
                          </div>
                          {/* Expanded body: capture list */}
                          {!isCollapsed && (
                            <div className="px-3.5 pb-3 pt-0.5 space-y-1.5" style={{ paddingLeft: 52 }}>
                              {group.jobs.map((job) => {
                                const wavName = job.outputPath.replace(/\\/g, '/').split('/').pop() ?? job.modelName
                                return (
                                  <div key={job.jobId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12px] border border-nm-border-s bg-panel-2">
                                    <svg className="w-3.5 h-3.5 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" />
                                    </svg>
                                    <span className="flex-1 font-mono truncate text-nm-text text-[11.5px]">{wavName}.wav</span>
                                    <span className="inline-flex items-center gap-1 h-[17px] px-1.5 rounded-[5px] text-[10px] font-[650] border flex-shrink-0" style={archChipStyle(job.architecture)}>
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                                      {architectureDisplayLabel(job.architecture)}
                                    </span>
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
            )
          })()}

          {/* ── HISTORY ────────────────────────────────────────────────────── */}
          {section === 'history' && (
            <div className="px-6 py-5 space-y-5 max-w-[1400px] mx-auto w-full">
              {/* Section head */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-[680] text-nm-text leading-tight">History</h2>
                  <p className="text-[12px] text-nm-text-3 mt-0.5">{filteredHistory.length} completed, failed &amp; canceled runs</p>
                </div>
                <button
                  onClick={handleExportHistory}
                  disabled={filteredHistory.length === 0}
                  className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-[9px] text-[12.5px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov disabled:opacity-40 disabled:cursor-not-allowed text-nm-text-2 transition-colors flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Export
                </button>
              </div>

              {/* Twin charts */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-[14px] border border-nm-border-s bg-panel p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
                    <span className="text-[12.5px] font-[650] text-nm-text">ESR quality · last 7 days</span>
                    <span className="flex-1" />
                    <span className="flex items-center gap-2.5 text-[10px] text-nm-text-3">
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm" style={{ background: '#10b981' }} />{'<.01'}</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm" style={{ background: '#f59e0b' }} />{'<.05'}</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm" style={{ background: '#ef4444' }} />{'≥.05'}</span>
                    </span>
                  </div>
                  <ChartFit minH={155}>
                    {(w) => <QualityBars groups={qualityBarsData} width={w} height={155} />}
                  </ChartFit>
                </div>
                <div className="rounded-[14px] border border-nm-border-s bg-panel p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-[15px] h-[15px] text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
                    <span className="text-[12.5px] font-[650] text-nm-text">Throughput · models / hour</span>
                  </div>
                  <ChartFit minH={155}>
                    {(w) => <Sparkline data={throughputData.map(v => Math.max(v, 0))} width={w} height={155} fill={true} />}
                  </ChartFit>
                </div>
              </div>

              {/* Filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 h-[34px] px-3 bg-field border border-field-bd rounded-[9px] min-w-[220px] flex-1 max-w-[320px]">
                  <svg className="w-3.5 h-3.5 text-nm-text-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                  <input
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                    placeholder="Search name or path…"
                    className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[12.5px] text-nm-text placeholder:text-nm-text-3"
                  />
                </div>
                {/* Status segmented pill */}
                <div className="flex items-center gap-0.5 h-[34px] p-[3px] bg-field border border-field-bd rounded-[9px]">
                  {([['all', 'All'], ['success', 'Done'], ['error', 'Failed'], ['canceled', 'Canceled']] as const).map(([id, lb]) => (
                    <button
                      key={id}
                      onClick={() => setHistoryStatusFilter(id)}
                      className={`h-[26px] px-3 rounded-[6px] text-[11.5px] font-medium transition-colors ${historyStatusFilter === id ? 'bg-nm-accent text-accent-text font-semibold' : 'text-nm-text-2 hover:text-nm-text'}`}
                    >
                      {lb}
                    </button>
                  ))}
                </div>
                <select value={historyProfileFilter} onChange={e => setHistoryProfileFilter(e.target.value)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text-2 focus:outline-none cursor-pointer">
                  <option value="all">All profiles</option>
                  {Array.from(new Map(trainerState.history.filter(e => e.profileId || e.profileName).map(e => [e.profileId ?? e.profileName ?? 'manual', e.profileName ?? 'Manual'])).entries()).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={historyTimeFilter} onChange={e => setHistoryTimeFilter(e.target.value as typeof historyTimeFilter)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text-2 focus:outline-none cursor-pointer">
                  {[['all','All time'],['day','Today'],['week','This week'],['month','This month'],['quarter','This quarter']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={historyEsrFilter} onChange={e => setHistoryEsrFilter(e.target.value as typeof historyEsrFilter)} className="h-[34px] px-2.5 bg-field border border-field-bd rounded-[9px] text-[12px] text-nm-text-2 focus:outline-none cursor-pointer">
                  {[['all','All ESR'],['green','Green (<0.01)'],['amber','Amber (<0.05)'],['red','Red (≥0.05)'],['none','No ESR']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Empty state */}
              {groupedHistory.length === 0 && (
                <div className="rounded-2xl border border-nm-border-s bg-panel p-10 flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-[14px] flex items-center justify-center bg-panel-2 text-nm-text-3">
                    <svg className="w-[26px] h-[26px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="text-[14px] font-[650] text-nm-text">Nothing matches</div>
                  <div className="text-[12.5px] text-nm-text-3">Try a different filter or search term.</div>
                </div>
              )}

              {/* Groups */}
              {groupedHistory.map(group => {
                const okN = group.entries.filter(e => e.status === 'success').length
                const failN = group.entries.filter(e => e.status === 'error').length
                const firstMode = group.entries[0]?.sourceMode
                const modeLabel = firstMode === 'watcher' ? 'Watch folder' : firstMode === 'manual-folder-run' ? 'Run Folder' : 'Run WAVs'
                return (
                  <div key={group.key} className="mb-2">
                    {/* Group head */}
                    <div className="flex items-center gap-2.5 px-0.5 pb-2.5">
                      <span className="text-[13px] font-[650] text-nm-text">{group.label}</span>
                      <span className="inline-flex items-center h-[19px] px-1.5 rounded-[6px] text-[10px] font-semibold border border-nm-border-s bg-field text-nm-text-2">{modeLabel}</span>
                      {okN > 0 && <span className="inline-flex items-center h-[19px] px-1.5 rounded-[6px] text-[10px] font-semibold border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">{okN} done</span>}
                      {failN > 0 && <span className="inline-flex items-center h-[19px] px-1.5 rounded-[6px] text-[10px] font-semibold border border-red-500/25 bg-red-500/10 text-red-400">{failN} failed</span>}
                      <span className="flex-1" />
                      {failN > 0 && (
                        <button
                          onClick={() => { void handleRetryHistoryBatch(group.entries.filter(e => e.status === 'error'), `Retry failed - ${group.label}`) }}
                          title={`Re-queue the ${failN} failed capture${failN === 1 ? '' : 's'} from this batch under a new submission. Uses the current Input DI and output formula from Settings.`}
                          className="h-7 inline-flex items-center gap-1 px-2 rounded-[7px] text-[11px] font-medium border border-red-500/30 hover:bg-red-500/10 text-red-400 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                          Retry failed
                        </button>
                      )}
                      {group.entries.length > 1 && (
                        <button
                          onClick={() => { void handleRetryHistoryBatch(group.entries, `Retry - ${group.label}`) }}
                          title={`Re-queue all ${group.entries.length} captures from this batch under a new submission.`}
                          className="h-7 inline-flex items-center gap-1 px-2 rounded-[7px] text-[11px] font-medium border border-nm-border-s hover:bg-hov text-nm-text-2 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                          Retry batch
                        </button>
                      )}
                      <span className="text-[11px] text-nm-text-3 font-mono">{group.createdAt ? new Date(group.createdAt).toLocaleString() : ''}</span>
                    </div>
                    {/* Rows */}
                    <div className="rounded-[12px] border border-nm-border-s bg-panel overflow-hidden">
                      {group.entries.map((entry, idx) => {
                        const tone = getEsrTone(entry.validationEsr)
                        const toneKey = tone.classes.includes('emerald') ? 'green' : tone.classes.includes('amber') ? 'amber' : tone.classes.includes('red') ? 'red' : 'none'
                        const clickable = entry.status === 'success' && !!entry.graphPath
                        const seed = (entry.historyId || '').length * 7 + 3
                        return (
                          <div
                            key={entry.historyId}
                            className={`flex items-center gap-3.5 px-4 py-3 ${idx < group.entries.length - 1 ? 'border-b border-nm-border-s' : ''} ${clickable ? 'cursor-pointer' : ''} hover:bg-hov transition-colors`}
                            onClick={clickable ? () => { void handleShowGraphModal(entry.graphPath) } : undefined}
                            onContextMenu={e => {
                              e.preventDefault()
                              setHistoryContextMenu({ entry, x: e.clientX, y: e.clientY })
                            }}
                          >
                            {/* Thumbnail */}
                            <div className="w-[44px] h-[34px] rounded-[7px] border border-nm-border-s bg-field flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                              {entry.status === 'success' && entry.graphPath
                                ? <MiniEsrPlot tone={toneKey as 'green' | 'amber' | 'red' | 'none'} seed={seed} />
                                : entry.status === 'error'
                                  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#f87171" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                                  : <svg className="w-3.5 h-3.5 text-nm-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" /></svg>
                              }
                            </div>
                            {/* Main */}
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-[560] text-nm-text truncate">{entry.finalModelName}</div>
                              {entry.status === 'error' ? (
                                <div className="text-[11px] text-red-400 font-mono truncate mt-[3px] max-w-[460px]">{entry.failureReason || 'Failed'}</div>
                              ) : (
                                <div className="flex items-center gap-2 flex-wrap mt-[3px] text-[11px] text-nm-text-3">
                                  <span className="inline-flex items-center h-[17px] px-1.5 rounded-[5px] text-[10px] font-medium border border-nm-border-s bg-field text-nm-text-2">{architectureDisplayLabel(entry.architecture)}</span>
                                  {entry.profileName && <span className="inline-flex items-center h-[17px] px-1.5 rounded-[5px] text-[10px] font-medium border border-nm-border-s bg-field text-nm-text-2">{entry.profileName}</span>}
                                  <span className="opacity-50">·</span>
                                  <span>{entry.epochs} epochs</span>
                                  {(() => {
                                    const dur = typeof entry.durationSec === 'number' ? entry.durationSec : null
                                    if (dur == null) return null
                                    return <><span className="opacity-50">·</span><span className="font-mono">{formatDuration(dur)}</span></>
                                  })()}
                                </div>
                              )}
                            </div>
                            {/* Right column */}
                            <div className="flex items-center gap-3.5 flex-shrink-0">
                              {entry.status === 'success' && typeof entry.validationEsr === 'number' ? (
                                <span className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11px] font-mono font-semibold ${tone.classes}`} style={{ background: toneKey === 'green' ? 'color-mix(in srgb, #10b981 14%, transparent)' : toneKey === 'amber' ? 'color-mix(in srgb, #f59e0b 14%, transparent)' : toneKey === 'red' ? 'color-mix(in srgb, #ef4444 14%, transparent)' : 'var(--field)' }}>
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                                  {tone.text}
                                </span>
                              ) : entry.status === 'error' ? (
                                <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11px] font-semibold border border-red-500/25 bg-red-500/10 text-red-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />Failed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11px] font-semibold border border-nm-border-s bg-field text-nm-text-3">
                                  <span className="w-1.5 h-1.5 rounded-full bg-nm-text-3" />{entry.status}
                                </span>
                              )}
                              <span className="text-[11px] font-mono text-nm-text-3 text-right whitespace-nowrap">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                              <div className="flex items-center gap-1">
                                {entry.graphPath && (
                                  <button onClick={e => { e.stopPropagation(); void handleShowGraphModal(entry.graphPath) }} className="w-7 h-7 flex items-center justify-center rounded-[7px] hover:bg-hov text-nm-text-3 hover:text-nm-text transition-colors" title="View ESR plot">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
                                  </button>
                                )}
                                {entry.status === 'error' && (
                                  <button onClick={e => { e.stopPropagation(); void handleRetryHistoryEntry(entry) }} className="w-7 h-7 flex items-center justify-center rounded-[7px] hover:bg-hov text-nm-text-3 hover:text-nm-text transition-colors" title="Retry">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                  </button>
                                )}
                                {entry.finalModelPath && (
                                  <button onClick={e => { e.stopPropagation(); void window.api.revealFile(entry.finalModelPath) }} className="w-7 h-7 flex items-center justify-center rounded-[7px] hover:bg-hov text-nm-text-3 hover:text-nm-text transition-colors" title="Reveal in folder">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" /></svg>
                                  </button>
                                )}
                              </div>
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

          {/* ── NEW RUN ────────────────────────────────────────────────────── */}
          {section === 'new' && (
            <div className="px-6 py-5 space-y-4 max-w-[1400px] mx-auto w-full">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[18px] font-[680] text-nm-text">Create Batch</h2>
                {presetSaveNotice && <span className="text-[12px] text-emerald-400">{presetSaveNotice}</span>}
              </div>

              {/* Captures card */}
              <div className="rounded-2xl border border-nm-border-s bg-panel-2 p-4 space-y-4">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" /></svg>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-nm-accent">Captures</span>
                </div>
                <Field label="Batch name" hint="Optional — leave blank to auto-name from the capture, folder, or count">
                  {(() => {
                    const folders = new Set(batchWavList.map(w => w.fromFolder).filter(Boolean))
                    const placeholder = batchWavList.length === 0
                      ? 'Auto — will use capture or folder name'
                      : batchWavList.length === 1
                        ? batchWavList[0].name
                        : (folders.size === 1 && batchWavList[0].fromFolder)
                          ? (batchWavList[0].fromFolder.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '')
                          : `Batch - ${batchWavList.length} captures`
                    return (
                      <input
                        type="text"
                        value={batchName}
                        onChange={e => setBatchName(e.target.value)}
                        placeholder={placeholder}
                        className="w-full h-9 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text placeholder:text-nm-text-3 focus:outline-none focus:border-nm-accent transition-colors"
                      />
                    )
                  })()}
                </Field>
                <Field label="Input DI" hint="Trainer reference / DI file">
                  <div
                    onDragOver={e => { e.preventDefault(); setDropTargetId('input-di') }}
                    onDragLeave={() => setDropTargetId(null)}
                    onDrop={handleInputDrop}
                    className={`rounded-lg transition-colors ${dropTargetId === 'input-di' ? 'ring-2 ring-nm-accent bg-nm-accent/10' : ''}`}
                  >
                    <PathPicker value={inputPath} placeholder="Select or drop DI WAV here" onChange={setInputPath} onBrowse={handleBrowseInput} />
                  </div>
                </Field>

                {/* Unified WAV list */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-nm-text">
                      Output WAVs
                      {batchWavList.length > 0 && (
                        <span className="ml-1.5 text-[11px] font-semibold text-nm-accent">· {batchWavList.length} selected</span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { void handleBrowseOutputs() }}
                        className="h-7 px-2.5 rounded-lg text-[12px] font-medium bg-nm-accent/15 border border-nm-accent/30 hover:bg-nm-accent/25 text-nm-accent transition-colors"
                      >+ Add Files</button>
                      <button
                        onClick={() => { void handleBrowseFolder() }}
                        className="h-7 px-2.5 rounded-lg text-[12px] font-medium bg-field border border-field-bd hover:bg-hov text-nm-text transition-colors"
                      >+ Add Folder</button>
                      {batchWavList.length > 0 && (
                        <button
                          onClick={() => setBatchWavList([])}
                          className="h-7 px-2.5 rounded-lg text-[12px] font-medium border border-nm-border-s hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 text-nm-text-3 transition-colors"
                        >✕ Clear</button>
                      )}
                    </div>
                  </div>
                  <div
                    onDragOver={e => { e.preventDefault(); setDropTargetId('output-wavs') }}
                    onDragLeave={() => setDropTargetId(null)}
                    onDrop={async e => {
                      e.preventDefault(); e.stopPropagation(); setDropTargetId(null)
                      const files = Array.from(e.dataTransfer.files)
                      if (files.length === 0) return
                      const wavFiles = files.filter(f => f.name.toLowerCase().endsWith('.wav'))
                      const otherFiles = files.filter(f => !f.name.toLowerCase().endsWith('.wav'))
                      // WAV files — add directly
                      if (wavFiles.length > 0) {
                        const paths = wavFiles.map(f => window.api.getPathForFile(f)).filter(Boolean) as string[]
                        addWavsToBatchList(paths)
                      }
                      // Non-WAV / unknown — check if it's a folder
                      for (const f of otherFiles) {
                        const p = window.api.getPathForFile(f)
                        if (!p) continue
                        const stat = await window.api.statPath(p)
                        if (stat.isDirectory) {
                          const wavPaths = await window.api.listWavFiles(p)
                          addWavsToBatchList(wavPaths, p)
                        }
                      }
                    }}
                    className={`rounded-lg border min-h-[80px] max-h-[220px] overflow-y-auto transition-colors ${dropTargetId === 'output-wavs' ? 'border-nm-accent bg-nm-accent/10 ring-2 ring-nm-accent' : 'border-field-bd bg-field'}`}
                  >
                    {batchWavList.length === 0 ? (
                      <div className="px-3 py-4 text-[12px] text-nm-text-3 italic text-center">
                        {dropTargetId === 'output-wavs' ? 'Drop WAVs or a folder here…' : 'No WAVs — choose files, add a folder, or drop here.'}
                      </div>
                    ) : (
                      (() => {
                        // Group by fromFolder, then ungrouped individuals
                        const folders = Array.from(new Set(batchWavList.map(i => i.fromFolder).filter(Boolean))) as string[]
                        const ungrouped = batchWavList.filter(i => !i.fromFolder)
                        return (
                          <div className="p-1 space-y-0.5">
                            {ungrouped.map(item => {
                              const parts = item.path.replace(/\\/g, '/').split('/')
                              const displayPath = parts.length > 2 ? `…/${parts.slice(-3, -1).join('/')}/${item.name}` : item.name
                              return (
                              <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px] hover:bg-hov group">
                                <svg className="w-3.5 h-3.5 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" /></svg>
                                <span className="flex-1 font-mono truncate text-nm-text-2 text-[11.5px]">{displayPath}</span>
                                <button onClick={() => setBatchWavList(prev => prev.filter(i => i.id !== item.id))} className="w-5 h-5 flex items-center justify-center rounded text-nm-text-3 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            )})}
                            {folders.map(folder => {
                              const items = batchWavList.filter(i => i.fromFolder === folder)
                              const folderName = folder.replace(/\\/g, '/').split('/').pop() ?? folder
                              const isExpanded = !collapsedFolders.has(folder)
                              return (
                                <div key={folder}>
                                  <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-hov cursor-pointer select-none"
                                    onClick={() => setCollapsedFolders(prev => { const n = new Set(prev); if (n.has(folder)) n.delete(folder); else n.add(folder); return n })}>
                                    <svg className={`w-3 h-3 text-nm-text-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                                    <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
                                    <span className="flex-1 text-[12px] font-medium text-nm-text truncate">{folderName}</span>
                                    <span className="text-[10px] text-nm-text-3">{items.length} file{items.length === 1 ? '' : 's'}</span>
                                    <button
                                      onClick={e => { e.stopPropagation(); setBatchWavList(prev => prev.filter(i => i.fromFolder !== folder)) }}
                                      className="w-5 h-5 flex items-center justify-center rounded text-nm-text-3 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
                                      title="Remove all files from this folder"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                  </div>
                                  {isExpanded && items.map(item => (
                                    <div key={item.id} className="flex items-center gap-2 pl-7 pr-2 py-1 rounded text-[12px] hover:bg-hov group">
                                      <svg className="w-3 h-3 text-nm-accent/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M2 12h3l2-7 4 16 3-12 2 5h6" /></svg>
                                      <span className="flex-1 font-mono truncate text-nm-text-2 text-[11.5px]">{item.name}</span>
                                      <button onClick={() => setBatchWavList(prev => prev.filter(i => i.id !== item.id))} className="w-5 h-5 flex items-center justify-center rounded text-nm-text-3 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()
                    )}
                  </div>
                </div>
              </div>

              {/* Training settings card */}
              <div className="rounded-2xl border border-nm-border-s bg-panel-2 p-4 space-y-4">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-nm-accent">Training Settings</span>
                  <HelpPopover title="Training Settings" side="right">
                    Configure the architecture, epochs, and model type for this run. Choose a saved <strong>Preset</strong> to load a full configuration in one click, or set <strong>Custom</strong> to adjust each field individually.
                    <br /><br />
                    The <strong>Architecture(s)</strong> picker includes built-in WaveNet sizes and any <strong>Capture Profiles</strong> you have saved in Settings → Training. A Capture Profile lets you store a custom layer config alongside an epoch count so you can reuse it.
                  </HelpPopover>
                </div>

                <div className="flex items-end gap-3 flex-wrap">
                  <Field label="Preset">
                    <select
                      value={currentPresetId}
                      onChange={e => { applyPreset(e.target.value) }}
                      className="h-10 px-3 pr-8 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none min-w-[220px]"
                    >
                      <option value={CUSTOM_PRESET_ID}>Custom</option>
                      {availablePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  {currentRunPreset && (
                    <div className="flex-1 min-w-[200px] h-10 rounded-lg border border-nm-border-s bg-field px-3 text-[12px] text-nm-text-2 flex items-center truncate">
                      {describePreset(currentRunPreset)}
                    </div>
                  )}
                </div>

                {/* Selected architectures as color-coded chips — appears under the preset row when a preset is active. */}
                {currentRunPreset && currentRunPreset.architectures.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 -mt-1.5">
                    <span className="text-[10.5px] uppercase font-[600] tracking-[.4px] text-nm-text-3 mr-0.5">Architectures</span>
                    {currentRunPreset.architectures.map(arch => (
                      <span key={arch} className="inline-flex items-center gap-1 h-[20px] px-2 rounded-full text-[10.5px] font-[650] border" style={archChipStyle(arch)}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                        {architectureFullLabel(arch)}
                      </span>
                    ))}
                  </div>
                )}

                {showsCustomSettings && (
                  <div className="grid gap-3 grid-cols-[1fr_100px_140px_100px_auto]">
                    <Field label="Architecture(s)" help={<>Each architecture produces a <code>.nam</code> of different size and quality. <strong>A2</strong> is the modern PackedWaveNet (one file = Full + Lite). <strong>A1 - Standard</strong> = best A1 quality. A1 Lite/Feather/Nano are smaller/faster. You can mix A1 and A2 — each ticked architecture spawns its own job in the batch.</>}>
                      <ArchitectureMultiSelect
                        values={architectures}
                        onChange={next => {
                          setArchitectures(next)
                          setSelectedPresetId(CUSTOM_PRESET_ID)
                        }}
                        userProfiles={settings.userCaptureProfiles ?? []}
                        onCreateProfile={() => { setCaptureProfileEditorTarget(null); setCaptureProfileEditorOpen(true) }}
                        onEditProfile={profile => { setCaptureProfileEditorTarget(profile); setCaptureProfileEditorOpen(true) }}
                      />
                    </Field>
                    <Field label="Epochs">
                      <input value={epochs} onChange={e => setEpochs(e.target.value)} className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none" />
                    </Field>
                    <Field label="Latency" labelTitle="blank = auto">
                      <input value={latency} onChange={e => setLatency(e.target.value)} className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none" placeholder="Auto" />
                    </Field>
                    <Field label="Target ESR" labelTitle="blank = off">
                      <input value={thresholdEsr} onChange={e => setThresholdEsr(e.target.value)} className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none" placeholder="—" />
                    </Field>
                    <div className="flex flex-row items-end gap-2 pb-0.5 flex-wrap">
                      <ToggleRow label="Save ESR plot" checked={savePlot} onChange={setSavePlot} />
                      <ToggleRow label="Ignore checks" checked={ignoreChecks} onChange={setIgnoreChecks} />
                      <div>
                        <div className="flex items-center gap-1 mb-1.5">
                          <label className="text-xs font-medium text-nm-text-2">Normalize</label>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={normalizeWavOverride}
                            onChange={e => setNormalizeWavOverride(e.target.value as typeof normalizeWavOverride)}
                            className="h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none"
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
                      </div>
                    </div>
                  </div>
                )}
                {showsCustomSettings && architectures.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] uppercase font-[600] tracking-[.4px] text-nm-text-3 mr-0.5">Selected</span>
                    {architectures.map(arch => {
                      const isBuiltIn = arch in ARCHITECTURE_ACCENT_HEX
                      const userProfile = isBuiltIn ? null : (settings.userCaptureProfiles ?? []).find(p => p.id === arch)
                      const displayLabel = isBuiltIn ? architectureFullLabel(arch) : (userProfile?.name ?? arch)
                      const style = isBuiltIn ? archChipStyle(arch) : { background: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 14%, transparent)', color: 'var(--nm-accent, var(--accent))', borderColor: 'color-mix(in srgb, var(--nm-accent, var(--accent)) 35%, transparent)' }
                      return (
                        <span key={arch} className="inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-full text-[11px] font-[650] border" style={style}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                          {displayLabel}
                          <button
                            onClick={() => { setArchitectures(architectures.filter(a => a !== arch)); setSelectedPresetId(CUSTOM_PRESET_ID) }}
                            className="w-[15px] h-[15px] rounded-full inline-flex items-center justify-center hover:bg-black/15 ml-0.5"
                            title={`Remove ${displayLabel}`}
                          >
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
                {showsCustomSettings && epochNote && (
                  <div className="text-[11px] text-amber-400">{epochNote}</div>
                )}
                {showsCustomSettings && (
                  <div className="flex justify-end">
                    <button onClick={handleSaveAsPreset} className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg text-[12px] font-medium border border-nm-border-s bg-field hover:bg-hov text-nm-text-2 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>
                      Save as Preset
                    </button>
                  </div>
                )}
              </div>

              {/* Output routing card */}
              <div className="rounded-2xl border border-nm-border-s bg-panel-2 p-4 space-y-4">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-nm-accent">Output Routing</span>
                  <HelpPopover side="right">
                    NAM Lab routes the final .nam and ESR graph to the configured destination. You can use a <strong>formula</strong> (from Settings → Training → Output Formula) for automatic token-based routing, or specify a fixed folder manually.
                  </HelpPopover>
                </div>

                {activeFormula && manualRoutingMode === 'root' && (() => {
                  const previewPath = formulaPreviewPath
                  const hasSource = !!filesStagingDir
                  return (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-[11px] font-semibold text-emerald-400">NAM output formula active</span>
                        <code className="text-[10px] font-mono bg-emerald-900/30 px-1.5 py-0.5 rounded text-emerald-300">
                          {activeFormula.split(/(\{[^}]+\})/).map((part, i) =>
                            part.startsWith('{') ? <span key={i} className="text-emerald-200 font-bold">{part}</span> : <span key={i} className="text-emerald-500">{part}</span>
                          )}
                        </code>
                      </div>
                      {previewPath && hasSource && <div className="pl-5 text-[11px] text-emerald-400 font-mono break-all">→ {previewPath}</div>}
                      {!hasSource && <div className="pl-5 text-[11px] text-emerald-500 italic">Add WAVs to preview output path</div>}
                      {!formulaOverrideActive && (
                        <div className="pl-5 flex items-center gap-2">
                          <span className="text-[11px] text-emerald-300/70">Override for this run:</span>
                          <button onClick={() => setFormulaOverrideActive(true)} className="text-[11px] text-emerald-300 hover:text-white border border-emerald-500/40 hover:border-emerald-400/70 rounded px-2 py-0.5 transition-colors bg-emerald-900/30 hover:bg-emerald-900/50">Use fixed path…</button>
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
                  const previewPath = graphFormulaPreviewPath
                  const hasSource = !!filesStagingDir
                  return (
                    <div className="rounded-lg border border-nm-accent/30 bg-nm-accent/10 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <svg className="w-3.5 h-3.5 text-nm-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-[11px] font-semibold text-nm-accent">Graph formula active</span>
                        <code className="text-[10px] font-mono bg-nm-accent/15 px-1.5 py-0.5 rounded text-nm-accent">
                          {activeGraphFormula.split(/(\{[^}]+\})/).map((part, i) =>
                            part.startsWith('{') ? <span key={i} className="text-accent-text font-bold">{part}</span> : <span key={i} className="text-nm-accent">{part}</span>
                          )}
                        </code>
                      </div>
                      {previewPath && hasSource && <div className="pl-5 text-[11px] text-nm-accent font-mono break-all">→ {previewPath}</div>}
                      {!hasSource && <div className="pl-5 text-[11px] text-nm-text-3 italic">Add WAVs to preview graph path</div>}
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

              {/* "Create as separate batches" checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none text-[13px] text-nm-text-2">
                <input
                  type="checkbox"
                  checked={separateBatches}
                  onChange={e => setSeparateBatches(e.target.checked)}
                  className="w-4 h-4 rounded accent-nm-accent"
                />
                Create all files as separate batches
              </label>

              {/* CTA buttons */}
              {(() => {
                const blockers: string[] = []
                if (!settings.namPythonPath.trim()) blockers.push('Python path not set (Settings → Training)')
                if (!inputPath.trim()) blockers.push('No input DI WAV selected')
                if (batchWavList.length === 0) blockers.push('No output WAV files added')
                if (!activePreset && architectures.length === 0) blockers.push('No architecture selected')
                if (!activePreset && (!Number.isFinite(Number(epochs)) || Number(epochs) <= 0)) blockers.push('Invalid epoch count')
                if (!trainPath.trim() && !(activeFormula && !formulaOverrideActive)) blockers.push('No output folder or formula set')
                const queueTooltip = blockers.length > 0 ? `Cannot queue:\n• ${blockers.join('\n• ')}` : undefined
                const allReady = blockers.length === 0
                return (
              <div className="flex flex-col gap-3">
                {!allReady && (
                  <div className="rounded-[11px] border border-amber-500/30 bg-amber-500/8 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                      <span className="text-[12.5px] font-[650] text-amber-400">Before you can queue</span>
                    </div>
                    <ul className="space-y-1">
                      {blockers.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-[12px] text-amber-300/90">
                          <span className="mt-[3px] w-1.5 h-1.5 rounded-full bg-amber-400/70 flex-shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              <div className="flex gap-3">
                <button
                  onClick={() => { void handleQueue(true) }}
                  disabled={!canQueue}
                  title={queueTooltip}
                  className="flex-1 py-3 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2"
                >
                  Stage (save, don't run)
                </button>
                <button
                  onClick={() => { void handleQueue(false) }}
                  disabled={!canQueue}
                  title={queueTooltip}
                  className="flex-1 py-3 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white bg-nm-accent hover:opacity-90"
                >
                  {(() => {
                    const jobArchCount = activePreset ? activePreset.architectures.length : architectures.length
                    const total = batchWavList.length * Math.max(jobArchCount, 1)
                    return total <= 1 ? 'Queue + Start' : `Queue ${total} · Start`
                  })()}
                </button>
              </div>
              </div>
                )
              })()}
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

    {historyContextMenu && createPortal(
      <>
        <div className="fixed inset-0 z-40" onClick={() => setHistoryContextMenu(null)} onContextMenu={e => { e.preventDefault(); setHistoryContextMenu(null) }} />
        <div
          className="fixed z-50 min-w-[220px] rounded-xl border border-nm-border bg-panel shadow-xl overflow-hidden py-1"
          style={{ left: historyContextMenu.x, top: historyContextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          {historyContextMenu.entry.graphPath && (
            <button onClick={() => { void handleShowGraphModal(historyContextMenu.entry.graphPath); setHistoryContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">View ESR plot</button>
          )}
          <button onClick={() => { void handleRetryHistoryEntry(historyContextMenu.entry); setHistoryContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Retry</button>
          {historyContextMenu.entry.finalModelPath && (
            <button onClick={() => { handleShowHistoryPath(historyContextMenu.entry.finalModelPath); setHistoryContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-nm-text hover:bg-hov">Reveal in folder</button>
          )}
          <div className="h-px bg-nm-border-s my-1" />
          <button
            onClick={() => {
              const entry = historyContextMenu.entry
              setHistoryContextMenu(null)
              setHistoryPurgeConfirm({ ids: [entry.historyId], label: entry.finalModelName || 'this capture', mode: 'capture' })
            }}
            className="w-full text-left px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10"
          >
            Purge from history…
          </button>
          {historyContextMenu.entry.submissionId && (() => {
            const sid = historyContextMenu.entry.submissionId
            const matches = trainerState.history.filter(e => e.submissionId === sid)
            if (matches.length <= 1) return null
            const label = historyContextMenu.entry.submissionLabel || `Batch (${matches.length} captures)`
            return (
              <button
                onClick={() => {
                  setHistoryContextMenu(null)
                  setHistoryPurgeConfirm({ ids: matches.map(e => e.historyId), label, mode: 'batch' })
                }}
                className="w-full text-left px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10"
              >
                Purge entire batch from history… <span className="text-nm-text-3 text-[11px]">({matches.length} captures)</span>
              </button>
            )
          })()}
        </div>
      </>,
      document.body
    )}

    {historyPurgeConfirm && createPortal(
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70" onClick={() => setHistoryPurgeConfirm(null)}>
        <div className="rounded-2xl border border-nm-border bg-panel shadow-2xl max-w-[440px] w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-nm-border-s flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, #ef4444 16%, transparent)', color: '#f87171' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            </div>
            <div>
              <div className="text-[14.5px] font-[660] text-nm-text">{historyPurgeConfirm.mode === 'batch' ? 'Purge batch from history?' : 'Purge from history?'}</div>
              <div className="text-[12px] text-nm-text-3 mt-0.5">This can&apos;t be undone.</div>
            </div>
          </div>
          <div className="px-5 py-4 text-[13px] text-nm-text-2 leading-[1.55]">
            {historyPurgeConfirm.mode === 'batch' ? (
              <>
                Removing <span className="font-mono text-nm-text">{historyPurgeConfirm.label}</span> will delete <span className="font-semibold text-nm-text">{historyPurgeConfirm.ids.length} history entries</span> permanently.
                <br /><br />
                Only the history record is removed — the trained <span className="font-mono">.nam</span> files and ESR plots on disk are left alone.
              </>
            ) : (
              <>
                Removing <span className="font-mono text-nm-text">{historyPurgeConfirm.label}</span> will delete this history entry permanently.
                <br /><br />
                Only the history record is removed — the trained <span className="font-mono">.nam</span> file and ESR plot on disk are left alone.
              </>
            )}
          </div>
          <div className="px-5 py-3.5 bg-panel-2 border-t border-nm-border-s flex items-center justify-end gap-2">
            <button onClick={() => setHistoryPurgeConfirm(null)} className="h-9 px-4 rounded-[9px] text-[12.5px] font-medium border border-nm-border-s bg-panel hover:bg-hov text-nm-text-2 transition-colors">Cancel</button>
            <button
              onClick={async () => {
                const target = historyPurgeConfirm
                setHistoryPurgeConfirm(null)
                const result = await window.api.purgeTrainerHistoryEntries(target.ids)
                if (!result.success) setQueueActionError(result.error ?? 'Could not purge history entries.')
              }}
              className="h-9 px-4 rounded-[9px] text-[12.5px] font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              {historyPurgeConfirm.mode === 'batch' ? `Purge ${historyPurgeConfirm.ids.length} entries` : 'Purge entry'}
            </button>
          </div>
        </div>
      </div>,
      document.body
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
        <label title={labelTitle} className={`text-[11px] font-[600] text-nm-text-2 ${labelTitle ? 'cursor-help' : ''}`}>
          {label}
          {labelTitle && <span className="ml-1 text-nm-text-3">ⓘ</span>}
          {hint && <span className="ml-2 text-nm-text-3 font-normal">{hint}</span>}
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
    ...ARCHITECTURE_DISPLAY_ORDER.map((id) => ({ id, name: architectureFullLabel(id) })),
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
        className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent flex items-center justify-between gap-3"
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 text-nm-text-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-nm-border bg-panel shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {ARCHITECTURE_DISPLAY_ORDER.length > 0 && (
              <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-nm-text-3">Built-in</div>
            )}
            {ARCHITECTURE_DISPLAY_ORDER.map((option) => {
              const checked = values.includes(option)
              return (
                <label key={option} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-[13px] ${checked ? 'bg-nm-accent/10 text-nm-accent' : 'text-nm-text-2 hover:bg-hov'}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onChange([...values, option]); else onChange(values.filter((item) => item !== option)) }} className="accent-nm-accent" />
                  <span>{architectureFullLabel(option)}</span>
                </label>
              )
            })}
            {userProfiles.length > 0 && (
              <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-nm-text-3 border-t border-nm-border-s mt-1">Custom</div>
            )}
            {userProfiles.map((profile) => {
              const checked = values.includes(profile.id)
              return (
                <div key={profile.id} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${checked ? 'bg-nm-accent/10' : 'hover:bg-hov'}`}>
                  <label className="flex items-center gap-2 flex-1 cursor-pointer text-[13px]">
                    <input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onChange([...values, profile.id]); else onChange(values.filter((item) => item !== profile.id)) }} className="accent-nm-accent" />
                    <span className={checked ? 'text-nm-accent' : 'text-nm-text-2'}>{profile.name}</span>
                  </label>
                  {onEditProfile && (
                    <button onClick={() => { onEditProfile(profile); setOpen(false) }} className="text-[10px] text-nm-text-3 hover:text-nm-text px-1">Edit</button>
                  )}
                </div>
              )
            })}
            {onCreateProfile && (
              <button onClick={() => { onCreateProfile(); setOpen(false) }} className="w-full text-left px-2.5 py-1.5 text-[11px] text-nm-accent hover:bg-hov border-t border-nm-border-s mt-1">
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
        className="flex-1 h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text placeholder:text-nm-text-3 focus:outline-none focus:border-nm-accent font-mono"
      />
      <button
        onClick={() => { void onBrowse() }}
        className="h-10 px-3 rounded-lg text-[13px] font-medium transition-colors bg-field border border-field-bd hover:bg-hov text-nm-text-2"
      >
        {browseLabel}
      </button>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-nm-border-s bg-field px-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-nm-accent"
      />
      <span className="text-[12.5px] text-nm-text-2">{label}</span>
    </label>
  )
}


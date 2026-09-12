import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { NamLabCrumb } from '../NamLabCrumb'
import { DataGrid, type DataGridColumn } from '../DataGrid'
import { TRAINER_ARCHITECTURES, BUILT_IN_CAPTURE_PROFILES } from '../../types/trainer'
import { GEAR_TYPES, TONE_TYPES } from '../../types/nam'
import type { NamFile } from '../../types/nam'
import { loadNamFileForPlayback } from '../../utils/loadNamFile'
import { PlayerPanel } from '../PlayerPanel'
import { WavPreviewPlayer } from '../WavPreviewPlayer'
import { IrProjectDefaultsModal } from './IrProjectDefaultsModal'
import { IrBuildPackModal } from './IrBuildPackModal'
import { describeIrLabAvailability, type IrLabStatus } from './irLabStatusMessage'
import type {
  NamProjectSummary,
  NamProjectDetail,
  NamCaptureRow,
  NamCaptureMetadataPatch,
  NamLibraryOverview
} from '../../types/namProjects'
import type { TrainerHistoryEntry, TrainerQueueJob } from '../../types/trainer'
import { goToTrainingBatches, goToTrainingQueue, consumePendingNamProjectNav } from '../../appNav'
import { SettingsPanel } from '../SettingsPanel'
import { AppSettings, loadSettings, saveSettings } from '../../types/settings'
import { namGearChipClass, namToneChipClass } from '../../assets/gear'
import { ScaledImage } from '../ScaledImage'

// Evaluated lazily (not at module scope): this file's pure helpers (matchesFacets, sortRows, …)
// are imported directly by NamProjectsShell.test.ts under plain Node, no `window` — a module-
// level `window.api` read would crash that import before any test body runs.
function isMacPlatform(): boolean {
  return typeof window !== 'undefined' && window.api?.platform === 'darwin'
}

/** Friendly label for an architecture id ("standard" -> "Standard"), matching the Trainer tab. */
const ARCH_LABEL: Record<string, string> = Object.fromEntries(
  BUILT_IN_CAPTURE_PROFILES.map((p) => [p.id, p.name])
)

/**
 * "NAM Projects" mode — the third top-level workspace (docs/nam-capture-import-plan-2026-08-29.md
 * §1, docs/nam-projects-detail-design-2026-08-31.md). Read-only view over IR Lab NAM Capture
 * projects already in the shared catalog (they enter it through IR mode's "Add Library Folder"),
 * plus two write actions: stage/queue captures as a training batch, and edit the per-capture
 * "effective" model-metadata (gear/tone hints + calibration dBu) that seeds the trained .nam.
 * Trained/untrained comes straight from each capture folder's nam-lab-result.json.
 *
 * Its own shell, not a fork of IrModeShell — IrItemRow is welded to IR-only columns and there's
 * no audition half. The three-region skeleton, Tailwind tokens, col-resize divider, filter
 * boxes, status chips, list/cards toggle, facet pills, and blue-dot / nam-chip idioms all match
 * the other two modes.
 */

const OUTPUT_ROOT_KEY = 'nam-lab-nam-projects-output-root'
const ARCH_KEY = 'nam-lab-nam-projects-architecture'
const EPOCHS_KEY = 'nam-lab-nam-projects-epochs'
const SELECTED_KEY = 'nam-lab-nam-projects-selected'
const VIEW_KEY = 'nam-lab-nam-projects-view'
const CAPTURE_VIEW_KEY = 'nam-lab-nam-projects-capture-view'
// M4 (docs/ir-lab-manager-handoff-2026-09-02.md): port FolderCardView's
// small/medium/large card-size toggle to CaptureCard. Same key-naming
// convention as its neighbours above, same three px values as
// FolderCardView's own CARD_PX ladder (180/264/336) so the two card
// grids in this app read as the same control, not a lookalike.
const CAPTURE_CARD_SIZE_KEY = 'nam-lab-nam-projects-capture-card-size'
// M-A4#4 (docs/nam-projects-2026-08-31-audit-and-switcher.md): the optional project-rail sort,
// marked optional in the original design and never built until now.
const PROJECT_SORT_KEY = 'nam-lab-nam-projects-project-sort'
const SORT_LS_KEY = 'nam-lab-nam-projects-sort'
// Projects index (design_handoff_nam_projects) — the list/cards toggle for the picker screen
// shown when selectedId is null, independent of captureView (which is the per-project capture
// grid's own list/cards toggle).
const INDEX_VIEW_KEY = 'nam-lab-nam-projects-index-view'

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}
function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* non-fatal */
  }
}

// Expanded status vocabulary (design_handoff_nam_projects) — `synthetic` is deliberately NOT one
// of these: it's an orthogonal flag a capture can carry regardless of training state (kept as its
// own toggle in the filter row), not a lifecycle stage.
export type CaptureStatus = 'untrained' | 'queued' | 'training' | 'trained' | 'failed' | 'missing'
type StatusFilter = 'all' | CaptureStatus

/** Derives a capture's live status from its own `trained` flag plus the trainer's queue state —
 * this shell had no live-queue signal at all before (only a post-hoc refetch on job completion
 * via onTrainerHistory), so `queued`/`training`/`failed` are new here, not a relabeling.
 * `namCaptureId` (set on the queue job via toBatchItem's `captureId: c.captureId ?? c.itemId`) is
 * the join key back to a specific capture — same identity NAM Capture import jobs already use. */
export function deriveCaptureStatus(capture: NamCaptureRow, queueJobs: TrainerQueueJob[]): CaptureStatus {
  if (capture.trained) return 'trained'
  if (!capture.excitationPath || !capture.recordingPath) return 'missing'
  const key = capture.captureId ?? capture.itemId
  const job = queueJobs.find((j) => j.namCaptureId === key)
  if (job) {
    if (job.status === 'running' || job.status === 'starting') return 'training'
    if (job.status === 'error') return 'failed'
    if (job.status === 'staged' || job.status === 'queued') return 'queued'
    // 'success'/'canceled' fall through to 'untrained' below — success is reflected via
    // capture.trained once onTrainerHistory triggers a refetch; canceled reverts silently.
  }
  return 'untrained'
}

const CAPTURE_STATUS_LABEL: Record<CaptureStatus, string> = {
  untrained: 'Untrained',
  queued: 'Queued',
  training: 'Training',
  trained: 'Trained',
  failed: 'Failed',
  missing: 'Missing WAV'
}
// Tailwind-safe literal classes (no dynamic class-name concatenation) matching the design's status
// color mapping: untrained gray, queued indigo, training amber, trained emerald, failed red,
// missing WAV orange.
const CAPTURE_STATUS_DOT: Record<CaptureStatus, string> = {
  untrained: 'bg-nm-text-3',
  queued: 'bg-indigo-500',
  training: 'bg-amber-500',
  trained: 'bg-emerald-500',
  failed: 'bg-red-500',
  missing: 'bg-orange-500'
}
const CAPTURE_STATUS_TEXT: Record<CaptureStatus, string> = {
  untrained: 'text-nm-text-3',
  queued: 'text-indigo-500',
  training: 'text-amber-500',
  trained: 'text-emerald-500',
  failed: 'text-red-500',
  missing: 'text-orange-500'
}

// --- formatting helpers ------------------------------------------------------

/** local-file:// src for an on-disk image/graph (matches FolderGallery et al.), Windows-safe. */
function fileSrc(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return norm.startsWith('/') ? `local-file://${norm}` : `local-file:///${norm}`
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "3d ago" / "just now" from an ISO string or epoch ms. */
function relTime(input: string | number | null | undefined): string | null {
  if (input == null) return null
  const t = typeof input === 'number' ? input : new Date(input).getTime()
  if (isNaN(t)) return null
  const secs = Math.round((Date.now() - t) / 1000)
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

function srLabel(sr: number | null | undefined): string | null {
  if (sr == null) return null
  return `${(sr / 1000).toFixed(sr % 1000 ? 1 : 0)}k`
}

/** "48k/24-bit · mono" — the shared audio-facts sub-line. */
function audioLabel(c: NamCaptureRow): string {
  const parts: string[] = []
  const sr = srLabel(c.sampleRate)
  if (sr && c.recordingBitDepth) parts.push(`${sr}/${c.recordingBitDepth}-bit`)
  else if (sr) parts.push(sr)
  else if (c.recordingBitDepth) parts.push(`${c.recordingBitDepth}-bit`)
  if (c.recordingChannels === 1) parts.push('mono')
  else if (c.recordingChannels === 2) parts.push('stereo')
  else if (c.recordingChannels) parts.push(`${c.recordingChannels}ch`)
  return parts.join(' · ')
}

function durationLabel(secs: number | null | undefined): string | null {
  if (secs == null || !isFinite(secs) || secs <= 0) return null
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function captureIsCalibrated(c: NamCaptureRow): boolean {
  return !!c.calibration && (c.calibration.inputLevelDbu != null || c.calibration.outputLevelDbu != null)
}

/**
 * Calibration levels are MEASURED by IR Lab's guided calibration, not typed in, so they arrive as
 * full-precision doubles ("17.497903575995384"). Interpolating one straight into a string prints
 * every significant digit. 0.1 dB is already finer than interface calibration is meaningful to.
 * `grid` keeps the trailing ".0" so right-aligned columns scan as a column; inline text drops it.
 */
function fmtDbu(v: number | null | undefined, style: 'inline' | 'grid' = 'inline'): string | null {
  if (v == null || !isFinite(v)) return null
  const fixed = v.toFixed(1)
  return style === 'grid' ? fixed : fixed.replace(/\.0$/, '')
}

// --- facets ----------------------------------------------------------------

export type FacetKey = 'scope' | 'sampleRate' | 'gearType' | 'toneType' | 'calibration' | 'architecture'
export type FacetState = Record<FacetKey, string[]>
const EMPTY_FACETS: FacetState = {
  scope: [],
  sampleRate: [],
  gearType: [],
  toneType: [],
  calibration: [],
  architecture: []
}

function tally(vals: Array<string | null | undefined>): Array<{ value: string; count: number }> {
  const m = new Map<string, number>()
  for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

interface AvailableFacets {
  scope: Array<{ value: string; count: number }>
  sampleRate: Array<{ value: string; count: number }>
  gearType: Array<{ value: string; count: number }>
  toneType: Array<{ value: string; count: number }>
  architecture: Array<{ value: string; count: number }>
  calibration: Array<{ value: string; count: number; label: string }>
}

export function availableFacets(caps: NamCaptureRow[]): AvailableFacets {
  const calibrated = caps.filter(captureIsCalibrated)
  const calibration: AvailableFacets['calibration'] = []
  if (calibrated.length > 0)
    calibration.push({ value: 'calibrated', count: calibrated.length, label: 'Calibrated' })
  if (calibrated.length < caps.length)
    calibration.push({ value: 'uncalibrated', count: caps.length - calibrated.length, label: 'Uncalibrated' })
  for (const { value, count } of tally(calibrated.map((c) => c.calibration?.confidence)))
    calibration.push({ value: `conf:${value}`, count, label: value })
  return {
    scope: tally(caps.map((c) => c.captureScope)),
    sampleRate: tally(caps.map((c) => srLabel(c.sampleRate))),
    gearType: tally(caps.map((c) => c.effective.gearType)),
    toneType: tally(caps.map((c) => c.effective.toneType)),
    architecture: tally(caps.map((c) => c.result?.architecture)),
    calibration
  }
}

/** Project-rail sort (design doc S9a, optional, previously unbuilt). `newest` treats a missing
 * `createdAt` as oldest, not as "now" -- an unknown date should never sort to the top. `name` is
 * a plain locale compare. `leastTrained` ranks the fewest-trained-fraction project first (0
 * captures counts as fully "needs work", i.e. ranks like 0 trained), ties broken by name. */
export function sortProjects<T extends { name: string; createdAt: string | null; captureCount: number; trainedCount: number }>(
  projects: T[],
  sort: 'name' | 'newest' | 'leastTrained'
): T[] {
  const sorted = [...projects]
  if (sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sort === 'newest') {
    sorted.sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : -Infinity
      const tb = b.createdAt ? Date.parse(b.createdAt) : -Infinity
      return tb - ta || a.name.localeCompare(b.name)
    })
  } else {
    sorted.sort((a, b) => {
      const fa = a.captureCount > 0 ? a.trainedCount / a.captureCount : 0
      const fb = b.captureCount > 0 ? b.trainedCount / b.captureCount : 0
      return fa - fb || a.name.localeCompare(b.name)
    })
  }
  return sorted
}

/** AND across facets, OR within a facet — matches IR mode's FieldBadge filter bar. */
export function matchesFacets(c: NamCaptureRow, f: FacetState): boolean {
  if (f.scope.length && !(c.captureScope && f.scope.includes(c.captureScope))) return false
  if (f.sampleRate.length) {
    const s = srLabel(c.sampleRate)
    if (!s || !f.sampleRate.includes(s)) return false
  }
  if (f.gearType.length && !(c.effective.gearType && f.gearType.includes(c.effective.gearType))) return false
  if (f.toneType.length && !(c.effective.toneType && f.toneType.includes(c.effective.toneType))) return false
  if (
    f.architecture.length &&
    !(c.result?.architecture && f.architecture.includes(c.result.architecture))
  )
    return false
  if (f.calibration.length) {
    const cal = captureIsCalibrated(c)
    const ok = f.calibration.some((v) => {
      if (v === 'calibrated') return cal
      if (v === 'uncalibrated') return !cal
      if (v.startsWith('conf:')) return cal && c.calibration?.confidence === v.slice(5)
      return false
    })
    if (!ok) return false
  }
  return true
}

// --- small shared components ---------------------------------------------------

// --- sorting + the shared DataGrid column model ---------------------------

type SortDir = 'asc' | 'desc'

const numOr = (n: number | null | undefined, fallback: number): number =>
  n == null || !Number.isFinite(n) ? fallback : n

/** Column definitions for the capture list's DataGrid. `getValue` is the text used for the
 * per-column filter / value checklist / autosize / default cell; `sortValue` / `render` refine
 * sorting and display. The card view sorts through the same defs (sortRows below).
 *
 * A function of `queueJobs` (not a static array) so the `trained`/status column's render can
 * derive each row's live status — `deriveCaptureStatus` needs the current queue snapshot, which
 * only exists inside the component, not at module scope. */
export function buildCaptureColumns(queueJobs: TrainerQueueJob[]): DataGridColumn<NamCaptureRow>[] {
  return [
  { key: 'name', label: 'Name', minWidth: 160, defaultWidth: 260, defaultVisible: true, filter: 'text', getValue: (c) => c.captureName },
  { key: 'scope', label: 'Scope', minWidth: 90, defaultVisible: true, getValue: (c) => c.captureScope ?? '' },
  { key: 'rate', label: 'Rate', minWidth: 70, defaultVisible: true, getValue: (c) => srLabel(c.sampleRate) ?? '', sortValue: (c) => c.sampleRate ?? 0 },
  { key: 'bitDepth', label: 'Bit depth', minWidth: 80, defaultVisible: false, getValue: (c) => (c.recordingBitDepth ? `${c.recordingBitDepth}-bit` : ''), sortValue: (c) => c.recordingBitDepth ?? 0 },
  { key: 'channels', label: 'Channels', minWidth: 84, defaultVisible: false, getValue: (c) => (c.recordingChannels === 1 ? 'mono' : c.recordingChannels === 2 ? 'stereo' : c.recordingChannels ? `${c.recordingChannels}ch` : '') },
  { key: 'duration', label: 'Length', minWidth: 70, defaultVisible: false, align: 'right', getValue: (c) => durationLabel(c.recordingDurationSec) ?? '', sortValue: (c) => numOr(c.recordingDurationSec, 0) },
  { key: 'latency', label: 'Latency', minWidth: 74, defaultVisible: true, align: 'right', getValue: (c) => (c.measuredLatencySamples != null ? String(c.measuredLatencySamples) : ''), sortValue: (c) => c.measuredLatencySamples ?? -1 },
  { key: 'calIn', label: 'Cal in (dBu)', minWidth: 96, defaultVisible: false, align: 'right', getValue: (c) => fmtDbu(c.effective.inputLevelDbu ?? c.calibration?.inputLevelDbu, 'grid') ?? '', sortValue: (c) => numOr(c.effective.inputLevelDbu ?? c.calibration?.inputLevelDbu, Number.POSITIVE_INFINITY) },
  { key: 'calOut', label: 'Cal out (dBu)', minWidth: 96, defaultVisible: false, align: 'right', getValue: (c) => fmtDbu(c.effective.outputLevelDbu ?? c.calibration?.outputLevelDbu, 'grid') ?? '', sortValue: (c) => numOr(c.effective.outputLevelDbu ?? c.calibration?.outputLevelDbu, Number.POSITIVE_INFINITY) },
  { key: 'calConfidence', label: 'Cal confidence', minWidth: 120, defaultVisible: false, getValue: (c) => c.calibration?.confidence ?? '' },
  { key: 'gearMake', label: 'Gear make', minWidth: 120, defaultVisible: false, getValue: (c) => c.effective.gearMake ?? '' },
  { key: 'gearModel', label: 'Gear model', minWidth: 120, defaultVisible: false, getValue: (c) => c.effective.gearModel ?? '' },
  { key: 'gearType', label: 'Gear type', minWidth: 100, defaultVisible: false, getValue: (c) => c.effective.gearType ?? '' },
  { key: 'toneType', label: 'Tone type', minWidth: 100, defaultVisible: false, getValue: (c) => c.effective.toneType ?? '' },
  { key: 'modeledBy', label: 'Modeled by', minWidth: 130, defaultVisible: false, getValue: (c) => c.effective.modeledBy ?? '' },
  { key: 'esr', label: 'ESR', minWidth: 74, defaultVisible: true, align: 'right', getValue: (c) => (c.result?.validationEsr != null ? c.result.validationEsr.toFixed(4) : ''), sortValue: (c) => c.result?.validationEsr ?? Number.POSITIVE_INFINITY },
  { key: 'architecture', label: 'Arch', minWidth: 70, defaultVisible: false, getValue: (c) => c.result?.architecture ?? '' },
  {
    key: 'trained',
    label: 'Status',
    minWidth: 92,
    defaultVisible: true,
    getValue: (c) => CAPTURE_STATUS_LABEL[deriveCaptureStatus(c, queueJobs)],
    sortValue: (c) => ['missing', 'untrained', 'queued', 'training', 'failed', 'trained'].indexOf(deriveCaptureStatus(c, queueJobs)),
    render: (c) => <CaptureStatusBadge status={deriveCaptureStatus(c, queueJobs)} />
  },
  { key: 'edited', label: 'Edited', minWidth: 70, defaultVisible: false, getValue: (c) => (c.metadataEdited ? 'Yes' : '') },
  { key: 'synthetic', label: 'Synthetic', minWidth: 84, defaultVisible: false, getValue: (c) => (c.synthetic ? 'Yes' : '') },
  {
    key: 'created',
    label: 'Date',
    minWidth: 90,
    defaultVisible: true,
    getValue: (c) => fmtDate(c.createdAt) ?? '',
    sortValue: (c) => (c.createdAt ? Date.parse(c.createdAt) || 0 : 0),
    render: (c) => <span title={fmtDateTime(c.createdAt) ?? ''}>{relTime(c.createdAt) ?? '—'}</span>
  }
  ]
}

/** Sort a row array through a DataGrid column's `sortValue` (or its text value) — used for the
 * card view, which shares the column model but isn't rendered by DataGrid. */
function sortRows<T>(rows: T[], columns: DataGridColumn<T>[], key: string, dir: SortDir): T[] {
  const col = columns.find((c) => c.key === key)
  if (!col) return rows
  const val = col.sortValue ?? ((r: T) => col.getValue(r).toLowerCase())
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = val(a)
    const bv = val(b)
    if (av < bv) return -mul
    if (av > bv) return mul
    return 0
  })
}

/** nam-chip that toggles a facet filter (card scope / rate / gear / tone chips). */
function FacetChip({
  label,
  active,
  onClick,
  colorClass = ''
}: {
  label: string
  active: boolean
  onClick: () => void
  colorClass?: string
}): React.ReactElement {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`Filter by ${label}`}
      className={`nam-chip ${colorClass} text-[10px] ${active ? 'ring-1 ring-nm-accent' : ''}`}
    >
      {label}
    </button>
  )
}

function CaptureStatusBadge({ status }: { status: CaptureStatus }): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 ${CAPTURE_STATUS_TEXT[status]}`}
      title={CAPTURE_STATUS_LABEL[status]}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${CAPTURE_STATUS_DOT[status]}`} />
      {CAPTURE_STATUS_LABEL[status]}
    </span>
  )
}

function Pill({
  label,
  count,
  active,
  onClick,
  colorClass = ''
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  colorClass?: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'px-1.5 py-0.5 text-[10px] rounded border bg-nm-accent text-accent-fg border-nm-accent'
          : `nam-chip ${colorClass} text-[10px] opacity-70 hover:opacity-100`
      }
    >
      {label}
      {count != null ? ` ${count}` : ''}
    </button>
  )
}

function FacetPills({
  available,
  active,
  onToggle
}: {
  available: AvailableFacets
  active: FacetState
  onToggle: (key: FacetKey, value: string) => void
}): React.ReactElement | null {
  const groups = (
    [
      { key: 'scope', title: 'Scope', opts: available.scope },
      { key: 'sampleRate', title: 'Rate', opts: available.sampleRate },
      { key: 'gearType', title: 'Gear', opts: available.gearType },
      { key: 'toneType', title: 'Tone', opts: available.toneType },
      { key: 'calibration', title: 'Cal', opts: available.calibration },
      { key: 'architecture', title: 'Arch', opts: available.architecture }
    ] as Array<{
      key: FacetKey
      title: string
      opts: Array<{ value: string; count: number; label?: string }>
    }>
  ).filter((g) => g.opts.length > 0)
  if (groups.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b border-nm-border-s flex-shrink-0">
      {groups.map((g) => (
        <div key={g.key} className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-nm-text-3">{g.title}</span>
          {g.opts.map((o) => (
            <Pill
              key={o.value}
              label={o.label ?? o.value}
              count={o.count}
              active={active[g.key].includes(o.value)}
              onClick={() => onToggle(g.key, o.value)}
              colorClass={
                g.key === 'gearType'
                  ? namGearChipClass(o.value)
                  : g.key === 'toneType'
                    ? namToneChipClass(o.value)
                    : g.key === 'scope'
                      ? 'chip-nam-scope'
                      : g.key === 'sampleRate'
                        ? 'chip-nam-rate'
                        : g.key === 'calibration'
                          ? 'chip-nam-cal'
                          : 'chip-ir-neutral'
              }
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function CoverageBar({
  trained,
  total,
  synthetic,
  meanEsr
}: {
  trained: number
  total: number
  synthetic: number
  meanEsr: number | null
}): React.ReactElement {
  const pct = total ? Math.round((trained / total) * 100) : 0
  return (
    <div className="flex items-center gap-3 text-[11px] text-nm-text-3 flex-wrap">
      <span className="inline-flex h-2 w-40 rounded-full bg-field-bg overflow-hidden flex-shrink-0">
        <span className="h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-nm-text-2">
        {trained} / {total} trained
      </span>
      {synthetic > 0 && <span>{synthetic} synthetic</span>}
      {meanEsr != null && <span>mean ESR {meanEsr.toFixed(4)}</span>}
    </div>
  )
}

function MakeupChips({ captures }: { captures: NamCaptureRow[] }): React.ReactElement | null {
  const chips: Array<{ label: string; colorClass: string }> = []
  for (const { value, count } of tally(captures.map((c) => srLabel(c.sampleRate))))
    chips.push({ label: `${value} ×${count}`, colorClass: 'chip-nam-rate' })
  for (const { value, count } of tally(captures.map((c) => (c.recordingBitDepth ? `${c.recordingBitDepth}-bit` : null))))
    chips.push({ label: count === captures.length ? value : `${value} ×${count}`, colorClass: 'chip-ir-depth' })
  const scope = tally(captures.map((c) => c.captureScope))
  if (scope.length) chips.push({ label: scope.map((s) => `${s.value} ×${s.count}`).join(' · '), colorClass: 'chip-nam-scope' })
  const calibrated = captures.filter(captureIsCalibrated)
  if (calibrated.length > 0) {
    const conf = tally(calibrated.map((c) => c.calibration?.confidence))
    chips.push({
      label: `${calibrated.length}/${captures.length} calibrated${conf[0] ? ` · mostly ${conf[0].value}` : ''}`,
      colorClass: 'chip-nam-cal'
    })
  }
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className={`nam-chip ${c.colorClass} text-[10px]`}>
          {c.label}
        </span>
      ))}
    </div>
  )
}

function ProjectHeader({
  detail,
  onReveal,
  onOpenProjectDefaults,
  onOpenBuildPack
}: {
  detail: NamProjectDetail
  onReveal: (path: string) => void
  onOpenProjectDefaults: () => void
  onOpenBuildPack: () => void
}): React.ReactElement {
  const esrs = detail.captures
    .filter((c) => c.trained)
    .map((c) => c.result?.validationEsr)
    .filter((v): v is number => v != null)
  const meanEsr = esrs.length ? esrs.reduce((a, b) => a + b, 0) / esrs.length : null
  const created = fmtDate(detail.createdAt)
  const hasProjectDetails =
    detail.cabinet ||
    detail.speaker ||
    detail.room ||
    detail.signalChain ||
    detail.description ||
    detail.projectNotes
  const [primaryImage, ...restImages] = detail.imagePaths

  const [connectorAvailable, setConnectorAvailable] = useState(false)
  const [irLabStatus, setIrLabStatus] = useState<IrLabStatus | null>(null)
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null)
  useEffect(() => {
    window.api.irLabConnectorAvailable().then(setConnectorAvailable)
    window.api.irLibraryGetIrLabStatus().then(setIrLabStatus)
  }, [])
  const openProjectInIrLab = useCallback(async () => {
    const result = await window.api.irLibrarySendProjectToIrLab(detail.projectId)
    setHandoffStatus(result.success ? 'Opened in IR Lab.' : result.reason ?? 'Failed to open in IR Lab.')
  }, [detail.projectId])

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-nm-border flex-shrink-0">
      {primaryImage && (
        <ScaledImage
          src={fileSrc(primaryImage)}
          width={288}
          height={192}
          fit="contain"
          onClick={() => void window.api.openFile(primaryImage)}
          title="Open full size"
          className="rounded border border-nm-border-s bg-field-bg flex-shrink-0 cursor-pointer hover:opacity-80"
        />
      )}
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-nm-text truncate">{detail.name}</span>
          {created && <span className="text-[11px] text-nm-text-3">created {created}</span>}
          {detail.namCapturesDir && (
            <button
              onClick={() => onReveal(detail.namCapturesDir as string)}
              className="text-[11px] text-nm-accent hover:underline"
            >
              Reveal NAM Captures folder
            </button>
          )}
          {detail.excitationsDir && (
            <button
              onClick={() => onReveal(detail.excitationsDir as string)}
              className="text-[11px] text-nm-accent hover:underline"
            >
              Reveal _excitations
            </button>
          )}
          <button
            onClick={() => void openProjectInIrLab()}
            disabled={!connectorAvailable}
            title={describeIrLabAvailability(connectorAvailable, irLabStatus, 'Open this project, ready to capture another position').tooltip}
            className="text-[11px] text-nm-accent hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Open in IR Lab
          </button>
          <button onClick={onOpenProjectDefaults} className="text-[11px] text-nm-accent hover:underline">
            Set Project Defaults…
          </button>
          <button onClick={onOpenBuildPack} className="text-[11px] text-nm-accent hover:underline">
            Build Pack…
          </button>
          {handoffStatus && <span className="text-[11px] text-nm-text-3">{handoffStatus}</span>}
        </div>
        <CoverageBar
          trained={detail.trainedCount}
          total={detail.captureCount}
          synthetic={detail.syntheticCount}
          meanEsr={meanEsr}
        />
        <MakeupChips captures={detail.captures} />
        {hasProjectDetails ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-nm-text-3">
            {detail.cabinet && <span>cab {detail.cabinet}</span>}
            {detail.speaker && <span>speaker {detail.speaker}</span>}
            {detail.room && <span>room {detail.room}</span>}
            {detail.signalChain && <span>chain {detail.signalChain}</span>}
          </div>
        ) : null}
        {restImages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto py-1">
            {restImages.map((p) => (
              <ScaledImage
                key={p}
                src={fileSrc(p)}
                width={96}
                height={64}
                fit="contain"
                onClick={() => void window.api.openFile(p)}
                className="rounded border border-nm-border-s bg-field-bg flex-shrink-0 cursor-pointer hover:opacity-80"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Live-run strip (design_handoff_nam_projects) — only rendered while a capture from THIS
 * project is actually training. Real data throughout, not simulated: epoch/ESR/ETA come straight
 * off the matching `TrainerQueueJob`, the same object TrainingPanel.tsx's own live-run view reads. */
function LiveRunStrip({ capture, job, queuedNext }: { capture: NamCaptureRow; job: TrainerQueueJob; queuedNext: NamCaptureRow[] }): React.ReactElement {
  const epochCurrent = job.progressEpochCurrent
  const epochTotal = job.progressEpochTotal ?? job.epochs
  const pct = epochTotal ? Math.min(100, Math.round(((epochCurrent ?? 0) / epochTotal) * 100)) : 0
  const eta =
    job.progressRate && epochCurrent != null && epochTotal
      ? (() => {
          const remaining = epochTotal - epochCurrent
          const secs = remaining / job.progressRate!
          const mins = Math.round(secs / 60)
          return mins > 0 ? `${mins}m left` : '<1m left'
        })()
      : null
  return (
    <div className="px-4 py-3 border-b border-nm-border-s flex-shrink-0">
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="nm-live-dot w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
          <span className="text-[13px] font-semibold text-nm-text truncate">{capture.captureName}</span>
          <span className="text-[11px] font-medium text-amber-500 tabular-nums flex-shrink-0">
            {epochCurrent != null && epochTotal ? `epoch ${epochCurrent} / ${epochTotal}` : 'starting…'}
            {job.validationEsr != null ? ` · ESR ${job.validationEsr.toFixed(4)}` : ''}
            {eta ? ` · ${eta}` : ''}
          </span>
        </div>
        <div className="mt-2.5 h-1.5 rounded-full bg-field-bg overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#b1700a,#f59e0b)' }}
          />
        </div>
        {queuedNext.length > 0 && (
          <div className="mt-2 text-[10.5px] font-medium text-nm-text-2 tabular-nums truncate">
            queued next: {queuedNext.map((c) => c.captureName).join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

function CaptureCard({
  capture,
  queueJobs,
  checked,
  active,
  onToggleCheck,
  onOpenDetail,
  onMenu,
  onReveal,
  onOpenModel,
  onQueue,
  onFacet,
  isFacetActive
}: {
  capture: NamCaptureRow
  queueJobs: TrainerQueueJob[]
  checked: boolean
  active: boolean
  onToggleCheck: () => void
  onOpenDetail: () => void
  onMenu: (c: NamCaptureRow, x: number, y: number) => void
  onReveal: () => void
  onOpenModel: () => void
  onQueue: () => void
  onFacet: (key: FacetKey, value: string) => void
  isFacetActive: (key: FacetKey, value: string | null) => boolean
}): React.ReactElement {
  const status = deriveCaptureStatus(capture, queueJobs)
  const eff = capture.effective
  const gear = [eff.gearMake, eff.gearModel].filter(Boolean).join(' · ')
  const srl = srLabel(capture.sampleRate)
  const hasGraph = capture.graphExists && !!capture.result?.graphPath
  return (
    <div
      onClick={onOpenDetail}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(capture, e.clientX, e.clientY)
      }}
      className={`flex flex-col rounded-xl border cursor-pointer transition-colors select-none overflow-hidden ${
        active
          ? 'border-nm-accent ring-1 ring-nm-accent/40 bg-panel'
          : 'border-nm-border bg-panel hover:border-nm-text-3/50'
      }`}
    >
      {/* media strip — training graph for a trained capture, quiet placeholder otherwise.
          aspect-video + the body padding below match FolderCardView's card proportions. */}
      <div className="w-full aspect-video bg-field-bg flex items-center justify-center overflow-hidden relative">
        {hasGraph ? (
          <img
            src={fileSrc(capture.result!.graphPath as string)}
            alt="training graph"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-8 h-8 text-nm-text-3/40">
            <path d="M2 12h3l2-6 3 12 3-16 3 20 2-8 2 2h2" />
          </svg>
        )}
        <label
          className="absolute top-2 left-2 flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleCheck}
            className="w-3.5 h-3.5 rounded border-field-bd bg-panel/80"
          />
        </label>
        {capture.synthetic && (
          <span className="absolute top-2 right-2 nam-chip opacity-80 text-[10px]">
            <span className="nam-dot" />
            synthetic
          </span>
        )}
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div
            className="text-sm font-medium leading-tight text-nm-text line-clamp-2"
            title={capture.captureName}
          >
            {capture.captureName}
          </div>
          <CaptureStatusBadge status={status} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 gap-y-1 text-xs text-nm-text-3">
          {capture.captureScope && (
            <FacetChip
              label={capture.captureScope}
              active={isFacetActive('scope', capture.captureScope)}
              onClick={() => onFacet('scope', capture.captureScope as string)}
              colorClass="chip-nam-scope"
            />
          )}
          {srl && (
            <FacetChip
              label={srl}
              active={isFacetActive('sampleRate', srl)}
              onClick={() => onFacet('sampleRate', srl)}
              colorClass="chip-nam-rate"
            />
          )}
          {capture.recordingBitDepth && <span>{capture.recordingBitDepth}-bit</span>}
          {capture.measuredLatencySamples != null && <span>{capture.measuredLatencySamples} smp</span>}
        </div>

        {captureIsCalibrated(capture) && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400">
            cal {fmtDbu(eff.inputLevelDbu ?? capture.calibration?.inputLevelDbu) ?? '?'} /{' '}
            {fmtDbu(eff.outputLevelDbu ?? capture.calibration?.outputLevelDbu) ?? '?'} dBu
            {capture.calibration?.method ? ` · ${capture.calibration.method}` : ''}
          </div>
        )}

        {gear && <div className="text-xs text-nm-text-2 truncate">{gear}</div>}

        {(eff.gearType || eff.toneType || capture.metadataEdited) && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {eff.gearType && (
              <FacetChip
                label={eff.gearType}
                active={isFacetActive('gearType', eff.gearType)}
                onClick={() => onFacet('gearType', eff.gearType as string)}
                colorClass={namGearChipClass(eff.gearType)}
              />
            )}
            {eff.toneType && (
              <FacetChip
                label={eff.toneType}
                active={isFacetActive('toneType', eff.toneType)}
                onClick={() => onFacet('toneType', eff.toneType as string)}
                colorClass={namToneChipClass(eff.toneType)}
              />
            )}
            {capture.metadataEdited && (
              <span className="text-[10px] text-nm-accent" title="Model metadata edited in NAM Lab">
                ✎ edited
              </span>
            )}
          </div>
        )}

        {capture.trained && (
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-nm-text-3 mt-0.5">
            {capture.result?.architecture && <span>{capture.result.architecture}</span>}
            {capture.result?.validationEsr != null && (
              <span>ESR {capture.result.validationEsr.toFixed(4)}</span>
            )}
            {relTime(capture.result?.trainedAt) && <span>{relTime(capture.result?.trainedAt)}</span>}
          </div>
        )}

        {fmtDate(capture.createdAt) && (
          <div
            className="text-[11px] text-nm-text-3"
            title={fmtDateTime(capture.createdAt) ?? ''}
          >
            captured {fmtDate(capture.createdAt)}
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-nm-border-s px-3 py-2 flex items-center gap-3 text-xs">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onReveal()
          }}
          className="text-nm-text-2 hover:text-nm-text"
        >
          Reveal WAV
        </button>
        {!capture.trained && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onQueue()
            }}
            className="text-nm-accent hover:underline"
          >
            Queue
          </button>
        )}
        {capture.trained && capture.result?.outputModelPath && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenModel()
            }}
            className="text-nm-text-2 hover:text-nm-text"
          >
            Open .nam
          </button>
        )}
      </div>
    </div>
  )
}

function ProjectRailRow({
  project,
  selected,
  onSelect,
  onContextMenu
}: {
  project: NamProjectSummary
  selected: boolean
  onSelect: () => void
  onContextMenu: (p: NamProjectSummary, x: number, y: number) => void
}): React.ReactElement {
  const allTrained = project.captureCount > 0 && project.trainedCount === project.captureCount
  const created = fmtDate(project.createdAt)
  return (
    <button
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(project, e.clientX, e.clientY)
      }}
      className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs rounded ${
        selected ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov text-nm-text'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${allTrained ? 'bg-emerald-500' : 'bg-blue-500'}`}
        title={allTrained ? 'Every capture trained' : 'Has untrained captures'}
      />
      <span className="flex-1 min-w-0">
        <span className="block truncate">{project.name}</span>
        {created && (
          <span className={`block truncate text-[10px] ${selected ? 'text-nm-accent/70' : 'text-nm-text-3'}`}>
            created {created}
          </span>
        )}
      </span>
      <span className={`flex-shrink-0 ${selected ? 'text-nm-accent' : 'text-nm-text-3'}`}>
        {project.trainedCount}/{project.captureCount}
      </span>
    </button>
  )
}

type ProjectStateFilter = 'all' | 'inProgress' | 'complete'

/** Projects index (design_handoff_nam_projects Screen 1) — shown when no project is selected,
 * replacing the old silent auto-select-first-project behavior. List/Cards toggle, independent of
 * the per-project capture grid's own `captureView` toggle.
 *
 * Per-project "training/failed/missing" breakdowns aren't wired yet — the summary this reads
 * (`NamProjectSummary`) only carries `captureCount`/`trainedCount`/`syntheticCount` today. Once
 * the live trainer-queue status vocabulary lands, this component's rollup line is the natural
 * place to show it; until then it only distinguishes trained vs. untrained. */
function ProjectsIndex({
  projects,
  filter,
  onFilterChange,
  stateFilter,
  onStateFilterChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  onOpenProject,
  onStageAllUntrained,
  onTrainAllUntrained,
  busy
}: {
  projects: NamProjectSummary[]
  filter: string
  onFilterChange: (v: string) => void
  stateFilter: ProjectStateFilter
  onStateFilterChange: (v: ProjectStateFilter) => void
  sort: 'name' | 'newest' | 'leastTrained'
  onSortChange: (v: 'name' | 'newest' | 'leastTrained') => void
  view: 'list' | 'cards'
  onViewChange: (v: 'list' | 'cards') => void
  onOpenProject: (collectionId: string) => void
  onStageAllUntrained: () => void
  onTrainAllUntrained: () => void
  busy: boolean
}): React.ReactElement {
  const projectState = (p: NamProjectSummary): 'complete' | 'inProgress' =>
    p.captureCount > 0 && p.trainedCount === p.captureCount ? 'complete' : 'inProgress'

  const filtered = projects.filter((p) => {
    if (filter && !p.name.toLowerCase().includes(filter.toLowerCase())) return false
    if (stateFilter !== 'all' && projectState(p) !== stateFilter) return false
    return true
  })
  const visible = sortProjects(filtered, sort)

  const totalCaptures = projects.reduce((n, p) => n + p.captureCount, 0)
  const totalTrained = projects.reduce((n, p) => n + p.trainedCount, 0)
  const totalUntrained = totalCaptures - totalTrained

  const stateCounts = {
    all: projects.length,
    inProgress: projects.filter((p) => projectState(p) === 'inProgress').length,
    complete: projects.filter((p) => projectState(p) === 'complete').length
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Hero band */}
      <div className="flex items-start justify-between gap-4 px-5 pt-[18px] pb-4 border-b border-nm-border-s flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-nm-text">NAM Projects</h1>
          <p className="text-xs text-nm-text-2 mt-1.5">
            Wave projects handed over from IR Lab, waiting to be trained by the NAM trainer.
          </p>
        </div>
        <div className="flex items-start gap-6 flex-shrink-0">
          <StatTile label="Projects" value={projects.length} />
          <StatTile label="Captures" value={totalCaptures} />
          <StatTile label="Trained" value={totalTrained} tone="accent" />
          <StatTile label="Untrained" value={totalUntrained} tone="muted" />
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-nm-border-s flex-shrink-0">
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter projects…"
          className="flex-1 min-w-[120px] h-[27px] text-xs px-2 rounded border border-field-bd bg-field-bg"
        />
        {(
          [
            ['all', `All ${stateCounts.all}`],
            ['inProgress', `In progress ${stateCounts.inProgress}`],
            ['complete', `Complete ${stateCounts.complete}`]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onStateFilterChange(key)}
            className={`flex-shrink-0 h-6 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${
              stateFilter === key ? 'bg-nm-accent text-accent-fg' : 'border border-field-bd text-nm-text-2 hover:bg-hov'
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as typeof sort)}
          className="flex-shrink-0 h-[27px] text-xs px-1.5 rounded border border-field-bd bg-field-bg text-nm-text-2"
        >
          <option value="name">Sort: Name</option>
          <option value="newest">Sort: Newest</option>
          <option value="leastTrained">Sort: Least trained</option>
        </select>
        <div className="flex-shrink-0 flex rounded-lg overflow-hidden border border-field-bd bg-field-bg p-0.5">
          {(['list', 'cards'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`h-[22px] px-2.5 rounded-md text-[11px] font-semibold ${
                view === v ? 'bg-active-bg text-nm-accent' : 'text-nm-text-2 hover:bg-hov'
              }`}
            >
              {v === 'list' ? 'List' : 'Cards'}
            </button>
          ))}
        </div>
      </div>

      {/* Project grid/list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-xs text-nm-text-3">No projects match.</div>
        ) : view === 'list' ? (
          <div className="flex flex-col px-5 py-3 gap-1">
            {visible.map((p) => (
              <ProjectIndexListRow key={p.collectionId} project={p} onOpen={() => onOpenProject(p.collectionId)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 px-5 py-4">
            {visible.map((p) => (
              <ProjectIndexCard key={p.collectionId} project={p} onOpen={() => onOpenProject(p.collectionId)} />
            ))}
          </div>
        )}
      </div>

      {/* Footer action bar */}
      <div className="flex items-center gap-3 px-5 h-[46px] border-t border-nm-border flex-shrink-0">
        <span className="text-[11.5px] text-nm-text-2">
          {projects.length} project{projects.length === 1 ? '' : 's'} · {totalCaptures} capture{totalCaptures === 1 ? '' : 's'} ·{' '}
          {totalUntrained} untrained across all projects
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onStageAllUntrained}
            disabled={busy || totalUntrained === 0}
            className="h-7 px-3 rounded text-[11.5px] font-semibold border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
          >
            Stage all untrained
          </button>
          <button
            onClick={onTrainAllUntrained}
            disabled={busy || totalUntrained === 0}
            className="h-7 px-3 rounded text-[11.5px] font-medium bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            Train all untrained →
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectIndexListRow({ project, onOpen }: { project: NamProjectSummary; onOpen: () => void }): React.ReactElement {
  const pct = project.captureCount ? Math.round((project.trainedCount / project.captureCount) * 100) : 0
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-hov border border-transparent hover:border-nm-border-s"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-nm-text truncate">{project.name}</div>
        {(project.cabinet || project.speaker) && (
          <div className="text-[10.5px] text-nm-text-3 truncate mt-0.5">
            {[project.cabinet, project.speaker].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <div className="w-32 flex-shrink-0 flex items-center gap-2">
        <span className="flex-1 h-[5px] rounded-full bg-field-bg overflow-hidden">
          <span className="block h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-[10px] font-medium text-nm-text-2 tabular-nums flex-shrink-0">
          {project.trainedCount}/{project.captureCount}
        </span>
      </div>
      <span className="w-20 flex-shrink-0 text-right text-[10px] text-nm-text-3">{relTime(project.createdAt) ?? '—'}</span>
      <span className="w-10 flex-shrink-0 text-right text-[11px] font-semibold text-nm-accent">Open →</span>
    </button>
  )
}

function ProjectIndexCard({ project, onOpen }: { project: NamProjectSummary; onOpen: () => void }): React.ReactElement {
  const pct = project.captureCount ? Math.round((project.trainedCount / project.captureCount) * 100) : 0
  const created = fmtDate(project.createdAt)
  return (
    <button
      onClick={onOpen}
      className="w-[326px] flex-shrink-0 text-left rounded-xl border border-nm-border bg-panel hover:border-nm-accent/50 overflow-hidden"
    >
      <div className="h-[104px] border-b border-nm-border bg-field-bg flex items-center justify-center overflow-hidden">
        {project.coverImagePath ? (
          <ScaledImage src={fileSrc(project.coverImagePath)} width={326} height={104} fit="cover" className="w-full h-full" />
        ) : (
          <span
            className="w-full h-full flex items-center justify-center text-[10px] font-mono text-nm-text-3"
            style={{ background: 'repeating-linear-gradient(135deg, var(--panel) 0 8px, var(--panel-2) 8px 16px)' }}
          >
            no cover
          </span>
        )}
      </div>
      <div className="px-3.5 py-3">
        <div className="text-[13.5px] font-semibold text-nm-text truncate">{project.name}</div>
        {(project.cabinet || project.speaker) && (
          <div className="text-[10px] text-nm-text-3 truncate mt-1">
            {[project.cabinet, project.speaker].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="flex items-center gap-2.5 mt-[11px]">
          <span className="flex-1 h-[5px] rounded-full bg-field-bg overflow-hidden">
            <span className="block h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-[11.5px] font-semibold text-nm-text flex-shrink-0">
            {project.trainedCount} / {project.captureCount} trained
          </span>
        </div>
        <div className="flex items-center justify-between mt-3 pt-[11px] border-t border-nm-border-s">
          <span className="text-[10px] font-mono text-nm-text-3">
            {created ? `created ${created}` : ''}
          </span>
          <span className="text-[11px] font-semibold text-nm-accent">Open →</span>
        </div>
      </div>
    </button>
  )
}

function StatTile({
  label,
  value,
  tone
}: {
  label: string
  value: string | number
  tone?: 'accent' | 'muted'
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded border border-nm-border-s bg-panel-2 min-w-[96px]">
      <span className="text-[10px] uppercase tracking-wide text-nm-text-3">{label}</span>
      <span
        className={`text-lg font-semibold ${tone === 'accent' ? 'text-nm-accent' : tone === 'muted' ? 'text-nm-text-3' : 'text-nm-text'}`}
      >
        {value}
      </span>
    </div>
  )
}

function Breakdown({
  title,
  rows
}: {
  title: string
  rows: Array<{ key: string; count: number }>
}): React.ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-nm-text-2">{title}</span>
      {rows.length === 0 && <span className="text-[11px] text-nm-text-3">—</span>}
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-[11px]">
          <span className="w-24 truncate text-nm-text-2">{r.key}</span>
          <span className="flex-1 h-2 rounded bg-field-bg overflow-hidden">
            <span className="block h-full bg-nm-accent/70" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="w-8 text-right text-nm-text-3">{r.count}</span>
        </div>
      ))}
    </div>
  )
}

function buildReport(o: NamLibraryOverview): string {
  const pct = o.totalCaptures ? Math.round((o.trainedCaptures / o.totalCaptures) * 100) : 0
  const lines: string[] = []
  lines.push(`# NAM Capture training coverage`)
  lines.push(``)
  lines.push(`Generated ${new Date().toISOString()}`)
  lines.push(``)
  lines.push(`- Projects: ${o.totalProjects}`)
  lines.push(
    `- Captures: ${o.totalCaptures}  (${o.trainedCaptures} trained / ${o.untrainedCaptures} untrained — ${pct}%)`
  )
  lines.push(`- Synthetic captures: ${o.syntheticCaptures}`)
  if (o.avgTrainedEsr != null) lines.push(`- Mean validation ESR (trained): ${o.avgTrainedEsr.toFixed(5)}`)
  lines.push(``)
  lines.push(`## By capture scope`)
  for (const r of o.byScope) lines.push(`- ${r.key}: ${r.count}`)
  lines.push(``)
  lines.push(`## By sample rate`)
  for (const r of o.bySampleRate) lines.push(`- ${r.key}: ${r.count}`)
  lines.push(``)
  lines.push(`## By trained architecture`)
  for (const r of o.byArchitecture) lines.push(`- ${r.key}: ${r.count}`)
  lines.push(``)
  lines.push(`## Per project`)
  lines.push(`| Project | Captures | Trained | Synthetic | Mean ESR |`)
  lines.push(`| --- | --- | --- | --- | --- |`)
  for (const p of o.projects) {
    lines.push(
      `| ${p.name} | ${p.captureCount} | ${p.trainedCount} | ${p.syntheticCount} | ${p.avgTrainedEsr != null ? p.avgTrainedEsr.toFixed(5) : '—'} |`
    )
  }
  return lines.join('\n') + '\n'
}

function DetailField({ label, value }: { label: string; value: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-nm-text-3">{label}</span>
      <span className="text-xs text-nm-text">{value}</span>
    </div>
  )
}

function StatusChip({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] rounded-full border ${
        active
          ? 'bg-nm-accent text-accent-fg border-nm-accent'
          : 'border-field-bd text-nm-text-2 hover:bg-hov'
      }`}
    >
      {label}
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-nm-text-3">{label}</span>
      <span className="text-xs text-nm-text break-words">{children}</span>
    </div>
  )
}

// --- editable model-metadata (effective columns) -----------------------------

type MetaStringKey = 'modeledBy' | 'gearMake' | 'gearModel' | 'gearType' | 'toneType'

const META_FIELDS: Array<{
  k: MetaStringKey
  label: string
  opts?: readonly string[]
}> = [
  { k: 'modeledBy', label: 'Modeled by' },
  { k: 'gearMake', label: 'Gear make' },
  { k: 'gearModel', label: 'Gear model' },
  { k: 'gearType', label: 'Gear type', opts: GEAR_TYPES },
  { k: 'toneType', label: 'Tone type', opts: TONE_TYPES }
]

function MetadataEditor({
  capture,
  onSave
}: {
  capture: NamCaptureRow
  onSave: (patch: NamCaptureMetadataPatch) => Promise<void>
}): React.ReactElement {
  const eff = capture.effective
  const sug = capture.suggested
  const [draft, setDraft] = useState<NamCaptureMetadataPatch>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setDraft({})
    setErr(null)
  }, [capture.itemId])

  const dirty = Object.keys(draft).length > 0
  const valueOf = (k: (typeof META_FIELDS)[number]['k']): string =>
    (k in draft ? (draft[k] as string | null) : eff[k]) ?? ''
  // '' (not null) for a deliberate clear -- namCaptureEnrichment.ts's setNamCaptureMetadata
  // treats '' as a permanent, sticky blank (survives a rescan) and null as "never touched"
  // (refills from the IR Lab suggestion on the next rescan). A field the operator actually typed
  // into and cleared should stay blank, not quietly come back -- see that function's own header
  // comment for the full reasoning (audit doc A4#3).
  const set = (k: (typeof META_FIELDS)[number]['k'], v: string): void =>
    setDraft((d) => ({ ...d, [k]: v.trim() === '' ? '' : v }))

  return (
    <div className="flex flex-col gap-2">
      {META_FIELDS.map(({ k, label, opts }) => {
        const value = valueOf(k)
        const suggested = (sug ? sug[k] : null) as string | null
        const editedFromSuggestion = (value || null) !== (suggested || null)
        return (
          <label key={k} className="flex flex-col gap-0.5 text-[11px] text-nm-text-3">
            <span className="flex items-center gap-2">
              {label}
              {suggested != null && (
                <span className={editedFromSuggestion ? 'text-nm-accent' : 'text-nm-text-3'}>
                  {editedFromSuggestion ? 'edited' : 'from IR Lab'}
                </span>
              )}
              {editedFromSuggestion && suggested != null && (
                <button
                  type="button"
                  onClick={() => set(k, suggested)}
                  className="text-nm-accent hover:underline"
                >
                  reset
                </button>
              )}
            </span>
            {opts ? (
              <select
                value={value}
                onChange={(e) => set(k, e.target.value)}
                className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
              >
                <option value="">—</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={value}
                onChange={(e) => set(k, e.target.value)}
                className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
              />
            )}
          </label>
        )
      })}
      {err && <span className="text-[11px] text-red-500">{err}</span>}
      {dirty && (
        <div className="flex gap-2">
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              setErr(null)
              try {
                await onSave(draft)
                setDraft({})
              } catch (e) {
                setErr(String(e))
              } finally {
                setSaving(false)
              }
            }}
            className="px-2.5 py-1 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save metadata'}
          </button>
          <button
            disabled={saving}
            onClick={() => setDraft({})}
            className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

// --- trained .nam link (stat + auto-find + Locate) --------------------------

function ModelFileLink({
  capture,
  onReveal,
  onOpen,
  onPlay,
  onRelink,
  onFindCandidates
}: {
  capture: NamCaptureRow
  onReveal: (p: string) => void
  onOpen: (p: string) => void
  onPlay: (p: string) => void
  onRelink: (newPath: string) => Promise<void>
  onFindCandidates: (modelName: string) => Promise<string[]>
}): React.ReactElement {
  const result = capture.result
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setCandidates(null)
    setErr(null)
  }, [capture.itemId])

  if (!result?.outputModelPath)
    return <span className="text-[11px] text-nm-text-3">No model path recorded.</span>

  if (capture.modelFile != null) {
    return (
      <div className="flex flex-col gap-1 text-[11px]">
        <span className="text-nm-text-2 break-all">{result.outputModelPath}</span>
        <span className="text-nm-text-3">
          {formatBytes(capture.modelFile.bytes)} · {relTime(capture.modelFile.mtimeMs)}
        </span>
        <div className="flex gap-3">
          <button onClick={() => onPlay(result.outputModelPath)} className="text-nm-accent hover:underline font-medium">
            Play
          </button>
          <button onClick={() => onOpen(result.outputModelPath)} className="text-nm-accent hover:underline">
            Open
          </button>
          <button onClick={() => onReveal(result.outputModelPath)} className="text-nm-accent hover:underline">
            Reveal in folder
          </button>
        </div>
      </div>
    )
  }

  const locate = async (): Promise<void> => {
    const picked = await window.api.openFiles()
    if (picked && picked[0]) {
      try {
        await onRelink(picked[0])
      } catch (e) {
        setErr(String(e))
      }
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <span className="text-amber-600 dark:text-amber-400">
        Model file moved or renamed — {result.outputModelPath}
      </span>
      {err && <span className="text-red-500">{err}</span>}
      {candidates == null ? (
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                const hits = await onFindCandidates(result.modelName || '')
                setCandidates(hits)
                if (hits.length === 1) await onRelink(hits[0])
              } catch (e) {
                setErr(String(e))
              } finally {
                setBusy(false)
              }
            }}
            className="text-nm-accent hover:underline disabled:opacity-50"
          >
            {busy ? 'Searching…' : 'Auto-find'}
          </button>
          <button onClick={locate} className="text-nm-accent hover:underline">
            Locate…
          </button>
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-nm-text-3">No match found under the training output root.</span>
          <button onClick={locate} className="text-nm-accent hover:underline self-start">
            Locate…
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {candidates.map((c) => (
            <button
              key={c}
              onClick={() => void onRelink(c)}
              className="text-left text-nm-accent hover:underline break-all"
            >
              Relink → {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- per-capture right panel ------------------------------------------------

function CaptureDetailPanel({
  capture,
  projectId,
  outputRoot,
  architecture,
  epochs,
  onBack,
  onReveal,
  onOpen,
  onPlay,
  onQueue,
  onEditMetadata,
  onRelink,
  onFindCandidates
}: {
  capture: NamCaptureRow
  projectId: string
  outputRoot: string
  architecture: string
  epochs: number
  onBack: () => void
  onReveal: (p: string) => void
  onOpen: (p: string) => void
  onPlay: (p: string) => void
  onQueue: (mode: 'stage' | 'runNext') => void
  onEditMetadata: (patch: NamCaptureMetadataPatch) => Promise<void>
  onRelink: (newPath: string) => Promise<void>
  onFindCandidates: (modelName: string) => Promise<string[]>
}): React.ReactElement {
  const c = capture
  const cal = c.calibration
  const r = c.result
  const exc = c.excitationPath

  // Local rather than threaded from the shell — this panel is the only place either handoff
  // button lives, so there's no other consumer to plumb a shared prop for.
  const [connectorAvailable, setConnectorAvailable] = useState(false)
  const [irLabStatus, setIrLabStatus] = useState<IrLabStatus | null>(null)
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null)
  useEffect(() => {
    window.api.irLabConnectorAvailable().then(setConnectorAvailable)
    window.api.irLibraryGetIrLabStatus().then(setIrLabStatus)
  }, [])
  useEffect(() => {
    setHandoffStatus(null)
  }, [capture.itemId])

  const openSessionInIrLab = useCallback(async () => {
    if (!c.captureId) return
    const result = await window.api.irLibrarySendSessionToIrLab(c.captureId)
    setHandoffStatus(result.success ? 'Opened in IR Lab.' : result.reason ?? 'Failed to open in IR Lab.')
  }, [c.captureId])

  const openProjectInIrLab = useCallback(async () => {
    const result = await window.api.irLibrarySendProjectToIrLab(projectId)
    setHandoffStatus(result.success ? 'Opened in IR Lab.' : result.reason ?? 'Failed to open in IR Lab.')
  }, [projectId])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-nm-text-2 truncate">{c.captureName}</span>
        <button onClick={onBack} className="text-[11px] text-nm-accent hover:underline flex-shrink-0">
          ← Project
        </button>
      </div>

      <section className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold text-nm-text-2">Files</span>
        <Row label="Recording">
          {c.recordingPath ? (
            <span className="flex flex-col gap-0.5">
              <span className="break-all">{c.recordingPath.replace(/^.*[\\/]/, '')}</span>
              <span className="text-[11px] text-nm-text-3">
                {[
                  audioLabel(c),
                  durationLabel(c.recordingDurationSec),
                  formatBytes(c.recordingFile?.bytes)
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <button
                onClick={() => onReveal(c.recordingPath as string)}
                className="text-[11px] text-nm-accent hover:underline self-start"
              >
                Reveal
              </button>
              <WavPreviewPlayer path={c.recordingPath} label="Return (recorded through the amp)" />
            </span>
          ) : (
            '—'
          )}
        </Row>
        <Row label="Excitation">
          {exc ? (
            <span className="flex flex-col gap-0.5">
              <span className="break-all">{exc.replace(/^.*[\\/]/, '')}</span>
              {c.excitationSourceName && (
                <span className="text-[11px] text-nm-text-3">source {c.excitationSourceName}</span>
              )}
              {c.stimulusSha256 && (
                <span className="text-[11px] text-nm-text-3">sha256 {c.stimulusSha256.slice(0, 12)}…</span>
              )}
              <button
                onClick={() => onReveal(exc)}
                className="text-[11px] text-nm-accent hover:underline self-start"
              >
                Reveal
              </button>
              <WavPreviewPlayer path={exc} label="DI (excitation sweep)" />
            </span>
          ) : (
            '—'
          )}
        </Row>
      </section>

      <section className="flex flex-col gap-2 border-t border-nm-border-s pt-3">
        <span className="text-[11px] font-semibold text-nm-text-2">Timing</span>
        {c.measuredLatencySamples != null && (
          <Row label="Measured latency">{c.measuredLatencySamples} samples</Row>
        )}
        {fmtDateTime(c.createdAt) && <Row label="Captured">{fmtDateTime(c.createdAt)}</Row>}
      </section>

      {cal && (captureIsCalibrated(c) || cal.method) && (
        <section className="flex flex-col gap-2 border-t border-nm-border-s pt-3">
          <span className="text-[11px] font-semibold text-nm-text-2">Calibration</span>
          {cal.method && <Row label="Method">{cal.method}</Row>}
          {cal.confidence && <Row label="Confidence">{cal.confidence}</Row>}
          {cal.profileName && <Row label="Profile">{cal.profileName}</Row>}
          {fmtDateTime(cal.calibratedAt) && <Row label="Calibrated">{fmtDateTime(cal.calibratedAt)}</Row>}
          <Row label="Levels">
            input {fmtDbu(cal.inputLevelDbu) ?? '?'} dBu · output {fmtDbu(cal.outputLevelDbu) ?? '?'} dBu
          </Row>
          <span className="text-[11px] text-nm-text-3">
            Embedded into the trained model as input_level_dbu / output_level_dbu.
          </span>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-nm-border-s pt-3">
        <span className="text-[11px] font-semibold text-nm-text-2">Model metadata</span>
        <span className="text-[11px] text-nm-text-3">
          Seeds the trained <code>.nam</code>. Defaults to IR Lab&apos;s suggestion; edits here are
          what the model gets. Nothing is written back to nam-capture.json.
        </span>
        <MetadataEditor capture={c} onSave={onEditMetadata} />
      </section>

      <section className="flex flex-col gap-2 border-t border-nm-border-s pt-3">
        <span className="text-[11px] font-semibold text-nm-text-2">Training</span>
        {c.trained && r ? (
          <>
            <Row label="Model">{r.modelName || '—'}</Row>
            <Row label="Architecture">{r.architecture || '—'}</Row>
            {r.validationEsr != null && <Row label="Validation ESR">{r.validationEsr.toFixed(5)}</Row>}
            {(r.validationEsrFull != null || r.validationEsrLite != null) && (
              <Row label="Sub-model ESR">
                {[
                  r.validationEsrFull != null ? `Full ${r.validationEsrFull.toFixed(5)}` : null,
                  r.validationEsrLite != null ? `Lite ${r.validationEsrLite.toFixed(5)}` : null
                ]
                  .filter(Boolean)
                  .join('  ')}
              </Row>
            )}
            {fmtDateTime(r.trainedAt) && (
              <Row label="Trained">
                {fmtDateTime(r.trainedAt)} ({relTime(r.trainedAt)})
              </Row>
            )}
            {r.trainerJobId && <Row label="Trainer job">{r.trainerJobId}</Row>}
            <Row label="Model file">
              <ModelFileLink
                capture={c}
                onReveal={onReveal}
                onOpen={onOpen}
                onPlay={onPlay}
                onRelink={onRelink}
                onFindCandidates={onFindCandidates}
              />
            </Row>
            {c.graphExists && r.graphPath && (
              <img
                src={fileSrc(r.graphPath)}
                alt="training graph"
                className="w-full rounded border border-nm-border-s bg-field-bg"
                loading="lazy"
              />
            )}
          </>
        ) : (
          <>
            <span className="text-[11px] text-nm-text-3">
              Not trained yet. Uses architecture <strong>{ARCH_LABEL[architecture] ?? architecture}</strong>,{' '}
              {epochs} epochs, output {outputRoot || '(choose a folder in the project view)'}.
            </span>
            <div className="flex gap-2">
              <button
                disabled={!outputRoot}
                onClick={() => onQueue('stage')}
                className="px-2.5 py-1 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                Queue this capture
              </button>
              <button
                disabled={!outputRoot}
                onClick={() => onQueue('runNext')}
                className="px-2.5 py-1 text-xs rounded border border-nm-accent/50 text-nm-accent hover:bg-nm-accent/10 disabled:opacity-50"
              >
                Run next
              </button>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-nm-border-s pt-3">
        <span className="text-[11px] font-semibold text-nm-text-2">Provenance</span>
        <Row label="App">IR Lab</Row>
        {c.captureId && <Row label="Capture id">{c.captureId}</Row>}
        {projectId && <Row label="Project id">{projectId}</Row>}
        {c.syntheticSourceIrName && <Row label="Synthetic source">{c.syntheticSourceIrName}</Row>}
        <div className="flex flex-wrap gap-2 pt-1">
          {c.captureId && (
            <button
              onClick={() => void openSessionInIrLab()}
              disabled={!connectorAvailable}
              title={describeIrLabAvailability(connectorAvailable, irLabStatus, 'Reopen this capture').tooltip}
              className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
            >
              Open capture in IR Lab
            </button>
          )}
          {projectId && (
            <button
              onClick={() => void openProjectInIrLab()}
              disabled={!connectorAvailable}
              title={describeIrLabAvailability(connectorAvailable, irLabStatus, 'Open this project, ready to capture another position').tooltip}
              className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
            >
              Open project in IR Lab
            </button>
          )}
        </div>
        {handoffStatus && <span className="text-[11px] text-nm-text-3">{handoffStatus}</span>}
      </section>
    </div>
  )
}

/** A capture is batch-eligible if it isn't trained yet and both WAV paths resolved. Synthetic
 * captures only count when includeSynthetic is on. */
export function isQueueEligible(c: NamCaptureRow, includeSynthetic: boolean): boolean {
  return !c.trained && (includeSynthetic || !c.synthetic) && !!c.excitationPath && !!c.recordingPath
}

/** One capture -> the IPC batch-item shape. Carries the **effective** calibration dBu +
 * model-metadata (falling back to IR Lab's suggestion) — that's what seeds the trained .nam. */
export function toBatchItem(
  c: NamCaptureRow,
  projectName: string
): {
  excitationPath: string
  recordingPath: string
  captureId: string
  captureName: string
  captureFolderPath: string
  projectName: string
  synthetic: boolean
  inputLevelDbu: number | null
  outputLevelDbu: number | null
  suggested: {
    modeledBy: string | null
    gearMake: string | null
    gearModel: string | null
    gearType: string | null
    toneType: string | null
  } | null
} {
  const eff = c.effective
  const pick = (a: string | null, b: string | null | undefined): string | null => a ?? b ?? null
  const meta = {
    modeledBy: pick(eff.modeledBy, c.suggested?.modeledBy),
    gearMake: pick(eff.gearMake, c.suggested?.gearMake),
    gearModel: pick(eff.gearModel, c.suggested?.gearModel),
    gearType: pick(eff.gearType, c.suggested?.gearType),
    toneType: pick(eff.toneType, c.suggested?.toneType)
  }
  const anyMeta = Object.values(meta).some((v) => v != null)
  return {
    excitationPath: c.excitationPath as string,
    recordingPath: c.recordingPath as string,
    captureId: c.captureId ?? c.itemId,
    captureName: c.captureName,
    captureFolderPath: c.captureFolderPath as string,
    projectName,
    synthetic: c.synthetic,
    inputLevelDbu: eff.inputLevelDbu ?? c.calibration?.inputLevelDbu ?? null,
    outputLevelDbu: eff.outputLevelDbu ?? c.calibration?.outputLevelDbu ?? null,
    suggested: anyMeta ? meta : null
  }
}

export function NamProjectsShell({ leftRail }: { leftRail?: React.ReactNode } = {}): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false)
  const [playerFile, setPlayerFile] = useState<NamFile | null>(null)
  const [showProjectDefaults, setShowProjectDefaults] = useState(false)
  const [showBuildPack, setShowBuildPack] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const openModelInPlayer = useCallback(async (path: string) => {
    setPlayerError(null)
    const loaded = await loadNamFileForPlayback(path)
    if (!loaded) {
      setPlayerError(`Could not read the model: ${path}`)
      return
    }
    setPlayerFile(loaded)
  }, [])
  // Read straight from preload, same as IrModeShell's own player wiring — settings.json is loaded
  // synchronously in preload and exposed as window.api.initialSettings, so this doesn't need the
  // two React trees (this shell vs App.tsx's) to share state to get the FX library paths/presets
  // PlayerPanel wants. Named settingsRaw, not settings — that name is already the AppSettings
  // state SettingsPanel above uses.
  const settingsRaw = (window.api.initialSettings ?? {}) as Record<string, unknown>
  const str = (key: string): string | null => (typeof settingsRaw[key] === 'string' ? (settingsRaw[key] as string) || null : null)
  const arr = <T,>(key: string): T[] => (Array.isArray(settingsRaw[key]) ? (settingsRaw[key] as T[]) : [])
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [projects, setProjects] = useState<NamProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => readStored(SELECTED_KEY) || null)
  const [detail, setDetail] = useState<NamProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trainFailure, setTrainFailure] = useState<string | null>(null)
  // Live trainer-queue snapshot (design_handoff_nam_projects) — this shell previously only learned
  // about a capture's training state after the fact, via onTrainerHistory on job completion.
  const [queueJobs, setQueueJobs] = useState<TrainerQueueJob[]>([])
  const [captureMenu, setCaptureMenu] = useState<{ capture: NamCaptureRow; x: number; y: number } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ project: NamProjectSummary; x: number; y: number } | null>(null)

  const [view, setView] = useState<'projects' | 'overview'>(() =>
    readStored(VIEW_KEY) === 'overview' ? 'overview' : 'projects'
  )
  const [captureView, setCaptureView] = useState<'list' | 'cards'>(() =>
    readStored(CAPTURE_VIEW_KEY) === 'cards' ? 'cards' : 'list'
  )
  const [captureCardSize, setCaptureCardSize] = useState<'small' | 'medium' | 'large'>(() => {
    const saved = readStored(CAPTURE_CARD_SIZE_KEY)
    return saved === 'small' || saved === 'medium' || saved === 'large' ? saved : 'medium'
  })
  const captureCardPx = captureCardSize === 'small' ? 180 : captureCardSize === 'large' ? 336 : 264
  const [sortKey, setSortKey] = useState<string>(() => {
    const k = readStored(SORT_LS_KEY).split(':')[0]
    // Column keys are fixed regardless of queue state — an empty array is fine just to validate
    // the persisted key against the known set, before captureColumns (below) is memoized.
    return buildCaptureColumns([]).some((c) => c.key === k) ? k : 'name'
  })
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    readStored(SORT_LS_KEY).split(':')[1] === 'desc' ? 'desc' : 'asc'
  )
  const [overview, setOverview] = useState<NamLibraryOverview | null>(null)
  const [reportCopied, setReportCopied] = useState(false)
  const [projectFilter, setProjectFilter] = useState('')
  // Projects index (design_handoff_nam_projects Screen 1) — shown when selectedId is null.
  const [indexView, setIndexView] = useState<'list' | 'cards'>(() =>
    readStored(INDEX_VIEW_KEY) === 'cards' ? 'cards' : 'list'
  )
  const [projectStateFilter, setProjectStateFilter] = useState<'all' | 'inProgress' | 'complete' | 'needsFixing'>('all')
  // Rail sort (design doc S9a, marked optional and never built): Name / Newest / Least trained.
  // "Least trained" = fewest of a project's captures already trained -- surfaces "what still
  // needs work" first, which is the point of the option per the design doc's own framing.
  const [projectSort, setProjectSort] = useState<'name' | 'newest' | 'leastTrained'>(() => {
    const saved = readStored(PROJECT_SORT_KEY)
    return saved === 'newest' || saved === 'leastTrained' ? saved : 'name'
  })
  const [captureFilter, setCaptureFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  // Orthogonal to statusFilter, per the design's own framing — a capture can be synthetic AND
  // any lifecycle status, so it's a separate toggle rather than one of the mutually-exclusive
  // status pills (which is what it used to be, folded in alongside 'trained'/'untrained').
  const [syntheticOnly, setSyntheticOnly] = useState(false)
  const [facets, setFacets] = useState<FacetState>(EMPTY_FACETS)
  const [selectedCaptureIds, setSelectedCaptureIds] = useState<Set<string>>(new Set())
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null)

  const [railWidth, setRailWidth] = useState(240)
  const dragging = useRef(false)
  // Which nam-capture-import history entries we've already reacted to — so a finished training
  // run refreshes the trained badges without a manual rescan, but only once per job.
  const seenFinishedJobs = useRef<Set<string>>(new Set())

  const [architecture, setArchitecture] = useState<string>(() => {
    try {
      return localStorage.getItem(ARCH_KEY) || 'standard'
    } catch {
      return 'standard'
    }
  })
  const [epochs, setEpochs] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(EPOCHS_KEY)) || 1000
    } catch {
      return 1000
    }
  })
  const [outputRoot, setOutputRoot] = useState<string>(() => {
    try {
      return localStorage.getItem(OUTPUT_ROOT_KEY) || ''
    } catch {
      return ''
    }
  })
  const [includeSynthetic, setIncludeSynthetic] = useState(false)
  const [queueing, setQueueing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(ARCH_KEY, architecture)
    } catch {
      /* non-fatal */
    }
  }, [architecture])
  useEffect(() => {
    try {
      localStorage.setItem(EPOCHS_KEY, String(epochs))
    } catch {
      /* non-fatal */
    }
  }, [epochs])
  useEffect(() => {
    try {
      if (outputRoot) localStorage.setItem(OUTPUT_ROOT_KEY, outputRoot)
    } catch {
      /* non-fatal */
    }
  }, [outputRoot])

  const refreshProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.irLibraryListNamProjects()
      setProjects(list)
      // Projects index (design_handoff_nam_projects) — a stored selection restores if it's still
      // there, but a missing one now lands on the index rather than silently picking the first
      // project. `selectedId === null` IS a real, intentional state, not "not loaded yet."
      setSelectedId((prev) => (prev && list.some((p) => p.collectionId === prev) ? prev : null))
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  // IR Lab's "Manage in NAM Lab..." button lands here via appNav's pending-nav slot (AppRoot
  // already flipped mode to 'nam-projects' before this shell mounted). One-shot by construction.
  useEffect(() => {
    const projectId = consumePendingNamProjectNav()
    if (projectId) {
      setSelectedId(projectId)
      setView('overview')
    }
  }, [])

  useEffect(() => {
    if (selectedId) writeStored(SELECTED_KEY, selectedId)
  }, [selectedId])
  useEffect(() => {
    writeStored(VIEW_KEY, view)
  }, [view])
  useEffect(() => {
    writeStored(CAPTURE_VIEW_KEY, captureView)
  }, [captureView])
  useEffect(() => {
    writeStored(CAPTURE_CARD_SIZE_KEY, captureCardSize)
  }, [captureCardSize])
  useEffect(() => {
    writeStored(PROJECT_SORT_KEY, projectSort)
  }, [projectSort])
  useEffect(() => {
    writeStored(INDEX_VIEW_KEY, indexView)
  }, [indexView])

  const refreshDetail = useCallback(async (collectionId: string) => {
    try {
      setDetail(await window.api.irLibraryGetNamProjectDetail(collectionId))
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await window.api.irLibraryGetNamLibraryOverview())
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    if (view === 'overview') void refreshOverview()
  }, [view, refreshOverview, projects])

  useEffect(() => {
    setSelectedCaptureIds(new Set())
    setSelectedCaptureId(null)
    setFacets(EMPTY_FACETS)
    if (selectedId) void refreshDetail(selectedId)
    else setDetail(null)
  }, [selectedId, refreshDetail])

  // NAM-capture training runs land here (trainer:update's own payload carries an empty history
  // array — history is its own channel). On success: refetch, so the trained badges flip
  // without a rescan (getNamProjectDetail re-reads nam-lab-result.json every call). On failure:
  // surface it — otherwise a queued NAM batch can fail silently while you're in this view.
  useEffect(() => {
    const off = window.api.onTrainerHistory((history: TrainerHistoryEntry[]) => {
      const mine = history.filter(
        (h) => h.sourceMode === 'nam-capture-import' && !seenFinishedJobs.current.has(h.historyId)
      )
      if (mine.length === 0) return
      for (const h of mine) seenFinishedJobs.current.add(h.historyId)
      const succeeded = mine.filter((h) => h.status === 'success')
      const failed = mine.filter((h) => h.status === 'error')
      if (succeeded.length > 0) {
        void refreshProjects()
        if (selectedId) void refreshDetail(selectedId)
      }
      if (failed.length > 0) {
        const first = failed[0]
        const name = first.finalModelName || first.sourcePath.replace(/^.*[\\/]/, '')
        setTrainFailure(
          failed.length === 1
            ? `Training failed for "${name}": ${first.failureReason || 'see the Trainer tab'}`
            : `${failed.length} NAM captures failed to train — first: "${name}" (${first.failureReason || 'see the Trainer tab'})`
        )
      }
    })
    return off
  }, [selectedId, refreshProjects, refreshDetail])

  // Live queue state (design_handoff_nam_projects) — seeded once via getTrainerState(), then kept
  // current via onTrainerUpdate, same events TrainingPanel.tsx already subscribes to for its own
  // live-run view. deriveCaptureStatus (above) is the only consumer of this.
  useEffect(() => {
    let disposed = false
    void window.api.getTrainerState().then((state) => {
      if (!disposed) setQueueJobs(state.queue)
    })
    const off = window.api.onTrainerUpdate((state) => {
      if (!disposed) setQueueJobs(state.queue)
    })
    return () => {
      disposed = true
      off()
    }
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      setRailWidth(Math.min(420, Math.max(180, e.clientX)))
    }
    const up = (): void => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const rescanAll = useCallback(async () => {
    setError(null)
    setMessage(null)
    setScanning(true)
    try {
      const roots = await window.api.irLibraryListRoots()
      for (const root of roots) await window.api.irLibraryScan(root.path, root.label)
      await refreshProjects()
      if (selectedId) await refreshDetail(selectedId)
    } catch (err) {
      setError(String(err))
    } finally {
      setScanning(false)
    }
  }, [refreshProjects, refreshDetail, selectedId])

  const handleAddFolder = useCallback(async () => {
    const folder = await window.api.openFolder()
    if (!folder) return
    setError(null)
    setMessage(null)
    setScanning(true)
    try {
      await window.api.irLibraryScan(folder, null)
      await refreshProjects()
      if (selectedId) await refreshDetail(selectedId)
    } catch (err) {
      setError(String(err))
    } finally {
      setScanning(false)
    }
  }, [refreshProjects, refreshDetail, selectedId])

  const handleChooseOutput = useCallback(async () => {
    const folder = await window.api.openFolder()
    if (folder) setOutputRoot(folder)
  }, [])

  // --- filtering ---
  const visibleProjects = useMemo(() => {
    const q = projectFilter.trim().toLowerCase()
    const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
    return sortProjects(filtered, projectSort)
  }, [projects, projectFilter, projectSort])

  const facetOptions = useMemo(() => availableFacets(detail?.captures ?? []), [detail])

  const visibleCaptures = useMemo(() => {
    if (!detail) return []
    const q = captureFilter.trim().toLowerCase()
    return detail.captures.filter((c) => {
      if (q) {
        const hay = [
          c.captureName,
          c.effective.gearMake,
          c.effective.gearModel,
          c.effective.modeledBy,
          c.suggested?.gearMake,
          c.suggested?.gearModel,
          c.suggested?.modeledBy
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (statusFilter !== 'all' && deriveCaptureStatus(c, queueJobs) !== statusFilter) return false
      if (syntheticOnly && !c.synthetic) return false
      if (!matchesFacets(c, facets)) return false
      return true
    })
  }, [detail, captureFilter, statusFilter, syntheticOnly, queueJobs, facets])

  const captureColumns = useMemo(() => buildCaptureColumns(queueJobs), [queueJobs])

  // Live-run strip data — the first capture of THIS project currently training, plus whichever of
  // its own other captures are queued/staged behind it (queueJobs' own array order is the queue
  // order, same assumption TrainingPanel.tsx's live-run view already makes).
  const liveRun = useMemo(() => {
    if (!detail) return null
    for (const c of detail.captures) {
      const key = c.captureId ?? c.itemId
      const job = queueJobs.find((j) => j.namCaptureId === key && (j.status === 'running' || j.status === 'starting'))
      if (job) {
        const queuedNext = detail.captures.filter((other) => {
          const otherKey = other.captureId ?? other.itemId
          const otherJob = queueJobs.find((j) => j.namCaptureId === otherKey)
          return otherJob && (otherJob.status === 'queued' || otherJob.status === 'staged')
        })
        return { capture: c, job, queuedNext }
      }
    }
    return null
  }, [detail, queueJobs])

  // Only the card view sorts through this — the list view is a DataGrid, which sorts itself
  // (controlled by the same sortKey/sortDir so both views agree).
  const sortedCaptures = useMemo(
    () => sortRows(visibleCaptures, captureColumns, sortKey, sortDir),
    [visibleCaptures, captureColumns, sortKey, sortDir]
  )

  useEffect(() => {
    writeStored(SORT_LS_KEY, `${sortKey}:${sortDir}`)
  }, [sortKey, sortDir])

  // A header/chip click on the active key flips direction; a new key picks a sensible default
  // direction (newest date / trained-first, otherwise A→Z / smallest-first).
  const setSort = useCallback((k: string) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(k === 'created' || k === 'trained' ? 'desc' : 'asc')
      return k
    })
  }, [])

  const filtersActive =
    captureFilter.trim() !== '' ||
    statusFilter !== 'all' ||
    syntheticOnly ||
    Object.values(facets).some((a) => a.length > 0)

  const toggleFacet = useCallback((key: FacetKey, value: string) => {
    setFacets((f) => {
      const cur = f[key]
      return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
  }, [])
  const isFacetActive = useCallback(
    (key: FacetKey, value: string | null) => !!value && facets[key].includes(value),
    [facets]
  )
  const clearFilters = useCallback(() => {
    setFacets(EMPTY_FACETS)
    setCaptureFilter('')
    setStatusFilter('all')
    setSyntheticOnly(false)
  }, [])

  const toggleCapture = useCallback((itemId: string) => {
    setSelectedCaptureIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const selectAllVisible = useCallback(() => {
    setSelectedCaptureIds((prev) => {
      const next = new Set(prev)
      const allSelected = visibleCaptures.every((c) => next.has(c.itemId))
      for (const c of visibleCaptures) {
        if (allSelected) next.delete(c.itemId)
        else next.add(c.itemId)
      }
      return next
    })
  }, [visibleCaptures])

  const selectedCaptures = useMemo(
    () => (detail ? detail.captures.filter((c) => selectedCaptureIds.has(c.itemId)) : []),
    [detail, selectedCaptureIds]
  )

  const selectedCapture = useMemo(
    () =>
      detail && selectedCaptureId
        ? detail.captures.find((c) => c.itemId === selectedCaptureId) ?? null
        : null,
    [detail, selectedCaptureId]
  )

  // --- batch creation ---
  const submitBatch = useCallback(
    async (captures: NamCaptureRow[], labelSuffix: string, mode: 'stage' | 'runNext') => {
      if (!detail || captures.length === 0) return
      if (!outputRoot) {
        setError('Choose a model output folder first (right panel).')
        return
      }
      const eligible = captures.filter((c) => isQueueEligible(c, true)) // include-synthetic gate handled per call site
      if (eligible.length === 0) {
        setError('Those captures are all trained already, or missing their WAV files.')
        return
      }
      setQueueing(true)
      setError(null)
      setMessage(null)
      try {
        const res = await window.api.enqueueNamCaptureImport({
          captures: eligible.map((c) => toBatchItem(c, detail.name)),
          finalModelRoot: outputRoot,
          architecture,
          epochs,
          includeSynthetic: true, // eligible list already reflects the caller's intent
          staged: mode === 'stage',
          priority: mode === 'runNext' ? 'next' : 'normal',
          submissionLabel: `${detail.name} — ${labelSuffix}`
        })
        if (res.success) {
          if (mode === 'stage') {
            setMessage(
              `Staged ${res.built ?? eligible.length} job${(res.built ?? 1) === 1 ? '' : 's'} — opening the Batches page…`
            )
            goToTrainingBatches()
          } else {
            setMessage(
              `Queued ${res.built ?? eligible.length} job${(res.built ?? 1) === 1 ? '' : 's'} to run next` +
                (res.ranNext ? ' (jumped ahead of the current queue)' : '') +
                ' — opening the Queue…'
            )
            goToTrainingQueue()
          }
        } else {
          setError(res.error ?? 'Could not queue the batch.')
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setQueueing(false)
      }
    },
    [detail, outputRoot, architecture, epochs]
  )
  const stageBatch = useCallback(
    (captures: NamCaptureRow[], labelSuffix: string) => submitBatch(captures, labelSuffix, 'stage'),
    [submitBatch]
  )

  // Projects index footer ("Stage all untrained" / "Train all untrained") — cross-project, unlike
  // submitBatch above (which is scoped to the single currently-loaded `detail`). Fetches every
  // project with at least one untrained capture, pools the eligible ones, and submits them as one
  // batch under a generic label rather than per-project labels.
  const stageOrTrainAllUntrained = useCallback(
    async (mode: 'stage' | 'runNext') => {
      if (!outputRoot) {
        setError('Choose a model output folder first (right panel).')
        return
      }
      const candidates = projects.filter((p) => p.trainedCount < p.captureCount)
      if (candidates.length === 0) return
      setQueueing(true)
      setError(null)
      setMessage(null)
      try {
        const details = await Promise.all(candidates.map((p) => window.api.irLibraryGetNamProjectDetail(p.collectionId)))
        const items = details.flatMap((d) =>
          d ? d.captures.filter((c) => isQueueEligible(c, true)).map((c) => toBatchItem(c, d.name)) : []
        )
        if (items.length === 0) {
          setError('Those captures are all trained already, or missing their WAV files.')
          return
        }
        const res = await window.api.enqueueNamCaptureImport({
          captures: items,
          finalModelRoot: outputRoot,
          architecture,
          epochs,
          includeSynthetic: true,
          staged: mode === 'stage',
          priority: mode === 'runNext' ? 'next' : 'normal',
          submissionLabel: `All untrained — ${mode === 'stage' ? 'Stage' : 'Run next'}`
        })
        if (res.success) {
          if (mode === 'stage') {
            setMessage(`Staged ${res.built ?? items.length} job${(res.built ?? 1) === 1 ? '' : 's'} — opening the Batches page…`)
            goToTrainingBatches()
          } else {
            setMessage(
              `Queued ${res.built ?? items.length} job${(res.built ?? 1) === 1 ? '' : 's'} to run next` +
                (res.ranNext ? ' (jumped ahead of the current queue)' : '') +
                ' — opening the Queue…'
            )
            goToTrainingQueue()
          }
        } else {
          setError(res.error ?? 'Could not queue the batch.')
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setQueueing(false)
      }
    },
    [projects, outputRoot, architecture, epochs]
  )

  const projectEligible = useMemo(
    () => (detail ? detail.captures.filter((c) => isQueueEligible(c, includeSynthetic)) : []),
    [detail, includeSynthetic]
  )

  const revealCapture = useCallback((capture: NamCaptureRow) => {
    setCaptureMenu(null)
    // Prefer the recording WAV itself — Explorer/Finder highlights the file; the whole capture
    // set (WAV, sidecar, result) sits right next to it in the flat "NAM Captures" folder.
    const target = capture.recordingPath ?? capture.captureFolderPath
    if (target) window.api.revealFile(target)
  }, [])

  // --- editable metadata + trained-.nam relink ---
  const applyUpdatedCapture = useCallback((row: NamCaptureRow | null) => {
    if (!row) return
    setDetail((d) =>
      d ? { ...d, captures: d.captures.map((c) => (c.itemId === row.itemId ? row : c)) } : d
    )
  }, [])

  const handleEditMetadata = useCallback(
    async (itemId: string, patch: NamCaptureMetadataPatch) => {
      const row = await window.api.irLibrarySetNamCaptureMetadata(itemId, patch)
      applyUpdatedCapture(row)
    },
    [applyUpdatedCapture]
  )
  const handleRelinkModel = useCallback(
    async (itemId: string, newPath: string) => {
      const row = await window.api.irLibraryRelinkNamModel(itemId, newPath)
      applyUpdatedCapture(row)
    },
    [applyUpdatedCapture]
  )
  const findCandidates = useCallback(
    (modelName: string) =>
      window.api.irLibraryFindNamModelCandidates(modelName, [outputRoot].filter(Boolean) as string[]),
    [outputRoot]
  )

  const captureMenuItems = useCallback(
    (capture: NamCaptureRow): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [
        {
          label: 'Open capture detail',
          onClick: () => {
            setSelectedCaptureId(capture.itemId)
            setCaptureMenu(null)
          }
        },
        {
          label: 'Create training batch from this capture',
          onClick: () => {
            setCaptureMenu(null)
            void stageBatch([capture], capture.captureName)
          }
        },
        {
          label: 'Run next (jump the queue)',
          onClick: () => {
            setCaptureMenu(null)
            void submitBatch([capture], capture.captureName, 'runNext')
          }
        },
        {
          label: selectedCaptureIds.has(capture.itemId) ? 'Remove from selection' : 'Add to selection',
          onClick: () => {
            toggleCapture(capture.itemId)
            setCaptureMenu(null)
          }
        },
        { divider: true },
        { label: 'Reveal WAV in Explorer', onClick: () => revealCapture(capture) }
      ]
      if (capture.trained && capture.result?.outputModelPath) {
        const modelPath = capture.result.outputModelPath
        items.push({
          label: capture.modelFile ? 'Open .nam' : 'Open .nam (may be missing)',
          onClick: () => {
            void window.api.openFile(modelPath)
            setCaptureMenu(null)
          }
        })
        items.push({
          label: 'Reveal .nam in folder',
          onClick: () => {
            window.api.revealFile(modelPath)
            setCaptureMenu(null)
          }
        })
      }
      items.push({ divider: true })
      items.push({
        label: 'Rescan all',
        onClick: () => {
          setCaptureMenu(null)
          void rescanAll()
        }
      })
      return items
    },
    [selectedCaptureIds, stageBatch, submitBatch, toggleCapture, revealCapture, rescanAll]
  )

  return (
    <div className="nam-projects-scope flex flex-col h-screen bg-app-bg text-nm-text overflow-hidden">
      <div
        className="flex items-center py-2 border-b border-nm-border flex-shrink-0"
        style={{
          paddingLeft: isMacPlatform() ? '80px' : '16px',
          paddingRight: isMacPlatform() ? '16px' : '155px',
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
      <div className="flex items-center gap-3 flex-1 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <NamLabCrumb mode="nam-projects" />
        {selectedId != null && (
          <span className="flex items-center gap-1.5 text-xs min-w-0 flex-shrink">
            <button onClick={() => setSelectedId(null)} className="text-nm-text-2 hover:text-nm-text flex-shrink-0">
              Projects
            </button>
            <span className="text-nm-text-3 flex-shrink-0">/</span>
            <span className="font-semibold text-nm-text truncate">{detail?.name ?? '…'}</span>
          </span>
        )}
        <div className="w-px h-5 bg-nm-border-s flex-shrink-0" />
        <button
          onClick={handleAddFolder}
          disabled={scanning}
          className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
        >
          {scanning ? 'Scanning…' : 'Add Folder'}
        </button>
        <button
          onClick={rescanAll}
          disabled={scanning}
          className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
        >
          Rescan all
        </button>
        <div className="flex rounded overflow-hidden border border-field-bd text-xs">
          {(['projects', 'overview'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 ${view === v ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
            >
              {v === 'projects' ? 'Projects' : 'Overview'}
            </button>
          ))}
        </div>
        {projects.length > 0 && (
          <span className="text-xs text-nm-text-3 flex-shrink-0">
            {projects.length} project{projects.length === 1 ? '' : 's'} ·{' '}
            {projects.reduce((n, p) => n + p.trainedCount, 0)}/
            {projects.reduce((n, p) => n + p.captureCount, 0)} captures trained
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowSettings(true)}
            className={`tb-menu-btn ${showSettings ? 'active' : ''}`}
            title="Settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </div>
      </div>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={(s) => { setSettings(s); saveSettings(s); setShowSettings(false) }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Full-viewport overlay rather than swapping the main content area in place — PlayerPanel
          is a real instrument (FX rig, presets, live tab) that needs guaranteed full space, and
          this shell's content region sits behind a long loading/empty/normal ternary that isn't
          worth threading a fourth branch through. Same closable-overlay shape as the
          addToGroupRow/missingFileInfo dialogs elsewhere in this file, just full-screen. */}
      {playerFile && (
        <div className="fixed inset-0 z-[500] bg-app-bg flex flex-col">
          <PlayerPanel
            file={playerFile}
            onClose={() => setPlayerFile(null)}
            diLibraryPath={str('diPreviewLibraryPath')}
            irLibraryPath={str('irLibraryPath')}
            reverbLibraryPath={str('reverbLibraryPath')}
            delayLibraryPath={str('delayLibraryPath')}
            irMix={typeof settingsRaw.irMix === 'number' ? (settingsRaw.irMix as number) : 1}
            chorusPresets={arr('chorusPresets')}
            delayPresets={arr('delayPresets')}
            reverbPresets={arr('reverbPresets')}
            echoLabPresets={arr('echoLabPresets')}
            rigPresets={arr('rigPresets')}
          />
        </div>
      )}
      {playerError && (
        <div className="fixed bottom-4 right-4 z-[600] bg-panel border border-red-500/40 text-red-500 text-xs rounded-lg px-3 py-2 shadow-lg flex items-center gap-3">
          {playerError}
          <button onClick={() => setPlayerError(null)} className="text-nm-text-3 hover:text-nm-text">×</button>
        </div>
      )}
      {showProjectDefaults && detail && (
        <IrProjectDefaultsModal
          collectionId={detail.collectionId}
          projectName={detail.name}
          onClose={() => setShowProjectDefaults(false)}
          onApplied={() => void refreshDetail(detail.collectionId)}
        />
      )}
      {showBuildPack && detail && <IrBuildPackModal detail={detail} onClose={() => setShowBuildPack(false)} />}

      {error && (
        <div className="flex items-center justify-between px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-nm-text-3 hover:text-nm-text">
            ×
          </button>
        </div>
      )}
      {trainFailure && (
        <div className="flex items-center justify-between px-4 py-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 flex-shrink-0">
          <span>{trainFailure}</span>
          <button onClick={() => setTrainFailure(null)} className="text-nm-text-3 hover:text-nm-text">
            ×
          </button>
        </div>
      )}
      {message && (
        <div className="flex items-center justify-between px-4 py-1 text-xs text-nm-text-2 bg-active-bg flex-shrink-0">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-nm-text-3 hover:text-nm-text">
            ×
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {leftRail}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-nm-text-3">
          Loading NAM projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 text-nm-text-2">
          <p className="text-sm">No NAM Capture projects in the catalog yet.</p>
          <p className="text-xs text-nm-text-3 max-w-[380px]">
            Add a folder that contains IR Lab NAM Capture projects (each capture is a folder with an{' '}
            <code>excitation.wav</code>, <code>recording.wav</code> and <code>nam-capture.json</code>).
          </p>
          <button
            onClick={handleAddFolder}
            className="px-3 py-1.5 text-sm rounded bg-nm-accent hover:opacity-90 text-accent-fg"
          >
            Add Folder
          </button>
        </div>
      ) : view === 'overview' ? (
        <div className="flex-1 overflow-y-auto p-5">
          {!overview ? (
            <div className="text-sm text-nm-text-3">Loading overview…</div>
          ) : (
            <div className="flex flex-col gap-5 max-w-[860px]">
              <div className="flex flex-wrap items-start gap-2">
                <StatTile label="Projects" value={overview.totalProjects} />
                <StatTile label="Captures" value={overview.totalCaptures} />
                <StatTile label="Trained" value={overview.trainedCaptures} tone="accent" />
                <StatTile label="Untrained" value={overview.untrainedCaptures} tone="muted" />
                <StatTile label="Synthetic" value={overview.syntheticCaptures} tone="muted" />
                <StatTile
                  label="Coverage"
                  value={
                    overview.totalCaptures
                      ? `${Math.round((overview.trainedCaptures / overview.totalCaptures) * 100)}%`
                      : '—'
                  }
                />
                <StatTile
                  label="Mean ESR"
                  value={overview.avgTrainedEsr != null ? overview.avgTrainedEsr.toFixed(4) : '—'}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Breakdown title="By capture scope" rows={overview.byScope} />
                <Breakdown title="By sample rate" rows={overview.bySampleRate} />
                <Breakdown title="By trained architecture" rows={overview.byArchitecture} />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-nm-text-2">Per project</span>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(buildReport(overview))
                        setReportCopied(true)
                        setTimeout(() => setReportCopied(false), 1500)
                      } catch {
                        setError('Could not copy the report to the clipboard.')
                      }
                    }}
                    className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
                  >
                    {reportCopied ? 'Copied ✓' : 'Copy report (Markdown)'}
                  </button>
                </div>
                <div className="border border-nm-border-s rounded overflow-hidden">
                  <div className="grid grid-cols-[1fr_repeat(4,72px)] text-[11px] bg-panel-2 text-nm-text-3 px-2 py-1">
                    <span>Project</span>
                    <span className="text-right">Caps</span>
                    <span className="text-right">Trained</span>
                    <span className="text-right">Synth</span>
                    <span className="text-right">Mean ESR</span>
                  </div>
                  {overview.projects.map((p) => (
                    <button
                      key={p.collectionId}
                      onClick={() => {
                        setSelectedId(p.collectionId)
                        setView('projects')
                      }}
                      className="w-full grid grid-cols-[1fr_repeat(4,72px)] text-xs px-2 py-1.5 border-t border-nm-border-s hover:bg-hov text-left"
                    >
                      <span className="truncate text-nm-text">{p.name}</span>
                      <span className="text-right text-nm-text-2">{p.captureCount}</span>
                      <span className="text-right text-nm-text-2">{p.trainedCount}</span>
                      <span className="text-right text-nm-text-2">{p.syntheticCount}</span>
                      <span className="text-right text-nm-text-3">
                        {p.avgTrainedEsr != null ? p.avgTrainedEsr.toFixed(4) : '—'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : selectedId === null ? (
        <ProjectsIndex
          projects={projects}
          filter={projectFilter}
          onFilterChange={setProjectFilter}
          stateFilter={projectStateFilter}
          onStateFilterChange={setProjectStateFilter}
          sort={projectSort}
          onSortChange={setProjectSort}
          view={indexView}
          onViewChange={setIndexView}
          onOpenProject={setSelectedId}
          onStageAllUntrained={() => void stageOrTrainAllUntrained('stage')}
          onTrainAllUntrained={() => void stageOrTrainAllUntrained('runNext')}
          busy={queueing}
        />
      ) : (
        <div className="flex-1 flex min-h-0">
          <div
            style={{ width: railWidth }}
            className="flex-shrink-0 flex flex-col min-h-0 border-r border-nm-border-s"
          >
            <div className="px-2 py-1.5 border-b border-nm-border-s flex-shrink-0 flex items-center gap-1.5">
              <input
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                placeholder="Filter projects…"
                className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
              />
              <select
                value={projectSort}
                onChange={(e) => setProjectSort(e.target.value as typeof projectSort)}
                title="Sort projects"
                className="text-[11px] px-1 py-0.5 rounded border border-field-bd bg-field-bg text-nm-text-2 flex-shrink-0"
              >
                <option value="name">Name</option>
                <option value="newest">Newest</option>
                <option value="leastTrained">Least trained</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
              {visibleProjects.map((p) => (
                <ProjectRailRow
                  key={p.collectionId}
                  project={p}
                  selected={p.collectionId === selectedId}
                  onSelect={() => setSelectedId(p.collectionId)}
                  onContextMenu={(project, x, y) => setProjectMenu({ project, x, y })}
                />
              ))}
              {visibleProjects.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-nm-text-3">No projects match.</div>
              )}
            </div>
          </div>
          <div
            onMouseDown={() => {
              dragging.current = true
            }}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-nm-accent/40 active:bg-nm-accent/60 transition-colors"
          />

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {detail && (
              <>
                <ProjectHeader
                  detail={detail}
                  onReveal={(p) => window.api.revealFile(p)}
                  onOpenProjectDefaults={() => setShowProjectDefaults(true)}
                  onOpenBuildPack={() => setShowBuildPack(true)}
                />
                {liveRun && <LiveRunStrip capture={liveRun.capture} job={liveRun.job} queuedNext={liveRun.queuedNext} />}
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-nm-border-s flex-shrink-0">
                  <input
                    value={captureFilter}
                    onChange={(e) => setCaptureFilter(e.target.value)}
                    placeholder="Filter captures (name, gear, modeled-by)…"
                    className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
                  />
                  <div className="flex rounded overflow-hidden border border-field-bd flex-shrink-0">
                    <button
                      onClick={() => setCaptureView('list')}
                      title="List view"
                      className={`p-1.5 ${captureView === 'list' ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setCaptureView('cards')}
                      title="Card view"
                      className={`p-1.5 ${captureView === 'cards' ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
                      </svg>
                    </button>
                  </div>
                  {captureView === 'cards' && (
                    <div className="flex items-center rounded overflow-hidden border border-field-bd flex-shrink-0">
                      {(['small', 'medium', 'large'] as const).map((size) => {
                        const active = captureCardSize === size
                        const rects = size === 'small'
                          ? [[1, 1], [5, 1], [1, 5], [5, 5], [9, 1], [9, 5]]
                          : size === 'medium'
                            ? [[1, 1], [6, 1], [1, 6], [6, 6]]
                            : [[1, 1], [6, 1]]
                        return (
                          <button
                            key={size}
                            title={size.charAt(0).toUpperCase() + size.slice(1)}
                            onClick={() => setCaptureCardSize(size)}
                            className={`px-1.5 py-1 transition-colors ${active
                              ? 'bg-nm-accent text-accent-fg'
                              : 'bg-field-bg text-nm-text-2 hover:bg-hov'
                            }`}
                          >
                            <svg viewBox="0 0 12 12" className={size === 'small' ? 'w-3 h-3' : size === 'medium' ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill="currentColor">
                              {rects.map(([x, y], i) => (
                                <rect key={i} x={x} y={y} width={size === 'small' ? 3 : size === 'medium' ? 4 : 10} height={size === 'small' ? 3 : size === 'medium' ? 4 : 10} rx="0.5" />
                              ))}
                            </svg>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="flex items-center flex-shrink-0">
                    <select
                      value={sortKey}
                      onChange={(e) => setSort(e.target.value)}
                      title="Sort captures (list-view column headers sort too)"
                      className="text-[11px] px-1.5 py-1 rounded-l border border-field-bd bg-field-bg text-nm-text-2 max-w-[130px]"
                    >
                      {captureColumns.map((c) => (
                        <option key={c.key} value={c.key}>
                          Sort: {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                      title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                      className="text-[11px] px-1.5 py-1 rounded-r border border-l-0 border-field-bd text-nm-text-2 hover:bg-hov"
                    >
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>
                  {(['all', 'untrained', 'queued', 'training', 'trained', 'failed', 'missing'] as const).map((s) => {
                    const n =
                      s === 'all'
                        ? detail.captures.length
                        : detail.captures.filter((c) => deriveCaptureStatus(c, queueJobs) === s).length
                    return (
                      <StatusChip
                        key={s}
                        label={`${s === 'all' ? 'All' : CAPTURE_STATUS_LABEL[s]} ${n}`}
                        active={statusFilter === s}
                        onClick={() => setStatusFilter(s)}
                      />
                    )
                  })}
                  <StatusChip
                    label={`Synthetic ${detail.captures.filter((c) => c.synthetic).length}`}
                    active={syntheticOnly}
                    onClick={() => setSyntheticOnly((v) => !v)}
                  />
                </div>
                <FacetPills available={facetOptions} active={facets} onToggle={toggleFacet} />
                <div className="flex items-center gap-3 px-4 py-1 border-b border-nm-border-s flex-shrink-0 text-[11px] text-nm-text-3">
                  {visibleCaptures.length > 0 && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={visibleCaptures.every((c) => selectedCaptureIds.has(c.itemId))}
                        onChange={selectAllVisible}
                      />
                      Select all shown
                    </label>
                  )}
                  <span>
                    showing {visibleCaptures.length} of {detail.captures.length}
                  </span>
                  {filtersActive && (
                    <button onClick={clearFilters} className="text-nm-accent hover:underline">
                      Clear filters
                    </button>
                  )}
                </div>
              </>
            )}
            {detail && captureView === 'cards' ? (
              <div className="flex-1 overflow-y-auto">
                <div
                  className="grid gap-4 p-5 content-start"
                  style={{ gridTemplateColumns: `repeat(auto-fill, ${captureCardPx}px)` }}
                >
                  {sortedCaptures.map((c) => (
                    <CaptureCard
                      key={c.itemId}
                      capture={c}
                      queueJobs={queueJobs}
                      checked={selectedCaptureIds.has(c.itemId)}
                      active={c.itemId === selectedCaptureId}
                      onToggleCheck={() => toggleCapture(c.itemId)}
                      onOpenDetail={() => setSelectedCaptureId(c.itemId)}
                      onMenu={(capture, x, y) => setCaptureMenu({ capture, x, y })}
                      onReveal={() => revealCapture(c)}
                      onOpenModel={() =>
                        c.result?.outputModelPath && void window.api.openFile(c.result.outputModelPath)
                      }
                      onQueue={() => void stageBatch([c], c.captureName)}
                      onFacet={toggleFacet}
                      isFacetActive={isFacetActive}
                    />
                  ))}
                  {sortedCaptures.length === 0 && (
                    <div className="col-span-full px-1 py-4 text-xs text-nm-text-3">
                      No captures match this filter.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <DataGrid<NamCaptureRow>
                rows={visibleCaptures}
                getRowId={(c) => c.itemId}
                columns={captureColumns}
                storageKey="nam-projects-captures"
                selectedIds={selectedCaptureIds}
                onSelectionChange={(ids) => setSelectedCaptureIds(new Set(ids))}
                onRowOpen={(c) => setSelectedCaptureId(c.itemId)}
                onRowContextMenu={(c, x, y) => setCaptureMenu({ capture: c, x, y })}
                sort={{ key: sortKey, dir: sortDir }}
                onSortChange={(k, d) => {
                  setSortKey(k)
                  setSortDir(d)
                }}
                emptyText="No captures match this filter."
                className="flex-1"
              />
            )}

            {selectedCaptures.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 border-t border-nm-border bg-panel-2 flex-shrink-0">
                <span className="text-xs text-nm-text-2">
                  {selectedCaptures.length} selected
                  {selectedCaptures.filter((c) => isQueueEligible(c, true)).length !==
                    selectedCaptures.length &&
                    ` (${selectedCaptures.filter((c) => isQueueEligible(c, true)).length} trainable)`}
                </span>
                <button
                  onClick={() => stageBatch(selectedCaptures, `${selectedCaptures.length} selected`)}
                  disabled={queueing}
                  className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
                >
                  {queueing ? 'Working…' : 'Create training batch'}
                </button>
                <button
                  onClick={() =>
                    submitBatch(selectedCaptures, `${selectedCaptures.length} selected`, 'runNext')
                  }
                  disabled={queueing}
                  title="Queue these live and jump the line — runs after the current file, or first if the queue is paused"
                  className="px-3 py-1 text-xs rounded border border-nm-accent/50 text-nm-accent hover:bg-nm-accent/10 disabled:opacity-50"
                >
                  Run next
                </button>
                <button
                  onClick={() => setSelectedCaptureIds(new Set())}
                  className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="w-[320px] flex-shrink-0 border-l border-nm-border overflow-y-auto p-4 flex flex-col gap-4">
            {selectedCapture ? (
              <CaptureDetailPanel
                capture={selectedCapture}
                projectId={detail?.projectId ?? ''}
                outputRoot={outputRoot}
                architecture={architecture}
                epochs={epochs}
                onBack={() => setSelectedCaptureId(null)}
                onReveal={(p) => window.api.revealFile(p)}
                onOpen={(p) => void window.api.openFile(p)}
                onPlay={(p) => void openModelInPlayer(p)}
                onQueue={(mode) => submitBatch([selectedCapture], selectedCapture.captureName, mode)}
                onEditMetadata={(patch) => handleEditMetadata(selectedCapture.itemId, patch)}
                onRelink={(newPath) => handleRelinkModel(selectedCapture.itemId, newPath)}
                onFindCandidates={(modelName) => findCandidates(modelName)}
              />
            ) : detail ? (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-nm-text-2">Project details</span>
                  <DetailField label="Cabinet" value={detail.cabinet} />
                  <DetailField label="Speaker" value={detail.speaker} />
                  <DetailField label="Room" value={detail.room} />
                  <DetailField label="Signal chain" value={detail.signalChain} />
                  <DetailField label="Description" value={detail.description} />
                  <DetailField label="Notes" value={detail.projectNotes} />
                  {!detail.cabinet &&
                    !detail.speaker &&
                    !detail.room &&
                    !detail.signalChain &&
                    !detail.description &&
                    !detail.projectNotes && (
                      <span className="text-xs text-nm-text-3">
                        No project details supplied by IR Lab (optional — nothing depends on them).
                      </span>
                    )}
                  <span className="text-[11px] text-nm-text-3 pt-1">
                    Select a capture to see its files, calibration, editable model metadata and
                    training result.
                  </span>
                </div>

                <div className="border-t border-nm-border-s pt-3 flex flex-col gap-2.5">
                  <span className="text-xs font-semibold text-nm-text-2">Training batch</span>

                  <label className="flex flex-col gap-1 text-[11px] text-nm-text-3">
                    Architecture
                    <select
                      value={architecture}
                      onChange={(e) => setArchitecture(e.target.value)}
                      className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                    >
                      {TRAINER_ARCHITECTURES.map((a) => (
                        <option key={a} value={a}>
                          {ARCH_LABEL[a] ?? a}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-[11px] text-nm-text-3">
                    Epochs
                    <input
                      type="number"
                      min={1}
                      value={epochs}
                      onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))}
                      className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                    />
                  </label>

                  <div className="flex flex-col gap-1 text-[11px] text-nm-text-3">
                    Model output folder
                    <button
                      onClick={handleChooseOutput}
                      title={outputRoot || 'Choose a folder for the trained .nam files'}
                      className="px-2 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov text-left truncate"
                    >
                      {outputRoot || 'Choose folder…'}
                    </button>
                  </div>

                  {detail.syntheticCount > 0 && (
                    <label className="flex items-center gap-2 text-[11px] text-nm-text-2">
                      <input
                        type="checkbox"
                        checked={includeSynthetic}
                        onChange={(e) => setIncludeSynthetic(e.target.checked)}
                      />
                      Include {detail.syntheticCount} synthetic capture
                      {detail.syntheticCount === 1 ? '' : 's'}
                    </label>
                  )}

                  <button
                    onClick={() => stageBatch(projectEligible, `${projectEligible.length} untrained`)}
                    disabled={queueing || projectEligible.length === 0}
                    className="px-3 py-1.5 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
                  >
                    {queueing
                      ? 'Working…'
                      : projectEligible.length === 0
                        ? 'Nothing to stage'
                        : `Stage batch — ${projectEligible.length} untrained capture${projectEligible.length === 1 ? '' : 's'}`}
                  </button>
                  <button
                    onClick={() =>
                      submitBatch(projectEligible, `${projectEligible.length} untrained`, 'runNext')
                    }
                    disabled={queueing || projectEligible.length === 0}
                    title="Queue these live and jump the line — runs after the current file, or first if the queue is paused"
                    className="px-3 py-1.5 text-xs rounded border border-nm-accent/50 text-nm-accent hover:bg-nm-accent/10 disabled:opacity-50"
                  >
                    Run next
                  </button>
                  <span className="text-[11px] text-nm-text-3">
                    <strong>Stage</strong> parks the jobs on the Batches page — nothing runs until you
                    hit Start there.
                    <strong> Run next</strong> queues them live and jumps ahead of the current queue
                    (after the running file finishes, or first when a paused queue resumes).
                    Already-trained captures are skipped; trained <code>.nam</code> files land in the
                    folder above and each badge flips on completion.
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
        </div>
      </div>

      {captureMenu && (
        <ContextMenu
          x={captureMenu.x}
          y={captureMenu.y}
          onClose={() => setCaptureMenu(null)}
          items={captureMenuItems(captureMenu.capture)}
        />
      )}

      {projectMenu && (
        <ContextMenu
          x={projectMenu.x}
          y={projectMenu.y}
          onClose={() => setProjectMenu(null)}
          items={[
            {
              label: 'Create training batch from project',
              onClick: () => {
                const p = projectMenu.project
                setProjectMenu(null)
                setSelectedId(p.collectionId)
                // detail may not be loaded for this project yet — fetch, then stage its untrained set.
                void (async () => {
                  const d = await window.api.irLibraryGetNamProjectDetail(p.collectionId)
                  if (!d) {
                    setError('Could not load that project.')
                    return
                  }
                  const eligible = d.captures.filter((c) => isQueueEligible(c, includeSynthetic))
                  if (eligible.length === 0) {
                    setError(`"${d.name}" has no untrainable captures (all trained, or WAVs missing).`)
                    return
                  }
                  if (!outputRoot) {
                    setError('Choose a model output folder first (right panel).')
                    return
                  }
                  setQueueing(true)
                  try {
                    const res = await window.api.enqueueNamCaptureImport({
                      captures: eligible.map((c) => toBatchItem(c, d.name)),
                      finalModelRoot: outputRoot,
                      architecture,
                      epochs,
                      includeSynthetic: true,
                      staged: true,
                      submissionLabel: `${d.name} — ${eligible.length} untrained`
                    })
                    if (res.success) {
                      setMessage(
                        `Staged ${res.built ?? eligible.length} job${(res.built ?? 1) === 1 ? '' : 's'} — opening the Batches page…`
                      )
                      goToTrainingBatches()
                    } else {
                      setError(res.error ?? 'Could not stage the batch.')
                    }
                  } catch (err) {
                    setError(String(err))
                  } finally {
                    setQueueing(false)
                  }
                })()
              }
            },
            {
              label: 'Reveal in Explorer',
              onClick: () => {
                const p = projectMenu.project
                setProjectMenu(null)
                void (async () => {
                  const d = await window.api.irLibraryGetNamProjectDetail(p.collectionId)
                  const folder =
                    d?.namCapturesDir ?? d?.captures.find((c) => c.captureFolderPath)?.captureFolderPath
                  if (folder) window.api.revealFile(folder)
                })()
              }
            },
            {
              label: 'Rescan all',
              onClick: () => {
                setProjectMenu(null)
                void rescanAll()
              }
            }
          ]}
        />
      )}
    </div>
  )
}

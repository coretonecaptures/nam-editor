import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { TRAINER_ARCHITECTURES, BUILT_IN_CAPTURE_PROFILES } from '../../types/trainer'
import { GEAR_TYPES, TONE_TYPES } from '../../types/nam'
import type {
  NamProjectSummary,
  NamProjectDetail,
  NamCaptureRow,
  NamCaptureMetadataPatch,
  NamLibraryOverview
} from '../../types/namProjects'
import type { TrainerHistoryEntry } from '../../types/trainer'
import { goToTrainingBatches, goToTrainingQueue } from '../../appNav'

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

type StatusFilter = 'all' | 'untrained' | 'trained' | 'synthetic'

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

function hasHints(c: NamCaptureRow): boolean {
  const s = c.suggested
  return !!s && !!(s.modeledBy || s.gearMake || s.gearModel || s.gearType || s.toneType)
}
function hintTip(c: NamCaptureRow): string {
  const s = c.suggested
  if (!s) return ''
  return (
    'Model-metadata hints from IR Lab (seed the effective metadata below):\n' +
    [
      s.modeledBy && `modeled by ${s.modeledBy}`,
      s.gearMake && `make ${s.gearMake}`,
      s.gearModel && `model ${s.gearModel}`,
      s.gearType && `type ${s.gearType}`,
      s.toneType && `tone ${s.toneType}`
    ]
      .filter(Boolean)
      .join('\n')
  )
}

function calChipTitle(c: NamCaptureRow): string {
  const cal = c.calibration
  if (!cal) return ''
  return (
    'Rig-calibrated' +
    (cal.method ? ` (${cal.method}${cal.confidence ? `, ${cal.confidence}` : ''})` : '') +
    ` — input ${cal.inputLevelDbu ?? '?'} dBu, output ${cal.outputLevelDbu ?? '?'} dBu`
  )
}

// --- facets ----------------------------------------------------------------

type FacetKey = 'scope' | 'sampleRate' | 'gearType' | 'toneType' | 'calibration' | 'architecture'
type FacetState = Record<FacetKey, string[]>
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

function availableFacets(caps: NamCaptureRow[]): AvailableFacets {
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

/** AND across facets, OR within a facet — matches IR mode's FieldBadge filter bar. */
function matchesFacets(c: NamCaptureRow, f: FacetState): boolean {
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

function TrainedBadge({ trained }: { trained: boolean }): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] flex-shrink-0 ${
        trained ? 'text-emerald-600 dark:text-emerald-400' : 'text-nm-text-3'
      }`}
      title={trained ? 'A model has been trained from this capture' : 'No model trained yet'}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${trained ? 'bg-emerald-500' : 'bg-nm-text-3/50'}`} />
      {trained ? 'Trained' : 'Untrained'}
    </span>
  )
}

function Pill({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 text-[10px] rounded border ${
        active
          ? 'bg-nm-accent text-accent-fg border-nm-accent'
          : 'border-field-bd text-nm-text-2 hover:bg-hov'
      }`}
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
  const chips: string[] = []
  for (const { value, count } of tally(captures.map((c) => srLabel(c.sampleRate))))
    chips.push(`${value} ×${count}`)
  for (const { value, count } of tally(captures.map((c) => (c.recordingBitDepth ? `${c.recordingBitDepth}-bit` : null))))
    chips.push(count === captures.length ? value : `${value} ×${count}`)
  const scope = tally(captures.map((c) => c.captureScope))
  if (scope.length) chips.push(scope.map((s) => `${s.value} ×${s.count}`).join(' · '))
  const calibrated = captures.filter(captureIsCalibrated)
  if (calibrated.length > 0) {
    const conf = tally(calibrated.map((c) => c.calibration?.confidence))
    chips.push(
      `${calibrated.length}/${captures.length} calibrated${conf[0] ? ` · mostly ${conf[0].value}` : ''}`
    )
  }
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className="px-1.5 py-0.5 text-[10px] rounded bg-field-bg text-nm-text-2 border border-nm-border-s"
        >
          {c}
        </span>
      ))}
    </div>
  )
}

function ProjectHeader({
  detail,
  onReveal
}: {
  detail: NamProjectDetail
  onReveal: (path: string) => void
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
  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-nm-border flex-shrink-0">
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
      {detail.imagePaths.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-1">
          {detail.imagePaths.map((p) => (
            <img
              key={p}
              src={fileSrc(p)}
              alt=""
              onClick={() => void window.api.openFile(p)}
              className="h-16 w-16 object-cover rounded border border-nm-border-s flex-shrink-0 cursor-pointer hover:opacity-80"
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CaptureRow({
  capture,
  checked,
  active,
  onToggleCheck,
  onOpenDetail,
  onMenu
}: {
  capture: NamCaptureRow
  checked: boolean
  active: boolean
  onToggleCheck: () => void
  onOpenDetail: () => void
  onMenu: (c: NamCaptureRow, x: number, y: number) => void
}): React.ReactElement {
  const rel = relTime(capture.createdAt)
  const eff = capture.effective
  return (
    <div
      onClick={onOpenDetail}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(capture, e.clientX, e.clientY)
      }}
      className={`flex items-center gap-2 px-3 py-2 border-b border-nm-border-s text-xs cursor-pointer ${
        active
          ? 'bg-active-bg ring-1 ring-inset ring-nm-accent/40'
          : checked
            ? 'bg-active-bg/60'
            : 'hover:bg-hov'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="truncate text-sm leading-tight text-nm-text">{capture.captureName}</div>
        <div className="flex items-center gap-2 text-[11px] text-nm-text-3 flex-wrap">
          {capture.captureScope && <span>{capture.captureScope}</span>}
          {audioLabel(capture) && <span>{audioLabel(capture)}</span>}
          {capture.measuredLatencySamples != null && <span>{capture.measuredLatencySamples} smp</span>}
          {captureIsCalibrated(capture) && (
            <span className="text-emerald-600 dark:text-emerald-400" title={calChipTitle(capture)}>
              ⚑ {eff.inputLevelDbu ?? capture.calibration?.inputLevelDbu ?? '?'}/
              {eff.outputLevelDbu ?? capture.calibration?.outputLevelDbu ?? '?'} dBu
              {capture.calibration?.confidence ? ` ${capture.calibration.confidence}` : ''}
            </span>
          )}
          {hasHints(capture) && (
            <span className="text-nm-text-3" title={hintTip(capture)}>
              ⓘ hints
            </span>
          )}
          {capture.metadataEdited && (
            <span className="text-nm-accent" title="Model metadata edited in NAM Lab">
              ✎ edited
            </span>
          )}
          {capture.synthetic && (
            <span
              className="nam-chip opacity-60 flex-shrink-0"
              title={
                capture.syntheticSourceIrName
                  ? `Synthetic — generated from ${capture.syntheticSourceIrName}, not a real capture`
                  : 'Synthetic — not a real capture'
              }
            >
              <span className="nam-dot" />
              synthetic
            </span>
          )}
        </div>
      </div>
      {capture.trained && capture.result?.validationEsr != null && (
        <span
          className="text-[11px] text-nm-text-3 flex-shrink-0"
          title="Validation ESR of the trained model"
        >
          ESR {capture.result.validationEsr.toFixed(4)}
        </span>
      )}
      {rel && (
        <span
          className="text-[11px] text-nm-text-3 flex-shrink-0 w-16 text-right"
          title={fmtDateTime(capture.createdAt) ?? ''}
        >
          {rel}
        </span>
      )}
      <TrainedBadge trained={capture.trained} />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onMenu(capture, e.clientX, e.clientY)
        }}
        className="flex-shrink-0 px-1 text-nm-text-3 hover:text-nm-text"
        title="More…"
      >
        ⋯
      </button>
    </div>
  )
}

function CaptureCard({
  capture,
  checked,
  active,
  onToggleCheck,
  onOpenDetail,
  onMenu,
  onReveal,
  onOpenModel,
  onQueue
}: {
  capture: NamCaptureRow
  checked: boolean
  active: boolean
  onToggleCheck: () => void
  onOpenDetail: () => void
  onMenu: (c: NamCaptureRow, x: number, y: number) => void
  onReveal: () => void
  onOpenModel: () => void
  onQueue: () => void
}): React.ReactElement {
  const eff = capture.effective
  const rel = relTime(capture.createdAt)
  return (
    <div
      onClick={onOpenDetail}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(capture, e.clientX, e.clientY)
      }}
      className={`flex flex-col rounded border text-xs cursor-pointer overflow-hidden ${
        active ? 'border-nm-accent bg-active-bg' : 'border-nm-border-s bg-panel-2 hover:bg-hov'
      }`}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleCheck}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="flex-1 min-w-0 truncate text-sm text-nm-text">{capture.captureName}</span>
        <TrainedBadge trained={capture.trained} />
      </div>
      <div className="px-2.5 pb-2 text-[11px] text-nm-text-3 flex flex-col gap-1">
        <div className="flex flex-wrap gap-x-2">
          {capture.captureScope && <span>{capture.captureScope}</span>}
          {audioLabel(capture) && <span>{audioLabel(capture)}</span>}
          {capture.measuredLatencySamples != null && <span>{capture.measuredLatencySamples} smp</span>}
        </div>
        {captureIsCalibrated(capture) && (
          <div className="text-emerald-600 dark:text-emerald-400">
            cal {eff.inputLevelDbu ?? capture.calibration?.inputLevelDbu ?? '?'} /{' '}
            {eff.outputLevelDbu ?? capture.calibration?.outputLevelDbu ?? '?'} dBu
            {capture.calibration?.method ? ` · ${capture.calibration.method}` : ''}
          </div>
        )}
        {(eff.gearMake || eff.gearModel) && (
          <div className="text-nm-text-2 truncate">
            {[eff.gearMake, eff.gearModel].filter(Boolean).join(' · ')}
          </div>
        )}
        {(eff.gearType || eff.toneType) && (
          <div className="flex gap-1 flex-wrap">
            {[eff.gearType, eff.toneType].filter(Boolean).map((t) => (
              <span key={t as string} className="nam-chip">
                {t}
              </span>
            ))}
          </div>
        )}
        {capture.metadataEdited && <span className="text-nm-accent">✎ edited</span>}
        {capture.synthetic && (
          <span className="nam-chip opacity-60 self-start">
            <span className="nam-dot" />
            synthetic
          </span>
        )}
      </div>
      {capture.trained && (
        <div className="border-t border-nm-border-s px-2.5 py-2 flex flex-col gap-1">
          {capture.graphExists && capture.result?.graphPath && (
            <img
              src={fileSrc(capture.result.graphPath)}
              alt="training graph"
              className="w-full h-16 object-cover rounded bg-field-bg"
              loading="lazy"
            />
          )}
          <div className="flex items-center gap-2 text-[11px] text-nm-text-3 flex-wrap">
            {capture.result?.architecture && <span>{capture.result.architecture}</span>}
            {capture.result?.validationEsr != null && (
              <span>ESR {capture.result.validationEsr.toFixed(4)}</span>
            )}
            {relTime(capture.result?.trainedAt) && <span>{relTime(capture.result?.trainedAt)}</span>}
          </div>
        </div>
      )}
      <div className="border-t border-nm-border-s px-2.5 py-1.5 flex items-center gap-3 text-[11px]">
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
        {rel && (
          <span className="ml-auto text-nm-text-3" title={fmtDateTime(capture.createdAt) ?? ''}>
            captured {fmtDate(capture.createdAt)}
          </span>
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
  const set = (k: (typeof META_FIELDS)[number]['k'], v: string): void =>
    setDraft((d) => ({ ...d, [k]: v.trim() === '' ? null : v }))

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
  onRelink,
  onFindCandidates
}: {
  capture: NamCaptureRow
  onReveal: (p: string) => void
  onOpen: (p: string) => void
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
  onQueue: (mode: 'stage' | 'runNext') => void
  onEditMetadata: (patch: NamCaptureMetadataPatch) => Promise<void>
  onRelink: (newPath: string) => Promise<void>
  onFindCandidates: (modelName: string) => Promise<string[]>
}): React.ReactElement {
  const c = capture
  const cal = c.calibration
  const r = c.result
  const exc = c.excitationPath
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
            input {cal.inputLevelDbu ?? '?'} dBu · output {cal.outputLevelDbu ?? '?'} dBu
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
      </section>
    </div>
  )
}

/** A capture is batch-eligible if it isn't trained yet and both WAV paths resolved. Synthetic
 * captures only count when includeSynthetic is on. */
function isQueueEligible(c: NamCaptureRow, includeSynthetic: boolean): boolean {
  return !c.trained && (includeSynthetic || !c.synthetic) && !!c.excitationPath && !!c.recordingPath
}

/** One capture -> the IPC batch-item shape. Carries the **effective** calibration dBu +
 * model-metadata (falling back to IR Lab's suggestion) — that's what seeds the trained .nam. */
function toBatchItem(
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

export function NamProjectsShell(): React.ReactElement {
  const [projects, setProjects] = useState<NamProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => readStored(SELECTED_KEY) || null)
  const [detail, setDetail] = useState<NamProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trainFailure, setTrainFailure] = useState<string | null>(null)
  const [captureMenu, setCaptureMenu] = useState<{ capture: NamCaptureRow; x: number; y: number } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ project: NamProjectSummary; x: number; y: number } | null>(null)

  const [view, setView] = useState<'projects' | 'overview'>(() =>
    readStored(VIEW_KEY) === 'overview' ? 'overview' : 'projects'
  )
  const [captureView, setCaptureView] = useState<'list' | 'cards'>(() =>
    readStored(CAPTURE_VIEW_KEY) === 'cards' ? 'cards' : 'list'
  )
  const [overview, setOverview] = useState<NamLibraryOverview | null>(null)
  const [reportCopied, setReportCopied] = useState(false)
  const [projectFilter, setProjectFilter] = useState('')
  const [captureFilter, setCaptureFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
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
      setSelectedId((prev) =>
        prev && list.some((p) => p.collectionId === prev) ? prev : list[0]?.collectionId ?? null
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    if (selectedId) writeStored(SELECTED_KEY, selectedId)
  }, [selectedId])
  useEffect(() => {
    writeStored(VIEW_KEY, view)
  }, [view])
  useEffect(() => {
    writeStored(CAPTURE_VIEW_KEY, captureView)
  }, [captureView])

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
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  }, [projects, projectFilter])

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
      if (statusFilter === 'trained' && !c.trained) return false
      if (statusFilter === 'untrained' && c.trained) return false
      if (statusFilter === 'synthetic' && !c.synthetic) return false
      if (!matchesFacets(c, facets)) return false
      return true
    })
  }, [detail, captureFilter, statusFilter, facets])

  const filtersActive =
    captureFilter.trim() !== '' ||
    statusFilter !== 'all' ||
    Object.values(facets).some((a) => a.length > 0)

  const toggleFacet = useCallback((key: FacetKey, value: string) => {
    setFacets((f) => {
      const cur = f[key]
      return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
  }, [])
  const clearFilters = useCallback(() => {
    setFacets(EMPTY_FACETS)
    setCaptureFilter('')
    setStatusFilter('all')
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
    <div className="flex flex-col h-full bg-app-bg text-nm-text overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-nm-border flex-shrink-0">
        <h1 className="text-sm font-semibold text-nm-text-2">NAM Projects</h1>
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
      </div>

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
      ) : (
        <div className="flex-1 flex min-h-0">
          <div
            style={{ width: railWidth }}
            className="flex-shrink-0 flex flex-col min-h-0 border-r border-nm-border-s"
          >
            <div className="px-2 py-1.5 border-b border-nm-border-s flex-shrink-0">
              <input
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                placeholder="Filter projects…"
                className="w-full text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
              />
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
                <ProjectHeader detail={detail} onReveal={(p) => window.api.revealFile(p)} />
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-nm-border-s flex-shrink-0">
                  <input
                    value={captureFilter}
                    onChange={(e) => setCaptureFilter(e.target.value)}
                    placeholder="Filter captures (name, gear, modeled-by)…"
                    className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
                  />
                  <div className="flex rounded overflow-hidden border border-field-bd text-[11px] flex-shrink-0">
                    {(['list', 'cards'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setCaptureView(v)}
                        className={`px-2 py-1 ${captureView === v ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
                      >
                        {v === 'list' ? 'List' : 'Cards'}
                      </button>
                    ))}
                  </div>
                  {(['all', 'untrained', 'trained', 'synthetic'] as const).map((s) => {
                    const n =
                      s === 'all'
                        ? detail.captures.length
                        : s === 'trained'
                          ? detail.captures.filter((c) => c.trained).length
                          : s === 'untrained'
                            ? detail.captures.filter((c) => !c.trained).length
                            : detail.captures.filter((c) => c.synthetic).length
                    return (
                      <StatusChip
                        key={s}
                        label={`${s[0].toUpperCase() + s.slice(1)} ${n}`}
                        active={statusFilter === s}
                        onClick={() => setStatusFilter(s)}
                      />
                    )
                  })}
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
            <div className="flex-1 overflow-y-auto">
              {detail && captureView === 'cards' ? (
                <div
                  className="grid gap-2 p-3"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
                >
                  {visibleCaptures.map((c) => (
                    <CaptureCard
                      key={c.itemId}
                      capture={c}
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
                    />
                  ))}
                </div>
              ) : (
                visibleCaptures.map((c) => (
                  <CaptureRow
                    key={c.itemId}
                    capture={c}
                    checked={selectedCaptureIds.has(c.itemId)}
                    active={c.itemId === selectedCaptureId}
                    onToggleCheck={() => toggleCapture(c.itemId)}
                    onOpenDetail={() => setSelectedCaptureId(c.itemId)}
                    onMenu={(capture, x, y) => setCaptureMenu({ capture, x, y })}
                  />
                ))
              )}
              {detail && visibleCaptures.length === 0 && (
                <div className="px-4 py-4 text-xs text-nm-text-3">No captures match this filter.</div>
              )}
            </div>

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

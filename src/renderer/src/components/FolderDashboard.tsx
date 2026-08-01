import { useMemo } from 'react'
import type { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import { getGearImageSrc } from '../assets/gear'
import { Gauge, TrendLine, gainRamp } from './dashboard/Charts'
import { folderHealth, buildEsrRuns, getEsrBucketTone } from './dashboard/dashboardMetrics'

// ── Design tokens ────────────────────────────────────────────────────────────
const GEAR_COLORS: Record<string, string> = {
  amp:           '#f97316',
  amp_cab:       '#3b82f6',
  pedal:         '#22c55e',
  pedal_amp:     '#eab308',
  amp_pedal_cab: '#a855f7',
  preamp:        '#f43f5e',
  studio:        '#14b8a6',
}
const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp', amp_cab: 'Amp + Cab', pedal: 'Pedal',
  pedal_amp: 'Pedal + Amp', amp_pedal_cab: 'Amp + Pedal + Cab',
  preamp: 'Preamp', studio: 'Studio',
}
const TONE_COLORS: Record<string, string> = {
  clean:      '#0ea5e9',
  crunch:     '#f59e0b',
  hi_gain:    '#dc2626',
  fuzz:       '#9333ea',
  overdrive:  '#16a34a',
  distortion: '#f43f5e',
  other:      '#6b7280',
}
const TONE_LABELS: Record<string, string> = {
  clean: 'Clean', crunch: 'Crunch', hi_gain: 'Hi Gain',
  fuzz: 'Fuzz', overdrive: 'Overdrive', distortion: 'Distortion', other: 'Other',
}
const PRESET_COLORS: Record<string, string> = {
  Complex:  '#a855f7',
  Standard: '#3b82f6',
  Lite:     '#22c55e',
  Feather:  '#f59e0b',
  Nano:     '#f97316',
  REVySTD:  '#06b6d4',
  REVyHI:   '#0ea5e9',
  REVxSTD:  '#8b5cf6',
  Unknown:  '#6b7280',
}

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  files: NamFile[]
  folderName: string
  checklistSummary?: {
    total: number
    completed: number
    percent: number
    targetDate: string
    liveDate: string
    isOverdue: boolean
    releasedLate: boolean
    releasedOnTime: boolean
  } | null
  hasPackInfo?: boolean
  hasReadme?: boolean
  hasCoverImage?: boolean
  galleryCount?: number
  watchSource?: string | null
  deliverySummary?: {
    totalRows: number
    lastImportedAt: string
    tonexIncluded: number
    namIncluded: number
    proxyIncluded: number
    qcIncluded: number
  } | null
  activeDuplicate?: boolean
  activeGear?: string | null
  activeTone?: string | null
  activePreset?: string | null
  activeMissing?: boolean
  activeEsr?: string | null
  activeRating?: number | null
  onDuplicateClick?: (on: boolean) => void
  onGearClick?: (gear: string | null) => void
  onToneClick?: (tone: string | null) => void
  onPresetClick?: (preset: string | null) => void
  onMissingClick?: (on: boolean) => void
  onEsrClick?: (tier: string | null) => void
  onRatingClick?: (rating: number | null) => void
  onRemoveWatch?: () => void
  onSyncWatch?: () => void
  onOpenWatchSource?: (path: string) => void
}

const CORE_FIELDS = [
  'name', 'modeled_by', 'gear_make', 'gear_model',
  'gear_type', 'tone_type', 'input_level_dbu',
] as const

// ── Shared style tokens ──────────────────────────────────────────────────────
const EYEBROW = 'text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400 dark:text-gray-500'
const CARD = 'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3.5'
const STAT_CARD = 'bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3.5 flex flex-col gap-1'

function gaugeColor(score: number): string {
  return score >= 85 ? '#22c55e' : score >= 70 ? '#14b8a6' : score >= 50 ? '#f59e0b' : '#ef4444'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes, unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex++ }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDateTime(ms: number): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function D1Health({ score, parts, label }: { score: number; parts: Array<{ label: string; pct: number; weight: string }>; label?: string }) {
  const color = gaugeColor(score)
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Healthy' : score >= 50 ? 'Needs work' : 'At risk'
  return (
    <div className={`${CARD} flex flex-row gap-4 items-start`}>
      <div className="flex-shrink-0">
        <Gauge value={score} size={132} thickness={13} color={color}>
          <span className="text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">{score}</span>
          <span className="font-mono text-[9px] tracking-widest uppercase text-gray-400 dark:text-gray-500 mt-1">/ 100</span>
        </Gauge>
      </div>
      <div className="flex flex-col gap-3 flex-1 min-w-0 pt-1">
        <div className="flex flex-col gap-0.5">
          <span className={EYEBROW}>{label ?? 'Pack Health'}</span>
          <span className="text-sm font-semibold leading-tight" style={{ color }}>{grade}</span>
        </div>
        <div className="flex flex-col gap-2">
          {parts.map((p) => (
            <div key={p.label} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 w-32 flex-shrink-0 truncate">{p.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${p.pct}%`, backgroundColor: color, opacity: 0.85 }} />
              </div>
              <span className="font-mono tabular-nums text-[11px] text-gray-700 dark:text-gray-300 w-8 text-right flex-shrink-0">{p.pct}%</span>
              <span className="font-mono text-[9px] text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">{p.weight}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function D1StatCard({ label, value, sub, onClick }: {
  label: string; value: string | number; sub?: string; onClick?: () => void
}) {
  return (
    <div
      className={`${STAT_CARD} ${onClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/60 transition-colors' : ''}`}
      onClick={onClick}
    >
      <span className={EYEBROW}>{label}</span>
      <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</span>}
    </div>
  )
}

function D1BarList({ title, rows, onRowClick, activeKey }: {
  title: string
  rows: Array<{ key: string; label: string; count: number; color: string }>
  onRowClick?: (key: string) => void
  activeKey?: string | null
}) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <span className={EYEBROW}>{title}</span>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-600">No data</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div
              key={row.key}
              className={`flex items-center gap-2 rounded px-1 py-0.5 ${onRowClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60' : ''} ${activeKey === row.key ? 'bg-gray-100 dark:bg-gray-800/60' : ''} transition-colors`}
              onClick={() => onRowClick?.(row.key)}
            >
              <span className="text-[11px] text-gray-600 dark:text-gray-300 w-28 truncate flex-shrink-0" title={row.label}>{row.label}</span>
              <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, Math.round((row.count / max) * 100))}%`, backgroundColor: row.color }} />
              </div>
              <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">{row.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Gain / tone gradient strips ───────────────────────────────────────────────

// Clean -> high gain. Ordered by how driven the tone is, not alphabetically, so the strip
// reads left-to-right as a gain progression. 'other' is deliberately excluded — it has no
// position on a gain axis.
const TONE_GAIN_ORDER = ['clean', 'crunch', 'overdrive', 'distortion', 'hi_gain', 'fuzz'] as const

// Cool -> hot, matching the clean -> high-gain progression.
const TONE_GAIN_COLORS: Record<string, string> = {
  clean: '#38bdf8',      // sky
  crunch: '#22c55e',     // green
  overdrive: '#eab308',  // yellow
  distortion: '#f97316', // orange
  hi_gain: '#ef4444',    // red
  fuzz: '#a855f7',       // purple — off-axis tonally, but reads as "beyond distortion"
}

/**
 * Continuous gradient strip of every capture's `metadata.gain`, cleanest to most saturated.
 *
 * Each capture is one segment, ordered by gain, colored by where it sits between the library's
 * min and max. Shows the shape of your saturation coverage at a glance — clustering, and any gaps.
 *
 * NOTE ON UNITS: `metadata.gain` is NOT decibels. NAM derives it from the model's own transfer
 * curve — see `nam/models/base.py::_metadata_gain`, documented as "Between 0 and 1, how much gain
 * / compression does the model seem to have?". Measured across a real 2,577-capture library it
 * runs 0.126..0.928 (median 0.741), so this renders 2 decimal places and no unit. An earlier
 * version of this card labelled these values "dB", which was wrong.
 */
function D1GainStrip({ values, title }: { values: number[]; title: string }) {
  if (values.length === 0) {
    return (
      <div className={`${CARD} flex flex-col gap-3`}>
        <span className={EYEBROW}>{title}</span>
        <p className="text-[11px] text-gray-400 dark:text-gray-600">
          No saturation data — captures in this folder don&apos;t report a gain value.
        </p>
      </div>
    )
  }

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const span = max - min

  // Shared with the Tone Map via gainRamp, so identical saturation values colour identically
  // in both places.
  const colorFor = gainRamp

  const median = sorted[Math.floor(sorted.length / 2)]

  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className={EYEBROW}>{title}</span>
          <span className="block text-[9.5px] text-gray-400 dark:text-gray-500 mt-0.5">
            NAM&apos;s measured 0&ndash;1 saturation, not decibels
          </span>
        </div>
        <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
          {values.length.toLocaleString()} measured
        </span>
      </div>

      <div className="flex h-6 w-full overflow-hidden rounded-md">
        {sorted.map((value, index) => (
          <div
            key={index}
            className="h-full flex-1"
            style={{ backgroundColor: colorFor(span > 0 ? (value - min) / span : 0.5) }}
            title={value.toFixed(2)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500">
        <span>{min.toFixed(2)}</span>
        <span className="text-gray-500 dark:text-gray-400">med {median.toFixed(2)}</span>
        <span>{max.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-600">
        <span>Cleanest</span>
        <span>Most saturated</span>
      </div>
    </div>
  )
}

/**
 * Proportional strip of tone-type counts, ordered clean -> high gain.
 *
 * Segment width is share of the folder, so it reads as "how much of my library is clean vs
 * hi-gain" — the thing a bar list sorted by count can't show.
 */
function D1ToneGainStrip({
  counts, title, onToneClick, activeTone,
}: {
  counts: Map<string, number>
  title: string
  onToneClick?: (tone: string) => void
  activeTone?: string | null
}) {
  const ordered = TONE_GAIN_ORDER
    .map((tone) => ({ tone, count: counts.get(tone) ?? 0 }))
    .filter((row) => row.count > 0)
  const totalOrdered = ordered.reduce((sum, row) => sum + row.count, 0)
  const otherCount = counts.get('other') ?? 0

  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={EYEBROW}>{title}</span>
        {otherCount > 0 && (
          <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500">
            +{otherCount.toLocaleString()} other
          </span>
        )}
      </div>

      {totalOrdered === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-600">No tone types set</p>
      ) : (
        <>
          <div className="flex h-6 w-full overflow-hidden rounded-md">
            {ordered.map(({ tone, count }) => (
              <div
                key={tone}
                onClick={() => onToneClick?.(tone)}
                className={`h-full transition-opacity ${onToneClick ? 'cursor-pointer hover:opacity-80' : ''} ${
                  activeTone && activeTone !== tone ? 'opacity-40' : ''
                }`}
                style={{
                  width: `${(count / totalOrdered) * 100}%`,
                  backgroundColor: TONE_GAIN_COLORS[tone] ?? '#94a3b8',
                }}
                title={`${TONE_LABELS[tone] ?? tone}: ${count}`}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {ordered.map(({ tone, count }) => (
              <button
                key={tone}
                onClick={() => onToneClick?.(tone)}
                className={`flex items-center gap-1.5 text-[10px] transition-opacity ${
                  onToneClick ? 'cursor-pointer hover:opacity-70' : 'cursor-default'
                } ${activeTone && activeTone !== tone ? 'opacity-40' : ''}`}
              >
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: TONE_GAIN_COLORS[tone] ?? '#94a3b8' }}
                />
                <span className="text-gray-600 dark:text-gray-300">{TONE_LABELS[tone] ?? tone}</span>
                <span className="font-mono tabular-nums text-gray-400 dark:text-gray-500">{count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function FolderDashboard({
  files, checklistSummary, hasPackInfo, hasReadme, hasCoverImage, galleryCount = 0,
  watchSource, deliverySummary, activeDuplicate, activeGear, activeTone, activePreset,
  activeMissing, activeEsr, activeRating: _activeRating,
  onDuplicateClick, onGearClick, onToneClick, onPresetClick, onMissingClick, onEsrClick,
  onRatingClick: _onRatingClick, onRemoveWatch, onSyncWatch, onOpenWatchSource,
}: Props) {
  const stats = useMemo(() => {
    const total = files.length
    const missingCount = files.filter((f) =>
      CORE_FIELDS.some((field) => !f.metadata[field] && f.metadata[field] !== 0)
    ).length
    const totalSizeBytes = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0)
    const newestUpdateMs = files.reduce((max, file) => Math.max(max, file.mtimeMs ?? 0), 0)
    const recentThreshold = Date.now() - (7 * 24 * 60 * 60 * 1000)
    const recentUpdatedCount = files.filter((file) => (file.mtimeMs ?? 0) >= recentThreshold).length

    const duplicateNameCounts = new Map<string, number>()
    for (const f of files) {
      const key = f.fileName.trim().toLowerCase()
      if (!key) continue
      duplicateNameCounts.set(key, (duplicateNameCounts.get(key) ?? 0) + 1)
    }
    const dupCount = [...duplicateNameCounts.values()].filter((c) => c > 1).reduce((sum, c) => sum + c, 0)
    const dupGroups = [...duplicateNameCounts.values()].filter((c) => c > 1).length

    const presetCounts = new Map<string, number>()
    for (const f of files) {
      const p = detectPreset(f.config) ?? 'Unknown'
      presetCounts.set(p, (presetCounts.get(p) ?? 0) + 1)
    }
    const presets = [...presetCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)

    // getEsrBucketTone applies kind-aware thresholds (strict for A1/A2-Full, looser for a
    // genuine A2 aggregate) instead of one hardcoded band for every capture — see
    // dashboardMetrics.ts for the real bug this replaced (A2 could never be detected here at
    // all since architecture/config weren't passed through).
    let esrGood = 0, esrOk = 0, esrReview = 0, esrNone = 0
    for (const f of files) {
      const tone = getEsrBucketTone(f)
      if (tone === 'none') esrNone++
      else if (tone === 'green') esrGood++
      else if (tone === 'amber') esrOk++
      else esrReview++
    }

    const gearCounts = new Map<string, number>()
    for (const f of files) {
      const g = f.metadata.gear_type as string | undefined
      if (g) gearCounts.set(g, (gearCounts.get(g) ?? 0) + 1)
    }
    const gearRows = [...gearCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)

    const toneCounts = new Map<string, number>()
    for (const f of files) {
      const t = f.metadata.tone_type as string | undefined
      if (t) toneCounts.set(t, (toneCounts.get(t) ?? 0) + 1)
    }
    const toneRows = [...toneCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)

    // Raw gain values for the clean -> high-gain strip. `gain` is read-only metadata straight
    // from the .nam, and not every capture reports it, so filter to finite numbers only.
    const gainValues = files
      .map((f) => f.metadata.gain)
      .filter((g): g is number => typeof g === 'number' && Number.isFinite(g))

    const health = folderHealth(files, {
      packInfo: !!hasPackInfo,
      readme: !!hasReadme,
      cover: !!hasCoverImage,
      gallery: galleryCount,
    })

    const esrRuns = buildEsrRuns(files, 18)

    return {
      total, missingCount, totalSizeBytes, newestUpdateMs, recentUpdatedCount,
      dupCount, dupGroups, presets, esrGood, esrOk, esrReview, esrNone,
      gearRows, toneRows, health, esrRuns, gainValues, toneCounts,
    }
  }, [files, hasPackInfo, hasReadme, hasCoverImage, galleryCount])

  const esrCovered = stats.esrGood + stats.esrOk + stats.esrReview
  const esrTotal = esrCovered + stats.esrNone
  const esrPassPct = esrTotal > 0 ? Math.round(((stats.esrGood + stats.esrOk) / esrTotal) * 100) : null
  const esrMax = Math.max(stats.esrGood, stats.esrOk, stats.esrReview, stats.esrNone, 1)

  // ESR trend direction
  const esrRuns = stats.esrRuns
  const esrImproving = esrRuns.length >= 2 && esrRuns[esrRuns.length - 1] < esrRuns[0]

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-2.5">

      {/* 1. Hero row */}
      <div className="flex flex-row gap-2.5">
        {/* Left &mdash; health gauge */}
        <div style={{ flex: '0 0 47%' }}>
          <D1Health score={stats.health.score} parts={stats.health.parts} label="Pack Health" />
        </div>
        {/* Right &mdash; 2×2 stat cards */}
        <div className="flex-1 grid grid-cols-2 gap-2">
          <D1StatCard label="Captures" value={stats.total} sub="in this pack" />
          <div
            className={`${STAT_CARD} ${stats.dupCount > 0 && onDuplicateClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/60 transition-colors' : ''} ${activeDuplicate ? 'ring-1 ring-amber-400 dark:ring-amber-500/60' : ''}`}
            onClick={stats.dupCount > 0 && onDuplicateClick ? () => onDuplicateClick(!activeDuplicate) : undefined}
          >
            <span className={EYEBROW}>Duplicates</span>
            <span className={`text-2xl font-bold tabular-nums leading-none ${stats.dupCount === 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-500 dark:text-amber-400'}`}>
              {stats.dupCount.toLocaleString()}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {stats.dupCount === 0 ? 'no collisions' : `${stats.dupGroups} collision${stats.dupGroups !== 1 ? 's' : ''}`}
            </span>
          </div>
          <div
            className={`${STAT_CARD} ${onMissingClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/60 transition-colors' : ''} ${activeMissing ? 'ring-1 ring-amber-400 dark:ring-amber-500/60' : ''}`}
            onClick={onMissingClick ? () => onMissingClick(!activeMissing) : undefined}
          >
            <span className={EYEBROW}>Missing Metadata</span>
            <span className={`text-2xl font-bold tabular-nums leading-none ${stats.missingCount === 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-500 dark:text-amber-400'}`}>
              {stats.missingCount.toLocaleString()}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {stats.total > 0 ? `${Math.round(stats.missingCount / stats.total * 100)}% incomplete` : ''}
            </span>
          </div>
          <D1StatCard
            label="Total Size"
            value={formatBytes(stats.totalSizeBytes)}
            sub={stats.total > 0 ? `${formatBytes(stats.totalSizeBytes / stats.total)} avg / capture` : undefined}
          />
        </div>
      </div>

      {/* 2. Readiness / Watch / Activity */}
      <div className="grid grid-cols-3 gap-2.5">
        {/* Pack Readiness */}
        <div className={`${CARD} flex flex-col gap-2.5`}>
          <span className={EYEBROW}>Pack Readiness</span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: 'Pack Info', ok: !!hasPackInfo },
              { label: 'Read Me', ok: !!hasReadme },
              { label: 'Cover', ok: !!hasCoverImage },
              { label: galleryCount > 0 ? `Gallery \u00b7 ${galleryCount} image${galleryCount !== 1 ? 's' : ''}` : 'Gallery', ok: galleryCount > 0 },
            ].map((item) => (
              <span
                key={item.label}
                className={`text-[10px] px-2 py-0.5 rounded-full ${item.ok ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400'}`}
              >
                {item.label} {item.ok ? 'ready' : 'missing'}
              </span>
            ))}
          </div>
        </div>

        {/* Folder Watch */}
        <div className={`${CARD} flex flex-col gap-2`}>
          <div className="flex items-center justify-between gap-2">
            <span className={EYEBROW}>Folder Watch</span>
            {watchSource && (
              <div className="flex items-center gap-1">
                {onSyncWatch && (
                  <button onClick={onSyncWatch} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    Sync Now
                  </button>
                )}
                {onRemoveWatch && (
                  <button onClick={onRemoveWatch} className="text-[10px] px-1.5 py-0.5 rounded border border-red-400/60 dark:border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          {watchSource ? (
            <div className="space-y-1">
              <button
                onClick={() => onOpenWatchSource?.(watchSource)}
                className="w-full text-left rounded bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-2 py-1.5 text-[10px] font-mono text-gray-600 dark:text-gray-300 break-all hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors truncate"
                title={watchSource}
              >
                {watchSource}
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-gray-500 dark:text-gray-400">No watch source configured.</span>
          )}
        </div>

        {/* Recent Activity */}
        <div className={`${CARD} flex flex-col gap-2.5`}>
          <span className={EYEBROW}>Recent Activity</span>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-gray-600 dark:text-gray-300">Updated in last 7 days</span>
              <span className="font-mono tabular-nums text-[11.5px] text-gray-900 dark:text-gray-100">{stats.recentUpdatedCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-gray-600 dark:text-gray-300">Latest file update</span>
              <span className="font-mono text-[11.5px] text-gray-900 dark:text-gray-100">{formatDateTime(stats.newestUpdateMs) ?? 'Unknown'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Formats | ESR Quality */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Formats */}
        <D1BarList
          title="Formats"
          rows={stats.presets.map((p) => ({
            key: p.key,
            label: p.key,
            count: p.count,
            color: PRESET_COLORS[p.key] ?? '#6b7280',
          }))}
          onRowClick={onPresetClick ? (k) => onPresetClick(activePreset === k ? null : k) : undefined}
          activeKey={activePreset}
        />

        {/* ESR Quality */}
        <div className={`${CARD} flex flex-col gap-3`}>
          <div className="flex items-baseline justify-between">
            <span className={EYEBROW}>ESR Quality</span>
            {esrPassPct !== null && esrCovered > 0 && (
              <span className="font-mono text-[10px]" style={{ color: '#34d399' }}>{esrPassPct}% pass</span>
            )}
          </div>
          {esrCovered === 0 && stats.esrNone === stats.total ? (
            <p className="text-[11px] text-gray-400 dark:text-gray-600">No ESR data</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {stats.esrGood > 0 && (
                <div
                  className={`flex items-center gap-2 rounded px-1 py-0.5 ${onEsrClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60' : ''} ${activeEsr === 'good' ? 'bg-gray-100 dark:bg-gray-800/60' : ''} transition-colors`}
                  onClick={() => onEsrClick?.(activeEsr === 'good' ? null : 'good')}
                >
                  <span className="text-[11px] font-semibold w-28 flex-shrink-0 truncate" style={{ color: '#22c55e' }}>Excellent <span className="font-normal opacity-70">&lt;0.01</span></span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round((stats.esrGood / esrMax) * 100))}%`, backgroundColor: '#22c55e' }} />
                  </div>
                  <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">{stats.esrGood}</span>
                </div>
              )}
              {stats.esrOk > 0 && (
                <div
                  className={`flex items-center gap-2 rounded px-1 py-0.5 ${onEsrClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60' : ''} ${activeEsr === 'ok' ? 'bg-gray-100 dark:bg-gray-800/60' : ''} transition-colors`}
                  onClick={() => onEsrClick?.(activeEsr === 'ok' ? null : 'ok')}
                >
                  <span className="text-[11px] font-semibold w-28 flex-shrink-0 truncate" style={{ color: '#f59e0b' }}>OK <span className="font-normal opacity-70">0.01&ndash;0.05</span></span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round((stats.esrOk / esrMax) * 100))}%`, backgroundColor: '#f59e0b' }} />
                  </div>
                  <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">{stats.esrOk}</span>
                </div>
              )}
              {stats.esrReview > 0 && (
                <div
                  className={`flex items-center gap-2 rounded px-1 py-0.5 ${onEsrClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60' : ''} ${activeEsr === 'review' ? 'bg-gray-100 dark:bg-gray-800/60' : ''} transition-colors`}
                  onClick={() => onEsrClick?.(activeEsr === 'review' ? null : 'review')}
                >
                  <span className="text-[11px] font-semibold w-28 flex-shrink-0 truncate" style={{ color: '#ef4444' }}>Review <span className="font-normal opacity-70">&gt;0.05</span></span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round((stats.esrReview / esrMax) * 100))}%`, backgroundColor: '#ef4444' }} />
                  </div>
                  <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">{stats.esrReview}</span>
                </div>
              )}
              {stats.esrNone > 0 && (
                <div className="flex items-center gap-2 rounded px-1 py-0.5">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 w-28 flex-shrink-0 truncate">No data</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round((stats.esrNone / esrMax) * 100))}%`, backgroundColor: '#4b5563' }} />
                  </div>
                  <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">{stats.esrNone}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4. Gear | Tone */}
      <div className="grid grid-cols-2 gap-2.5">
        <D1BarList
          title="Gear Type"
          rows={stats.gearRows.map(({ key, count }) => ({
            key,
            label: GEAR_LABELS[key] ?? key,
            count,
            color: GEAR_COLORS[key] ?? '#6b7280',
          }))}
          onRowClick={onGearClick ? (k) => onGearClick(activeGear === k ? null : k) : undefined}
          activeKey={activeGear}
        />
        <D1BarList
          title="Tone Type"
          rows={stats.toneRows.map(({ key, count }) => ({
            key,
            label: TONE_LABELS[key] ?? key,
            count,
            color: TONE_COLORS[key] ?? '#6b7280',
          }))}
          onRowClick={onToneClick ? (k) => onToneClick(activeTone === k ? null : k) : undefined}
          activeKey={activeTone}
        />
      </div>

      {/* 4b. Gain coverage strips — clean to high gain */}
      <div className="grid grid-cols-2 gap-2.5">
        <D1GainStrip title="Saturation Range" values={stats.gainValues} />
        <D1ToneGainStrip
          title="Tone Spread"
          counts={stats.toneCounts}
          onToneClick={onToneClick ? (t) => onToneClick(activeTone === t ? null : t) : undefined}
          activeTone={activeTone}
        />
      </div>

      {/* 5. Training Quality Trend | Delivery Targets */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* ESR Trend */}
        <div className={`${CARD} flex flex-col gap-2.5`}>
          <div className="flex items-baseline justify-between">
            <div>
              <span className={EYEBROW}>Training Quality Trend</span>
              <span className="block text-[9.5px] text-gray-400 dark:text-gray-500 mt-0.5">avg ESR &middot; lower is better</span>
            </div>
            {esrRuns.length >= 2 && (
              <span className="font-mono text-[10px]" style={{ color: esrImproving ? '#34d399' : '#f87171' }}>
                {esrImproving ? '▼ improving' : '▲ degrading'}
              </span>
            )}
          </div>
          {esrRuns.length >= 2 ? (
            <>
              <TrendLine data={esrRuns} color="#22c55e" height={104} invert />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9.5px] text-gray-400 dark:text-gray-500">
                  oldest &middot; {esrRuns[0].toFixed(4)}
                </span>
                <span className="font-mono text-[9.5px]" style={{ color: '#34d399' }}>
                  latest &middot; {esrRuns[esrRuns.length - 1].toFixed(4)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-400 dark:text-gray-600">Not enough ESR data</p>
          )}
        </div>

        {/* Delivery Targets */}
        {deliverySummary ? (
          <div className={`${CARD} flex flex-col gap-3`}>
            <div className="flex items-start justify-between">
              <div>
                <span className={EYEBROW}>Delivery Targets</span>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {deliverySummary.totalRows} matrix row{deliverySummary.totalRows !== 1 ? 's' : ''} stored
                </p>
              </div>
              {deliverySummary.lastImportedAt && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 text-right">
                  {new Date(deliverySummary.lastImportedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['ToneX', deliverySummary.tonexIncluded],
                ['NAM', deliverySummary.namIncluded],
                ['Proxy', deliverySummary.proxyIncluded],
                ['QC', deliverySummary.qcIncluded],
              ].map(([label, count]) => (
                <div key={String(label)} className="bg-gray-100 dark:bg-gray-800/60 rounded-xl px-3 py-2.5 flex flex-col gap-0.5">
                  <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">{count}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{label} included</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={`${CARD} flex flex-col gap-2`}>
            <span className={EYEBROW}>Delivery Targets</span>
            <p className="text-[11px] text-gray-400 dark:text-gray-600">No delivery data imported.</p>
          </div>
        )}
      </div>

      {/* 6. Checklist Progress */}
      {checklistSummary && checklistSummary.total > 0 && (
        <div className={`${CARD} flex flex-col gap-3`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className={EYEBROW}>Checklist Progress</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                {checklistSummary.completed} of {checklistSummary.total} steps complete
              </span>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">{checklistSummary.percent}%</div>
              <div className="text-[10px] mt-0.5" style={{ color: checklistSummary.liveDate ? '#34d399' : undefined }}>
                {checklistSummary.liveDate
                  ? 'Released'
                  : checklistSummary.isOverdue ? 'Overdue'
                  : checklistSummary.targetDate ? 'Scheduled'
                  : 'No target'}
              </div>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${checklistSummary.percent}%`, backgroundColor: '#14b8a6' }} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {checklistSummary.targetDate && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
                Target {checklistSummary.targetDate}
              </span>
            )}
            {checklistSummary.liveDate && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
                Live {checklistSummary.liveDate}
              </span>
            )}
            {checklistSummary.releasedOnTime && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">Released on time</span>
            )}
            {checklistSummary.releasedLate && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Released late</span>
            )}
            {checklistSummary.isOverdue && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Target date passed</span>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

// Suppress unused import — kept for icons in gear type
void getGearImageSrc

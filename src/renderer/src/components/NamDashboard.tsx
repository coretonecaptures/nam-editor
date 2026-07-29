import { useMemo } from 'react'
import type { NamFile } from '../types/nam'
import { Gauge, Donut, Sparkline, AreaChart, StackedMeter } from './dashboard/Charts'
import { libraryHealth, buildGrowthSeries, topMakes } from './dashboard/dashboardMetrics'

// ── Design tokens ───────────────────────────────────────────────────────────
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
  clean: 'Clean', crunch: 'Crunch', hi_gain: 'Hi-Gain',
  fuzz: 'Fuzz', overdrive: 'Overdrive', distortion: 'Distortion', other: 'Other',
}

const COMPLETENESS_FIELDS: (keyof NamFile['metadata'])[] = [
  'name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu',
]

// ── Props ───────────────────────────────────────────────────────────────────
interface Props {
  files: NamFile[]
  packChecklistRollup?: Array<{
    folderLabel: string
    status: string
    progressLabel: string
    percent: number
  }>
  activeCreator?: string
  onCreatorClick: (creator: string) => void
  onClearCreatorFilter?: () => void
  onGearTypeClick: (gearType: string) => void
  onToneTypeClick: (toneType: string) => void
  onCompleteClick?: () => void
  onIncompleteClick?: () => void
  onRecentFileClick?: (filePath: string) => void
  activeRating?: number | null
  onRatingClick?: (rating: number | null) => void
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const EYEBROW = 'text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400 dark:text-gray-500'
const CARD = 'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3.5'
const STAT_CARD = 'bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3.5 flex flex-col gap-1'

function gaugeColor(score: number): string {
  return score >= 85 ? '#22c55e' : score >= 70 ? '#14b8a6' : score >= 50 ? '#f59e0b' : '#ef4444'
}

function formatDate(ms: number | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString()
}

function countBy<K extends string>(
  items: NamFile[],
  key: (f: NamFile) => K | null | undefined
): Array<{ key: K; count: number }> {
  const map = new Map<K, number>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count)
}

// ── Sub-components ──────────────────────────────────────────────────────────

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
          <span className={EYEBROW}>{label ?? 'Library Health'}</span>
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

function D1StatCard({
  label, value, sub, spark, sparkColor, onClick,
}: {
  label: string
  value: string | number
  sub?: string
  spark?: number[]
  sparkColor?: string
  onClick?: () => void
}) {
  return (
    <div
      className={`${STAT_CARD} ${onClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/60 transition-colors' : ''}`}
      onClick={onClick}
    >
      <span className={EYEBROW}>{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {spark && spark.length > 1 && (
          <Sparkline data={spark} color={sparkColor ?? '#14b8a6'} width={68} height={26} />
        )}
      </div>
      {sub && <span className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</span>}
    </div>
  )
}

function D1MixPanel({
  title, rows, total, labelFn, colorFn, onRowClick,
}: {
  title: string
  rows: Array<{ key: string; count: number }>
  total: number
  labelFn: (k: string) => string
  colorFn: (k: string) => string
  onRowClick?: (key: string) => void
}) {
  const segs = rows.map((r) => ({ value: r.count, color: colorFn(r.key), label: labelFn(r.key) }))
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <span className={EYEBROW}>
        {title}
        <span className="normal-case font-normal ml-1 text-gray-300 dark:text-gray-600"> (click to filter)</span>
      </span>
      <div className="flex flex-row gap-4 items-center">
        <div className="flex-shrink-0">
          <Donut segments={segs} size={108} thickness={15}>
            <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">{total.toLocaleString()}</span>
            <span className="font-mono text-[8.5px] tracking-[0.1em] uppercase text-gray-400 dark:text-gray-500 mt-0.5">total</span>
          </Donut>
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {rows.map((r) => {
            const pct = total > 0 ? Math.round((r.count / total) * 100) : 0
            return (
              <button
                key={r.key}
                className="flex items-center gap-2 text-left rounded hover:bg-gray-100 dark:hover:bg-gray-800/60 px-0.5 py-0.5 transition-colors w-full"
                onClick={() => onRowClick?.(r.key)}
              >
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: colorFn(r.key) }} />
                <span className="text-[11.5px] text-gray-700 dark:text-gray-300 flex-1 truncate">{labelFn(r.key)}</span>
                <span className="font-mono tabular-nums text-[11px] text-gray-900 dark:text-gray-100 flex-shrink-0">{r.count.toLocaleString()}</span>
                <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-8 text-right flex-shrink-0">{pct}%</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function D1BarList({
  title, rows, trackColor, fillColor,
}: {
  title: string
  rows: Array<{ label: string; count: number; color?: string }>
  trackColor?: string
  fillColor?: string
}) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <span className={EYEBROW}>{title}</span>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-600">No data</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600 dark:text-gray-300 w-32 truncate flex-shrink-0" title={row.label}>{row.label}</span>
              <div className={`flex-1 h-2 rounded-full overflow-hidden ${trackColor ?? 'bg-gray-200 dark:bg-gray-800'}`}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(2, Math.round((row.count / max) * 100))}%`,
                    backgroundColor: row.color ?? fillColor ?? '#14b8a6',
                  }}
                />
              </div>
              <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-8 text-right flex-shrink-0">{row.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function D1RecentList({
  title, items,
}: {
  title: string
  items: Array<{ filePath: string; name: string; date: string }>
  onItemClick?: (filePath: string) => void
}) {
  return (
    <div className={`${CARD} flex flex-col gap-2`}>
      <span className={EYEBROW}>{title}</span>
      <div className="flex flex-col gap-0.5">
        {items.map((f) => (
          <div key={f.filePath} className="flex flex-col px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors">
            <span className="text-[11.5px] text-gray-700 dark:text-gray-300 truncate">{f.name}</span>
            <span className="font-mono text-[9.5px] text-gray-400 dark:text-gray-500">{f.date}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export function NamDashboard({
  files,
  packChecklistRollup,
  activeCreator,
  onCreatorClick: _onCreatorClick,
  onClearCreatorFilter,
  onGearTypeClick,
  onToneTypeClick,
  onCompleteClick,
  onIncompleteClick,
  onRecentFileClick,
  activeRating: _activeRating,
  onRatingClick: _onRatingClick,
}: Props) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-center px-8">
        <svg className="w-10 h-10 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-gray-500">Open a folder to see your library overview</p>
      </div>
    )
  }

  const metrics = useMemo(() => {
    const health = libraryHealth(files)

    let complete = 0, partial = 0, incomplete = 0
    for (const f of files) {
      const missing = COMPLETENESS_FIELDS.filter((k) => f.metadata[k] == null || f.metadata[k] === '').length
      if (missing === 0) complete++
      else if (missing === 1) partial++
      else incomplete++
    }

    const dirtyCount = files.filter((f) => f.isDirty).length

    const gearCounts = countBy(files, (f) => (f.metadata.gear_type as string | null | undefined) ?? null)
    const toneCounts = countBy(files, (f) => (f.metadata.tone_type as string | null | undefined) ?? null)

    const growthSeries = buildGrowthSeries(files, 14)
    const cumulative = growthSeries.reduce<number[]>((acc, g) => {
      acc.push((acc[acc.length - 1] ?? 0) + g.add)
      return acc
    }, [])

    // Growth delta: last 6 mo vs prior 6 mo
    const last6 = growthSeries.slice(-6).reduce((s, g) => s + g.add, 0)
    const prior6 = growthSeries.slice(-12, -6).reduce((s, g) => s + g.add, 0)
    const growthDelta = prior6 > 0 ? Math.round(((last6 - prior6) / prior6) * 100) : null

    const makes = topMakes(files, 8)

    const recentlyAdded = [...files]
      .filter((f) => f.birthtimeMs)
      .sort((a, b) => (b.birthtimeMs ?? 0) - (a.birthtimeMs ?? 0))
      .slice(0, 7)
      .map((f) => ({ filePath: f.filePath, name: f.metadata.name || f.fileName, date: formatDate(f.birthtimeMs) }))

    const recentlyUpdated = [...files]
      .filter((f) => f.mtimeMs)
      .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
      .slice(0, 7)
      .map((f) => ({ filePath: f.filePath, name: f.metadata.name || f.fileName, date: formatDate(f.mtimeMs) }))

    return {
      health, complete, partial, incomplete, dirtyCount,
      gearCounts, toneCounts, growthSeries, cumulative, growthDelta, makes,
      recentlyAdded, recentlyUpdated,
    }
  }, [files])

  const {
    health, complete, partial, incomplete, dirtyCount,
    gearCounts, toneCounts, growthSeries, cumulative, growthDelta, makes,
    recentlyAdded, recentlyUpdated,
  } = metrics

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex-1">Library Overview</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">{files.length.toLocaleString()} captures</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
        {/* Active creator filter chip */}
        {activeCreator && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700/50 rounded-lg flex-shrink-0">
            <span className="text-[10px] text-teal-700 dark:text-teal-300 flex-1 truncate">Filtering by: <strong>{activeCreator}</strong></span>
            {onClearCreatorFilter && (
              <button
                onClick={onClearCreatorFilter}
                className="text-teal-500 hover:text-teal-700 dark:text-teal-400 dark:hover:text-white transition-colors flex-shrink-0"
                title="Clear creator filter"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* 1. Hero row */}
        <div className="flex flex-row gap-2.5">
          {/* Left &mdash; health gauge */}
          <div style={{ flex: '0 0 47%' }}>
            <D1Health score={health.score} parts={health.parts} label="Library Health" />
          </div>
          {/* Right &mdash; 2×2 stat cards */}
          <div className="flex-1 grid grid-cols-2 gap-2">
            <D1StatCard
              label="Total Captures"
              value={files.length}
              sub={`+${growthSeries[growthSeries.length - 1]?.add ?? 0} this month`}
              spark={cumulative}
              sparkColor="#14b8a6"
            />
            <D1StatCard
              label="Complete"
              value={complete}
              sub={`${Math.round((complete / files.length) * 100)}% of library`}
              onClick={onCompleteClick}
            />
            <D1StatCard
              label="Incomplete"
              value={partial + incomplete}
              sub={`${partial} partial \u00b7 ${incomplete} missing 2+`}
              onClick={onIncompleteClick}
            />
            <D1StatCard
              label="Unsaved Changes"
              value={dirtyCount}
              sub="pending write to disk"
            />
          </div>
        </div>

        {/* 2. Gear / Tone mix */}
        {(gearCounts.length > 0 || toneCounts.length > 0) && (
          <div className="grid grid-cols-2 gap-2.5">
            {gearCounts.length > 0 && (
              <D1MixPanel
                title="Gear Type"
                rows={gearCounts}
                total={gearCounts.reduce((s, r) => s + r.count, 0)}
                labelFn={(k) => GEAR_LABELS[k] ?? k}
                colorFn={(k) => GEAR_COLORS[k] ?? '#6b7280'}
                onRowClick={onGearTypeClick}
              />
            )}
            {toneCounts.length > 0 && (
              <D1MixPanel
                title="Tone Type"
                rows={toneCounts}
                total={toneCounts.reduce((s, r) => s + r.count, 0)}
                labelFn={(k) => TONE_LABELS[k] ?? k}
                colorFn={(k) => TONE_COLORS[k] ?? '#6b7280'}
                onRowClick={onToneTypeClick}
              />
            )}
          </div>
        )}

        {/* 3. Library Growth */}
        <div className={`${CARD} flex flex-col gap-2.5`}>
          <div className="flex items-baseline justify-between">
            <span className={EYEBROW}>
              Library Growth
              <span className="normal-case font-normal ml-1 text-gray-300 dark:text-gray-600"> captures added / month</span>
            </span>
            {growthDelta !== null && (
              <span className="font-mono text-[11px]" style={{ color: growthDelta >= 0 ? '#34d399' : '#f87171' }}>
                {growthDelta >= 0 ? '▲' : '▼'} {Math.abs(growthDelta)}% vs prior 6 mo
              </span>
            )}
          </div>
          <AreaChart
            data={growthSeries.map((g) => g.add)}
            labels={growthSeries.map((g) => g.m)}
            color="#14b8a6"
            height={120}
          />
        </div>

        {/* 4. Completeness | Top Gear Makes */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className={`${CARD} flex flex-col gap-3`}>
            <span className={EYEBROW}>
              Metadata Completeness
              <span className="normal-case font-normal ml-1 text-gray-300 dark:text-gray-600"> 7 fields</span>
            </span>
            <StackedMeter
              segments={[
                { value: complete, color: '#22c55e', label: 'Complete' },
                { value: partial, color: '#f59e0b', label: '1 missing' },
                { value: incomplete, color: '#ef4444', label: '2+ missing' },
              ]}
              height={12}
            />
            <div className="flex flex-col gap-1.5">
              {[
                { color: '#22c55e', label: 'Complete', count: complete },
                { color: '#f59e0b', label: '1 missing', count: partial },
                { color: '#ef4444', label: '2+ missing', count: incomplete },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-1">{item.label}</span>
                  <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">{item.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <D1BarList
            title="Top Gear Makes"
            rows={makes.map((m) => ({ label: m.name, count: m.count }))}
            fillColor="#14b8a6"
          />
        </div>

        {/* 5. Recently Added | Recently Updated */}
        {(recentlyAdded.length > 0 || recentlyUpdated.length > 0) && (
          <div className="grid grid-cols-2 gap-2.5">
            {recentlyAdded.length > 0 && (
              <div className={`${CARD} flex flex-col gap-2`}>
                <span className={EYEBROW}>Recently Added</span>
                <div className="flex flex-col gap-0.5">
                  {recentlyAdded.map((f) => (
                    <button
                      key={f.filePath}
                      className="text-left flex flex-col px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors"
                      onClick={() => onRecentFileClick?.(f.filePath)}
                      title={f.filePath}
                    >
                      <span className="text-[11.5px] text-gray-700 dark:text-gray-300 truncate">{f.name}</span>
                      <span className="font-mono text-[9.5px] text-gray-400 dark:text-gray-500">{f.date}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {recentlyUpdated.length > 0 && (
              <div className={`${CARD} flex flex-col gap-2`}>
                <span className={EYEBROW}>Recently Updated</span>
                <div className="flex flex-col gap-0.5">
                  {recentlyUpdated.map((f) => (
                    <button
                      key={f.filePath}
                      className="text-left flex flex-col px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors"
                      onClick={() => onRecentFileClick?.(f.filePath)}
                      title={f.filePath}
                    >
                      <span className="text-[11.5px] text-gray-700 dark:text-gray-300 truncate">{f.name}</span>
                      <span className="font-mono text-[9.5px] text-gray-400 dark:text-gray-500">{f.date}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 6. Active Pack Checklists */}
        {packChecklistRollup && packChecklistRollup.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className={EYEBROW}>Active Pack Checklists</h3>
            <div className="flex flex-col gap-2">
              {packChecklistRollup.map((entry) => {
                const released = entry.status.startsWith('Released')
                return (
                  <div key={entry.folderLabel} className="bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] text-gray-700 dark:text-gray-300 truncate">{entry.folderLabel}</span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: released ? '#34d399' : undefined }} >{entry.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${entry.percent}%`, backgroundColor: released ? '#22c55e' : '#14b8a6' }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 text-right">{entry.progressLabel}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Suppress unused import warning — D1RecentList kept as named for reuse
void D1RecentList

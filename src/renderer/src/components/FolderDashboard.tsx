import { useMemo } from 'react'
import type { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import { getGearImageSrc } from '../assets/gear'

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
  onOpenWatchSource?: (path: string) => void
}

const CORE_FIELDS = [
  'name', 'modeled_by', 'gear_make', 'gear_model',
  'gear_type', 'tone_type', 'input_level_dbu',
] as const

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

function getEsr(file: NamFile): number | null {
  const esr = (file.metadata.training as Record<string, unknown> | undefined)?.validation_esr
  return typeof esr === 'number' ? esr : null
}

function StatBox({ value, label, sub }: { value: number | string; label: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/40 px-3 py-2.5 text-center">
      <div className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{value}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">{label}</div>
      {sub && <div className="text-[9px] text-gray-400 dark:text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function BudgetRow({
  icon, label, count, maxCount, color, isActive, onClick,
}: {
  icon?: React.ReactNode
  label: string
  count: number
  maxCount: number
  color: string
  isActive?: boolean
  onClick?: () => void
}) {
  const pct = maxCount > 0 ? count / maxCount : 0
  return (
    <div
      className={`flex items-center gap-2 min-h-[26px] rounded-md transition-colors ${onClick ? 'cursor-pointer' : ''} ${isActive ? 'ring-1 ring-inset' : 'hover:bg-gray-100/70 dark:hover:bg-white/5'}`}
      style={isActive ? { outline: `1px solid ${color}55`, outlineOffset: '-1px' } : undefined}
      onClick={onClick}
    >
      <div className="w-5 flex-shrink-0 flex items-center justify-center">
        {icon ?? <span style={{ color }} className="text-[9px] leading-none">●</span>}
      </div>
      <div className="flex-1 relative rounded overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded transition-all"
          style={{ width: `${Math.max(pct * 100, 6)}%`, backgroundColor: isActive ? color + '55' : color + '2e' }}
        />
        <span
          className="relative block px-2 py-0.5 text-[11px] font-semibold truncate"
          style={{ color, opacity: isActive ? 1 : 0.85 }}
        >
          {label}
        </span>
      </div>
      <span className="text-[11px] text-gray-500 w-7 text-right flex-shrink-0 tabular-nums">{count}</span>
    </div>
  )
}

function MiniBar({ label, count, maxCount, color, isActive, onClick }: { label: string; count: number; maxCount: number; color: string; isActive?: boolean; onClick?: () => void }) {
  const pct = maxCount > 0 ? count / maxCount : 0
  return (
    <div
      className={`flex items-center gap-2 min-h-[22px] rounded px-1 transition-colors ${onClick ? 'cursor-pointer' : ''} ${isActive ? 'bg-gray-100 dark:bg-white/[0.08]' : 'hover:bg-gray-100/70 dark:hover:bg-white/5'}`}
      onClick={onClick}
    >
      <span className="text-[10px] w-16 text-right flex-shrink-0 truncate font-medium text-gray-600 dark:text-gray-400" style={{ color: isActive ? color : undefined, opacity: isActive ? 1 : 0.8 }}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700/50 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct * 100, 2)}%`, backgroundColor: color, opacity: isActive ? 1 : 0.7 }} />
      </div>
      <span className="text-[10px] text-gray-500 w-5 text-right flex-shrink-0 tabular-nums">{count}</span>
    </div>
  )
}

export function FolderDashboard({
  files, checklistSummary, hasPackInfo, hasReadme, hasCoverImage, galleryCount = 0, watchSource, deliverySummary, activeDuplicate, activeGear, activeTone, activePreset, activeMissing, activeEsr, activeRating,
  onDuplicateClick, onGearClick, onToneClick, onPresetClick, onMissingClick, onEsrClick, onRatingClick, onRemoveWatch, onOpenWatchSource,
}: Props) {
  const stats = useMemo(() => {
    const total = files.length
    const missing = files.filter((f) =>
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
    const duplicateGroups = [...duplicateNameCounts.values()].filter((c) => c > 1).length
    const duplicateFiles = [...duplicateNameCounts.entries()]
      .filter(([, c]) => c > 1)
      .reduce((sum, [, c]) => sum + c, 0)

    const presetCounts = new Map<string, number>()
    for (const f of files) {
      const p = detectPreset(f.config) ?? 'Unknown'
      presetCounts.set(p, (presetCounts.get(p) ?? 0) + 1)
    }
    const presets = [...presetCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
    const maxPreset = Math.max(...presets.map((r) => r.count), 1)

    let esrGood = 0, esrOk = 0, esrReview = 0, esrNone = 0
    for (const f of files) {
      const esr = getEsr(f)
      if (esr == null) esrNone++
      else if (esr < 0.01) esrGood++
      else if (esr <= 0.05) esrOk++
      else esrReview++
    }

    const gearCounts = new Map<string, number>()
    for (const f of files) {
      const g = f.metadata.gear_type
      if (g) gearCounts.set(g, (gearCounts.get(g) ?? 0) + 1)
    }
    const gearRows = [...gearCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
    const maxGear = Math.max(...gearRows.map((r) => r.count), 1)

    const toneCounts = new Map<string, number>()
    for (const f of files) {
      const t = f.metadata.tone_type
      if (t) toneCounts.set(t, (toneCounts.get(t) ?? 0) + 1)
    }
    const toneRows = [...toneCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
    const maxTone = Math.max(...toneRows.map((r) => r.count), 1)

    const ratingCounts = new Map<number, number>()
    let unratedCount = 0
    for (const f of files) {
      const r = f.metadata.nl_rating ?? 0
      if (r > 0) ratingCounts.set(r, (ratingCounts.get(r) ?? 0) + 1)
      else unratedCount++
    }
    const ratingRows = [...ratingCounts.entries()]
      .map(([rating, count]) => ({ rating, count }))
      .sort((a, b) => b.rating - a.rating)
    const maxRating = Math.max(...ratingRows.map((r) => r.count), unratedCount, 1)

    return {
      total, missing, totalSizeBytes, newestUpdateMs, recentUpdatedCount, duplicateGroups, duplicateFiles,
      presets, maxPreset, esrGood, esrOk, esrReview, esrNone, gearRows, maxGear, toneRows, maxTone, ratingRows, unratedCount, maxRating
    }
  }, [files])

  const esrCovered = stats.esrGood + stats.esrOk + stats.esrReview
  const esrMaxCount = Math.max(stats.esrGood, stats.esrOk, stats.esrReview, stats.esrNone, 1)

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">

      {/* Stat boxes */}
      <div className="flex gap-3">
        <StatBox value={stats.total} label="captures" />
        <div
          className={`flex-1 rounded-xl border px-3 py-2.5 text-center transition-colors ${stats.duplicateFiles > 0 && onDuplicateClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/40' : ''} ${activeDuplicate ? 'bg-gray-200/80 dark:bg-gray-700/60 border-gray-400/60 dark:border-gray-500/60' : 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/40'}`}
          onClick={stats.duplicateFiles > 0 && onDuplicateClick ? () => onDuplicateClick(!activeDuplicate) : undefined}
        >
          <div className={`text-2xl font-bold leading-none ${stats.duplicateFiles === 0 ? 'text-green-600 dark:text-green-400' : activeDuplicate ? 'text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-400'}`}>{stats.duplicateFiles}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">duplicates</div>
          <div className="text-[9px] text-gray-400 dark:text-gray-600 mt-0.5">{stats.duplicateFiles === 0 ? 'no collisions' : `${stats.duplicateGroups} duplicate group${stats.duplicateGroups === 1 ? '' : 's'}`}</div>
        </div>
        {stats.missing > 0 && (
          <div
            className={`flex-1 rounded-xl border px-3 py-2.5 text-center transition-colors ${onMissingClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/40' : ''} ${activeMissing ? 'bg-gray-200/80 dark:bg-gray-700/60 border-gray-400/60 dark:border-gray-500/60' : 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/40'}`}
            onClick={onMissingClick ? () => onMissingClick(!activeMissing) : undefined}
          >
            <div className={`text-2xl font-bold leading-none ${activeMissing ? 'text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-400'}`}>{stats.missing}</div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">missing metadata</div>
            <div className="text-[9px] text-gray-400 dark:text-gray-600 mt-0.5">{`${Math.round(stats.missing / stats.total * 100)}% incomplete`}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Pack Readiness</h3>
          <div className="flex flex-wrap gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${hasPackInfo ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300'}`}>Pack Info {hasPackInfo ? 'ready' : 'missing'}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${hasReadme ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300'}`}>Read Me {hasReadme ? 'ready' : 'missing'}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${hasCoverImage ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300'}`}>Cover {hasCoverImage ? 'ready' : 'missing'}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${galleryCount > 0 ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300'}`}>Gallery {galleryCount > 0 ? `${galleryCount} image${galleryCount === 1 ? '' : 's'}` : 'empty'}</span>
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Folder Watch</h3>
            {watchSource && onRemoveWatch && (
              <button
                onClick={onRemoveWatch}
                className="text-[10px] px-2 py-0.5 rounded border border-red-400/60 dark:border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                title="Remove watch source from this folder"
              >
                Remove Watch
              </button>
            )}
          </div>
          {watchSource ? (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-gray-500 dark:text-gray-400">This folder watches:</div>
              <button
                onClick={() => onOpenWatchSource?.(watchSource)}
                className="w-full text-left rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700/50 px-2.5 py-2 text-gray-700 dark:text-gray-200 break-all hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:bg-indigo-50/50 dark:hover:bg-gray-900/70 transition-colors"
                title="Open watch source in Explorer/Finder"
              >
                {watchSource}
              </button>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">
                New top-level <code>.nam</code> files copied from that source will appear here automatically.
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-gray-500 dark:text-gray-400">No watch source configured for this folder.</div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">
                Right-click this folder in the tree and choose <span className="text-gray-600 dark:text-gray-400">Set watch source...</span> to pull new training files in automatically.
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Size</h3>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Total pack size</span>
              <span className="text-gray-800 dark:text-gray-200 font-medium">{formatBytes(stats.totalSizeBytes)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Average per capture</span>
              <span className="text-gray-800 dark:text-gray-200 font-medium">{formatBytes(stats.total > 0 ? stats.totalSizeBytes / stats.total : 0)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent Updates</h3>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Updated in last 7 days</span>
              <span className="text-gray-800 dark:text-gray-200 font-medium">{stats.recentUpdatedCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Latest file update</span>
              <span className="text-gray-800 dark:text-gray-200 font-medium">{formatDateTime(stats.newestUpdateMs) ?? 'Unknown'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Formats + ESR row */}
      <div className="flex gap-3">
        {/* Preset formats */}
        <div className="flex-1 rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Formats</h3>
          {stats.presets.length === 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-gray-600">No preset data</p>
          ) : (
            <div className="flex flex-col gap-1">
              {stats.presets.map(({ key, count }) => (
                <MiniBar
                  key={key}
                  label={key}
                  count={count}
                  maxCount={stats.maxPreset}
                  color={PRESET_COLORS[key] ?? '#6b7280'}
                  isActive={activePreset === key}
                  onClick={onPresetClick ? () => onPresetClick(activePreset === key ? null : key) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* ESR quality */}
        <div className="flex-1 rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">ESR Quality</h3>
          <div className="flex flex-col gap-1">
            {esrCovered === 0 && stats.esrNone === stats.total ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-600">No ESR data</p>
            ) : (
              <>
                {stats.esrGood > 0 && (
                  <BudgetRow label="Excellent  < 0.01" count={stats.esrGood} maxCount={esrMaxCount} color="#22c55e"
                    isActive={activeEsr === 'good'}
                    onClick={onEsrClick ? () => onEsrClick(activeEsr === 'good' ? null : 'good') : undefined} />
                )}
                {stats.esrOk > 0 && (
                  <BudgetRow label="OK  0.01–0.05" count={stats.esrOk} maxCount={esrMaxCount} color="#f59e0b"
                    isActive={activeEsr === 'ok'}
                    onClick={onEsrClick ? () => onEsrClick(activeEsr === 'ok' ? null : 'ok') : undefined} />
                )}
                {stats.esrReview > 0 && (
                  <BudgetRow label="Review  > 0.05" count={stats.esrReview} maxCount={esrMaxCount} color="#ef4444"
                    isActive={activeEsr === 'review'}
                    onClick={onEsrClick ? () => onEsrClick(activeEsr === 'review' ? null : 'review') : undefined} />
                )}
                {stats.esrNone > 0 && (
                  <BudgetRow label="No data" count={stats.esrNone} maxCount={esrMaxCount} color="#4b5563"
                    isActive={activeEsr === 'none'}
                    onClick={onEsrClick ? () => onEsrClick(activeEsr === 'none' ? null : 'none') : undefined} />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gear + Tone columns */}
      <div className="flex gap-3">
        {/* Gear type */}
        <div className="flex-1 rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Gear Type</h3>
          {stats.gearRows.length === 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-gray-600">No gear data</p>
          ) : (
            <div className="flex flex-col">
              {stats.gearRows.map(({ key, count }) => {
                const imgSrc = getGearImageSrc(key)
                const color = GEAR_COLORS[key] ?? '#6b7280'
                return (
                  <BudgetRow
                    key={key}
                    icon={
                      imgSrc
                        ? <img src={imgSrc} alt={key} className="h-4 w-4 object-contain opacity-70" />
                        : <span style={{ color }} className="text-[9px] leading-none">●</span>
                    }
                    label={GEAR_LABELS[key] ?? key}
                    count={count}
                    maxCount={stats.maxGear}
                    color={color}
                    isActive={activeGear === key}
                    onClick={onGearClick ? () => onGearClick(activeGear === key ? null : key) : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Tone type */}
        <div className="flex-1 rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Tone Type</h3>
          {stats.toneRows.length === 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-gray-600">No tone data</p>
          ) : (
            <div className="flex flex-col">
              {stats.toneRows.map(({ key, count }) => (
                <BudgetRow
                  key={key}
                  label={TONE_LABELS[key] ?? key}
                  count={count}
                  maxCount={stats.maxTone}
                  color={TONE_COLORS[key] ?? '#6b7280'}
                  isActive={activeTone === key}
                  onClick={onToneClick ? () => onToneClick(activeTone === key ? null : key) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rating */}
      {(stats.ratingRows.length > 0 || stats.unratedCount > 0) && (
        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Rating</h3>
          <div className="flex flex-col gap-1">
            {stats.ratingRows.map(({ rating, count }) => (
              <MiniBar
                key={rating}
                label={'★'.repeat(rating)}
                count={count}
                maxCount={stats.maxRating}
                color="#f59e0b"
                isActive={activeRating === rating}
                onClick={onRatingClick ? () => onRatingClick(activeRating === rating ? null : rating) : undefined}
              />
            ))}
            {stats.unratedCount > 0 && (
              <MiniBar
                label="Unrated"
                count={stats.unratedCount}
                maxCount={stats.maxRating}
                color="#6b7280"
                isActive={activeRating === 0}
                onClick={onRatingClick ? () => onRatingClick(activeRating === 0 ? null : 0) : undefined}
              />
            )}
          </div>
        </div>
      )}

      {checklistSummary && checklistSummary.total > 0 && (
        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Checklist Progress</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                {checklistSummary.completed} of {checklistSummary.total} steps complete
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-gray-900 dark:text-white leading-none">{checklistSummary.percent}%</div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                {checklistSummary.liveDate
                  ? 'Released'
                  : checklistSummary.isOverdue
                    ? 'Overdue'
                    : checklistSummary.targetDate
                      ? 'Scheduled'
                      : 'No target'}
              </div>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700/50 overflow-hidden">
            <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${checklistSummary.percent}%` }} />
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {checklistSummary.targetDate && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300">
                Target {checklistSummary.targetDate}
              </span>
            )}
            {checklistSummary.liveDate && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300">
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

      {deliverySummary && (
        <div className="rounded-xl bg-white dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/40 p-3">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Delivery Targets</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                {deliverySummary.totalRows} matrix row{deliverySummary.totalRows !== 1 ? 's' : ''} stored
              </p>
            </div>
            {deliverySummary.lastImportedAt && (
              <div className="text-[10px] text-gray-400 dark:text-gray-500 text-right">
                Imported {new Date(deliverySummary.lastImportedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              ['ToneX', deliverySummary.tonexIncluded],
              ['NAM', deliverySummary.namIncluded],
              ['Proxy', deliverySummary.proxyIncluded],
              ['QC', deliverySummary.qcIncluded],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/40 px-3 py-2">
                <div className="text-lg font-semibold text-gray-900 dark:text-white leading-none">{count}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{label} included</div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDateTime(ms: number): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

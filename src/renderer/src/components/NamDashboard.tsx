import type { NamFile } from '../types/nam'

const COMPLETENESS_FIELDS: (keyof NamFile['metadata'])[] = [
  'name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu',
]

// Display labels
const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp',
  pedal: 'Pedal',
  pedal_amp: 'Pedal + Amp',
  amp_cab: 'Amp + Cab',
  amp_pedal_cab: 'Amp + Pedal + Cab',
  preamp: 'Preamp',
  studio: 'Studio',
}

const TONE_LABELS: Record<string, string> = {
  clean: 'Clean',
  crunch: 'Crunch',
  hi_gain: 'Hi-Gain',
  fuzz: 'Fuzz',
  overdrive: 'Overdrive',
  distortion: 'Distortion',
  other: 'Other',
}

// Count text colors — match the solid pill colors (bg-orange-500 → text-orange-600 dark:text-orange-400)
const GEAR_COUNT_COLOR: Record<string, string> = {
  amp: 'text-orange-600 dark:text-orange-400',
  amp_cab: 'text-blue-600 dark:text-blue-400',
  pedal: 'text-green-600 dark:text-green-400',
  pedal_amp: 'text-yellow-600 dark:text-yellow-500',
  amp_pedal_cab: 'text-purple-600 dark:text-purple-400',
  preamp: 'text-rose-600 dark:text-rose-400',
  studio: 'text-teal-600 dark:text-teal-400',
}

const TONE_COUNT_COLOR: Record<string, string> = {
  clean: 'text-sky-600 dark:text-sky-400',
  crunch: 'text-amber-600 dark:text-amber-400',
  hi_gain: 'text-red-700 dark:text-red-400',
  fuzz: 'text-purple-700 dark:text-purple-400',
  overdrive: 'text-green-700 dark:text-green-400',
  distortion: 'text-rose-600 dark:text-rose-400',
  other: 'text-gray-500 dark:text-gray-400',
}

interface Props {
  files: NamFile[]
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

function StatCard({
  label, value, sub, onClick,
}: {
  label: string
  value: string | number
  sub?: string
  onClick?: () => void
}) {
  return (
    <div
      className={`bg-gray-100 dark:bg-gray-800/60 rounded-lg px-3 py-2.5 flex flex-col gap-0.5 ${onClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/70 transition-colors' : ''}`}
      onClick={onClick}
    >
      <span className="text-[10px] text-gray-500 uppercase tracking-wide font-medium truncate">{label}</span>
      <span className="text-xl font-bold text-gray-800 dark:text-gray-100 leading-tight">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="text-[10px] text-gray-400 dark:text-gray-600">{sub}</span>}
    </div>
  )
}

// Colored type stat card: the count number uses the type's color
function TypeStatCard({
  label, count, countColor, onClick,
}: {
  label: string
  count: number
  countColor: string
  onClick?: () => void
}) {
  return (
    <div
      className={`bg-gray-100 dark:bg-gray-800/60 rounded-lg px-3 py-2.5 flex flex-col gap-0.5 ${onClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/70 transition-colors' : ''}`}
      onClick={onClick}
    >
      <span className="text-[10px] text-gray-500 uppercase tracking-wide font-medium truncate">{label}</span>
      <span className={`text-xl font-bold leading-tight ${countColor}`}>
        {count.toLocaleString()}
      </span>
    </div>
  )
}

function BarChart({ rows, max, color, onLabelClick }: {
  rows: Array<{ label: string; count: number }>
  max: number
  color: string
  onLabelClick?: (label: string) => void
}) {
  if (!rows.length) return <p className="text-[11px] text-gray-400 dark:text-gray-600 py-2">No data</p>
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const pct = max > 0 ? Math.max(2, Math.round((row.count / max) * 100)) : 2
        return (
          <div key={row.label} className="flex items-center gap-2">
            {onLabelClick ? (
              <button
                className="text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-200 w-28 truncate flex-shrink-0 text-left transition-colors"
                title={`Filter to ${row.label}`}
                onClick={() => onLabelClick(row.label)}
              >
                {row.label}
              </button>
            ) : (
              <span className="text-[10px] text-gray-500 dark:text-gray-400 w-28 truncate flex-shrink-0" title={row.label}>{row.label}</span>
            )}
            <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-800 rounded-sm overflow-hidden">
              <div className={`h-full rounded-sm ${color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 w-8 text-right flex-shrink-0">{row.count.toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}

function CompletenessBar({ complete, partial, incomplete }: { complete: number; partial: number; incomplete: number }) {
  const total = complete + partial + incomplete
  if (total === 0) return <p className="text-[11px] text-gray-400 dark:text-gray-600 py-2">No data</p>
  const completePct = Math.round((complete / total) * 100)
  const partialPct = Math.round((partial / total) * 100)
  const incompletePct = 100 - completePct - partialPct
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 rounded overflow-hidden gap-px">
        {completePct > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${completePct}%` }} title={`Complete: ${complete.toLocaleString()}`} />}
        {partialPct > 0 && <div className="bg-amber-500 transition-all" style={{ width: `${partialPct}%` }} title={`1 missing: ${partial.toLocaleString()}`} />}
        {incompletePct > 0 && <div className="bg-red-500 transition-all" style={{ width: `${incompletePct}%` }} title={`2+ missing: ${incomplete.toLocaleString()}`} />}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-emerald-500 flex-shrink-0" />
          <span className="text-[10px] text-gray-500 dark:text-gray-400">Complete <span className="text-gray-400 dark:text-gray-500">({complete.toLocaleString()})</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-amber-500 flex-shrink-0" />
          <span className="text-[10px] text-gray-500 dark:text-gray-400">1 missing <span className="text-gray-400 dark:text-gray-500">({partial.toLocaleString()})</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-red-500 flex-shrink-0" />
          <span className="text-[10px] text-gray-500 dark:text-gray-400">2+ missing <span className="text-gray-400 dark:text-gray-500">({incomplete.toLocaleString()})</span></span>
        </div>
      </div>
    </div>
  )
}

function formatDate(isoOrMs: string | number | undefined): string {
  if (!isoOrMs) return ''
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString()
}

export function NamDashboard({ files, activeCreator, onCreatorClick, onClearCreatorFilter, onGearTypeClick, onToneTypeClick, onCompleteClick, onIncompleteClick, onRecentFileClick, activeRating, onRatingClick }: Props) {
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

  // Compute stats
  const dirtyCount = files.filter((f) => f.isDirty).length
  const topCreators = countBy(files, (f) => f.metadata.modeled_by ?? null)
    .map(({ key, count }) => ({ label: key, count }))
    .slice(0, 10)
  const gearCounts = countBy(files, (f) => f.metadata.gear_type ?? null)
  const toneCounts = countBy(files, (f) => f.metadata.tone_type ?? null)

  let complete = 0, partial = 0, incomplete = 0
  for (const f of files) {
    const missing = COMPLETENESS_FIELDS.filter((k) => f.metadata[k] == null || f.metadata[k] === '').length
    if (missing === 0) complete++
    else if (missing === 1) partial++
    else incomplete++
  }

  // Rating distribution
  const ratingCounts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 }
  for (const f of files) {
    const r = f.metadata.nl_rating ?? 0
    const key = (r >= 1 && r <= 5) ? r : 0
    ratingCounts[key] = (ratingCounts[key] ?? 0) + 1
  }
  const ratingRows = ([5, 4, 3, 2, 1] as const).filter((r) => ratingCounts[r] > 0)
  const unratedCount = ratingCounts[0]
  const maxRatingCount = Math.max(...ratingRows.map((r) => ratingCounts[r]), unratedCount, 1)

  const recentlyUpdated = [...files]
    .filter((f) => f.mtimeMs)
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
    .slice(0, 10)

  const recentlyAdded = [...files]
    .filter((f) => f.birthtimeMs)
    .sort((a, b) => (b.birthtimeMs ?? 0) - (a.birthtimeMs ?? 0))
    .slice(0, 10)

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

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {/* Active creator filter chip */}
        {activeCreator && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700/50 rounded-lg">
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

        {/* Top stat cards */}
        <div className="grid grid-cols-2 gap-1.5">
          <StatCard label="Total Captures" value={files.length} />
          <StatCard label="Unsaved Changes" value={dirtyCount} />
          <StatCard
            label="Complete"
            value={complete}
            sub={`${Math.round((complete / files.length) * 100)}% of library`}
            onClick={onCompleteClick}
          />
          <StatCard
            label="Incomplete"
            value={partial + incomplete}
            sub={`${partial} partial · ${incomplete} missing 2+`}
            onClick={onIncompleteClick}
          />
        </div>

        {/* Gear & Tone Type section */}
        {(gearCounts.length > 0 || toneCounts.length > 0) && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              Gear & Tone Type
              <span className="normal-case font-normal text-gray-300 dark:text-gray-600 ml-1">(click to filter)</span>
            </h3>

            {gearCounts.length > 0 && (
              <>
                <p className="text-[10px] text-gray-400 dark:text-gray-600 -mb-1">Gear Type</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {gearCounts.map(({ key, count }) => (
                    <TypeStatCard
                      key={key}
                      label={GEAR_LABELS[key] ?? key}
                      count={count}
                      countColor={GEAR_COUNT_COLOR[key] ?? 'text-gray-500 dark:text-gray-400'}
                      onClick={() => onGearTypeClick(key)}
                    />
                  ))}
                </div>
              </>
            )}

            {toneCounts.length > 0 && (
              <>
                <p className="text-[10px] text-gray-400 dark:text-gray-600 -mb-1">Tone Type</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {toneCounts.map(({ key, count }) => (
                    <TypeStatCard
                      key={key}
                      label={TONE_LABELS[key] ?? key}
                      count={count}
                      countColor={TONE_COUNT_COLOR[key] ?? 'text-gray-500 dark:text-gray-400'}
                      onClick={() => onToneTypeClick(key)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Top creators — full width */}
        {topCreators.length > 0 && (
          <div>
            <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
              Top Creators
              <span className="normal-case font-normal text-gray-300 dark:text-gray-600 ml-1">(click to filter)</span>
            </h3>
            <BarChart
              rows={topCreators}
              max={topCreators[0]?.count ?? 1}
              color="bg-indigo-500"
              onLabelClick={onCreatorClick}
            />
          </div>
        )}

        {/* Completeness bar */}
        <div>
          <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">Completeness (7 fields)</h3>
          <CompletenessBar complete={complete} partial={partial} incomplete={incomplete} />
        </div>

        {/* Rating distribution */}
        {(ratingRows.length > 0 || unratedCount > 0) && (
          <div>
            <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
              Rating
              {onRatingClick && <span className="normal-case font-normal text-gray-300 dark:text-gray-600 ml-1">(click to filter)</span>}
            </h3>
            <div className="flex flex-col gap-1">
              {ratingRows.map((r) => {
                const pct = Math.max(2, Math.round((ratingCounts[r] / maxRatingCount) * 100))
                const isActive = activeRating === r
                return (
                  <div
                    key={r}
                    className={`flex items-center gap-2 rounded px-1 py-0.5 ${onRatingClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60' : ''} ${isActive ? 'bg-gray-100 dark:bg-gray-800/60' : ''} transition-colors`}
                    onClick={() => onRatingClick?.(isActive ? null : r)}
                  >
                    <span className="text-[11px] w-[52px] flex-shrink-0 text-right tracking-tight" style={{ color: isActive ? '#f59e0b' : '#d97706', opacity: isActive ? 1 : 0.75 }}>{'★'.repeat(r)}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#f59e0b', opacity: isActive ? 1 : 0.6 }} />
                    </div>
                    <span className="text-[10px] text-gray-500 w-5 text-right flex-shrink-0 tabular-nums">{ratingCounts[r]}</span>
                  </div>
                )
              })}
              {unratedCount > 0 && (
                <div
                  className={`flex items-center gap-2 rounded px-1 py-0.5 ${onRatingClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60' : ''} ${activeRating === 0 ? 'bg-gray-100 dark:bg-gray-800/60' : ''} transition-colors`}
                  onClick={() => onRatingClick?.(activeRating === 0 ? null : 0)}
                >
                  <span className="text-[11px] w-[52px] flex-shrink-0 text-right text-gray-400 dark:text-gray-600">Unrated</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full transition-all bg-gray-400 dark:bg-gray-600" style={{ width: `${Math.max(2, Math.round((unratedCount / maxRatingCount) * 100))}%`, opacity: activeRating === 0 ? 1 : 0.5 }} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-5 text-right flex-shrink-0 tabular-nums">{unratedCount}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recent files — two columns */}
        {(recentlyUpdated.length > 0 || recentlyAdded.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {recentlyAdded.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Recently Added</h3>
                <div className="flex flex-col gap-0.5">
                  {recentlyAdded.map((f) => (
                    <button
                      key={f.filePath}
                      className="text-left flex flex-col min-w-0 px-1.5 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors group"
                      onClick={() => onRecentFileClick?.(f.filePath)}
                      title={f.filePath}
                    >
                      <span className="text-[11px] text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white truncate transition-colors">
                        {f.metadata.name || f.fileName}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-600 truncate">
                        {formatDate(f.birthtimeMs)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {recentlyUpdated.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Recently Updated</h3>
                <div className="flex flex-col gap-0.5">
                  {recentlyUpdated.map((f) => (
                    <button
                      key={f.filePath}
                      className="text-left flex flex-col min-w-0 px-1.5 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors group"
                      onClick={() => onRecentFileClick?.(f.filePath)}
                      title={f.filePath}
                    >
                      <span className="text-[11px] text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white truncate transition-colors">
                        {f.metadata.name || f.fileName}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-600 truncate">
                        {formatDate(f.mtimeMs)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

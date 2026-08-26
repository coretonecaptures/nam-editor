import { useEffect, useState } from 'react'
import { D1StatCard, D1BarList, CARD, EYEBROW } from '../FolderDashboard'
import { formatSampleRate } from '../../../../shared/wavFormat'

type Entry = { value: string; count: number }

type Overview = {
  totalItems: number
  totalFolders: number
  favoriteCount: number
  ratedCount: number
  documentCount: number
  taggedCount: number
  manufacturerBreakdown: Entry[]
  microphoneBreakdown: Entry[]
  speakerBreakdown: Entry[]
  cabinetBreakdown: Entry[]
  sampleRateBreakdown: Entry[]
  bitDepthBreakdown: Entry[]
  channelsBreakdown: Entry[]
  totalBytes: number
  missingAudioInfoCount: number
  projectCount: number
}

/** Same palette family NAM Lab's own dashboard uses for its bar lists — assigned by position so a
 * breakdown reads as a ranked set rather than an arbitrary rainbow. */
const RANK_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#d8b4fe', '#e9d5ff', '#ede9fe', '#f5f3ff']
const FORMAT_COLORS = ['#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899']

function toRows(entries: Entry[], colors: string[]): Array<{ key: string; label: string; count: number; color: string }> {
  return entries.map((e, i) => ({ key: e.value, label: e.value, count: e.count, color: colors[i % colors.length] }))
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * Overview tab — a real report, built from NAM Lab's OWN dashboard pieces (`D1StatCard`,
 * `D1BarList` and the `CARD`/`EYEBROW` styles exported from `FolderDashboard.tsx`) rather than a
 * second, visually-parallel set of stat cards and bars. Same concept as NAM's folder Overview:
 * clicking the root reports the whole library, clicking a folder reports that folder's subtree.
 *
 * Bars are click-to-filter where the browse list can actually act on them (manufacturer, cabinet,
 * speaker, microphone, sample rate, bit depth) and inert where it can't — the report is a way into
 * the list, not a dead-end infographic.
 */
export function IrLibraryOverview({
  libraryRootId,
  folderId,
  folderName,
  onFacet,
  onAudioFacet,
  activeFacets,
  activeAudioFacets,
  refreshKey
}: {
  libraryRootId: number | null
  folderId?: number | null
  folderName?: string | null
  onFacet?: (field: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone', value: string) => void
  onAudioFacet?: (field: 'sampleRate' | 'bitDepth', value: number) => void
  activeFacets?: { manufacturer?: string[]; cabinet?: string; speaker?: string[]; microphone?: string[] }
  activeAudioFacets?: { sampleRate?: number[]; bitDepth?: number[] }
  /** Bumped by the shell when a scan finishes. Without it the report fetches once on mount and
   * never again — so an overview that happened to be open while a library was still importing
   * kept showing the empty result it got at the time, which reads as "the report is broken"
   * rather than "the data wasn't there yet". Reported exactly that way. */
  refreshKey?: number
}): React.ReactElement {
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    if (libraryRootId == null) {
      setOverview(null)
      return
    }
    let cancelled = false
    window.api.irLibraryGetLibraryOverview(libraryRootId, folderId ?? null).then((o) => {
      if (!cancelled) setOverview(o as Overview)
    })
    return () => {
      cancelled = true
    }
  }, [libraryRootId, folderId, refreshKey])

  if (libraryRootId == null || !overview) {
    return <div className="p-3 text-xs text-nm-text-3">Add a library folder to see an overview.</div>
  }

  const scoped = folderId != null && folderName
  // Reverses formatSampleRate for the click-to-filter callback — the bar carries the rendered
  // label ("44.1k"), but the query filters on the raw number.
  const rateFromLabel = (label: string): number => Math.round(parseFloat(label) * 1000)
  const depthFromLabel = (label: string): number => parseInt(label, 10)

  const descriptive = (
    [
      { title: 'Top manufacturers', field: 'manufacturer', entries: overview.manufacturerBreakdown },
      { title: 'Top cabinets', field: 'cabinet', entries: overview.cabinetBreakdown },
      { title: 'Top speakers', field: 'speaker', entries: overview.speakerBreakdown },
      { title: 'Top microphones', field: 'microphone', entries: overview.microphoneBreakdown }
    ] as const
  ).filter((d) => d.entries.length > 0)

  return (
    <div className="h-full overflow-y-auto p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className={EYEBROW}>{scoped ? 'Folder Report' : 'Library Report'}</span>
        <span className="text-sm font-semibold text-nm-text truncate">{scoped ? folderName : 'Whole library'}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <D1StatCard label="IRs" value={overview.totalItems} sub={formatBytes(overview.totalBytes)} />
        <D1StatCard label="Folders" value={overview.totalFolders} />
        <D1StatCard label="Favorites" value={overview.favoriteCount} />
        <D1StatCard label="Rated" value={overview.ratedCount} />
        <D1StatCard label="IR Lab Projects" value={overview.projectCount} sub={overview.projectCount ? 'with capture metadata' : undefined} />
        <D1StatCard label="Vendor docs" value={overview.documentCount} />
      </div>

      {/* Technical make-up. Only rendered once something has actually been read from the files —
          otherwise it says so, with the reason, instead of showing three empty cards. */}
      {overview.sampleRateBreakdown.length > 0 ? (
        <>
          <D1BarList
            title="Sample rate"
            rows={toRows(overview.sampleRateBreakdown, FORMAT_COLORS)}
            activeKey={activeAudioFacets?.sampleRate?.length === 1 ? formatSampleRate(activeAudioFacets.sampleRate[0]) : null}
            onRowClick={onAudioFacet ? (key) => onAudioFacet('sampleRate', rateFromLabel(key)) : undefined}
          />
          <D1BarList
            title="Bit depth"
            rows={toRows(overview.bitDepthBreakdown, FORMAT_COLORS)}
            activeKey={activeAudioFacets?.bitDepth?.length === 1 ? `${activeAudioFacets.bitDepth[0]}-bit` : null}
            onRowClick={onAudioFacet ? (key) => onAudioFacet('bitDepth', depthFromLabel(key)) : undefined}
          />
          <D1BarList title="Channels" rows={toRows(overview.channelsBreakdown, FORMAT_COLORS)} />
        </>
      ) : (
        <div className={`${CARD} flex flex-col gap-1`}>
          <span className={EYEBROW}>Audio format</span>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Not read yet for {overview.missingAudioInfoCount.toLocaleString()} file
            {overview.missingAudioInfoCount === 1 ? '' : 's'}. Sample rate, bit depth, channels and length come from
            each file&apos;s own WAV header during a scan — run <span className="font-medium">File &rarr; Rescan Library</span> to
            fill them in.
          </p>
        </div>
      )}

      {/* Only rendered when there's something to draw. An empty D1BarList still paints a titled
          card saying "No data", so showing all four unconditionally filled the report with grey
          placeholder cards and no colour whenever a library hadn't been parsed yet — which is
          exactly what "the overview has zero colors or charts" looked like. Note `cabinet` is
          routinely empty by design: vocabulary.ts has mic/speaker/brand term lists but no cabinet
          list, so nothing ever infers a cabinet model from a filename. */}
      {descriptive.map(({ title, field, entries }) => (
        <D1BarList
          key={field}
          title={title}
          rows={toRows(entries, RANK_COLORS)}
          activeKey={
            field === 'cabinet'
              ? activeFacets?.cabinet ?? null
              : (activeFacets?.[field]?.length ?? 0) === 1
                ? (activeFacets![field] as string[])[0]
                : null
          }
          onRowClick={onFacet ? (key) => onFacet(field, key) : undefined}
        />
      ))}

      {descriptive.length === 0 && (
        <div className={`${CARD} flex flex-col gap-1`}>
          <span className={EYEBROW}>Gear</span>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            No manufacturer, speaker or microphone recognised in this scope yet. Those are read
            from filenames and folder names during a scan — run{' '}
            <span className="font-medium">File &rarr; Rescan Library</span> if this library was
            added before that ran.
          </p>
        </div>
      )}
    </div>
  )
}

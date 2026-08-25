import { useEffect, useState } from 'react'

type Overview = {
  totalItems: number
  totalFolders: number
  favoriteCount: number
  ratedCount: number
  documentCount: number
  taggedCount: number
  manufacturerBreakdown: Array<{ value: string; count: number }>
  microphoneBreakdown: Array<{ value: string; count: number }>
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold text-nm-text">{value.toLocaleString()}</span>
      <span className="text-xs text-nm-text-3">{label}</span>
    </div>
  )
}

/** Plain CSS bars, not a charting library — this is a handful of rows, not a real dashboard.
 * Widths are relative to the top entry in the same breakdown, not an absolute scale. */
function BreakdownBars({ title, entries }: { title: string; entries: Array<{ value: string; count: number }> }): React.ReactElement | null {
  if (entries.length === 0) return null
  const max = entries[0].count
  return (
    <div>
      <div className="text-xs text-nm-text-2 mb-1.5">{title}</div>
      <div className="flex flex-col gap-1">
        {entries.map((e) => (
          <div key={e.value} className="flex items-center gap-2 text-xs">
            <span className="w-24 flex-shrink-0 truncate text-nm-text" title={e.value}>
              {e.value}
            </span>
            <div className="flex-1 h-3 bg-panel-2 rounded overflow-hidden">
              <div className="h-full bg-nm-accent" style={{ width: `${Math.max(4, (e.count / max) * 100)}%` }} />
            </div>
            <span className="w-8 flex-shrink-0 text-right text-nm-text-3">{e.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Overview tab — a rollup report, same concept as NAM Lab's own Overview tab (screenshot supplied
 * by the user): clicking the root shows the whole library, clicking a folder shows that folder's
 * subtree scope only, via `libraryOverview.ts`'s now-generalized `folderId` parameter. Total
 * counts plus two breakdown bars (manufacturer, microphone) from whatever Phase 3's vendor
 * parsers have already populated — deliberately small, "a few graphs for now."
 */
export function IrLibraryOverview({
  libraryRootId,
  folderId,
  folderName
}: {
  libraryRootId: number | null
  folderId?: number | null
  folderName?: string | null
}): React.ReactElement {
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    if (libraryRootId == null) {
      setOverview(null)
      return
    }
    window.api.irLibraryGetLibraryOverview(libraryRootId, folderId ?? null).then(setOverview)
  }, [libraryRootId, folderId])

  if (libraryRootId == null || !overview) {
    return <div className="p-3 text-xs text-nm-text-3">Add a library folder to see an overview.</div>
  }

  return (
    <div className="p-3 flex flex-col gap-4 overflow-y-auto h-full">
      <div className="text-sm font-medium text-nm-text truncate">
        {folderId != null && folderName ? folderName : 'Library Overview'}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="IRs" value={overview.totalItems} />
        <Stat label="Folders" value={overview.totalFolders} />
        <Stat label="Favorites" value={overview.favoriteCount} />
        <Stat label="Rated" value={overview.ratedCount} />
        <Stat label="Tagged" value={overview.taggedCount} />
        <Stat label="Vendor docs" value={overview.documentCount} />
      </div>

      <BreakdownBars title="Top manufacturers" entries={overview.manufacturerBreakdown} />
      <BreakdownBars title="Top microphones" entries={overview.microphoneBreakdown} />

      {overview.manufacturerBreakdown.length === 0 && overview.microphoneBreakdown.length === 0 && (
        <div className="text-xs text-nm-text-3 italic">
          No breakdown yet — nothing in this scope has been tagged by a vendor parser or hand-entered.
        </div>
      )}

      {folderId == null && (
        <div className="text-xs text-nm-text-3 pt-2 border-t border-nm-border-s">
          Click a folder in the tree to see that folder's own rollup instead of the whole library.
        </div>
      )}
    </div>
  )
}

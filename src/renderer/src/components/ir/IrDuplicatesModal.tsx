import { useEffect, useState } from 'react'

/**
 * Duplicate-set report over the IR catalog's own `content_hash` (parity backlog item 17 / audit
 * idea 6) — "you're holding N MB of byte-identical IRs across three packs" as a report, not a
 * deletion tool. There is no catalog-transactional trash for IR items yet (backlog item 1); the
 * only removal action offered here is the existing catalog-only `removeItemFromCatalog`, labeled
 * honestly as NOT deleting the file. Once item 1/5 land, a real "trash the extras" action belongs
 * here as the first consumer of that primitive.
 */

interface DuplicateMember {
  itemId: string
  relativePath: string
  displayName: string
  absPath: string
  fileSize: number | null
  isFavorite: boolean
  rating: number | null
  metadataCompleteness: number
}

interface DuplicateSet {
  contentHash: string
  fileSize: number | null
  reclaimableBytes: number
  members: DuplicateMember[]
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

export function IrDuplicatesModal({
  libraryRootId,
  folderId,
  scopeLabel,
  onClose
}: {
  libraryRootId: number | null
  folderId: number | null
  scopeLabel: string
  onClose: () => void
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [sets, setSets] = useState<DuplicateSet[]>([])
  const [totalReclaimableBytes, setTotalReclaimableBytes] = useState(0)
  const [unhashedCount, setUnhashedCount] = useState(0)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.irLibraryFindDuplicates({ libraryRootId, folderId }).then((report) => {
      if (cancelled) return
      setSets(report.sets)
      setTotalReclaimableBytes(report.totalReclaimableBytes)
      setUnhashedCount(report.unhashedCount)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [libraryRootId, folderId])

  const removeFromCatalog = async (itemId: string): Promise<void> => {
    setRemoving(itemId)
    try {
      await window.api.irLibraryRemoveItemFromCatalog(itemId)
      setRemovedIds((prev) => new Set(prev).add(itemId))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[640px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-nm-border flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <div className="text-sm font-semibold text-nm-text">Duplicate IRs</div>
            <div className="text-xs text-nm-text-3 mt-0.5">{scopeLabel}</div>
          </div>
          <button onClick={onClose} className="text-nm-text-3 hover:text-nm-text flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-nm-border-s flex-shrink-0 flex items-center gap-4 flex-wrap">
          <div className="nam-chip chip-ir-missing text-xs">
            <span className="nam-dot" />
            {loading ? 'Scanning…' : `${sets.length} duplicate set${sets.length === 1 ? '' : 's'}`}
          </div>
          {!loading && sets.length > 0 && (
            <span className="text-xs text-nm-text-2">
              Up to <strong className="text-nm-text">{formatBytes(totalReclaimableBytes)}</strong> reclaimable by keeping one copy of each
            </span>
          )}
          {!loading && unhashedCount > 0 && (
            <span className="text-xs text-nm-text-3" title="Items scanned before a content hash was computed for them — rescan to include them in this check.">
              {unhashedCount.toLocaleString()} item{unhashedCount === 1 ? '' : 's'} not yet checked
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && <div className="text-xs text-nm-text-3 py-6 text-center">Comparing content hashes…</div>}

          {!loading && sets.length === 0 && (
            <div className="text-xs text-nm-text-3 py-6 text-center">
              No byte-identical duplicates found in this scope.
            </div>
          )}

          <div className="flex flex-col gap-4">
            {sets.map((set) => (
              <div key={set.contentHash} className="border border-nm-border-s rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-panel-2 text-[11px] text-nm-text-2 flex items-center justify-between gap-2">
                  <span>
                    {set.members.length} identical copies · {formatBytes(set.fileSize ?? 0)} each
                  </span>
                  <span className="text-nm-text-3">reclaim {formatBytes(set.reclaimableBytes)}</span>
                </div>
                <div className="divide-y divide-nm-border-s">
                  {set.members.map((m, i) => {
                    const removed = removedIds.has(m.itemId)
                    return (
                      <div
                        key={m.itemId}
                        className={`px-3 py-2 flex items-center gap-2 text-xs ${removed ? 'opacity-40' : ''}`}
                      >
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                            i === 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-field-bg text-nm-text-3'
                          }`}
                          title={i === 0 ? 'Most complete metadata — suggested keeper' : undefined}
                        >
                          {i === 0 ? 'Keep' : 'Extra'}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-nm-text" title={m.relativePath}>
                          {m.relativePath}
                        </span>
                        {m.isFavorite && <span className="text-nm-accent flex-shrink-0">★</span>}
                        <button
                          onClick={() => window.api.revealFile(m.absPath)}
                          className="text-nm-text-3 hover:text-nm-text flex-shrink-0"
                          title="Reveal in folder"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                          </svg>
                        </button>
                        {i > 0 && !removed && (
                          <button
                            onClick={() => void removeFromCatalog(m.itemId)}
                            disabled={removing === m.itemId}
                            title="Forget this item in the catalog — leaves the file on disk untouched. Use Reveal + delete manually to actually free the space."
                            className="text-[11px] text-nm-text-3 hover:text-red-500 disabled:opacity-50 flex-shrink-0"
                          >
                            {removing === m.itemId ? '…' : 'Remove from catalog'}
                          </button>
                        )}
                        {removed && <span className="text-[11px] text-nm-text-3 flex-shrink-0">Removed</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-nm-border-s flex-shrink-0 text-[11px] text-nm-text-3">
          "Remove from catalog" only forgets the entry here — it never deletes the file. Use Reveal to find and delete it yourself.
        </div>
      </div>
    </div>
  )
}

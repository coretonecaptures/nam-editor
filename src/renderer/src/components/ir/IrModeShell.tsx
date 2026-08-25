import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtualList } from './VirtualList'
import { useIrAudition } from './useIrAudition'
import { IrFolderTree } from './IrFolderTree'
import { IrFolderPanel } from './IrFolderPanel'

type IrItemRow = {
  id: string
  relative_path: string
  display_name: string
  file_size: number | null
  is_favorite: number
  rating: number | null
  manufacturer: string | null
  manufacturer_source: string | null
  cabinet: string | null
  cabinet_source: string | null
  speaker: string | null
  speaker_source: string | null
  microphone: string | null
  microphone_source: string | null
  abs_path: string
}

type LibraryRoot = { id: number; path: string; label: string | null; watch_mode: string; created_at: string }

const ROW_HEIGHT = 64
const PAGE_SIZE = 200

/**
 * Confidence-ladder badge color (plan section 3) — "a small badge, not a modal," per field.
 * Only the two sources Phase 3's parsers actually produce are handled; ir_lab_native/
 * vendor_documentation/user_entered aren't written by any code yet (Phase 4/5/UI-editing).
 */
function confidenceDotClass(source: string | null): string {
  switch (source) {
    case 'vendor_parser':
      return 'bg-indigo-400'
    case 'filename_inferred':
      return 'bg-gray-400 dark:bg-gray-600'
    default:
      return 'bg-gray-300 dark:bg-gray-700'
  }
}

function FieldBadge({ label, value, source }: { label: string; value: string | null; source: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <span
      title={`${label}: ${value} (${source === 'vendor_parser' ? 'vendor parser' : source === 'filename_inferred' ? 'filename guess' : 'unknown source'})`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-400"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confidenceDotClass(source)}`} />
      {value}
    </span>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Folder trail / file name, matching the split convention utils/irLibrary.ts already uses. */
function splitPath(rel: string): { folder: string; name: string } {
  const parts = rel.split('/')
  const name = parts.pop() ?? rel
  return { folder: parts.join(' / '), name: name.replace(/\.wav$/i, '') }
}

/**
 * Phase 2 — read-only browse + search over the IR catalog (docs/ir-lab-manager-build-plan.md
 * section 12, Phase 2), now showing Phase 3's vendor-parsed fields with confidence badges
 * (section 3) per field, and Phase 4's quick audition (section 8) — a play button per row plus
 * arrow-key navigation through the current filtered list, per the plan's spec. No organization
 * features yet (tags/collections/tray are later phases), no A/B audition yet (Phase 7). No
 * faceted filter chips yet either (section 7) — badges show what's known per row, but there's no
 * click-to-narrow-by-cabinet/speaker/mic UI; that's a distinct feature (needs a distinct-values
 * aggregation query + filter state) still tracked as not done.
 */
export function IrModeShell(): React.ReactElement {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ filesSeen: number; foldersSeen: number; elapsedMs: number } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  // Folder tree/panel — scoped to the first root for now (no root switcher yet; a second "Add
  // Library Folder" click adds another root but the tree only ever shows the first one). Selecting
  // a folder both opens its metadata panel AND filters the item list to that folder's subtree
  // (queryLibrary.ts's folderId option) — these were briefly separate (panel-only) and merged
  // after user testing showed the unfiltered list reading as broken.
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null)
  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = Number(localStorage.getItem('nam-lab-ir-tree-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 200
  })
  // Bumped on every filter/search change so a query response that resolves AFTER a newer filter
  // was already selected gets thrown away instead of populating the cache with stale-context rows
  // (e.g. a slow "all IRs" query resolving after the user already clicked into a folder).
  const requestEpochRef = useRef(0)

  const audition = useIrAudition()

  // Sparse cache keyed by row index within the current (root, search) result set — a 282K-row
  // catalog is never fetched or held in full, only the indices actually scrolled into view. Reset
  // whenever the search changes, since the index-to-row mapping is only valid for one query.
  const cacheRef = useRef<Map<number, IrItemRow>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const [, forceRerender] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const refreshRoots = useCallback(async () => {
    const r = await window.api.irLibraryListRoots()
    setRoots(r)
  }, [])

  useEffect(() => {
    refreshRoots()
  }, [refreshRoots])

  useEffect(() => {
    return window.api.onIrLibraryScanProgress((p) => {
      setScanProgress(p)
      if (p.done) setScanning(false)
    })
  }, [])

  // New search, folder filter, or a completed scan invalidates every cached index — the same
  // offset can now point at a different row.
  useEffect(() => {
    requestEpochRef.current++
    cacheRef.current = new Map()
    pendingRef.current = new Set()
    setFocusedIndex(null)
    audition.stop()
    forceRerender((n) => n + 1)
    // audition is stable across renders (all its returned functions are useCallback'd with a
    // fixed dependency set) — omitted from deps so a play/stop state change doesn't itself
    // re-trigger a cache wipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roots.length, selectedFolderId])

  // Arrow-key navigation through the current filtered list (plan section 8), plus Escape to stop.
  // Ignored while a text input has focus so this doesn't fight the search box's own cursor keys.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      if (total === 0) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((current) => {
          const base = current ?? -1
          const next = e.key === 'ArrowDown' ? Math.min(total - 1, base + 1) : Math.max(0, base - 1)
          const row = cacheRef.current.get(next)
          // Known rough edge: if `next` hasn't loaded into cacheRef yet (rapid jump ahead of
          // what VirtualList has fetched), this silently doesn't play — no retry once it
          // arrives. Acceptable for a first cut; revisit if it's actually annoying in practice.
          if (row) audition.play(row)
          return next
        })
      } else if (e.key === 'Escape') {
        audition.stop()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  const handleAddFolder = useCallback(async () => {
    const folder = await window.api.openFolder()
    if (!folder) return
    setScanError(null)
    setScanning(true)
    setScanProgress({ filesSeen: 0, foldersSeen: 0, elapsedMs: 0 })
    try {
      await window.api.irLibraryScan(folder, null)
      await refreshRoots()
    } catch (err) {
      setScanError(String(err))
    } finally {
      setScanning(false)
    }
  }, [refreshRoots])

  const onVisibleRangeChange = useCallback(
    (start: number, end: number) => {
      const missingStart = start
      let hasMissing = false
      for (let i = start; i < end; i++) {
        if (!cacheRef.current.has(i)) {
          hasMissing = true
          break
        }
      }
      if (!hasMissing) return

      // Snap to PAGE_SIZE-aligned chunks so scrolling doesn't fire a new IPC call per pixel —
      // query latency is sub-2ms (validated in Phase 1) so this is about request count, not speed.
      const pageStart = Math.floor(missingStart / PAGE_SIZE) * PAGE_SIZE
      const pageEnd = Math.min(total, Math.ceil(end / PAGE_SIZE) * PAGE_SIZE)
      const key = `${pageStart}-${pageEnd}`
      if (pendingRef.current.has(key)) return
      pendingRef.current.add(key)

      const epoch = requestEpochRef.current
      window.api
        .irLibraryQuery({ search: search || undefined, folderId: selectedFolderId, offset: pageStart, limit: pageEnd - pageStart })
        .then((res) => {
          if (requestEpochRef.current !== epoch) return // a newer filter/search superseded this
          setTotal(res.total)
          res.rows.forEach((row, i) => cacheRef.current.set(pageStart + i, row))
          forceRerender((n) => n + 1)
        })
        .finally(() => {
          pendingRef.current.delete(key)
        })
    },
    [search, total, selectedFolderId]
  )

  // Fires once per search/folder change to establish `total` even before the list scrolls
  // (VirtualList's own effect also triggers a range fetch, but that only runs once `total` — and
  // thus a non-zero row count to scroll through — is already known).
  useEffect(() => {
    const epoch = requestEpochRef.current
    window.api.irLibraryQuery({ search: search || undefined, folderId: selectedFolderId, offset: 0, limit: PAGE_SIZE }).then((res) => {
      if (requestEpochRef.current !== epoch) return
      setTotal(res.total)
      res.rows.forEach((row, i) => cacheRef.current.set(i, row))
      forceRerender((n) => n + 1)
    })
  }, [search, roots.length, selectedFolderId])

  const toggleFavorite = useCallback((row: IrItemRow, index: number) => {
    const next = row.is_favorite ? 0 : 1
    cacheRef.current.set(index, { ...row, is_favorite: next })
    forceRerender((n) => n + 1)
    window.api.irLibrarySetFavorite(row.id, next === 1)
  }, [])

  const setRating = useCallback((row: IrItemRow, index: number, rating: number) => {
    const next = row.rating === rating ? null : rating
    cacheRef.current.set(index, { ...row, rating: next })
    forceRerender((n) => n + 1)
    window.api.irLibrarySetRating(row.id, next)
  }, [])

  const hasAnyRoot = roots.length > 0

  const handleSelectFolder = useCallback((id: number, name: string) => {
    setSelectedFolderId(id)
    setSelectedFolderName(name)
  }, [])

  const clearFolderFilter = useCallback(() => {
    setSelectedFolderId(null)
    setSelectedFolderName(null)
  }, [])

  const onTreeDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = treeWidth
      let latest = treeWidth
      const onMove = (ev: MouseEvent): void => {
        const next = Math.min(480, Math.max(140, startWidth + (ev.clientX - startX)))
        latest = next
        setTreeWidth(next)
      }
      const onUp = (): void => {
        localStorage.setItem('nam-lab-ir-tree-width', String(latest))
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [treeWidth]
  )

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <h1 className="text-sm font-semibold text-gray-500 dark:text-gray-400">IR Library</h1>
        <button
          onClick={handleAddFolder}
          disabled={scanning}
          className="px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
        >
          {scanning ? 'Scanning…' : 'Add Library Folder'}
        </button>
        {hasAnyRoot && (
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="flex-1 max-w-md px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        )}
        {hasAnyRoot && <span className="text-xs text-gray-400 dark:text-gray-600 flex-shrink-0">{total.toLocaleString()} IRs</span>}
        {hasAnyRoot && (
          <button
            onClick={audition.pickDiClip}
            title={audition.diPath ?? 'Pick a DI clip to audition IRs against'}
            className="ml-auto px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
          >
            {audition.diPath ? `DI: ${audition.diPath.split(/[\\/]/).pop()}` : 'Pick DI clip…'}
          </button>
        )}
      </div>
      {audition.error && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">
          Audition: {audition.error}
        </div>
      )}

      {scanning && scanProgress && (
        <div className="px-4 py-1 text-xs text-gray-500 dark:text-gray-400 bg-indigo-50 dark:bg-indigo-950/40 flex-shrink-0">
          Scanning… {scanProgress.filesSeen.toLocaleString()} files, {scanProgress.foldersSeen.toLocaleString()} folders,{' '}
          {(scanProgress.elapsedMs / 1000).toFixed(1)}s
        </div>
      )}
      {scanError && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">{scanError}</div>
      )}
      {selectedFolderId != null && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <span className="text-gray-500 dark:text-gray-400">
            Showing: <span className="font-medium text-gray-700 dark:text-gray-300">{selectedFolderName}</span> and its subfolders
          </span>
          <button onClick={clearFolderFilter} className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Clear
          </button>
        </div>
      )}

      {!hasAnyRoot && !scanning ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 text-gray-500 dark:text-gray-500">
          <p className="text-sm">No IR library folders added yet.</p>
          <button onClick={handleAddFolder} className="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-500 text-white">
            Add Library Folder
          </button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div style={{ width: treeWidth }} className="flex-shrink-0 overflow-y-auto">
            <IrFolderTree
              libraryRootId={roots[0]?.id ?? null}
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleSelectFolder}
            />
          </div>
          <div
            onMouseDown={onTreeDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors"
          />
          <VirtualList
            total={total}
            rowHeight={ROW_HEIGHT}
            onVisibleRangeChange={onVisibleRangeChange}
            className="flex-1"
            renderRow={(index) => {
            const row = cacheRef.current.get(index)
            if (!row) {
              return <div className="h-full border-b border-gray-100 dark:border-gray-900" />
            }
            const { folder, name } = splitPath(row.relative_path)
            const isPlaying = audition.playingId === row.id
            const isFocused = focusedIndex === index
            return (
              <div
                onClick={() => setFocusedIndex(index)}
                className={`h-full flex items-center gap-3 px-4 border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-gray-900/50 ${isFocused ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''}`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedIndex(index)
                    if (isPlaying) audition.stop()
                    else audition.play(row)
                  }}
                  disabled={!audition.diPath}
                  title={audition.diPath ? (isPlaying ? 'Stop' : 'Audition this IR') : 'Pick a DI clip first'}
                  className={`flex-shrink-0 text-base w-5 text-center ${isPlaying ? 'text-indigo-500' : 'text-gray-400 dark:text-gray-600 hover:text-indigo-400'} disabled:opacity-30`}
                >
                  {isPlaying ? '■' : '▶'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(row, index)
                  }}
                  title={row.is_favorite ? 'Remove favorite' : 'Add favorite'}
                  className={`flex-shrink-0 text-lg ${row.is_favorite ? 'text-amber-400' : 'text-gray-300 dark:text-gray-700 hover:text-amber-300'}`}
                >
                  {row.is_favorite ? '★' : '☆'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{name}</div>
                  {folder && <div className="text-xs text-gray-400 dark:text-gray-600 truncate">{folder}</div>}
                  {(row.manufacturer || row.cabinet || row.speaker || row.microphone) && (
                    <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                      <FieldBadge label="Manufacturer" value={row.manufacturer} source={row.manufacturer_source} />
                      <FieldBadge label="Cabinet" value={row.cabinet} source={row.cabinet_source} />
                      <FieldBadge label="Speaker" value={row.speaker} source={row.speaker_source} />
                      <FieldBadge label="Microphone" value={row.microphone} source={row.microphone_source} />
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRating(row, index, n)}
                      className={`text-sm ${row.rating != null && n <= row.rating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-700 hover:text-amber-300'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <div className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-600 w-14 text-right">{formatBytes(row.file_size)}</div>
              </div>
            )
          }}
          />
          {selectedFolderId != null && (
            <div className="w-64 flex-shrink-0 border-l border-gray-200 dark:border-gray-800 overflow-y-auto">
              <IrFolderPanel folderId={selectedFolderId} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

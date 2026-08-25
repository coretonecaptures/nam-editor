import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtualList } from './VirtualList'

type IrItemRow = {
  id: string
  relative_path: string
  display_name: string
  file_size: number | null
  is_favorite: number
  rating: number | null
}

type LibraryRoot = { id: number; path: string; label: string | null; watch_mode: string; created_at: string }

const ROW_HEIGHT = 52
const PAGE_SIZE = 200

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
 * section 12, Phase 2). No organization features yet (tags/collections/tray are later phases).
 *
 * Confidence badges (plan section 3) are deliberately absent here: they show per-field provenance
 * (vendor_parser / filename_inferred / user_entered / ...) on ir_item's descriptive columns, and
 * nothing populates ir_item yet — vendor parsers are Phase 3. Building badge UI against a table
 * with no rows would be decorative, not functional; it lands once Phase 3 gives it real data.
 */
export function IrModeShell(): React.ReactElement {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ filesSeen: number; foldersSeen: number; elapsedMs: number } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)

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

  // New search (or a completed scan) invalidates every cached index — the same offset can now
  // point at a different row.
  useEffect(() => {
    cacheRef.current = new Map()
    pendingRef.current = new Set()
    forceRerender((n) => n + 1)
  }, [search, roots.length])

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

      window.api
        .irLibraryQuery({ search: search || undefined, offset: pageStart, limit: pageEnd - pageStart })
        .then((res) => {
          setTotal(res.total)
          res.rows.forEach((row, i) => cacheRef.current.set(pageStart + i, row))
          forceRerender((n) => n + 1)
        })
        .finally(() => {
          pendingRef.current.delete(key)
        })
    },
    [search, total]
  )

  // Fires once per search change to establish `total` even before the list scrolls (VirtualList's
  // own effect also triggers a range fetch, but that only runs once `total` — and thus a
  // non-zero row count to scroll through — is already known).
  useEffect(() => {
    window.api.irLibraryQuery({ search: search || undefined, offset: 0, limit: PAGE_SIZE }).then((res) => {
      setTotal(res.total)
      res.rows.forEach((row, i) => cacheRef.current.set(i, row))
      forceRerender((n) => n + 1)
    })
  }, [search, roots.length])

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
      </div>

      {scanning && scanProgress && (
        <div className="px-4 py-1 text-xs text-gray-500 dark:text-gray-400 bg-indigo-50 dark:bg-indigo-950/40 flex-shrink-0">
          Scanning… {scanProgress.filesSeen.toLocaleString()} files, {scanProgress.foldersSeen.toLocaleString()} folders,{' '}
          {(scanProgress.elapsedMs / 1000).toFixed(1)}s
        </div>
      )}
      {scanError && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">{scanError}</div>
      )}

      {!hasAnyRoot && !scanning ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 text-gray-500 dark:text-gray-500">
          <p className="text-sm">No IR library folders added yet.</p>
          <button onClick={handleAddFolder} className="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-500 text-white">
            Add Library Folder
          </button>
        </div>
      ) : (
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
            return (
              <div className="h-full flex items-center gap-3 px-4 border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <button
                  onClick={() => toggleFavorite(row, index)}
                  title={row.is_favorite ? 'Remove favorite' : 'Add favorite'}
                  className={`flex-shrink-0 text-lg ${row.is_favorite ? 'text-amber-400' : 'text-gray-300 dark:text-gray-700 hover:text-amber-300'}`}
                >
                  {row.is_favorite ? '★' : '☆'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{name}</div>
                  {folder && <div className="text-xs text-gray-400 dark:text-gray-600 truncate">{folder}</div>}
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
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtualList } from './VirtualList'
import { useIrLiveAudition } from './useIrLiveAudition'
import { IrFolderTree } from './IrFolderTree'
import { IrRightPanel } from './IrRightPanel'
import { IrMenuBar } from './IrMenuBar'

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
    case 'ir_lab_native':
      return 'bg-blue-500'
    case 'vendor_parser':
      return 'bg-nm-accent'
    case 'filename_inferred':
      return 'bg-gray-400 dark:bg-gray-600'
    default:
      return 'bg-gray-300 dark:bg-gray-700'
  }
}

/** Faceted filter chip (plan: "click-to-narrow-by-field UI"). Clicking a badge sets that field as
 * the ONLY active filter for it (clicking an active badge again clears it) — a plain toggle, not
 * a multi-select facet browser, matching the scope actually asked for. */
function FieldBadge({
  label,
  value,
  source,
  active,
  onClick
}: {
  label: string
  value: string | null
  source: string | null
  active?: boolean
  onClick?: () => void
}): React.ReactElement | null {
  if (!value) return null
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`${label}: ${value} (${source === 'vendor_parser' ? 'vendor parser' : source === 'filename_inferred' ? 'filename guess' : source === 'ir_lab_native' ? 'IR Lab' : 'unknown source'}) — click to filter`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${
        active ? 'bg-active-bg text-nm-accent ring-1 ring-nm-accent' : 'bg-panel-2 text-nm-text-2 hover:bg-hov'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${confidenceDotClass(source)}`} />
      {value}
    </button>
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
 * (section 3) per field, and live audition (section 8b) — a row's play button hot-swaps the
 * cabinet on a real-time NAM-through-LiveEngine session (pick an amp capture once in the Live
 * tab), same mechanism and UI idiom as NAM Lab's own PlayerPanel Live mode, not the earlier
 * DI-render-once mechanism it replaced. Arrow-key navigation through the current filtered list
 * plays live too. Faceted filter chips (section 7) — clicking a row's manufacturer/cabinet/
 * speaker/microphone badge narrows the list to exactly that value (queryLibrary.ts's facet
 * WHERE clauses); clicking the same badge again clears it. Root switcher — a dropdown next to
 * search picks one library_root or "All roots" (folder tree only ever shows one root at a time,
 * but browse/search scope follows the same selection). No A/B audition yet (Phase 7).
 */
export function IrModeShell(): React.ReactElement {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ filesSeen: number; foldersSeen: number; elapsedMs: number } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [ratedOnly, setRatedOnly] = useState(false)
  // Groups (plan section 8, item 8) — named, cross-folder tags. tagFilterId narrows the browse
  // list to one group from anywhere in the library, independent of the folder tree; tags is the
  // full list for the filter dropdown and the row context menu's "Add to Group" submenu.
  const [tags, setTags] = useState<Array<{ id: number; name: string; itemCount: number }>>([])
  const [tagFilterId, setTagFilterId] = useState<number | null>(null)
  // Faceted filter chips — at most one active value per field (a plain toggle, not a multi-select
  // facet browser). Clicking a badge with the same field+value again clears it.
  const [facets, setFacets] = useState<{ manufacturer?: string; cabinet?: string; speaker?: string; microphone?: string }>({})
  const toggleFacet = useCallback((field: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone', value: string) => {
    setFacets((prev) => {
      if (prev[field] === value) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return { ...prev, [field]: value }
    })
  }, [])
  // Root switcher — null means "All roots" (today's default: browse/search span every root).
  const [selectedRootId, setSelectedRootId] = useState<number | null>(null)
  const [groupsMenuOpen, setGroupsMenuOpen] = useState(false)
  const [addToGroupRow, setAddToGroupRow] = useState<IrItemRow | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
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
  // Tray + Send to IR Lab (plan section 9/Phase 6). trayIds is the fast per-row membership
  // lookup; trayRows is the ordered list the strip renders — kept in IrModeShell rather than a
  // separate component since both the row context menu and the strip need to read/mutate the
  // same state.
  const [trayIds, setTrayIds] = useState<Set<string>>(new Set())
  const [trayRows, setTrayRows] = useState<Array<{ id: string; display_name: string; abs_path: string }>>([])
  const [connectorAvailable, setConnectorAvailable] = useState(false)
  const [sendingTray, setSendingTray] = useState(false)
  const [trayError, setTrayError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: IrItemRow } | null>(null)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('nam-lab-ir-panel-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 256
  })
  // Bumped on every filter/search change so a query response that resolves AFTER a newer filter
  // was already selected gets thrown away instead of populating the cache with stale-context rows
  // (e.g. a slow "all IRs" query resolving after the user already clicked into a folder).
  const requestEpochRef = useRef(0)

  const live = useIrLiveAudition()

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

  const refreshTray = useCallback(() => {
    window.api.irLibraryListTray().then((rows) => {
      setTrayRows(rows)
      setTrayIds(new Set(rows.map((r) => r.id)))
    })
  }, [])

  useEffect(() => {
    refreshTray()
    window.api.irLabConnectorAvailable().then(setConnectorAvailable)
  }, [refreshTray])

  const refreshTags = useCallback(() => {
    window.api.irLibraryListTags().then(setTags)
  }, [])

  useEffect(() => {
    refreshTags()
  }, [refreshTags])

  const addRowToGroup = useCallback(
    async (row: IrItemRow, tagId: number) => {
      await window.api.irLibraryAddItemToTag(row.id, tagId)
      refreshTags()
      setAddToGroupRow(null)
    },
    [refreshTags]
  )

  const createGroupAndAddRow = useCallback(
    async (row: IrItemRow, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const tagId = await window.api.irLibraryGetOrCreateTag(trimmed)
      await addRowToGroup(row, tagId)
      setNewGroupName('')
    },
    [addRowToGroup]
  )

  const toggleTray = useCallback(
    async (row: IrItemRow) => {
      if (trayIds.has(row.id)) {
        await window.api.irLibraryRemoveFromTray(row.id)
      } else {
        const result = await window.api.irLibraryAddToTray(row.id)
        if (!result.success) {
          setTrayError(result.reason ?? 'Could not add to tray')
          setTimeout(() => setTrayError(null), 3000)
        }
      }
      refreshTray()
    },
    [trayIds, refreshTray]
  )

  const sendTrayToIrLab = useCallback(async () => {
    setSendingTray(true)
    setTrayError(null)
    try {
      const result = await window.api.irLibrarySendTrayToIrLab()
      if (!result.success) setTrayError(result.reason ?? 'Failed to send to IR Lab')
    } finally {
      setSendingTray(false)
    }
  }, [])

  // Groups filter dropdown: dismiss on outside click.
  useEffect(() => {
    if (!groupsMenuOpen) return
    const dismiss = (): void => setGroupsMenuOpen(false)
    window.addEventListener('click', dismiss)
    return () => window.removeEventListener('click', dismiss)
  }, [groupsMenuOpen])

  // Context menu: dismiss on outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (): void => setContextMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // New search, folder filter, or a completed scan invalidates every cached index — the same
  // offset can now point at a different row. Deliberately does NOT stop live monitoring (unlike
  // the old offline-DI audition this replaced) — live is a continuous session tied to the chosen
  // amp capture, not to the current search/filter view; stopping it on every keystroke would be
  // far more disruptive than the old mechanism's cheap-to-restart render.
  useEffect(() => {
    requestEpochRef.current++
    cacheRef.current = new Map()
    pendingRef.current = new Set()
    setFocusedIndex(null)
    forceRerender((n) => n + 1)
  }, [search, roots.length, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, selectedRootId])

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
          if (row) void live.playItem(row)
          return next
        })
      } else if (e.key === 'Escape') {
        void live.stop()
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

  const handleImportLabProjects = useCallback(async () => {
    const folder = await window.api.openFolder()
    if (!folder) return
    setScanError(null)
    setImportResult(null)
    setScanning(true)
    setScanProgress({ filesSeen: 0, foldersSeen: 0, elapsedMs: 0 })
    try {
      const result = await window.api.irLibraryImportLabProjects(folder, null)
      await refreshRoots()
      setImportResult(
        result.reusedExistingRoot
          ? `Rescanned existing library — found ${result.projectsFound} IR Lab Project${result.projectsFound === 1 ? '' : 's'}, enriched ${result.itemsEnriched} capture${result.itemsEnriched === 1 ? '' : 's'}.`
          : `Imported ${result.projectsFound} IR Lab Project${result.projectsFound === 1 ? '' : 's'} (${result.itemsEnriched} capture${result.itemsEnriched === 1 ? '' : 's'}); skipped ${result.nonProjectItemsRemoved} non-Project file${result.nonProjectItemsRemoved === 1 ? '' : 's'} found in the same folder.`
      )
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
        .irLibraryQuery({
          libraryRootId: selectedRootId,
          search: search || undefined,
          folderId: selectedFolderId,
          favoritesOnly: favoritesOnly || undefined,
          minRating: ratedOnly ? 1 : undefined,
          tagId: tagFilterId ?? undefined,
          ...facets,
          offset: pageStart,
          limit: pageEnd - pageStart
        })
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
    [search, total, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, selectedRootId]
  )

  // Fires once per search/folder/filter change to establish `total` even before the list scrolls
  // (VirtualList's own effect also triggers a range fetch, but that only runs once `total` — and
  // thus a non-zero row count to scroll through — is already known).
  useEffect(() => {
    const epoch = requestEpochRef.current
    window.api
      .irLibraryQuery({
        libraryRootId: selectedRootId,
        search: search || undefined,
        folderId: selectedFolderId,
        favoritesOnly: favoritesOnly || undefined,
        minRating: ratedOnly ? 1 : undefined,
        tagId: tagFilterId ?? undefined,
        ...facets,
        offset: 0,
        limit: PAGE_SIZE
      })
      .then((res) => {
        if (requestEpochRef.current !== epoch) return
        setTotal(res.total)
        res.rows.forEach((row, i) => cacheRef.current.set(i, row))
        forceRerender((n) => n + 1)
      })
  }, [search, roots.length, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, selectedRootId])

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
  // "All roots" (selectedRootId === null) still needs ONE root to drive the folder tree (a tree
  // has no meaning across multiple roots at once) — falls back to the first, same as the
  // pre-root-switcher behavior, so nothing regresses for the common single-root case.
  const activeRootId = selectedRootId ?? roots[0]?.id ?? null
  const activeRoot = roots.find((r) => r.id === activeRootId) ?? roots[0]

  // Switching roots invalidates whatever folder was selected under the previous one.
  useEffect(() => {
    setSelectedFolderId(null)
    setSelectedFolderName(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRootId])

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

  const onPanelDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = panelWidth
      let latest = panelWidth
      const onMove = (ev: MouseEvent): void => {
        // Panel is on the right, so dragging LEFT (negative delta) widens it — inverse of the
        // tree handle's sign.
        const next = Math.min(480, Math.max(180, startWidth - (ev.clientX - startX)))
        latest = next
        setPanelWidth(next)
      }
      const onUp = (): void => {
        localStorage.setItem('nam-lab-ir-panel-width', String(latest))
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [panelWidth]
  )

  return (
    <div className="flex flex-col h-screen bg-app-bg text-nm-text overflow-hidden">
      <IrMenuBar onAddLibraryFolder={handleAddFolder} onImportLabProjects={handleImportLabProjects} scanning={scanning} />
      <div className="flex items-center gap-3 px-4 py-2 border-b border-nm-border flex-shrink-0">
        <h1 className="text-sm font-semibold text-nm-text-2">IR Library</h1>
        <button
          onClick={handleAddFolder}
          disabled={scanning}
          className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
        >
          {scanning ? 'Scanning…' : 'Add Library Folder'}
        </button>
        {roots.length > 1 && (
          <select
            value={selectedRootId ?? ''}
            onChange={(e) => setSelectedRootId(e.target.value ? Number(e.target.value) : null)}
            title="Scope browse/search and the folder tree to one library folder, or all of them"
            className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text-2 flex-shrink-0 max-w-[180px]"
          >
            <option value="">All roots</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || r.path.split(/[\\/]/).pop() || r.path}
              </option>
            ))}
          </select>
        )}
        {hasAnyRoot && (
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="flex-1 max-w-md px-2 py-1 text-sm rounded border border-field-bd bg-field-bg"
          />
        )}
        {hasAnyRoot && (
          <button
            onClick={() => setFavoritesOnly((v) => !v)}
            title="Favorites only"
            className={`px-2 py-1 text-xs rounded border flex-shrink-0 ${favoritesOnly ? 'bg-active-bg border-nm-accent text-nm-accent' : 'border-field-bd text-nm-text-2 hover:bg-hov'}`}
          >
            ★ Favorites
          </button>
        )}
        {hasAnyRoot && (
          <button
            onClick={() => setRatedOnly((v) => !v)}
            title="Rated only"
            className={`px-2 py-1 text-xs rounded border flex-shrink-0 ${ratedOnly ? 'bg-active-bg border-nm-accent text-nm-accent' : 'border-field-bd text-nm-text-2 hover:bg-hov'}`}
          >
            Rated
          </button>
        )}
        {hasAnyRoot && tags.length > 0 && (
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setGroupsMenuOpen((v) => !v)
              }}
              title="Filter to one group"
              className={`px-2 py-1 text-xs rounded border ${
                tagFilterId != null ? 'bg-active-bg border-nm-accent text-nm-accent' : 'border-field-bd text-nm-text-2 hover:bg-hov'
              }`}
            >
              {tagFilterId != null ? tags.find((t) => t.id === tagFilterId)?.name ?? 'Group' : 'Groups'} ▾
            </button>
            {groupsMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-0 top-full mt-0.5 min-w-[180px] max-h-72 overflow-y-auto py-1 rounded border border-nm-border bg-panel shadow-lg z-50"
              >
                {tagFilterId != null && (
                  <button
                    onClick={() => {
                      setTagFilterId(null)
                      setGroupsMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-hov text-nm-accent"
                  >
                    Clear group filter
                  </button>
                )}
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTagFilterId(t.id)
                      setGroupsMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-hov text-nm-text flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="text-nm-text-3 flex-shrink-0">{t.itemCount}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {hasAnyRoot && <span className="text-xs text-nm-text-3 flex-shrink-0">{total.toLocaleString()} IRs</span>}
        {hasAnyRoot && (
          <button
            onClick={() => (live.running ? void live.stop() : undefined)}
            title={live.running ? 'Click to stop live monitoring' : live.capturePath ? live.captureName ?? undefined : 'Set an amp capture in the Live tab'}
            className={`ml-auto px-2.5 py-1 text-xs rounded border flex-shrink-0 ${
              live.running ? 'border-nm-accent text-nm-accent bg-active-bg' : 'border-field-bd text-nm-text-2 hover:bg-hov'
            }`}
          >
            {live.starting
              ? 'Starting…'
              : live.running
                ? `● Live — ${live.slotA?.display_name ?? '…'}${live.slotB ? ` / ${live.slotB.display_name}` : ''}`
                : 'Live: off'}
          </button>
        )}
      </div>
      {live.error && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">
          Live audition: {live.error}
        </div>
      )}

      {scanning && scanProgress && (
        <div className="px-4 py-1 text-xs text-nm-text-2 bg-active-bg flex-shrink-0">
          Scanning… {scanProgress.filesSeen.toLocaleString()} files, {scanProgress.foldersSeen.toLocaleString()} folders,{' '}
          {(scanProgress.elapsedMs / 1000).toFixed(1)}s
        </div>
      )}
      {scanError && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">{scanError}</div>
      )}
      {importResult && (
        <div className="flex items-center justify-between gap-2 px-4 py-1 text-xs text-nm-text-2 bg-active-bg flex-shrink-0">
          <span>{importResult}</span>
          <button onClick={() => setImportResult(null)} className="text-nm-text-3 hover:text-nm-text flex-shrink-0">
            ×
          </button>
        </div>
      )}
      {selectedFolderId != null && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs bg-panel-2 border-b border-nm-border flex-shrink-0">
          <span className="text-nm-text-2">
            Showing: <span className="font-medium text-nm-text">{selectedFolderName}</span> and its subfolders
          </span>
          <button onClick={clearFolderFilter} className="text-nm-accent hover:underline">
            Clear
          </button>
        </div>
      )}
      {Object.keys(facets).length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 text-xs bg-panel-2 border-b border-nm-border flex-shrink-0">
          <span className="text-nm-text-2">Filtered by:</span>
          {(Object.entries(facets) as Array<[keyof typeof facets, string]>).map(([field, value]) => (
            <span key={field} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-active-bg text-nm-accent">
              {value}
              <button onClick={() => toggleFacet(field, value)} className="hover:text-red-500" title={`Clear ${field} filter`}>
                ×
              </button>
            </span>
          ))}
          <button onClick={() => setFacets({})} className="text-nm-accent hover:underline">
            Clear all
          </button>
        </div>
      )}

      {!hasAnyRoot && !scanning ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 text-nm-text-2">
          <p className="text-sm">No IR library folders added yet.</p>
          <button onClick={handleAddFolder} className="px-3 py-1.5 text-sm rounded bg-nm-accent hover:opacity-90 text-accent-fg">
            Add Library Folder
          </button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div style={{ width: treeWidth }} className="flex-shrink-0 overflow-y-auto">
            <IrFolderTree
              libraryRootCount={roots.length}
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleSelectFolder}
            />
          </div>
          <div
            onMouseDown={onTreeDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-nm-accent/40 active:bg-nm-accent/60 transition-colors"
          />
          <VirtualList
            total={total}
            rowHeight={ROW_HEIGHT}
            onVisibleRangeChange={onVisibleRangeChange}
            className="flex-1"
            renderRow={(index) => {
            const row = cacheRef.current.get(index)
            if (!row) {
              return <div className="h-full border-b border-nm-border-s" />
            }
            const { folder, name } = splitPath(row.relative_path)
            const isSlotA = live.running && live.slotA?.id === row.id
            const isSlotB = live.running && live.slotB?.id === row.id
            const isPlaying = isSlotA || isSlotB
            const isFocused = focusedIndex === index
            return (
              <div
                onClick={() => setFocusedIndex(index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setFocusedIndex(index)
                  setContextMenu({ x: e.clientX, y: e.clientY, row })
                }}
                className={`h-full flex items-center gap-3 px-4 border-b border-nm-border-s hover:bg-hov ${isFocused ? 'bg-active-bg' : ''}`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedIndex(index)
                    if (isPlaying) void live.stop()
                    else void live.playItem({ id: row.id, abs_path: row.abs_path, display_name: row.display_name }, 'A')
                  }}
                  disabled={!live.capturePath}
                  title={
                    live.capturePath
                      ? isPlaying
                        ? 'Stop live monitoring'
                        : 'Audition this IR live (slot A) — right-click for slot B'
                      : 'Set an amp capture in the Live tab first'
                  }
                  className={`flex-shrink-0 text-base w-5 text-center ${
                    isSlotB ? 'text-sky-500' : isSlotA ? 'text-nm-accent' : 'text-nm-text-3 hover:text-nm-accent'
                  } disabled:opacity-30`}
                >
                  {isPlaying ? '■' : '▶'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(row, index)
                  }}
                  title={row.is_favorite ? 'Remove favorite' : 'Add favorite'}
                  className={`flex-shrink-0 text-lg ${row.is_favorite ? 'text-amber-400' : 'text-nm-text-3 hover:text-amber-300'}`}
                >
                  {row.is_favorite ? '★' : '☆'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{name}</div>
                  {folder && <div className="text-xs text-nm-text-3 truncate">{folder}</div>}
                  {(row.manufacturer || row.cabinet || row.speaker || row.microphone) && (
                    <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                      <FieldBadge
                        label="Manufacturer"
                        value={row.manufacturer}
                        source={row.manufacturer_source}
                        active={row.manufacturer != null && facets.manufacturer === row.manufacturer}
                        onClick={() => row.manufacturer && toggleFacet('manufacturer', row.manufacturer)}
                      />
                      <FieldBadge
                        label="Cabinet"
                        value={row.cabinet}
                        source={row.cabinet_source}
                        active={row.cabinet != null && facets.cabinet === row.cabinet}
                        onClick={() => row.cabinet && toggleFacet('cabinet', row.cabinet)}
                      />
                      <FieldBadge
                        label="Speaker"
                        value={row.speaker}
                        source={row.speaker_source}
                        active={row.speaker != null && facets.speaker === row.speaker}
                        onClick={() => row.speaker && toggleFacet('speaker', row.speaker)}
                      />
                      <FieldBadge
                        label="Microphone"
                        value={row.microphone}
                        source={row.microphone_source}
                        active={row.microphone != null && facets.microphone === row.microphone}
                        onClick={() => row.microphone && toggleFacet('microphone', row.microphone)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRating(row, index, n)}
                      className={`text-sm ${row.rating != null && n <= row.rating ? 'text-amber-400' : 'text-nm-text-3 hover:text-amber-300'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <div className="flex-shrink-0 text-xs text-nm-text-3 w-14 text-right">{formatBytes(row.file_size)}</div>
              </div>
            )
          }}
          />
          <div
            onMouseDown={onPanelDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-nm-accent/40 active:bg-nm-accent/60 transition-colors"
          />
          <div style={{ width: panelWidth }} className="flex-shrink-0 overflow-hidden">
            <IrRightPanel
              libraryRootId={activeRootId}
              libraryRootPath={activeRoot?.path ?? null}
              folderId={selectedFolderId}
              folderName={selectedFolderName}
              live={live}
            />
          </div>
        </div>
      )}

      {trayRows.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-nm-border bg-panel-2 flex-shrink-0">
          <span className="text-xs text-nm-text-2 flex-shrink-0">Tray ({trayRows.length}/8)</span>
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            {trayRows.map((row) => (
              <span
                key={row.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-field-bg border border-field-bd text-xs whitespace-nowrap flex-shrink-0"
              >
                {row.display_name}
                <button
                  onClick={() => window.api.irLibraryRemoveFromTray(row.id).then(refreshTray)}
                  className="text-nm-text-3 hover:text-red-500"
                  title="Remove from tray"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <button
            onClick={sendTrayToIrLab}
            disabled={!connectorAvailable || sendingTray}
            title={connectorAvailable ? 'Send this tray to IR Lab’s Blender' : 'IR Lab connector not configured in this build'}
            className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-40 text-accent-fg flex-shrink-0"
          >
            {sendingTray ? 'Sending…' : 'Send to IR Lab'}
          </button>
        </div>
      )}
      {trayError && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">{trayError}</div>
      )}

      {contextMenu && (
        <div
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 200 }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-[180px] py-1 rounded border border-nm-border bg-panel shadow-lg text-xs"
        >
          <button
            onClick={() => {
              window.api.revealFile(contextMenu.row.abs_path)
              setContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hov text-nm-text"
          >
            Reveal in Folder
          </button>
          <button
            onClick={() => {
              toggleTray(contextMenu.row)
              setContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hov text-nm-text"
          >
            {trayIds.has(contextMenu.row.id) ? 'Remove from Tray' : 'Add to Tray'}
          </button>
          <button
            onClick={() => {
              void live.playItem(
                { id: contextMenu.row.id, abs_path: contextMenu.row.abs_path, display_name: contextMenu.row.display_name },
                'A'
              )
              setContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hov text-nm-text"
          >
            Audition Live — Slot A
          </button>
          <button
            onClick={() => {
              void live.playItem(
                { id: contextMenu.row.id, abs_path: contextMenu.row.abs_path, display_name: contextMenu.row.display_name },
                'B'
              )
              setContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hov text-nm-text"
          >
            Audition Live — Slot B (blend)
          </button>
          <button
            onClick={() => {
              setAddToGroupRow(contextMenu.row)
              setContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hov text-nm-text"
          >
            Add to Group…
          </button>
          <div className="border-t border-nm-border-s my-1" />
          {/* Placeholder for the rest of section 12's roadmap (collections beyond tray/groups, IR
              Lab handoff beyond blend) — a stub row rather than inventing menu items that don't
              do anything, per the user's own framing ("add a reveal in folder...or add to tray
              etc until we build it up"). */}
          <div className="px-3 py-1 text-nm-text-3 italic">More actions coming soon</div>
        </div>
      )}

      {addToGroupRow && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setAddToGroupRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-72 rounded border border-nm-border bg-panel shadow-lg p-3 flex flex-col gap-2"
          >
            <div className="text-sm font-medium text-nm-text truncate">Add "{addToGroupRow.display_name}" to a group</div>
            {tags.length > 0 && (
              <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => void addRowToGroup(addToGroupRow, t.id)}
                    className="text-left px-2 py-1 text-xs rounded hover:bg-hov text-nm-text"
                  >
                    {t.name} <span className="text-nm-text-3">({t.itemCount})</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1 border-t border-nm-border-s">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createGroupAndAddRow(addToGroupRow, newGroupName)
                }}
                placeholder="New group name…"
                autoFocus
                className="flex-1 px-2 py-1 text-xs rounded border border-field-bd bg-field-bg"
              />
              <button
                onClick={() => void createGroupAndAddRow(addToGroupRow, newGroupName)}
                disabled={!newGroupName.trim()}
                className="px-2 py-1 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-40 flex-shrink-0"
              >
                Create
              </button>
            </div>
            <button onClick={() => setAddToGroupRow(null)} className="self-end text-xs text-nm-text-3 hover:text-nm-text">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

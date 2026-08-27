import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtualList } from './VirtualList'
import { IrFolderTree } from './IrFolderTree'
import { IrRightPanel } from './IrRightPanel'
import { IrMenuBar } from './IrMenuBar'
import { ContextMenu } from '../ContextMenu'
import { IrTray } from './IrTray'
import { IrFilterBar } from './IrFilterBar'
import { PlayerPanel } from '../PlayerPanel'
import { loadNamFileForPlayback } from '../../utils/loadNamFile'
import type { NamFile } from '../../types/nam'
import guitarJackIcon from '../../assets/icons/guitar-jack.png'
import { formatSampleRate } from '../../../../shared/wavFormat'

/** The amp capture IRs are auditioned through, remembered across restarts. */
const AMP_CAPTURE_KEY = 'nam-lab-ir-mode-live-capture-path'

type IrItemRow = {
  id: string
  relative_path: string
  display_name: string
  file_size: number | null
  is_favorite: number
  rating: number | null
  missing_since: string | null
  manufacturer: string | null
  manufacturer_source: string | null
  cabinet: string | null
  cabinet_source: string | null
  speaker: string | null
  speaker_source: string | null
  microphone: string | null
  microphone_source: string | null
  sample_rate: number | null
  bit_depth: number | null
  channels: number | null
  duration_seconds: number | null
  audio_format: string | null
  abs_path: string
}

type LibraryRoot = { id: number; path: string; label: string | null; watch_mode: string; created_at: string }

const ROW_HEIGHT = 72
const PAGE_SIZE = 200

/**
 * Confidence-ladder badge color (plan section 3) — "a small badge, not a modal," per field.
 * Only the two sources Phase 3's parsers actually produce are handled; ir_lab_native/
 * vendor_documentation/user_entered aren't written by any code yet (Phase 4/5/UI-editing).
 */

/** Faceted filter chip (plan: "click-to-narrow-by-field UI"). Clicking a badge sets that field as
 * the ONLY active filter for it (clicking an active badge again clears it) — a plain toggle, not
 * a multi-select facet browser, matching the scope actually asked for. */
/** Field type -> chip color, one of the `chip-ir-*` classes added to index.css alongside NAM
 * Lab's own gear/tone chip colors — same `.nam-chip` system, so these pills follow the user's
 * global soft/solid/minimal chip-style setting instead of hardcoding one look. */
const FIELD_CHIP_CLASS: Record<string, string> = {
  manufacturer: 'chip-ir-manufacturer',
  cabinet: 'chip-ir-cabinet',
  speaker: 'chip-ir-speaker',
  microphone: 'chip-ir-mic'
}

function FieldBadge({
  field,
  label,
  value,
  source,
  active,
  onClick
}: {
  field: keyof typeof FIELD_CHIP_CLASS
  label: string
  value: string | null
  source: string | null
  active?: boolean
  onClick?: () => void
}): React.ReactElement | null {
  if (!value) return null
  // A filename guess is the lowest-confidence source, so its pill is dimmed rather than full
  // strength — the color still says what KIND of fact this is, the opacity says how sure we are.
  const isGuess = source === 'filename_inferred' || source == null
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`${label}: ${value} (${
        source === 'vendor_parser'
          ? 'vendor parser'
          : source === 'filename_inferred'
            ? 'filename guess'
            : source === 'ir_lab_native'
              ? 'IR Lab'
              : source === 'ir_lab_embedded'
                ? "IR Lab, embedded in the file"
                : source === 'ir_lab_project'
                  ? 'inherited from the IR Lab Project'
                  : 'unknown source'
      }) — click to filter`}
      className={`nam-chip ${FIELD_CHIP_CLASS[field]} flex-shrink-0 ${isGuess ? 'opacity-60' : ''} ${
        active ? 'ring-1 ring-nm-accent' : ''
      }`}
    >
      <span className="nam-dot" />
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
 * (section 3) per field.
 *
 * Audition renders NAM Lab's OWN `PlayerPanel` (section 8b) — the same component NAM mode uses,
 * not a second player. Clicking a row's play button replaces the right panel with it, exactly the
 * way NAM mode's list does, which brings all three of its views over as-is: the DI/Preview
 * player, the inline Live player, and the full-screen Live rig (with its pop-out arrow, tuner,
 * RIG presets and photoreal racks). The IR being auditioned drives PlayerPanel's cabinet through
 * its `cabIrPath` controlled prop, and the amp capture it plays through is picked once and
 * remembered. An earlier version of this file grew its own parallel player (a bespoke hook plus a
 * thinner FX UI) — that was duplication of something already built and working, and was deleted
 * rather than kept alongside.
 *
 * Faceted filter chips (section 7) — clicking a row's manufacturer/cabinet/speaker/microphone
 * badge narrows the list to exactly that value (queryLibrary.ts's facet WHERE clauses); clicking
 * the same badge again clears it. Root switcher — a dropdown next to search scopes browse/search
 * to one library_root or all of them.
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
  // Faceted filter chips. `cabinet` stays single-value (only ever set by clicking a row's cabinet
  // badge — no multiselect UI offers it, since vocabulary.ts has no cabinet term list and it's
  // rarely populated). manufacturer/speaker/microphone are arrays, OR'd together, driven by both
  // the row-badge single click (IrFilterBar's toggle helpers below) AND the new filter bar's
  // multiselect checklists ("multiselect on microphones... and speaker, same idea").
  const [facets, setFacets] = useState<{ manufacturer?: string[]; cabinet?: string; speaker?: string[]; microphone?: string[] }>({})
  const toggleFacet = useCallback((field: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone', value: string) => {
    setFacets((prev) => {
      if (field === 'cabinet') {
        const next = { ...prev }
        if (prev.cabinet === value) delete next.cabinet
        else next.cabinet = value
        return next
      }
      const current = prev[field] ?? []
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      return { ...prev, [field]: next.length > 0 ? next : undefined }
    })
  }, [])
  // Technical-format facets, separate state from the descriptive ones above because they filter
  // on numbers rather than strings (queryLibrary's sampleRate/bitDepth/channels options). Arrays
  // for the same reason as manufacturer/speaker/microphone above — the filter bar's quick pills
  // are multi-select ("44.1k or 48k"), not a single radio choice.
  const [audioFacets, setAudioFacets] = useState<{ sampleRate?: number[]; bitDepth?: number[] }>({})
  const toggleAudioFacet = useCallback((field: 'sampleRate' | 'bitDepth', value: number) => {
    setAudioFacets((prev) => {
      const current = prev[field] ?? []
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      return { ...prev, [field]: next.length > 0 ? next : undefined }
    })
  }, [])
  // Root switcher — null means "All roots" (today's default: browse/search span every root).
  const [selectedRootId, setSelectedRootId] = useState<number | null>(null)
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

  // ── Audition, via NAM Lab's own PlayerPanel (see this component's header comment).
  // `playerIr` is the IR currently loaded into the player's cabinet AND the "is the player open"
  // flag — the two are the same thing here, since the player only exists to audition an IR.
  const [playerIr, setPlayerIr] = useState<IrItemRow | null>(null)
  const [ampCapture, setAmpCapture] = useState<NamFile | null>(null)
  const [ampCaptureError, setAmpCaptureError] = useState<string | null>(null)
  // Bumped to ask PlayerPanel to jump straight to its full-screen rig — the same self-clearing
  // one-shot protocol NAM Lab's list uses for its own "Play Live" button.
  const [liveJumpRequest, setLiveJumpRequest] = useState<number | null>(null)
  // "Highlight the capture if someone tries to open one and realizes it doesn't exist" — set when
  // openPlayer's availability check finds the file gone, cleared on dismiss/action. Carries enough
  // of the check result to render the right dialog copy and offer the right actions.
  const [missingFileInfo, setMissingFileInfo] = useState<{
    row: IrItemRow
    jumpLive: boolean
    missingScope: 'item' | 'folder' | 'root'
    missingFolderId?: number
    missingFolderName?: string
    libraryRootId: number
    libraryRootLabel: string
    affectedItemCount: number
  } | null>(null)
  const [missingFileBusy, setMissingFileBusy] = useState(false)
  // Read straight from preload rather than App.tsx's state: settings.json is loaded synchronously
  // in preload and exposed as window.api.initialSettings, so IR mode can read the very same
  // library paths and FX presets NAM mode passes to PlayerPanel without needing the two React
  // trees to share state (which they don't — see AppRoot.tsx).
  const settings = (window.api.initialSettings ?? {}) as Record<string, unknown>
  const str = (key: string): string | null => (typeof settings[key] === 'string' ? (settings[key] as string) || null : null)
  const arr = <T,>(key: string): T[] => (Array.isArray(settings[key]) ? (settings[key] as T[]) : [])

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

  // The amp capture the IR is auditioned THROUGH. Picked once, remembered across restarts, and
  // loaded lazily — the player can't open without one, so the first play prompts for it.
  const applyAmpCapturePath = useCallback(async (path: string, remember: boolean): Promise<void> => {
    const loaded = await loadNamFileForPlayback(path)
    if (!loaded) {
      // A remembered path can go stale (file moved/deleted). Forget it so the next attempt asks
      // again rather than failing identically forever.
      try {
        localStorage.removeItem(AMP_CAPTURE_KEY)
      } catch {
        // Non-fatal.
      }
      setAmpCapture(null)
      setAmpCaptureError(`Could not read the amp capture: ${path}`)
      return
    }
    if (remember) {
      try {
        localStorage.setItem(AMP_CAPTURE_KEY, path)
      } catch {
        // Non-fatal — worst case the choice doesn't survive a restart.
      }
    }
    setAmpCaptureError(null)
    setAmpCapture(loaded)
  }, [])

  // Restore the remembered amp capture once, quietly, on mount — so a returning user never sees
  // the "choose one" prompt again.
  useEffect(() => {
    let remembered: string | null = null
    try {
      remembered = localStorage.getItem(AMP_CAPTURE_KEY)
    } catch {
      // Non-fatal.
    }
    if (remembered) void applyAmpCapturePath(remembered, false)
  }, [applyAmpCapturePath])

  /** Explicit, user-initiated amp-capture picker. Only ever called from a button the user
   * actually clicked — never as a side effect of pressing play. */
  const chooseAmpCapture = useCallback(async () => {
    const picked = await window.api.openFiles()
    if (picked.length === 0) return
    await applyAmpCapturePath(picked[0], true)
  }, [applyAmpCapturePath])

  /** Opens the player on `row`. `jumpLive` mirrors NAM Lab's "Play Live" — straight to the
   * full-screen rig instead of landing in Preview first.
   *
   * Deliberately does NOT require an amp capture first. An earlier version awaited a picker here,
   * so the very first press of play opened an OS file dialog instead of the player — reported as
   * "why do the play and live play new buttons open a file picker and not the page". NAM Lab
   * never does that (there, the row IS the capture), so the player opens immediately and asks for
   * the amp capture inline, in the panel, where the request has visible context. */
  const openPlayer = useCallback((row: IrItemRow, jumpLive: boolean) => {
    // Checked at the moment of actually trying to open a capture — not on a timer, not for every
    // row in view — matching this app's "detect on demand, not a live watcher" model
    // (missingFileCheck.ts's own header comment has the full reasoning). A single stat() round
    // trip is imperceptible; it's not an OS dialog, so this doesn't reintroduce the earlier
    // file-picker-instead-of-player bug.
    window.api.irLibraryCheckItemAvailability(row.id).then((result) => {
      if (!result.fileMissing) {
        setPlayerIr(row)
        if (jumpLive) setLiveJumpRequest(Date.now())
        return
      }
      setMissingFileInfo({
        row,
        jumpLive,
        missingScope: result.missingScope!,
        missingFolderId: result.missingFolderId,
        missingFolderName: result.missingFolderName,
        libraryRootId: result.libraryRootId,
        libraryRootLabel: result.libraryRootLabel,
        affectedItemCount: result.affectedItemCount
      })
      // The row's own badge should reflect this immediately, without waiting for a rescan —
      // missingFileCheck.ts already set missing_since in the DB; bump the cache/epoch so the
      // visible row re-renders with it.
      requestEpochRef.current++
      cacheRef.current = new Map()
      forceRerender((n) => n + 1)
    })
  }, [])

  // New search, folder filter, or a completed scan invalidates every cached index — the same
  // offset can now point at a different row. Deliberately does NOT close the player — it's tied
  // to the IR being auditioned, not to the current browse view, and tearing down the live engine
  // on every keystroke would be far more disruptive than leaving it playing.
  useEffect(() => {
    requestEpochRef.current++
    cacheRef.current = new Map()
    pendingRef.current = new Set()
    setFocusedIndex(null)
    forceRerender((n) => n + 1)
  }, [search, roots.length, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, selectedRootId])

  // Arrow-key navigation through the current filtered list (plan section 8). While the player is
  // open this also swaps the cabinet as you move, which is the whole point — step down the list
  // and hear each IR. Ignored while a text input has focus so it doesn't fight the search box's
  // own cursor keys.
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
          // what VirtualList has fetched), the cab silently doesn't change — no retry once it
          // arrives. Acceptable for a first cut; revisit if it's actually annoying in practice.
          // Only swaps an ALREADY-open player; arrowing around with it closed just moves focus.
          if (row && playerIr) setPlayerIr(row)
          return next
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, playerIr])

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

  /** Re-runs the full scan pipeline over every already-added root. See IrMenuBar's own comment for
   * why this exists as its own action rather than relying on re-picking a folder. */
  const handleRescan = useCallback(async () => {
    if (roots.length === 0) return
    setScanError(null)
    setImportResult(null)
    setScanning(true)
    setScanProgress({ filesSeen: 0, foldersSeen: 0, elapsedMs: 0 })
    try {
      for (const root of roots) {
        await window.api.irLibraryScan(root.path, root.label)
      }
      await refreshRoots()
      // Bump the epoch so every cached page is refetched with the newly-populated columns.
      requestEpochRef.current++
      cacheRef.current = new Map()
      pendingRef.current = new Set()
      forceRerender((n) => n + 1)
      setImportResult(`Rescanned ${roots.length} librar${roots.length === 1 ? 'y' : 'ies'}.`)
    } catch (err) {
      setScanError(String(err))
    } finally {
      setScanning(false)
    }
  }, [roots, refreshRoots])

  // Fired by IrFolderTree after a folder or whole root is actually removed from the catalog
  // (removeFromCatalog.ts). The removed folder may have been the one currently selected/scoped —
  // clearing it here rather than leaving a stale folderId pointed at a row that no longer exists.
  const handleLibraryChanged = useCallback(() => {
    setSelectedFolderId(null)
    setSelectedFolderName(null)
    void refreshRoots()
    requestEpochRef.current++
    cacheRef.current = new Map()
    pendingRef.current = new Set()
    forceRerender((n) => n + 1)
  }, [refreshRoots])

  // "Ask if they want to remove from the app or find the folder and restore it" — the two actions
  // offered by the missing-file dialog. "Locate…" only ever shows for missingScope 'root' (see
  // missingFileCheck.ts's relinkLibraryRoot for why a subfolder can't be cleanly relinked to an
  // arbitrary new location, only a whole added root can).
  const handleMissingFileAction = useCallback(
    async (action: 'remove' | 'locate') => {
      if (!missingFileInfo) return
      setMissingFileBusy(true)
      try {
        if (action === 'remove') {
          if (missingFileInfo.missingScope === 'item') {
            await window.api.irLibraryRemoveItemFromCatalog(missingFileInfo.row.id)
          } else if (missingFileInfo.missingScope === 'folder' && missingFileInfo.missingFolderId != null) {
            await window.api.irLibraryRemoveFolderFromCatalog(missingFileInfo.missingFolderId)
          } else if (missingFileInfo.missingScope === 'root') {
            await window.api.irLibraryRemoveLibraryRoot(missingFileInfo.libraryRootId)
          }
        } else {
          const newPath = await window.api.openFolder()
          if (!newPath) return
          await window.api.irLibraryRelinkLibraryRoot(missingFileInfo.libraryRootId, newPath)
          const rootLabel = roots.find((r) => r.id === missingFileInfo.libraryRootId)?.label ?? null
          setScanning(true)
          try {
            await window.api.irLibraryScan(newPath, rootLabel)
          } finally {
            setScanning(false)
          }
        }
        handleLibraryChanged()
      } finally {
        setMissingFileBusy(false)
        setMissingFileInfo(null)
      }
    },
    [missingFileInfo, roots, handleLibraryChanged]
  )

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
          ...audioFacets,
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
    [search, total, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, selectedRootId]
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
        ...audioFacets,
        offset: 0,
        limit: PAGE_SIZE
      })
      .then((res) => {
        if (requestEpochRef.current !== epoch) return
        setTotal(res.total)
        res.rows.forEach((row, i) => cacheRef.current.set(i, row))
        forceRerender((n) => n + 1)
      })
  }, [search, roots.length, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, selectedRootId])

  const toggleFavorite = useCallback((row: IrItemRow, index: number) => {
    const next = row.is_favorite ? 0 : 1
    cacheRef.current.set(index, { ...row, is_favorite: next })
    forceRerender((n) => n + 1)
    window.api.irLibrarySetFavorite(row.id, next === 1)
  }, [])

  /** Ratings persist fine (queryLibrary.setRating + the "Rated" quick filter both still work);
   * only the per-row star strip is currently unrendered, pending a decision on where ratings
   * belong in the row now that actions have moved to the right. Kept rather than deleted so
   * turning them back on is a render change, not a rebuild. */
  const setRating = useCallback((row: IrItemRow, index: number, rating: number) => {
    const next = row.rating === rating ? null : rating
    cacheRef.current.set(index, { ...row, rating: next })
    forceRerender((n) => n + 1)
    window.api.irLibrarySetRating(row.id, next)
  }, [])
  void setRating

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

  // Picking a group clears EVERY other narrowing filter first — folder/root scope, any facet
  // chips, favorites/rated, and search text. A group is deliberately cross-folder AND cross-root
  // (tag.ts: "across anywhere in your library"), but the browse query ANDs every active filter
  // together — so with ANY of them still set, a group whose item doesn't also happen to match
  // that leftover filter silently returned zero rows while the Groups menu still showed a
  // non-zero item count. First reported for folder/root scope specifically ("i see i have a group
  // with 1 item, but when i click it, nothing shows"); reported again after that fix ("filtering
  // groups still does nothing") — the second report is what makes clearing folder/root alone not
  // enough: whatever OTHER filter was still active (a facet chip, Favorites/Rated, leftover
  // search text) was doing the exact same thing. Clicking a group should always show exactly its
  // members, not its members ANDed with whatever was left over from browsing before.
  const selectTagFilter = useCallback((id: number | null) => {
    if (id != null) {
      setSelectedFolderId(null)
      setSelectedFolderName(null)
      setSelectedRootId(null)
      setFacets({})
      setAudioFacets({})
      setFavoritesOnly(false)
      setRatedOnly(false)
      setSearchInput('')
      setSearch('')
    }
    setTagFilterId(id)
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
        // tree handle's sign. Bounded dynamically by the actual window width (same idea as NAM
        // Lab's own App.tsx pane-resize logic) rather than a small fixed cap — 480px left the
        // panel barely able to move at all before hitting its ceiling, reported directly ("seems
        // i cant drag the right panel very far, give it way more space to move left"). 300px is
        // reserved for the list column so it's narrowed, never squeezed to nothing.
        const maxWidth = Math.max(180, window.innerWidth - treeWidth - 300)
        const next = Math.min(maxWidth, Math.max(180, startWidth - (ev.clientX - startX)))
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
    [panelWidth, treeWidth]
  )

  return (
    <div className="flex flex-col h-screen bg-app-bg text-nm-text overflow-hidden">
      <IrMenuBar
        onAddLibraryFolder={handleAddFolder}
        onImportLabProjects={handleImportLabProjects}
        onRescan={() => void handleRescan()}
        canRescan={roots.length > 0}
        scanning={scanning}
      />
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
        {hasAnyRoot && <span className="text-xs text-nm-text-3 flex-shrink-0">{total.toLocaleString()} IRs</span>}
        {hasAnyRoot && ampCapture && (
          <button
            onClick={() => void chooseAmpCapture()}
            title={`Auditioning through ${ampCapture.filePath} — click to choose a different amp capture`}
            className="ml-auto px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0 max-w-[220px] truncate"
          >
            Amp: {ampCapture.metadata.name || ampCapture.fileName}
          </button>
        )}
      </div>
      {ampCaptureError && (
        <div className="px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">
          {ampCaptureError}
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
              onLibraryChanged={handleLibraryChanged}
            />
          </div>
          <div
            onMouseDown={onTreeDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-nm-accent/40 active:bg-nm-accent/60 transition-colors"
          />
          {/* Search/filter bar sits in its own flex-col wrapping ONLY the list column — same idea
              as NAM Lab's own FileList.tsx, whose search+filter row lives inside the file list
              component itself rather than spanning the folder tree and the right panel too. */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <IrFilterBar
              search={searchInput}
              onSearchChange={setSearchInput}
              favoritesOnly={favoritesOnly}
              onToggleFavoritesOnly={() => setFavoritesOnly((v) => !v)}
              ratedOnly={ratedOnly}
              onToggleRatedOnly={() => setRatedOnly((v) => !v)}
              tags={tags}
              tagFilterId={tagFilterId}
              onSelectTag={selectTagFilter}
              libraryRootId={selectedRootId}
              folderId={selectedFolderId}
              facets={facets}
              audioFacets={audioFacets}
              onToggleFacet={toggleFacet}
              onToggleAudioFacet={toggleAudioFacet}
              onClearAll={() => {
                setFacets({})
                setAudioFacets({})
                setFavoritesOnly(false)
                setRatedOnly(false)
                setTagFilterId(null)
              }}
              refreshKey={requestEpochRef.current}
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
            const isPlaying = playerIr?.id === row.id
            const isFocused = focusedIndex === index
            return (
              <div
                onClick={() => setFocusedIndex(index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setFocusedIndex(index)
                  setContextMenu({ x: e.clientX, y: e.clientY, row })
                }}
                className={`group h-full flex items-center gap-3 px-4 border-b border-nm-border-s hover:bg-hov ${isFocused ? 'bg-active-bg' : ''}`}
              >
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 py-1.5">
                  <div className="text-sm truncate leading-tight">{name}</div>
                  {folder && <div className="text-[11px] text-nm-text-3 truncate leading-tight">{folder}</div>}
                  {/* Audio-format pills and gear pills share ONE non-wrapping row rather than each
                      stacking on its own line — the row is wide enough, and a fixed-height virtual
                      list row can't grow to fit a third or fourth wrapped line without pills
                      overlapping the row below it (the bug reported from the previous build).
                      Anything past the available width is clipped by overflow-hidden rather than
                      wrapping down into the next row. */}
                  {(row.missing_since || row.sample_rate || row.channels || row.duration_seconds || row.manufacturer || row.cabinet || row.speaker || row.microphone) && (
                    <div className="flex items-center gap-1 overflow-hidden">
                      {row.missing_since && (
                        <span
                          className="nam-chip chip-ir-missing flex-shrink-0"
                          title={`File not found on disk since ${new Date(row.missing_since).toLocaleString()} — click Play to see options`}
                        >
                          <span className="nam-dot" />
                          Missing
                        </span>
                      )}
                      {row.sample_rate ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleAudioFacet('sampleRate', row.sample_rate!)
                          }}
                          title="Filter to this sample rate"
                          className={`nam-chip chip-ir-rate flex-shrink-0 ${audioFacets.sampleRate?.includes(row.sample_rate!) ? 'ring-1 ring-nm-accent' : ''}`}
                        >
                          <span className="nam-dot" />
                          {formatSampleRate(row.sample_rate)}
                        </button>
                      ) : null}
                      {row.bit_depth ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleAudioFacet('bitDepth', row.bit_depth!)
                          }}
                          title="Filter to this bit depth"
                          className={`nam-chip chip-ir-depth flex-shrink-0 ${audioFacets.bitDepth?.includes(row.bit_depth!) ? 'ring-1 ring-nm-accent' : ''}`}
                        >
                          <span className="nam-dot" />
                          {row.bit_depth}-bit
                        </button>
                      ) : null}
                      {row.channels ? (
                        <span className="nam-chip chip-ir-channels flex-shrink-0">
                          <span className="nam-dot" />
                          {row.channels === 1 ? 'mono' : row.channels === 2 ? 'stereo' : `${row.channels}ch`}
                        </span>
                      ) : null}
                      {row.duration_seconds ? (
                        <span className="nam-chip chip-ir-length flex-shrink-0">
                          <span className="nam-dot" />
                          {row.duration_seconds.toFixed(2)}s
                        </span>
                      ) : null}
                      <FieldBadge
                        field="manufacturer"
                        label="Manufacturer"
                        value={row.manufacturer}
                        source={row.manufacturer_source}
                        active={row.manufacturer != null && (facets.manufacturer?.includes(row.manufacturer) ?? false)}
                        onClick={() => row.manufacturer && toggleFacet('manufacturer', row.manufacturer)}
                      />
                      <FieldBadge
                        field="cabinet"
                        label="Cabinet"
                        value={row.cabinet}
                        source={row.cabinet_source}
                        active={row.cabinet != null && facets.cabinet === row.cabinet}
                        onClick={() => row.cabinet && toggleFacet('cabinet', row.cabinet)}
                      />
                      <FieldBadge
                        field="speaker"
                        label="Speaker"
                        value={row.speaker}
                        source={row.speaker_source}
                        active={row.speaker != null && (facets.speaker?.includes(row.speaker) ?? false)}
                        onClick={() => row.speaker && toggleFacet('speaker', row.speaker)}
                      />
                      <FieldBadge
                        field="microphone"
                        label="Microphone"
                        value={row.microphone}
                        source={row.microphone_source}
                        active={row.microphone != null && (facets.microphone?.includes(row.microphone) ?? false)}
                        onClick={() => row.microphone && toggleFacet('microphone', row.microphone)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 text-xs text-nm-text-3 w-14 text-right">{formatBytes(row.file_size)}</div>
                {/* Actions live to the RIGHT of the name, same side and same order as NAM Lab's
                    own rows (FileList.tsx): favourite, then play, then Play Live. Identical size,
                    icons, colors and hover treatment — faint at rest, growing to a solid filled
                    circle on row hover.
                    Rating stars are deliberately not rendered for now (see setRating's comment):
                    hidden pending a decision on where they belong, not removed. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(row, index)
                  }}
                  title={row.is_favorite ? 'Remove favorite' : 'Add favorite'}
                  className={`flex-shrink-0 self-center text-lg ${row.is_favorite ? 'text-amber-400' : 'text-nm-text-3 hover:text-amber-300'}`}
                >
                  {row.is_favorite ? '★' : '☆'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedIndex(index)
                    openPlayer(row, false)
                  }}
                  title="Play this IR through an amp capture"
                  className={`flex-shrink-0 self-center w-9 h-9 rounded-full flex items-center justify-center group-hover:opacity-100 transition-all duration-150 text-green-500 dark:text-green-400 hover:bg-green-500 hover:text-white dark:hover:bg-green-500 dark:hover:text-white hover:!bg-green-600 ${
                    isPlaying ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5.14v14l11-7-11-7z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedIndex(index)
                    openPlayer(row, true)
                  }}
                  title="Play Live — open straight to the full-screen rig"
                  className="flex-shrink-0 self-center w-9 h-9 rounded-full flex items-center justify-center opacity-40 group-hover:opacity-100 text-pink-500 dark:text-pink-400 hover:bg-pink-500 hover:text-white dark:hover:bg-pink-500 dark:hover:text-white transition-all duration-150"
                >
                  <span
                    className="block w-4 h-4"
                    style={{
                      backgroundColor: 'currentColor',
                      WebkitMaskImage: `url(${guitarJackIcon})`,
                      maskImage: `url(${guitarJackIcon})`,
                      WebkitMaskSize: 'contain',
                      maskSize: 'contain',
                      WebkitMaskRepeat: 'no-repeat',
                      maskRepeat: 'no-repeat',
                      WebkitMaskPosition: 'center',
                      maskPosition: 'center'
                    }}
                  />
                </button>
              </div>
            )
          }}
            />
          </div>
          <div
            onMouseDown={onPanelDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-nm-accent/40 active:bg-nm-accent/60 transition-colors"
          />
          <div style={{ width: panelWidth }} className="flex-shrink-0 overflow-hidden">
            {/* The player REPLACES the tabs while it's open, exactly as NAM mode's own list does
                (App.tsx renders PlayerPanel in place of the metadata editor) — its X closes back
                to the tabs. Deliberately not keyed by IR: remounting per IR would tear down the
                live engine and reload the DI/IR libraries on every click, which is precisely what
                makes stepping through cabinets by ear impossible. The panel takes the new cabinet
                through its controlled `cabIrPath` prop instead. */}
            {playerIr && ampCapture ? (
              <PlayerPanel
                file={ampCapture}
                titleOverride={playerIr.display_name.replace(/\.wav$/i, '')}
                cabIrPath={playerIr.abs_path}
                onCabIrPathChange={(path) => {
                  // The player's own cab picker changed the IR out from under the browse list.
                  // Nothing in the catalog matches an arbitrary picked path, so drop the list
                  // linkage rather than showing a row as playing when it isn't.
                  if (path !== playerIr.abs_path) setPlayerIr(null)
                }}
                onClose={() => {
                  setPlayerIr(null)
                  setLiveJumpRequest(null)
                }}
                diLibraryPath={str('diPreviewLibraryPath')}
                irLibraryPath={str('irLibraryPath')}
                reverbLibraryPath={str('reverbLibraryPath')}
                delayLibraryPath={str('delayLibraryPath')}
                irMix={typeof settings.irMix === 'number' ? (settings.irMix as number) : 1}
                chorusPresets={arr('chorusPresets')}
                delayPresets={arr('delayPresets')}
                reverbPresets={arr('reverbPresets')}
                echoLabPresets={arr('echoLabPresets')}
                rigPresets={arr('rigPresets')}
                autoStartLiveOnPopout={settings.autoStartLiveOnPopout === true}
                liveJumpRequest={liveJumpRequest}
                onLiveJumpHandled={() => setLiveJumpRequest(null)}
              />
            ) : playerIr ? (
              /* Player requested, but there's no amp capture to play the IR through yet. Ask for
                 it HERE, in the panel, with the IR you clicked named right above the button —
                 rather than firing an OS file dialog straight off the play button, which is what
                 the first version did and gave no clue what was being asked for or why. */
              <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="text-sm text-nm-text">{playerIr.display_name.replace(/\.wav$/i, '')}</div>
                <div className="text-xs text-nm-text-3 max-w-[260px]">
                  Pick an amp capture to hear this IR through. Chosen once and remembered — every IR
                  you play afterwards uses it.
                </div>
                <button
                  onClick={() => void chooseAmpCapture()}
                  className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90"
                >
                  Choose amp capture…
                </button>
                <button onClick={() => setPlayerIr(null)} className="text-xs text-nm-text-3 hover:text-nm-text">
                  Cancel
                </button>
              </div>
            ) : (
              <IrRightPanel
                libraryRootId={activeRootId}
                libraryRootPath={activeRoot?.path ?? null}
                folderId={selectedFolderId}
                folderName={selectedFolderName}
                onFacet={toggleFacet}
                onAudioFacet={toggleAudioFacet}
                activeFacets={facets}
                activeAudioFacets={audioFacets}
              />
            )}
          </div>
        </div>
      )}

      <IrTray
        rows={trayRows}
        onRemove={(id) => void window.api.irLibraryRemoveFromTray(id).then(refreshTray)}
        onClear={() => {
          void Promise.all(trayRows.map((r) => window.api.irLibraryRemoveFromTray(r.id))).then(refreshTray)
        }}
        onPlay={(row) => {
          const full = cacheRef.current.get(focusedIndex ?? -1)
          // The tray row carries only id/name/path; openPlayer wants the full browse row. Use the
          // cached one when it happens to be the same item, otherwise synthesise the minimum the
          // player actually reads (name for the title, abs_path for the cabinet).
          openPlayer(
            full && full.id === row.id
              ? full
              : ({ ...row, relative_path: row.display_name } as unknown as IrItemRow),
            false
          )
        }}
        onSendToIrLab={() => void sendTrayToIrLab()}
        connectorAvailable={connectorAvailable}
        sending={sendingTray}
        error={trayError}
      />

      {missingFileInfo && (
        <div
          className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center"
          onClick={() => !missingFileBusy && setMissingFileInfo(null)}
        >
          <div
            className="bg-panel border border-nm-border rounded-xl p-5 w-[420px] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-nm-text">File not found</div>
            <div className="text-xs text-nm-text-2 leading-relaxed">
              {missingFileInfo.missingScope === 'item' && (
                <>
                  <span className="font-medium text-nm-text">"{missingFileInfo.row.display_name}"</span> couldn&apos;t be found on
                  disk. Its containing folder is still there — just this one file appears to have been moved or deleted.
                </>
              )}
              {missingFileInfo.missingScope === 'folder' && (
                <>
                  The folder <span className="font-medium text-nm-text">"{missingFileInfo.missingFolderName}"</span> couldn&apos;t
                  be found on disk — it, and {missingFileInfo.affectedItemCount.toLocaleString()} capture
                  {missingFileInfo.affectedItemCount === 1 ? '' : 's'} inside it, appear to have been moved or deleted together.
                </>
              )}
              {missingFileInfo.missingScope === 'root' && (
                <>
                  The whole library folder <span className="font-medium text-nm-text">"{missingFileInfo.libraryRootLabel}"</span>{' '}
                  couldn&apos;t be found on disk — all {missingFileInfo.affectedItemCount.toLocaleString()} captures in it appear to
                  have moved (a rename, a relocated drive, or a changed drive letter) or been deleted.
                </>
              )}
              <br />
              <br />
              {missingFileInfo.missingScope === 'root'
                ? 'If it moved, locate its new folder to relink everything in place. Otherwise, remove it from the catalog.'
                : 'Remove it from the catalog, or leave it — it stays marked "Missing" until it either reappears on a rescan or you remove it.'}
            </div>
            <div className="flex items-center justify-end gap-2 mt-1 flex-wrap">
              <button
                onClick={() => setMissingFileInfo(null)}
                disabled={missingFileBusy}
                className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
              >
                Leave it
              </button>
              {missingFileInfo.missingScope === 'root' && (
                <button
                  onClick={() => void handleMissingFileAction('locate')}
                  disabled={missingFileBusy}
                  className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
                >
                  {missingFileBusy ? 'Working…' : 'Locate Folder…'}
                </button>
              )}
              <button
                onClick={() => void handleMissingFileAction('remove')}
                disabled={missingFileBusy}
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {missingFileBusy ? 'Removing…' : 'Remove from Catalog'}
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Reveal in Folder', onClick: () => window.api.revealFile(contextMenu.row.abs_path) },
            {
              label: trayIds.has(contextMenu.row.id) ? 'Remove from Tray' : 'Add to Tray',
              onClick: () => toggleTray(contextMenu.row)
            },
            { label: 'Play', onClick: () => openPlayer(contextMenu.row, false) },
            { label: 'Play Live', onClick: () => openPlayer(contextMenu.row, true) },
            { label: 'Add to Group…', onClick: () => setAddToGroupRow(contextMenu.row) },
            { divider: true },
            // Placeholder for the rest of section 12's roadmap (collections beyond tray/groups,
            // IR Lab handoff beyond blend) — an honest disabled row rather than inventing menu
            // items that don't do anything yet.
            { label: 'More actions coming soon', disabled: true }
          ]}
        />
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

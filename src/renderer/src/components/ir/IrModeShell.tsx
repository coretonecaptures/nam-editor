import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtualList } from './VirtualList'
import { IrFolderTree } from './IrFolderTree'
import { IrRightPanel } from './IrRightPanel'
import { NamLabCrumb } from '../NamLabCrumb'
import { ContextMenu } from '../ContextMenu'
import { IrTray } from './IrTray'
import { describeIrLabAvailability, type IrLabStatus } from './irLabStatusMessage'
import { IrFilterBar } from './IrFilterBar'
import { PlayerPanel } from '../PlayerPanel'
import { DataGrid, type DataGridColumn } from '../DataGrid'
import { loadNamFileForPlayback } from '../../utils/loadNamFile'
import type { NamFile } from '../../types/nam'
import guitarJackIcon from '../../assets/icons/guitar-jack.png'
import { formatSampleRate } from '../../../../shared/wavFormat'
import { SettingsPanel } from '../SettingsPanel'
import { IR_ITEM_DRAG_MIME } from './dragMime'
import { exportIrCatalogCSV, exportIrCatalogXLSX } from './irExport'
import { IrDuplicatesModal } from './IrDuplicatesModal'
import { CoveragePlannerModal } from './CoveragePlannerModal'
import { IrMoveToFolderModal } from './IrMoveToFolderModal'
import { IrBatchRenameModal } from './IrBatchRenameModal'
import { IrEditMetadataModal } from './IrEditMetadataModal'
import { IrBatchMetadataEditModal } from './IrBatchMetadataEditModal'
import { IrLibraryCleanupModal } from './IrLibraryCleanupModal'
import { AppSettings, loadSettings, saveSettings } from '../../types/settings'

// Evaluated lazily, not at module scope — see NamProjectsShell.tsx's matching comment: a
// module-level `window.api` read crashes under a plain-Node test importing this file's pure
// helpers, no `window` present.
function isMacPlatform(): boolean {
  return typeof window !== 'undefined' && window.api?.platform === 'darwin'
}

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
  capture_id: string | null
  folder_id: number | null
  library_root_id: number
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
  // Already selected by queryLibrary.ts's browse query (ItemRow there) but never threaded onto
  // this file's own copy of the row shape until now — real, already-scanned data, not new backend
  // work. preset_kind ("Cab IR" / "Short Reverb IR" / etc, auto-populated) is the only real signal
  // for the design mock's CAB/VERB type tag; mic_a_target_zone ("Cap Center" / "Cap Edge" / "Cone
  // Middle" / etc, IR Lab's own fixed vocabulary) is the closest real field to the mock's POSITION
  // column — not an exact match to the mock's illustrative "cap 2\"" text, but real rather than
  // fabricated.
  preset_kind: string | null
  speaker_position: string | null
  mic_a_target_zone: string | null
}

type LibraryRoot = { id: number; path: string; label: string | null; watch_mode: string; created_at: string }

// 56px (not the old 72px two-line stacked layout) once the row became a single dense line of real
// table columns, matching design_handoff_ir_prototype's screenshots — 72px was sized for wrapping
// content that no longer wraps.
const ROW_HEIGHT = 56
// Shared between the list header and every data row so their columns actually line up: type-tag |
// name+maker | format | length | mic/space | position. Checkbox, size, and the action icons stay
// their own flex siblings around this grid (unchanged from before), not part of it.
const IR_ROW_GRID = '32px minmax(160px,1.6fr) 118px 56px 64px minmax(90px,1fr)'
// Reserved width for the trailing favorite/play/play-live icon buttons (each ~36px, gap-3 between
// them, the parent row's own gap-3 in front) -- the header row needs a matching spacer after its
// "Size" label so the header text actually sits above the size VALUES, not past them.
const IR_ROW_ACTIONS_WIDTH = 116
const PAGE_SIZE = 200

const IR_SORT_LS_KEY = 'nam-lab-ir-sort'
const IR_SORT_KEYS = ['name', 'size', 'rate', 'depth', 'duration', 'favorite', 'missing'] as const
type IrSortKey = (typeof IR_SORT_KEYS)[number]
const IR_SORT_LABELS: Record<IrSortKey, string> = {
  name: 'Name / path',
  size: 'File size',
  rate: 'Sample rate',
  depth: 'Bit depth',
  duration: 'Length',
  favorite: 'Favorites first',
  missing: 'Missing first'
}

/**
 * Row-level fields render as plain, mostly-uncolored text now (design_handoff_ir_prototype's
 * screenshots — format/mic/position are plain IBM Plex Mono text, not badges). The type tag
 * (CAB/VERB) is the one deliberate exception that stays a small solid-filled chip, same rule as
 * NAM Projects' captureScope. `FieldBadge`/`FIELD_CHIP_CLASS` (per-field solid pills for
 * manufacturer/cabinet/speaker/microphone) are gone, not just restyled — that whole approach was
 * the "wall of colored pills" this rewrite replaces, not something to keep alongside the new look.
 * Manufacturer becomes the coral maker-name line under the impulse name; microphone becomes the
 * MIC/SPACE column; cabinet/speaker are dropped from the row entirely (the mock doesn't surface
 * them here either — still filterable via the top Format/Mic dropdowns, just not per-row anymore).
 */

/** "Cab IR" / "Short Reverb IR" / etc (real, auto-populated data, see IrItemRow's own comment) ->
 * the mock's small solid CAB/VERB tag. Returns null (no tag) rather than guessing when unknown —
 * an unenriched older scan may have no preset_kind at all. */
function kindTag(presetKind: string | null, relativePath: string): { label: string; className: string } {
  // preset_kind is only ever written by IR Lab's own project-import path (labProjectEnrichment.ts)
  // -- the vast majority of a real library (plain scanned/archived WAVs) never gets it, so falling
  // back to null-and-hide-the-tag left nearly every row with no tag at all. Folder naming is real
  // structural evidence the user themselves created (e.g. a "Convolution Reverbs" folder) -- a
  // reasonable, non-fabricated signal for the rows preset_kind doesn't cover. Defaults to CAB
  // (the overwhelmingly common case in a guitar-cab IR library) rather than showing nothing.
  const isReverb = presetKind ? /reverb/i.test(presetKind) : /reverb/i.test(relativePath)
  return isReverb
    ? { label: 'VERB', className: 'bg-teal-600/90 text-white' }
    : { label: 'CAB', className: 'bg-indigo-600/90 text-white' }
}

/** "44.1k · 24-bit · mono" — one plain mono-font string, not a row of chips. */
function formatLabel(row: Pick<IrItemRow, 'sample_rate' | 'bit_depth' | 'channels'>): string {
  const parts: string[] = []
  if (row.sample_rate) parts.push(formatSampleRate(row.sample_rate))
  if (row.bit_depth) parts.push(`${row.bit_depth}-bit`)
  if (row.channels === 1) parts.push('mono')
  else if (row.channels === 2) parts.push('stereo')
  else if (row.channels) parts.push(`${row.channels}ch`)
  return parts.join(' · ')
}

/** Plain, click-to-filter text (replaces a chip) — used for the maker line and the Mic/Space
 * column. Still toggles its facet on click, just no longer shaped like a pill. */
function PlainFieldText({
  value,
  colorVar,
  active,
  onClick,
  className = ''
}: {
  value: string | null
  colorVar?: string
  active?: boolean
  onClick?: () => void
  className?: string
}): React.ReactElement | null {
  if (!value) return null
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`${value} — click to filter`}
      style={colorVar ? { color: `var(${colorVar})` } : undefined}
      className={`truncate text-left hover:underline ${active ? 'underline decoration-nm-accent' : ''} ${className}`}
    >
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

/** Columns for the optional DataGrid "Grid" view. `key`s that map to a backend sort column
 * (queryLibrary.ts SORT_COLUMNS) are sortable; the descriptive facet columns are not (the
 * facet filter bar above the list already covers narrowing by those). Column filtering is off
 * in this grid — `disableColumnFilters` — for the same reason. */
const chLabel = (n: number | null): string =>
  n === 1 ? 'mono' : n === 2 ? 'stereo' : n ? `${n}ch` : ''
const IR_GRID_COLUMNS: DataGridColumn<IrItemRow>[] = [
  { key: 'name', label: 'Name', minWidth: 180, defaultWidth: 300, defaultVisible: true, getValue: (r) => splitPath(r.relative_path).name },
  { key: 'folder', label: 'Folder', minWidth: 160, defaultVisible: false, sortable: false, getValue: (r) => splitPath(r.relative_path).folder },
  { key: 'size', label: 'Size', minWidth: 80, defaultVisible: true, align: 'right', getValue: (r) => formatBytes(r.file_size), sortValue: (r) => r.file_size ?? -1 },
  { key: 'rate', label: 'Sample rate', minWidth: 100, defaultVisible: true, getValue: (r) => (r.sample_rate ? formatSampleRate(r.sample_rate) : ''), sortValue: (r) => r.sample_rate ?? 0 },
  { key: 'depth', label: 'Bit depth', minWidth: 84, defaultVisible: true, getValue: (r) => (r.bit_depth ? `${r.bit_depth}-bit` : ''), sortValue: (r) => r.bit_depth ?? 0 },
  { key: 'channels', label: 'Channels', minWidth: 84, defaultVisible: false, sortable: false, getValue: (r) => chLabel(r.channels) },
  { key: 'duration', label: 'Length', minWidth: 74, defaultVisible: false, align: 'right', getValue: (r) => (r.duration_seconds ? `${r.duration_seconds.toFixed(2)}s` : ''), sortValue: (r) => r.duration_seconds ?? -1 },
  { key: 'manufacturer', label: 'Manufacturer', minWidth: 120, defaultVisible: true, sortable: false, getValue: (r) => r.manufacturer ?? '' },
  { key: 'cabinet', label: 'Cabinet', minWidth: 130, defaultVisible: false, sortable: false, getValue: (r) => r.cabinet ?? '' },
  { key: 'speaker', label: 'Speaker', minWidth: 120, defaultVisible: true, sortable: false, getValue: (r) => r.speaker ?? '' },
  { key: 'microphone', label: 'Microphone', minWidth: 120, defaultVisible: true, sortable: false, getValue: (r) => r.microphone ?? '' },
  { key: 'audio_format', label: 'Format', minWidth: 90, defaultVisible: false, sortable: false, getValue: (r) => r.audio_format ?? '' },
  { key: 'missing', label: 'Missing', minWidth: 84, defaultVisible: false, getValue: (r) => (r.missing_since ? 'Missing' : ''), sortValue: (r) => (r.missing_since ? 1 : 0) }
]

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
export function IrModeShell({ leftRail }: { leftRail?: React.ReactNode } = {}): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false)
  const [appSettings, setAppSettings] = useState<AppSettings>(loadSettings)
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
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [showCoveragePlanner, setShowCoveragePlanner] = useState(false)
  // Inline rename (parity backlog item 3) — F2 on the focused row or the context menu's Rename.
  // itemId rather than index: the row can scroll/shift under a long rename, and the id is what
  // both commit and cancel actually need.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  // Move to folder (parity backlog item 4) — no multi-select exists in this list yet, so this
  // always operates on a single item id for now; the modal/IPC underneath already take an array
  // so multi-select can plug straight in later with no further plumbing.
  const [moveModal, setMoveModal] = useState<{ itemIds: string[]; libraryRootId: number; currentFolderId: number | null } | null>(null)
  // Bumped after a move so IrFolderTree refetches its row counts — the tree's own
  // onLibraryChanged only fires for actions the tree itself performs (its right-click Remove).
  const [treeRefreshSignal, setTreeRefreshSignal] = useState(0)
  // Trash (parity backlog item 5) — multi-select aware once selectedIds (below) exists.
  const [trashConfirmRows, setTrashConfirmRows] = useState<IrItemRow[] | null>(null)
  const [trashBusy, setTrashBusy] = useState(false)
  const [showBatchRename, setShowBatchRename] = useState(false)
  const [editMetadataRow, setEditMetadataRow] = useState<IrItemRow | null>(null)
  const [batchEditRows, setBatchEditRows] = useState<IrItemRow[] | null>(null)
  const [showLibraryCleanup, setShowLibraryCleanup] = useState(false)
  // Multi-select (parity backlog item 9's real prerequisite — items 4/5/6 deliberately scoped to
  // single-item pending this, with the array-shaped IPC already in place). Ctrl/Cmd-click toggles,
  // Shift-click ranges from the last plain click — same convention as NAM mode's own FileList.tsx.
  // No Ctrl+A: this list is paginated/virtualized against a live query, not a fully-loaded array,
  // so "select all" would need to mean "everything matching the current filter" (unbounded, could
  // be tens of thousands of rows) rather than "everything on screen" — deliberately left out
  // rather than building a version of it that silently means something narrower than it looks like
  // it means.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectionAnchorRef = useRef(-1)
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
  const [irLabStatus, setIrLabStatus] = useState<IrLabStatus | null>(null)
  const [sendingTray, setSendingTray] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)

  // Saved searches (audit finding B6) — a named filter/facet combination, re-run live against
  // whatever the catalog looks like now, distinct from a Group (a static list of specific items).
  const [savedSearches, setSavedSearches] = useState<Array<{ id: string; name: string; filterJson: string }>>([])
  const [showSavedSearches, setShowSavedSearches] = useState(false)
  const [savingSearchName, setSavingSearchName] = useState<string | null>(null)
  const refreshSavedSearches = useCallback(() => {
    window.api.irLibraryListSavedSearches().then(setSavedSearches)
  }, [])
  useEffect(() => {
    refreshSavedSearches()
  }, [refreshSavedSearches])
  const [trayError, setTrayError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: IrItemRow } | null>(null)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('nam-lab-ir-panel-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 256
  })
  // Collapse is a separate boolean from width (design_handoff_ir_prototype) -- hiding the panel
  // shouldn't forget how wide the user last dragged it to.
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('nam-lab-ir-panel-open') !== '0')
  const togglePanelOpen = useCallback(() => {
    setPanelOpen((v) => {
      const next = !v
      localStorage.setItem('nam-lab-ir-panel-open', next ? '1' : '0')
      return next
    })
  }, [])
  // Bumped on every filter/search change so a query response that resolves AFTER a newer filter
  // was already selected gets thrown away instead of populating the cache with stale-context rows
  // (e.g. a slow "all IRs" query resolving after the user already clicked into a folder).
  const requestEpochRef = useRef(0)

  const [sortKey, setSortKey] = useState<IrSortKey>(() => {
    const k = (localStorage.getItem(IR_SORT_LS_KEY) || '').split(':')[0] as IrSortKey
    return IR_SORT_KEYS.includes(k) ? k : 'name'
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() =>
    (localStorage.getItem(IR_SORT_LS_KEY) || '').split(':')[1] === 'desc' ? 'desc' : 'asc'
  )
  useEffect(() => {
    try {
      localStorage.setItem(IR_SORT_LS_KEY, `${sortKey}:${sortDir}`)
    } catch {
      /* non-fatal */
    }
  }, [sortKey, sortDir])
  const setSort = useCallback((k: IrSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(k === 'favorite' || k === 'missing' || k === 'size' ? 'desc' : 'asc')
      return k
    })
  }, [])

  const [irListView, setIrListView] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('nam-lab-ir-list-view') === 'grid' ? 'grid' : 'list'
  )
  useEffect(() => {
    try {
      localStorage.setItem('nam-lab-ir-list-view', irListView)
    } catch {
      /* non-fatal */
    }
  }, [irListView])

  // ── Audition, via NAM Lab's own PlayerPanel (see this component's header comment).
  // `playerIr` is the IR currently loaded into the player's cabinet AND the "is the player open"
  // flag — the two are the same thing here, since the player only exists to audition an IR.
  const [playerIr, setPlayerIr] = useState<IrItemRow | null>(null)

  // A/B audition (audit finding B6 / idea 5) — play two IRs back-to-back under blind labels,
  // pick a winner, reveal after. Ratings accumulate as a by-product of a comparison people
  // already want to do, rather than asking anyone to sit and rate the whole library up front.
  // Deliberately reuses the SAME live PlayerPanel instance below via its controlled `cabIrPath`
  // prop (see that render site's own comment on why remounting per-IR would kill the live
  // engine) — flipping abActive just swaps which of the two rows plays.
  const [abPair, setAbPair] = useState<{ a: IrItemRow; b: IrItemRow } | null>(null)
  const [abActive, setAbActive] = useState<'a' | 'b'>('a')
  const [abRevealed, setAbRevealed] = useState(false)
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
    window.api.irLibraryGetIrLabStatus().then(setIrLabStatus)
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

  const startRename = useCallback((row: IrItemRow) => {
    setRenamingId(row.id)
    setRenameDraft(splitPath(row.relative_path).name)
    setRenameError(null)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameError(null)
  }, [])

  const commitRename = useCallback(
    async (force = false) => {
      if (!renamingId) return
      const trimmed = renameDraft.trim()
      if (!trimmed) {
        setRenameError('Name cannot be empty.')
        return
      }
      setRenameBusy(true)
      setRenameError(null)
      try {
        const result = await window.api.irLibraryRenameItem(renamingId, trimmed, force)
        if (!result.success) {
          setRenameError(result.error ?? 'Rename failed.')
          return
        }
        // Patch the cached row in place rather than a full refetch — same "the row IS the
        // truth, don't reload the world for a one-field change" approach the favorite/rating
        // toggles below already use.
        for (const [index, cached] of cacheRef.current.entries()) {
          if (cached.id === renamingId) {
            const folderRel = cached.relative_path.includes('/') ? cached.relative_path.slice(0, cached.relative_path.lastIndexOf('/')) : ''
            const newRelativePath = folderRel ? `${folderRel}/${trimmed}.wav` : `${trimmed}.wav`
            cacheRef.current.set(index, { ...cached, relative_path: newRelativePath, display_name: `${trimmed}.wav` })
            break
          }
        }
        forceRerender((n) => n + 1)
        setRenamingId(null)
      } finally {
        setRenameBusy(false)
      }
    },
    [renamingId, renameDraft]
  )

  const handleMoved = useCallback((results: Array<{ itemId: string; success: boolean }>) => {
    const moved = results.filter((r) => r.success).length
    setImportResult(
      moved === results.length
        ? `Moved ${moved} item${moved === 1 ? '' : 's'}.`
        : `Moved ${moved} of ${results.length} — see the item(s) left behind for why.`
    )
    // A move can change which folder an item belongs to, which changes list MEMBERSHIP (it may no
    // longer match the current folder scope) as well as its sort position — unlike rename, this
    // isn't a safe single-field cache patch. Simplest correct fix: invalidate and refetch, same
    // pattern the rescan-completion path above already uses.
    setSelectedIds(new Set())
    requestEpochRef.current++
    cacheRef.current = new Map()
    pendingRef.current = new Set()
    forceRerender((n) => n + 1)
    setTreeRefreshSignal((n) => n + 1)
  }, [])

  const confirmTrash = useCallback(async () => {
    if (!trashConfirmRows || trashConfirmRows.length === 0) return
    setTrashBusy(true)
    try {
      const ids = trashConfirmRows.map((r) => r.id)
      const results = await window.api.irLibraryTrashItems(ids)
      const succeededIds = new Set(results.filter((r) => r.success).map((r) => r.itemId))
      const failed = results.filter((r) => !r.success)
      if (succeededIds.size === 0) {
        setImportResult(failed[0]?.error ?? 'Could not move that to the Trash.')
        return
      }
      if (playerIr && succeededIds.has(playerIr.id)) setPlayerIr(null)
      for (const id of succeededIds) {
        if (trayIds.has(id)) void window.api.irLibraryRemoveFromTray(id).then(refreshTray)
      }
      setImportResult(
        failed.length === 0
          ? `Moved ${succeededIds.size} item${succeededIds.size === 1 ? '' : 's'} to the Trash.`
          : `Moved ${succeededIds.size} to the Trash, ${failed.length} failed.`
      )
      setSelectedIds(new Set())
      setTrashConfirmRows(null)
      // Trashing changes total count and list membership, same as a move — invalidate rather than
      // patch (see handleMoved's matching comment).
      requestEpochRef.current++
      cacheRef.current = new Map()
      pendingRef.current = new Set()
      forceRerender((n) => n + 1)
      setTreeRefreshSignal((n) => n + 1)
    } finally {
      setTrashBusy(false)
    }
  }, [trashConfirmRows, playerIr, trayIds, refreshTray])

  const sendSessionToIrLab = useCallback(async (row: IrItemRow) => {
    if (!row.capture_id) {
      setImportResult('This IR has no IR Lab capture id — not something IR Lab captured, so there is no session to reopen.')
      return
    }
    const result = await window.api.irLibrarySendSessionToIrLab(row.capture_id)
    setImportResult(result.success ? 'Opened in IR Lab.' : result.reason ?? 'Failed to open in IR Lab.')
  }, [])

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

  const startAbAudition = useCallback(() => {
    if (selectedIds.size !== 2) return
    const [id1, id2] = [...selectedIds]
    const rows = [...cacheRef.current.values()]
    const row1 = rows.find((r) => r.id === id1)
    const row2 = rows.find((r) => r.id === id2)
    if (!row1 || !row2) return
    // Randomize which selected row lands on A vs B — the whole point is that the user can't
    // infer the answer from selection order.
    const [a, b] = Math.random() < 0.5 ? [row1, row2] : [row2, row1]
    setAbPair({ a, b })
    setAbActive('a')
    setAbRevealed(false)
    openPlayer(a, false)
  }, [selectedIds, openPlayer])

  const pickAbWinner = useCallback(
    (winner: 'a' | 'b') => {
      if (!abPair) return
      const row = winner === 'a' ? abPair.a : abPair.b
      const nextRating = Math.min(5, (row.rating ?? 0) + 1)
      void window.api.irLibrarySetRating(row.id, nextRating).then(() => {
        requestEpochRef.current++
        cacheRef.current = new Map()
        forceRerender((n) => n + 1)
      })
      setAbRevealed(true)
    },
    [abPair]
  )

  const closeAbAudition = useCallback(() => {
    setAbPair(null)
    setAbRevealed(false)
    setPlayerIr(null)
  }, [])

  // Flipping the blind A/B toggle swaps which row the (already-live) player points at.
  useEffect(() => {
    if (!abPair) return
    openPlayer(abActive === 'a' ? abPair.a : abPair.b, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abActive])

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
  }, [search, roots.length, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, selectedRootId, sortKey, sortDir])

  // Arrow-key navigation through the current filtered list (plan section 8). While the player is
  // open this also swaps the cabinet as you move, which is the whole point — step down the list
  // and hear each IR. Ignored while a text input has focus so it doesn't fight the search box's
  // own cursor keys.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      if (total === 0) return

      if (e.key === 'F2' && focusedIndex != null) {
        const row = cacheRef.current.get(focusedIndex)
        if (row) {
          e.preventDefault()
          startRename(row)
        }
        return
      }

      if (e.key === 'Delete' && focusedIndex != null) {
        if (selectedIds.size > 1) {
          const rows = [...cacheRef.current.values()].filter((r) => selectedIds.has(r.id) && !r.missing_since)
          if (rows.length > 0) {
            e.preventDefault()
            setTrashConfirmRows(rows)
          }
          return
        }
        const row = cacheRef.current.get(focusedIndex)
        if (row && !row.missing_since) {
          e.preventDefault()
          setTrashConfirmRows([row])
        }
        return
      }

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
  }, [total, playerIr, focusedIndex, startRename, selectedIds])

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

  /** Re-runs the full scan pipeline over every already-added root — a scan is what reads WAV
   * headers, applies vendor parsers and detects IR Lab Projects, so newly-added passes only
   * reach existing rows on a re-scan. Its own action rather than re-picking the same folder. */
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

  /** Right-click "Rescan" on a single folder in the tree — scoped to just that folder's containing
   * library_root, not every added root (that's handleRescan above, the menu-bar action). There's
   * no narrower "just this subfolder" scan in the pipeline (importLibrary walks a whole
   * library_root each time — see its own comment), so this re-runs the identical full-root scan
   * handleRescan uses, just for the one root instead of looping over all of them. Practically a
   * "rescan" and a "refresh" of that folder's subtree end up being the same operation here. */
  const handleRescanRoot = useCallback(
    async (libraryRootId: number) => {
      const root = roots.find((r) => r.id === libraryRootId)
      if (!root) return
      setScanError(null)
      setImportResult(null)
      setScanning(true)
      setScanProgress({ filesSeen: 0, foldersSeen: 0, elapsedMs: 0 })
      try {
        await window.api.irLibraryScan(root.path, root.label)
        await refreshRoots()
        requestEpochRef.current++
        cacheRef.current = new Map()
        pendingRef.current = new Set()
        forceRerender((n) => n + 1)
        setImportResult(`Rescanned "${root.label ?? root.path}".`)
      } catch (err) {
        setScanError(String(err))
      } finally {
        setScanning(false)
      }
    },
    [roots, refreshRoots]
  )

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
          sort: sortKey,
          sortDir,
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
    [search, total, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, selectedRootId, sortKey, sortDir]
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
        sort: sortKey,
        sortDir,
        offset: 0,
        limit: PAGE_SIZE
      })
      .then((res) => {
        if (requestEpochRef.current !== epoch) return
        setTotal(res.total)
        res.rows.forEach((row, i) => cacheRef.current.set(i, row))
        forceRerender((n) => n + 1)
      })
  }, [search, roots.length, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, selectedRootId, sortKey, sortDir])

  // Spreadsheet export (B6) — the SAME filter scope the current view is showing, not just the
  // loaded page window (queryForExport re-runs the query with no LIMIT, up to its own hard cap).
  const exportCurrentView = useCallback(
    async (format: 'csv' | 'xlsx') => {
      setShowExportMenu(false)
      setExporting(true)
      setExportNotice(null)
      try {
        const res = await window.api.irLibraryQueryForExport({
          libraryRootId: selectedRootId,
          search: search || undefined,
          folderId: selectedFolderId,
          favoritesOnly: favoritesOnly || undefined,
          minRating: ratedOnly ? 1 : undefined,
          tagId: tagFilterId ?? undefined,
          ...facets,
          ...audioFacets,
          sort: sortKey,
          sortDir
        })
        const filename = `ir-library.${format}`
        if (format === 'csv') exportIrCatalogCSV(res.rows, filename)
        else exportIrCatalogXLSX(res.rows, filename)
        if (res.truncated) {
          setExportNotice(`Exported the first ${res.rows.length.toLocaleString()} of ${res.total.toLocaleString()} matching IRs — narrow the filter to get the rest.`)
        }
      } finally {
        setExporting(false)
      }
    },
    [selectedRootId, search, selectedFolderId, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, sortKey, sortDir]
  )

  // Same filter shape queryItems() takes (minus offset/limit) — the one payload both export and
  // saved searches serialize, so a saved search reapplies exactly what was on screen when saved.
  const currentFilterPayload = useCallback(
    () => ({
      libraryRootId: selectedRootId,
      folderId: selectedFolderId,
      search: search || undefined,
      favoritesOnly: favoritesOnly || undefined,
      minRating: ratedOnly ? 1 : undefined,
      tagId: tagFilterId ?? undefined,
      ...facets,
      ...audioFacets,
      sort: sortKey,
      sortDir
    }),
    [selectedRootId, selectedFolderId, search, favoritesOnly, ratedOnly, tagFilterId, facets, audioFacets, sortKey, sortDir]
  )

  const applySavedSearch = useCallback((filterJson: string) => {
    setShowSavedSearches(false)
    let parsed: ReturnType<typeof currentFilterPayload>
    try {
      parsed = JSON.parse(filterJson)
    } catch {
      return
    }
    setSelectedRootId(parsed.libraryRootId ?? null)
    setSelectedFolderId(parsed.folderId ?? null)
    setSearch(parsed.search ?? '')
    setFavoritesOnly(Boolean(parsed.favoritesOnly))
    setRatedOnly(parsed.minRating != null)
    setTagFilterId(parsed.tagId ?? null)
    setFacets({ manufacturer: parsed.manufacturer, cabinet: parsed.cabinet, speaker: parsed.speaker, microphone: parsed.microphone })
    setAudioFacets({ sampleRate: parsed.sampleRate, bitDepth: parsed.bitDepth })
    setSortKey((parsed.sort as IrSortKey) ?? 'name')
    setSortDir(parsed.sortDir ?? 'asc')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveCurrentSearch = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      await window.api.irLibraryCreateSavedSearch(trimmed, JSON.stringify(currentFilterPayload()))
      setSavingSearchName(null)
      refreshSavedSearches()
    },
    [currentFilterPayload, refreshSavedSearches]
  )

  const toggleFavorite = useCallback((row: IrItemRow, index: number) => {
    const next = row.is_favorite ? 0 : 1
    cacheRef.current.set(index, { ...row, is_favorite: next })
    forceRerender((n) => n + 1)
    window.api.irLibrarySetFavorite(row.id, next === 1)
  }, [])

  // Bulk-select checkbox column (design_handoff_ir_prototype) reuses the EXISTING selectedIds set
  // (already the multi-select target for the Move/Trash/Edit Metadata context-menu actions) rather
  // than adding a second, parallel "checked" concept -- toggleChecked only touches selectedIds, not
  // focusedIndex/selectionAnchorRef, so ticking a checkbox never disturbs which row drives the
  // detail panel (unlike a plain row click, which resets the whole selection to just that row).
  const toggleChecked = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // "Every currently visible row" is scoped to what's actually in cacheRef -- the same scope the
  // context menu's own menuRows already uses for a multi-row action, not a fresh unbounded query
  // against the full (282K-row) catalog.
  const toggleCheckAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => (ids.length > 0 && ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)))
  }, [])
  const bulkSetFavorite = useCallback(
    (fav: boolean) => {
      const value = fav ? 1 : 0
      for (const [idx, row] of cacheRef.current.entries()) {
        if (selectedIds.has(row.id) && row.is_favorite !== value) {
          cacheRef.current.set(idx, { ...row, is_favorite: value })
          window.api.irLibrarySetFavorite(row.id, fav)
        }
      }
      forceRerender((n) => n + 1)
    },
    [selectedIds]
  )
  const exportChecked = useCallback(
    (format: 'csv' | 'xlsx') => {
      const rows = [...cacheRef.current.values()].filter((r) => selectedIds.has(r.id))
      const filename = `ir-selection.${format}`
      if (format === 'csv') exportIrCatalogCSV(rows, filename)
      else exportIrCatalogXLSX(rows, filename)
    },
    [selectedIds]
  )

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
      <div
        className="flex items-center py-2 border-b border-nm-border flex-shrink-0"
        style={{
          paddingLeft: isMacPlatform() ? '80px' : '16px',
          paddingRight: isMacPlatform() ? '16px' : '155px',
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
      <div className="flex items-center gap-3 flex-1 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <NamLabCrumb mode="ir" />
        <div className="w-px h-5 bg-nm-border-s flex-shrink-0" />
        <button
          onClick={handleAddFolder}
          disabled={scanning}
          className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
        >
          {scanning ? 'Scanning…' : 'Add Library Folder'}
        </button>
        <button
          onClick={handleImportLabProjects}
          disabled={scanning}
          className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
        >
          Import Projects…
        </button>
        <button
          onClick={() => void handleRescan()}
          disabled={scanning || roots.length === 0}
          className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
        >
          Rescan
        </button>
        {hasAnyRoot && (
          <button
            onClick={() => setShowDuplicates(true)}
            className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
            title="Find byte-identical IRs across this scope"
          >
            Duplicates
          </button>
        )}
        {hasAnyRoot && (
          <button
            onClick={() => setShowCoveragePlanner(true)}
            className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
            title="Find mic/position combos other cabinets have that this one doesn't"
          >
            Coverage Planner…
          </button>
        )}
        {hasAnyRoot && (
          <button
            onClick={() => setShowBatchRename(true)}
            disabled={selectedFolderId == null}
            className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
            title={selectedFolderId == null ? 'Select a folder in the tree first' : 'Rename every IR in this folder from a template'}
          >
            Batch Rename…
          </button>
        )}
        {hasAnyRoot && (
          <button
            onClick={() => setShowLibraryCleanup(true)}
            disabled={selectedFolderId == null && selectedRootId == null}
            className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
            title="Restructure this scope into a new folder layout, with a preview before anything moves"
          >
            Build Library…
          </button>
        )}
        {hasAnyRoot && (
          <button
            onClick={startAbAudition}
            disabled={selectedIds.size !== 2}
            className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
            title={selectedIds.size === 2 ? 'Blind A/B audition between the two selected IRs' : 'Select exactly two IRs (Ctrl/Cmd-click) to A/B audition them'}
          >
            A/B Audition
          </button>
        )}
        {hasAnyRoot && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowSavedSearches((v) => !v)}
              className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
              title="Saved searches — re-run a named filter/facet combination"
            >
              Saved Searches…
            </button>
            {showSavedSearches && (
              <div
                onMouseLeave={() => setShowSavedSearches(false)}
                className="absolute right-0 top-full mt-1 w-64 bg-panel border border-field-bd rounded shadow-xl z-50 py-1"
              >
                {savedSearches.length === 0 && savingSearchName === null && (
                  <div className="px-3 py-2 text-xs text-nm-text-3">No saved searches yet.</div>
                )}
                {savedSearches.map((s) => (
                  <div key={s.id} className="flex items-center gap-1 px-1">
                    <button
                      onClick={() => applySavedSearch(s.filterJson)}
                      className="flex-1 text-left px-2 py-1.5 text-xs text-nm-text-2 hover:bg-hov truncate"
                      title={s.name}
                    >
                      {s.name}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete saved search "${s.name}"?`)) {
                          void window.api.irLibraryDeleteSavedSearch(s.id).then(refreshSavedSearches)
                        }
                      }}
                      title="Delete"
                      className="flex-shrink-0 w-5 h-5 rounded text-nm-text-3 hover:text-red-500 flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="border-t border-field-bd my-1" />
                {savingSearchName === null ? (
                  <button
                    onClick={() => setSavingSearchName('')}
                    className="w-full text-left px-3 py-1.5 text-xs text-nm-accent hover:bg-hov"
                  >
                    + Save current filter…
                  </button>
                ) : (
                  <input
                    autoFocus
                    value={savingSearchName}
                    placeholder="Name this search…"
                    onChange={(e) => setSavingSearchName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveCurrentSearch(savingSearchName)
                      if (e.key === 'Escape') setSavingSearchName(null)
                    }}
                    onBlur={() => (savingSearchName.trim() ? void saveCurrentSearch(savingSearchName) : setSavingSearchName(null))}
                    className="w-[calc(100%-16px)] mx-2 my-1 h-7 rounded border border-field-bd bg-field-bg text-xs px-2 text-nm-text"
                  />
                )}
              </div>
            )}
          </div>
        )}
        {hasAnyRoot && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowExportMenu((v) => !v)}
              disabled={exporting}
              className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
              title="Export the current view (filters/search included) as a spreadsheet"
            >
              {exporting ? 'Exporting…' : 'Export…'}
            </button>
            {showExportMenu && (
              <div
                onMouseLeave={() => setShowExportMenu(false)}
                className="absolute right-0 top-full mt-1 w-40 bg-panel border border-field-bd rounded shadow-xl z-50 py-1"
              >
                <button
                  onClick={() => void exportCurrentView('csv')}
                  className="w-full text-left px-3 py-1.5 text-xs text-nm-text-2 hover:bg-hov"
                >
                  CSV
                </button>
                <button
                  onClick={() => void exportCurrentView('xlsx')}
                  className="w-full text-left px-3 py-1.5 text-xs text-nm-text-2 hover:bg-hov"
                >
                  Excel (.xlsx)
                </button>
              </div>
            )}
          </div>
        )}
        {hasAnyRoot && (
          <div className="flex rounded overflow-hidden border border-field-bd flex-shrink-0">
            <button
              onClick={() => setIrListView('list')}
              title="List view"
              className={`p-1.5 ${irListView === 'list' ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setIrListView('grid')}
              title="Grid view"
              className={`p-1.5 ${irListView === 'grid' ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
              </svg>
            </button>
          </div>
        )}
        {hasAnyRoot && irListView === 'list' && (
          <div className="flex items-center flex-shrink-0">
            <select
              value={sortKey}
              onChange={(e) => setSort(e.target.value as IrSortKey)}
              title="Sort the IR list"
              className="text-xs px-1.5 py-1 rounded-l border border-field-bd bg-field-bg text-nm-text-2"
            >
              {IR_SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  Sort: {IR_SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
              className="text-xs px-1.5 py-1 rounded-r border border-l-0 border-field-bd text-nm-text-2 hover:bg-hov"
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        )}
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
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {hasAnyRoot && ampCapture && (
            <button
              onClick={() => void chooseAmpCapture()}
              title={`Auditioning through ${ampCapture.filePath} — click to choose a different amp capture`}
              className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0 max-w-[220px] truncate"
            >
              Amp: {ampCapture.metadata.name || ampCapture.fileName}
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className={`tb-menu-btn ${showSettings ? 'active' : ''}`}
            title="Settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </div>
      </div>
      {showSettings && (
        <SettingsPanel
          settings={appSettings}
          onSave={(s) => { setAppSettings(s); saveSettings(s); setShowSettings(false) }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showDuplicates && (
        <IrDuplicatesModal
          libraryRootId={selectedRootId}
          folderId={selectedFolderId}
          scopeLabel={selectedFolderId != null ? `${selectedFolderName} and its subfolders` : selectedRootId != null ? roots.find((r) => r.id === selectedRootId)?.label || 'This library folder' : 'Whole library'}
          onClose={() => setShowDuplicates(false)}
        />
      )}
      {showCoveragePlanner && (
        <CoveragePlannerModal
          libraryRootId={selectedRootId}
          scopeLabel={selectedRootId != null ? roots.find((r) => r.id === selectedRootId)?.label || 'This library root' : 'Whole library'}
          onClose={() => setShowCoveragePlanner(false)}
        />
      )}
      {moveModal && (
        <IrMoveToFolderModal
          itemIds={moveModal.itemIds}
          libraryRootId={moveModal.libraryRootId}
          currentFolderId={moveModal.currentFolderId}
          onClose={() => setMoveModal(null)}
          onMoved={handleMoved}
        />
      )}
      {showBatchRename && selectedFolderId != null && (
        <IrBatchRenameModal
          libraryRootId={selectedRootId}
          folderId={selectedFolderId}
          scopeLabel={`${selectedFolderName} and its subfolders`}
          onClose={() => setShowBatchRename(false)}
          onRenamed={() => {
            requestEpochRef.current++
            cacheRef.current = new Map()
            pendingRef.current = new Set()
            forceRerender((n) => n + 1)
          }}
        />
      )}
      {showLibraryCleanup && (selectedFolderId != null || selectedRootId != null) && (
        <IrLibraryCleanupModal
          libraryRootId={selectedRootId}
          folderId={selectedFolderId}
          scopeLabel={selectedFolderId != null ? `${selectedFolderName} and its subfolders` : roots.find((r) => r.id === selectedRootId)?.label || 'This library folder'}
          onClose={() => setShowLibraryCleanup(false)}
          onDone={() => {
            requestEpochRef.current++
            cacheRef.current = new Map()
            pendingRef.current = new Set()
            forceRerender((n) => n + 1)
            setTreeRefreshSignal((n) => n + 1)
          }}
        />
      )}
      {editMetadataRow && (
        <IrEditMetadataModal
          row={editMetadataRow}
          displayName={editMetadataRow.display_name}
          onClose={() => setEditMetadataRow(null)}
          onSaved={() => {
            requestEpochRef.current++
            cacheRef.current = new Map()
            pendingRef.current = new Set()
            forceRerender((n) => n + 1)
          }}
        />
      )}
      {batchEditRows && batchEditRows.length > 0 && (
        <IrBatchMetadataEditModal
          itemIds={batchEditRows.map((r) => r.id)}
          onClose={() => setBatchEditRows(null)}
          onSaved={() => {
            requestEpochRef.current++
            cacheRef.current = new Map()
            pendingRef.current = new Set()
            forceRerender((n) => n + 1)
          }}
        />
      )}
      {trashConfirmRows && trashConfirmRows.length > 0 && (
        <div
          className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center"
          onClick={() => !trashBusy && setTrashConfirmRows(null)}
        >
          <div
            className="bg-panel border border-nm-border rounded-xl p-5 w-[420px] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-nm-text">Move to Trash</div>
            <div className="text-xs text-nm-text-2 leading-relaxed">
              {trashConfirmRows.length === 1 ? (
                <>Move <span className="font-medium text-nm-text">"{trashConfirmRows[0].display_name}"</span> to the Trash?</>
              ) : (
                <>Move <span className="font-medium text-nm-text">{trashConfirmRows.length} items</span> to the Trash?</>
              )}{' '}
              This removes {trashConfirmRows.length === 1 ? 'it' : 'them'} from the catalog too — favourites, rating, tags and tray membership go with {trashConfirmRows.length === 1 ? 'it' : 'them'}.
              You can recover the file{trashConfirmRows.length === 1 ? '' : 's'} from the OS Trash, but re-adding {trashConfirmRows.length === 1 ? 'it' : 'them'} to the catalog needs a rescan.
            </div>
            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                onClick={() => setTrashConfirmRows(null)}
                disabled={trashBusy}
                className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmTrash()}
                disabled={trashBusy}
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {trashBusy ? 'Moving…' : 'Move to Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
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
      {exportNotice && (
        <div className="flex items-center justify-between gap-2 px-4 py-1 text-xs text-nm-text-2 bg-active-bg flex-shrink-0">
          <span>{exportNotice}</span>
          <button onClick={() => setExportNotice(null)} className="text-nm-text-3 hover:text-nm-text flex-shrink-0">
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
      <div className="flex flex-1 min-h-0">
        {leftRail}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
              onRescanRoot={handleRescanRoot}
              onDropItems={(destFolderId, payload) => {
                if (payload.itemIds.length === 0) return
                void window.api.irLibraryMoveItems(payload.itemIds, destFolderId).then(handleMoved)
              }}
              refreshSignal={treeRefreshSignal}
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
            {irListView === 'grid' ? (
              <DataGrid<IrItemRow>
                rowCount={total}
                getRow={(i) => cacheRef.current.get(i)}
                onRangeChange={onVisibleRangeChange}
                rowHeight={40}
                getRowId={(r) => r.id}
                columns={IR_GRID_COLUMNS}
                storageKey="ir-library-grid"
                disableColumnFilters
                sort={{ key: sortKey, dir: sortDir }}
                onSortChange={(k, d) => {
                  if ((IR_SORT_KEYS as readonly string[]).includes(k)) {
                    setSortKey(k as IrSortKey)
                    setSortDir(d)
                  }
                }}
                onRowOpen={(row) => openPlayer(row, false)}
                onRowContextMenu={(row, x, y) =>
                  setContextMenu({ x: Math.min(x, window.innerWidth - 224), y, row })
                }
                className="flex-1"
              />
            ) : (
              <>
              {(() => {
                const loadedIds = [...cacheRef.current.values()].map((r) => r.id)
                const checkedCount = loadedIds.filter((id) => selectedIds.has(id)).length
                const headerCheckMark = checkedCount === 0 ? '☐' : checkedCount === loadedIds.length ? '☑' : '◫'
                return (
                  <>
                    {checkedCount > 0 && (
                      <div className="flex items-center gap-3.5 px-4 py-2 border-b border-nm-border-s bg-panel-2 flex-shrink-0">
                        <span className="text-xs font-semibold text-nm-text">{checkedCount} selected</span>
                        <button onClick={() => bulkSetFavorite(true)} className="text-xs font-medium text-amber-500 hover:underline">
                          ★ Favorite
                        </button>
                        <button
                          onClick={() => {
                            const rows = [...cacheRef.current.values()].filter((r) => selectedIds.has(r.id))
                            if (rows.length) setBatchEditRows(rows)
                          }}
                          className="text-xs font-medium text-nm-accent hover:underline"
                        >
                          Tag…
                        </button>
                        <button
                          onClick={() => {
                            const rows = [...cacheRef.current.values()].filter((r) => selectedIds.has(r.id))
                            if (rows.length) {
                              setMoveModal({
                                itemIds: rows.map((r) => r.id),
                                libraryRootId: rows[0].library_root_id,
                                currentFolderId: rows.length === 1 ? rows[0].folder_id : null
                              })
                            }
                          }}
                          className="text-xs font-medium text-nm-text-2 hover:underline"
                        >
                          Move…
                        </button>
                        <button onClick={() => exportChecked('csv')} className="text-xs font-medium text-nm-text-2 hover:underline">
                          Export…
                        </button>
                        <button
                          onClick={() => setSelectedIds(new Set())}
                          className="ml-auto text-xs font-medium text-nm-text-3 hover:text-nm-text"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-3 px-4 h-7 border-b border-nm-border-s bg-field-bg flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ir-label-amber)]">
                      <button
                        onClick={() => toggleCheckAll(loadedIds)}
                        title="Select/deselect all loaded rows"
                        className="w-[18px] flex-shrink-0 text-left text-nm-text-3 hover:text-nm-text text-sm normal-case"
                      >
                        {headerCheckMark}
                      </button>
                      <div className="flex-1 min-w-0 grid items-center gap-3" style={{ gridTemplateColumns: IR_ROW_GRID }}>
                        <span />
                        <span>Impulse / Maker</span>
                        <span>Format</span>
                        <span>Length</span>
                        <span>Mic / Space</span>
                        <span>Position</span>
                      </div>
                      <span className="flex-shrink-0 w-14 text-right">Size</span>
                      {/* Matches the trailing favorite/play/play-live icon buttons' reserved width
                          in each data row below (IR_ROW_ACTIONS_WIDTH) -- without this spacer the
                          Size header sits at the row's true right edge while the actual size VALUES
                          sit to the left of those icons, visibly misaligned under a wider header. */}
                      <span className="flex-shrink-0" style={{ width: IR_ROW_ACTIONS_WIDTH }} />
                    </div>
                  </>
                )
              })()}
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
            const isChecked = selectedIds.has(row.id)
            // Focused (drives the detail/right panel) always gets the stronger tint; a row that's
            // only part of the bulk selection gets a lighter, distinct one -- so which row the
            // panel is showing and which rows Move/Trash/Edit/the bulk bar will act on both stay
            // legible at once, rather than one concept silently overriding the other's highlight.
            const rowTintClass = isFocused ? 'bg-active-bg' : isChecked ? 'bg-nm-accent/10' : ''
            return (
              <div
                onClick={(e) => {
                  if (e.shiftKey && selectionAnchorRef.current >= 0) {
                    const lo = Math.min(selectionAnchorRef.current, index)
                    const hi = Math.max(selectionAnchorRef.current, index)
                    const ranged = new Set<string>()
                    for (let i = lo; i <= hi; i++) {
                      const r = cacheRef.current.get(i)
                      if (r) ranged.add(r.id)
                    }
                    setSelectedIds(ranged)
                  } else if (e.ctrlKey || e.metaKey) {
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(row.id)) next.delete(row.id)
                      else next.add(row.id)
                      return next
                    })
                    selectionAnchorRef.current = index
                  } else {
                    setSelectedIds(new Set())
                    selectionAnchorRef.current = index
                  }
                  setFocusedIndex(index)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  // Right-clicking a row already inside a multi-selection keeps the whole
                  // selection (so the menu's actions apply to all of it); right-clicking outside
                  // one replaces it with just this row — same convention as NAM mode's FileList.
                  if (!selectedIds.has(row.id)) {
                    setSelectedIds(new Set())
                    selectionAnchorRef.current = index
                  }
                  setFocusedIndex(index)
                  setContextMenu({ x: e.clientX, y: e.clientY, row })
                }}
                draggable={!row.missing_since}
                onDragStart={(e) => {
                  // Drag-to-move onto IrFolderTree (parity backlog item 4). JSON rather than a
                  // bare id: the drop target needs the source library_root_id up front to refuse
                  // a cross-root drop before ever calling moveItems (fileOps.ts would refuse it
                  // too, but failing at the drop site gives the user a location to see why).
                  // Dragging a row that's part of the current multi-selection carries the whole
                  // selection; dragging any other row carries just that one.
                  const draggedIds = selectedIds.has(row.id) && selectedIds.size > 1 ? [...selectedIds] : [row.id]
                  e.dataTransfer.setData(IR_ITEM_DRAG_MIME, JSON.stringify({ itemIds: draggedIds, libraryRootId: row.library_root_id }))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                className={`group h-full flex items-center gap-3 px-4 border-b border-nm-border-s hover:bg-hov ${rowTintClass}`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleChecked(row.id)
                  }}
                  title={isChecked ? 'Deselect' : 'Select'}
                  className="w-[18px] flex-shrink-0 text-sm text-nm-text-3 hover:text-nm-text"
                >
                  {isChecked ? '☑' : '☐'}
                </button>
                <div className="flex-1 min-w-0 grid items-center gap-3" style={{ gridTemplateColumns: IR_ROW_GRID }}>
                  {(() => {
                    const tag = kindTag(row.preset_kind, row.relative_path)
                    return (
                      <span
                        title={row.preset_kind ?? undefined}
                        className={`justify-self-start px-1.5 h-4 rounded text-[9px] font-bold tracking-wide leading-4 ${tag.className}`}
                      >
                        {tag.label}
                      </span>
                    )
                  })()}
                  <div className="min-w-0 flex flex-col justify-center">
                    {renamingId === row.id ? (
                      <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={renameDraft}
                          disabled={renameBusy}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => void commitRename()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                            e.stopPropagation()
                          }}
                          className="text-sm px-1 py-0.5 -mx-1 rounded border border-nm-accent bg-field-bg text-nm-text w-full"
                        />
                        {renameError && (
                          <div className="text-[11px] text-red-500 flex items-center gap-2">
                            {renameError}
                            {renameError.includes('already exists') && (
                              <button onClick={() => void commitRename(true)} className="text-nm-accent hover:underline flex-shrink-0">
                                Overwrite
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[15px] font-medium truncate leading-tight">
                        {row.missing_since && (
                          <span
                            title={`File not found on disk since ${new Date(row.missing_since).toLocaleString()} — click Play to see options`}
                            className="text-orange-500 mr-1"
                          >
                            ⚠
                          </span>
                        )}
                        {name}
                      </div>
                    )}
                    {row.manufacturer ? (
                      <PlainFieldText
                        value={row.manufacturer}
                        colorVar="--ir-maker"
                        active={facets.manufacturer?.includes(row.manufacturer) ?? false}
                        onClick={() => row.manufacturer && toggleFacet('manufacturer', row.manufacturer)}
                        className="text-[11px] leading-tight"
                      />
                    ) : (
                      folder && <div className="text-[11px] text-[color:var(--ir-muted)] truncate leading-tight">{folder}</div>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-[color:var(--ir-muted)] truncate">{formatLabel(row) || '—'}</span>
                  <span className="font-mono text-[11px] text-[color:var(--ir-muted)]">
                    {row.duration_seconds ? `${row.duration_seconds.toFixed(2)}s` : '—'}
                  </span>
                  <PlainFieldText
                    value={row.microphone}
                    active={row.microphone != null && (facets.microphone?.includes(row.microphone) ?? false)}
                    onClick={() => row.microphone && toggleFacet('microphone', row.microphone)}
                    className="font-mono text-[11px] text-nm-text-2"
                  />
                  <span className="font-mono text-[11px] text-[color:var(--ir-faint)] truncate pl-4">
                    {row.mic_a_target_zone ?? row.speaker_position ?? '—'}
                  </span>
                </div>
                <div className="flex-shrink-0 text-xs text-[color:var(--ir-faint)] w-14 text-right">{formatBytes(row.file_size)}</div>
                {/* Actions live to the RIGHT of the name, same side and same order as NAM Lab's
                    own rows (FileList.tsx): favourite, then play, then Play Live. Identical size,
                    icons, colors and hover treatment — faint at rest, growing to a solid filled
                    circle on row hover.
                    Rating stars are deliberately not rendered for now (see setRating's comment):
                    hidden pending a decision on where they belong, not removed.
                    Fixed width matches IR_ROW_ACTIONS_WIDTH's header spacer, so the Size column
                    lines up between header and data regardless of how these buttons render. */}
                <div className="flex-shrink-0 flex items-center justify-end gap-0" style={{ width: IR_ROW_ACTIONS_WIDTH }}>
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
              </div>
            )
          }}
            />
              </>
            )}
          </div>
          {!panelOpen ? (
            <button
              onClick={togglePanelOpen}
              title="Show panel"
              className="w-6 flex-shrink-0 flex items-center justify-center border-l border-nm-border-s hover:bg-hov text-nm-text-3 hover:text-nm-text"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
          <>
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
              <div className="relative h-full">
                {abPair && (
                  <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-2 px-4 py-2 bg-panel-2 border-b border-nm-border">
                    {(['a', 'b'] as const).map((label) => (
                      <button
                        key={label}
                        onClick={() => setAbActive(label)}
                        className={`px-3 py-1 text-xs font-semibold rounded ${abActive === label ? 'bg-nm-accent text-accent-fg' : 'border border-field-bd text-nm-text-2 hover:bg-hov'}`}
                      >
                        {label.toUpperCase()}
                        {abRevealed && (label === 'a' ? abPair.a : abPair.b).display_name && (
                          <span className="ml-1.5 font-normal opacity-80">
                            — {(label === 'a' ? abPair.a : abPair.b).display_name.replace(/\.wav$/i, '')}
                          </span>
                        )}
                      </button>
                    ))}
                    <span className="flex-1" />
                    {!abRevealed ? (
                      <>
                        <span className="text-[11px] text-nm-text-3">Pick the winner —</span>
                        <button onClick={() => pickAbWinner('a')} className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov">
                          A wins
                        </button>
                        <button onClick={() => pickAbWinner('b')} className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov">
                          B wins
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-green-600 dark:text-green-400">Rating bumped — pick a new pair, or</span>
                    )}
                    <button onClick={closeAbAudition} className="text-nm-text-3 hover:text-nm-text text-xs">
                      Exit A/B
                    </button>
                  </div>
                )}
                <div className={abPair ? 'h-full pt-11' : 'h-full'}>
                  <PlayerPanel
                    file={ampCapture}
                    titleOverride={playerIr.display_name.replace(/\.wav$/i, '')}
                    cabIrPath={playerIr.abs_path}
                    onCabIrPathChange={(path) => {
                      // The player's own cab picker changed the IR out from under the browse list.
                      // Nothing in the catalog matches an arbitrary picked path, so drop the list
                      // linkage rather than showing a row as playing when it isn't.
                      if (path !== playerIr.abs_path) {
                        setPlayerIr(null)
                        setAbPair(null)
                      }
                    }}
                    onClose={() => {
                      setPlayerIr(null)
                      setLiveJumpRequest(null)
                      setAbPair(null)
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
                </div>
              </div>
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
                onTogglePanel={togglePanelOpen}
              />
            )}
          </div>
          </>
          )}
        </div>
      )}
        </div>
      </div>

      <IrTray
        rows={trayRows}
        onRemove={(id) => void window.api.irLibraryRemoveFromTray(id).then(refreshTray)}
        onClear={() => {
          void Promise.all(trayRows.map((r) => window.api.irLibraryRemoveFromTray(r.id))).then(refreshTray)
        }}
        onReorder={(orderedIds) => {
          // Optimistic — reflect the drop immediately rather than waiting on the round trip.
          setTrayRows((prev) => orderedIds.map((id) => prev.find((r) => r.id === id)).filter((r): r is typeof prev[number] => r != null))
          void window.api.irLibraryReorderTray(orderedIds)
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
        sendTitle={describeIrLabAvailability(connectorAvailable, irLabStatus, 'Send this tray to IR Lab’s Blender').tooltip}
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

      {contextMenu && (() => {
        // Multi-select-aware: if the right-clicked row is part of an active multi-selection with
        // more than one item, Move/Trash/Edit act on the whole selection — otherwise just this row.
        const menuRows = selectedIds.has(contextMenu.row.id) && selectedIds.size > 1
          ? [...cacheRef.current.values()].filter((r) => selectedIds.has(r.id))
          : [contextMenu.row]
        const menuIds = menuRows.map((r) => r.id)
        const suffix = menuIds.length > 1 ? ` (${menuIds.length})` : ''
        const anyMissing = menuRows.some((r) => r.missing_since)
        return (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Reveal in Folder', onClick: () => window.api.revealFile(contextMenu.row.abs_path) },
            {
              label: 'Rename…',
              disabled: !!contextMenu.row.missing_since || menuIds.length > 1,
              onClick: () => startRename(contextMenu.row)
            },
            {
              label: `Move to…${suffix}`,
              disabled: anyMissing,
              onClick: () =>
                setMoveModal({
                  itemIds: menuIds,
                  libraryRootId: contextMenu.row.library_root_id,
                  currentFolderId: menuIds.length === 1 ? contextMenu.row.folder_id : null
                })
            },
            {
              label: `Edit Metadata…${suffix}`,
              onClick: () => (menuRows.length > 1 ? setBatchEditRows(menuRows) : setEditMetadataRow(contextMenu.row))
            },
            {
              label: `Move to Trash…${suffix}`,
              // A missing item has no file to trash — fileOps.ts refuses it uniformly for all
              // four operations. Use "Remove from Catalog" via the missing-file dialog for that
              // case instead (a different, catalog-only removal that already exists for it).
              disabled: anyMissing,
              destructive: true,
              onClick: () => setTrashConfirmRows(menuRows)
            },
            {
              label: trayIds.has(contextMenu.row.id) ? 'Remove from Tray' : 'Add to Tray',
              onClick: () => toggleTray(contextMenu.row)
            },
            { label: 'Play', onClick: () => openPlayer(contextMenu.row, false) },
            { label: 'Play Live', onClick: () => openPlayer(contextMenu.row, true) },
            { label: 'Add to Group…', onClick: () => setAddToGroupRow(contextMenu.row) },
            { divider: true },
            // The other IR Lab handoff route (blend/tray was already wired) — only meaningful for
            // an IR Lab-native capture, so it's disabled rather than hidden for anything else, same
            // as the rest of this menu's disabled-not-missing convention.
            {
              label: 'Open in IR Lab',
              disabled: !connectorAvailable || !contextMenu.row.capture_id,
              onClick: () => void sendSessionToIrLab(contextMenu.row)
            }
          ]}
        />
        )
      })()}

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

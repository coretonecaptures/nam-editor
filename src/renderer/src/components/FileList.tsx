import { useRef, useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { NamFile, GEAR_TYPES, TONE_TYPES } from '../types/nam'
import { gearChipClass, toneChipClass, getGearImageSrc } from '../assets/gear'
import { detectPreset } from '../utils/detectPreset'
import { BatchRenameModal } from './BatchRenameModal'

type FilterMode = 'all' | 'unnamed' | 'no-gear' | 'no-maker' | 'no-tone' | 'edited' | 'incomplete'

// Completeness: 7 core shareable fields (output level and epochs are optional/technical)
const COMPLETENESS_FIELDS: (keyof NamFile['metadata'])[] = [
  'name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu'
]
function getCompletenessColor(meta: NamFile['metadata']): string | null {
  const filled = COMPLETENESS_FIELDS.filter((k) => meta[k] != null && meta[k] !== '').length
  if (filled === COMPLETENESS_FIELDS.length) return null // fully complete — no dot
  if (filled >= 6) return 'bg-amber-400'  // 1 missing
  return 'bg-red-500'                     // 2+ missing
}
type ViewMode = 'list' | 'grid'
type SortDir = 'asc' | 'desc'

interface FileListProps {
  files: NamFile[]
  selectedIds: Set<string>
  onSelect: (id: string, multi: boolean) => void
  onSelectRange: (ids: string[]) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRemove?: (id: string) => void
  onBatchEditSelected?: (paths: string[]) => void
  onSaveSelected?: (paths: string[]) => void
  onBatchRename?: (renames: { filePath: string; newBaseName: string }[]) => void
  onTrashSelected?: (paths: string[]) => Promise<void>
  onCopyToFolder?: (paths: string[]) => Promise<void>
  onMoveToFolder?: (paths: string[]) => Promise<void>
  onApplyDefaults?: (paths: string[]) => void
  metadataClipboard?: { sourceName: string; metadata: Partial<NamFile['metadata']> } | null
  onCopyMetadata?: (filePath: string) => void
  onPasteMetadata?: (filePaths: string[]) => void
  onClearNamLab?: (filePaths: string[]) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  solidPills?: boolean
  draggable?: boolean
}

const ALL_GRID_COLUMNS: { key: string; label: string; minWidth: number; defaultVisible: boolean }[] = [
  { key: 'name',             label: 'Capture Name',       minWidth: 180, defaultVisible: true  },
  { key: 'date',             label: 'Date',               minWidth: 96,  defaultVisible: true  },
  { key: 'modeled_by',       label: 'Modeled By',         minWidth: 130, defaultVisible: true  },
  { key: 'gear_make',        label: 'Manufacturer',       minWidth: 120, defaultVisible: true  },
  { key: 'gear_model',       label: 'Model',              minWidth: 120, defaultVisible: true  },
  { key: 'gear_type',        label: 'Gear Type',          minWidth: 90,  defaultVisible: true  },
  { key: 'tone_type',        label: 'Tone Type',          minWidth: 90,  defaultVisible: true  },
  { key: 'input_level_dbu',  label: 'Reamp Send (dBu)',   minWidth: 110, defaultVisible: false },
  { key: 'output_level_dbu', label: 'Reamp Return (dBu)', minWidth: 110, defaultVisible: false },
  { key: 'validation_esr',   label: 'ESR',                minWidth: 90,  defaultVisible: false },
  { key: 'loudness',          label: 'Loudness (dBFS)',    minWidth: 110, defaultVisible: false },
  { key: 'gain',              label: 'Gain',               minWidth: 80,  defaultVisible: false },
  { key: 'architecture',      label: 'Architecture',       minWidth: 110, defaultVisible: false },
  { key: 'nam_version',       label: 'NAM Version',        minWidth: 90,  defaultVisible: false },
  { key: 'model_size',        label: 'Model Channels',     minWidth: 120, defaultVisible: false },
  { key: 'checks_passed',     label: 'Checks Passed',      minWidth: 110, defaultVisible: false },
  { key: 'latency_samples',   label: 'Latency (samples)',  minWidth: 110, defaultVisible: false },
  { key: 'nb_trained_epochs',  label: 'Trained Epochs',     minWidth: 100, defaultVisible: false },
  { key: 'nb_preset_name',     label: 'NAM-BOT Preset',     minWidth: 120, defaultVisible: false },
  { key: 'detected_preset',    label: 'Detected Preset',    minWidth: 120, defaultVisible: false },
  { key: 'nl_mics',            label: 'Mic(s)',             minWidth: 130, defaultVisible: false },
  { key: 'nl_cabinet',         label: 'Cabinet',            minWidth: 140, defaultVisible: false },
  { key: 'nl_cabinet_config',  label: 'Cab Config',         minWidth: 90,  defaultVisible: false },
  { key: 'nl_amp_channel',     label: 'Amp Channel',        minWidth: 100, defaultVisible: false },
  { key: 'nl_boost_pedal',     label: 'Boost Pedal(s)',     minWidth: 140, defaultVisible: false },
  { key: 'nl_amp_settings',    label: 'Amp Settings',       minWidth: 160, defaultVisible: false },
  { key: 'nl_pedal_settings',  label: 'Pedal Settings',     minWidth: 160, defaultVisible: false },
  { key: 'nl_amp_switches',    label: 'Amp Switches',       minWidth: 130, defaultVisible: false },
  { key: 'nl_comments',        label: 'Comments',           minWidth: 180, defaultVisible: false },
]

export { ALL_GRID_COLUMNS }

const DEFAULT_VISIBLE_COLS = ALL_GRID_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)
const GRID_COL_STORAGE_KEY = 'nam-lab-grid-columns'

function loadVisibleCols(): string[] {
  try {
    const stored = localStorage.getItem(GRID_COL_STORAGE_KEY)
    if (!stored) return DEFAULT_VISIBLE_COLS
    const parsed = JSON.parse(stored) as string[]
    // Always ensure 'name' is included and only known keys are kept
    const known = new Set(ALL_GRID_COLUMNS.map((c) => c.key))
    const filtered = parsed.filter((k) => known.has(k))
    return filtered.includes('name') ? filtered : ['name', ...filtered]
  } catch {
    return DEFAULT_VISIBLE_COLS
  }
}

function saveVisibleCols(cols: string[]): void {
  localStorage.setItem(GRID_COL_STORAGE_KEY, JSON.stringify(cols))
}

function getCellValue(file: NamFile, key: string): string {
  const m = file.metadata
  switch (key) {
    case 'name':       return m.name || file.fileName
    case 'modeled_by': return m.modeled_by ?? ''
    case 'gear_make':  return m.gear_make ?? ''
    case 'gear_model': return m.gear_model ?? ''
    case 'gear_type':  return m.gear_type ?? ''
    case 'tone_type':  return m.tone_type ?? ''
    case 'date':
      if (!m.date) return ''
      return `${m.date.year}-${String(m.date.month).padStart(2, '0')}-${String(m.date.day).padStart(2, '0')}`
    case 'input_level_dbu':  return m.input_level_dbu  != null ? String(m.input_level_dbu)  : ''
    case 'output_level_dbu': return m.output_level_dbu != null ? String(m.output_level_dbu) : ''
    case 'validation_esr': {
      const esr = (m.training as Record<string, unknown> | undefined)?.validation_esr
      return esr != null ? (esr as number).toFixed(6) : ''
    }
    case 'loudness':    return m.loudness != null ? m.loudness.toFixed(2) : ''
    case 'gain':        return m.gain != null ? m.gain.toFixed(2) : ''
    case 'architecture': return file.architecture ?? ''
    case 'nam_version': return file.version ?? ''
    case 'model_size': {
      const layers = (file.config as Record<string, unknown> | undefined)?.layers
      const ch = Array.isArray(layers) && layers.length > 0
        ? (layers[0] as Record<string, unknown>)?.channels as number | undefined
        : undefined
      if (ch == null) return ''
      return `${ch} channels`
    }
    case 'checks_passed': {
      const t = m.training as Record<string, unknown> | undefined
      const checks = ((t?.data as Record<string, unknown> | undefined)?.checks as Record<string, unknown> | undefined)
      if (checks?.passed == null) return ''
      const passed = checks.passed as boolean
      const ignored = (t?.settings as Record<string, unknown> | undefined)?.ignore_checks === true
      return passed ? 'Yes' : ignored ? 'No (bypassed)' : 'No'
    }
    case 'latency_samples': {
      const cal = (((m.training as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)?.latency as Record<string, unknown> | undefined)?.calibration as Record<string, unknown> | undefined
      return cal?.recommended != null ? String(cal.recommended) : ''
    }
    case 'nb_trained_epochs':
      return m.nb_trained_epochs != null ? String(m.nb_trained_epochs) : ''
    case 'nb_preset_name':
      return m.nb_preset_name ?? ''
    case 'detected_preset':
      return detectPreset(file.config) ?? ''
    case 'nl_mics':           return m.nl_mics           ?? ''
    case 'nl_cabinet':        return m.nl_cabinet        ?? ''
    case 'nl_cabinet_config': return m.nl_cabinet_config ?? ''
    case 'nl_amp_channel':    return m.nl_amp_channel    ?? ''
    case 'nl_boost_pedal':    return m.nl_boost_pedal    ?? ''
    case 'nl_amp_settings':   return m.nl_amp_settings   ?? ''
    case 'nl_pedal_settings': return m.nl_pedal_settings ?? ''
    case 'nl_amp_switches':   return m.nl_amp_switches   ?? ''
    case 'nl_comments':       return m.nl_comments       ?? ''
    default: return ''
  }
}

export { getCellValue, buildExportRows, doExportCSV, doExportXLSX }

function getSortValue(file: NamFile, key: string): string | number {
  if (key === 'date') {
    const d = file.metadata.date
    return d ? d.year * 10000 + d.month * 100 + d.day : 0
  }
  if (key === 'loudness') return file.metadata.loudness ?? -Infinity
  if (key === 'gain') return file.metadata.gain ?? -Infinity
  if (key === 'input_level_dbu') return file.metadata.input_level_dbu ?? -Infinity
  if (key === 'output_level_dbu') return file.metadata.output_level_dbu ?? -Infinity
  if (key === 'validation_esr') {
    const esr = (file.metadata.training as Record<string, unknown> | undefined)?.validation_esr
    return esr != null ? (esr as number) : Infinity
  }
  return getCellValue(file, key).toLowerCase()
}

// ---- Export helpers ----

function buildExportRows(files: NamFile[], cols: typeof ALL_GRID_COLUMNS): Record<string, string>[] {
  return files.map((file) => {
    const row: Record<string, string> = {}
    for (const col of cols) row[col.label] = getCellValue(file, col.key)
    return row
  })
}

function doExportCSV(files: NamFile[], cols: typeof ALL_GRID_COLUMNS, filename: string): void {
  const headers = cols.map((c) => c.label)
  const rows = buildExportRows(files, cols)
  const csvLines = [
    headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map((r) =>
      headers.map((h) => {
        const v = r[h] ?? ''
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v
      }).join(',')
    )
  ]
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function doExportXLSX(files: NamFile[], cols: typeof ALL_GRID_COLUMNS, filename: string): void {
  const rows = buildExportRows(files, cols)
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols.map((c) => c.label) })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'NAM Library')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function FileList({
  files,
  selectedIds,
  onSelect,
  onSelectRange,
  onSelectAll,
  onDeselectAll,
  onRemove = undefined,
  onBatchEditSelected,
  onSaveSelected,
  onBatchRename,
  onTrashSelected,
  onCopyToFolder,
  onMoveToFolder,
  onApplyDefaults,
  metadataClipboard,
  onCopyMetadata,
  onPasteMetadata,
  onClearNamLab,
  viewMode,
  onViewModeChange,
  solidPills = false,
  draggable = false
}: FileListProps) {
  const [search, setSearch] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [gearFilter, setGearFilter] = useState('')
  const [toneFilter, setToneFilter] = useState('')
  const [sortKey, setSortKey] = useState<string | null>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [visibleCols, setVisibleCols] = useState<string[]>(loadVisibleCols)
  const [showExport, setShowExport] = useState(false)
  const [showColChooser, setShowColChooser] = useState(false)
  const anchorIndexRef = useRef<number>(-1)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const [showBatchRename, setShowBatchRename] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const chooserRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showExport) return
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExport(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showExport])

  useEffect(() => {
    if (!showColChooser) return
    const handler = (e: MouseEvent) => {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setShowColChooser(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showColChooser])

  const handleVisibleColsChange = (cols: string[]) => {
    setVisibleCols(cols)
    saveVisibleCols(cols)
  }

  const triggerExport = (allCols: boolean, format: 'csv' | 'xlsx') => {
    setShowExport(false)
    const cols = allCols ? ALL_GRID_COLUMNS : ALL_GRID_COLUMNS.filter((c) => visibleCols.includes(c.key))
    const filename = `nam-library.${format}`
    if (format === 'csv') doExportCSV(sorted, cols, filename)
    else doExportXLSX(sorted, cols, filename)
  }

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu])


  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-gray-400 dark:text-gray-600 text-xs text-center">No files loaded</p>
      </div>
    )
  }

  const filtered = files.filter((f) => {
    const m = f.metadata
    const o = f.originalMetadata
    if (search) {
      const q = search.toLowerCase()
      const haystack = [f.fileName, m.name, m.gear_make, m.gear_model, m.modeled_by]
        .filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (nameSearch) {
      const q = nameSearch.toLowerCase()
      const namVal = (m.name || f.fileName || '').toLowerCase()
      if (!namVal.includes(q)) return false
    }
    if (gearFilter && m.gear_type !== gearFilter) return false
    if (toneFilter && m.tone_type !== toneFilter) return false
    switch (filter) {
      case 'unnamed':    return !o.name
      case 'no-gear':    return !o.gear_type
      case 'no-maker':   return !o.gear_make && !o.gear_model
      case 'no-tone':    return !o.tone_type
      case 'edited':     return f.isDirty
      case 'incomplete': return COMPLETENESS_FIELDS.some((k) => m[k] == null || m[k] === '')
      default:           return true
    }
  })

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = getSortValue(a, sortKey)
        const bv = getSortValue(b, sortKey)
        let cmp = 0
        if (typeof av === 'number' && typeof bv === 'number') {
          cmp = av - bv
        } else {
          cmp = String(av).localeCompare(String(bv))
        }
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtered

  const handleSortClick = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const editedCount = files.filter((f) => f.isDirty).length
  const incompleteCount = files.filter((f) => COMPLETENESS_FIELDS.some((k) => f.metadata[k] == null || f.metadata[k] === '')).length
  const filterOptions: { value: FilterMode; label: string }[] = [
    { value: 'all',        label: 'All' },
    { value: 'edited',     label: editedCount > 0 ? `Edited (${editedCount})` : 'Edited' },
    { value: 'incomplete', label: incompleteCount > 0 ? `Incomplete (${incompleteCount})` : 'Incomplete' },
    { value: 'unnamed',    label: 'Unnamed' },
    { value: 'no-gear',    label: 'No Type' },
    { value: 'no-maker',   label: 'No Maker' },
    { value: 'no-tone',    label: 'No Tone' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden" onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); onSelectAll(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (sorted.length === 0) return
        const selectedArr = [...selectedIds]
        if (selectedArr.length === 0) return
        // Find the anchor: last selected item (bottom for down, top for up)
        const anchorPath = e.key === 'ArrowDown'
          ? sorted.findLast((f) => selectedIds.has(f.filePath))?.filePath
          : sorted.find((f) => selectedIds.has(f.filePath))?.filePath
        if (!anchorPath) return
        const currentIdx = sorted.findIndex((f) => f.filePath === anchorPath)
        if (currentIdx === -1) return
        const nextIdx = e.key === 'ArrowDown'
          ? Math.min(currentIdx + 1, sorted.length - 1)
          : Math.max(currentIdx - 1, 0)
        if (nextIdx === currentIdx) return
        if (e.shiftKey) {
          // Shift+arrow: add adjacent file to selection
          onSelect(sorted[nextIdx].filePath, true)
        } else {
          onSelect(sorted[nextIdx].filePath, false)
        }
      }
    }} tabIndex={-1}>
      {/* Search + view toggle */}
      <div className="px-3 pt-2 pb-1 flex-shrink-0 flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            title="Searches: filename, capture name, manufacturer, model, modeled by"
            className="w-full pl-7 pr-7 py-1.5 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* View toggle + Export */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onViewModeChange('list')}
            title="List view"
            className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => onViewModeChange('grid')}
            title="Grid view"
            className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
            </svg>
          </button>
          {/* Column chooser */}
          <div ref={chooserRef} className="relative">
            <button
              onClick={() => setShowColChooser((v) => !v)}
              title="Configure columns"
              className={`p-1.5 rounded transition-colors ${showColChooser ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </button>
            {showColChooser && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                  Columns
                </div>
                {ALL_GRID_COLUMNS.map((col) => (
                  <label key={col.key} className={`flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${col.key === 'name' ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(col.key)}
                      onChange={() => {
                        if (col.key === 'name') return
                        const next = visibleCols.includes(col.key)
                          ? visibleCols.filter((k) => k !== col.key)
                          : [...visibleCols, col.key]
                        handleVisibleColsChange(next)
                      }}
                      disabled={col.key === 'name'}
                      className="w-3.5 h-3.5 rounded border-gray-400 text-indigo-500 focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <span className="text-gray-700 dark:text-gray-300">{col.label}</span>
                  </label>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-700 mt-1 pt-1 px-3 pb-1">
                  <button
                    onClick={() => handleVisibleColsChange(DEFAULT_VISIBLE_COLS)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Export dropdown */}
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setShowExport((v) => !v)}
              title="Export"
              disabled={sorted.length === 0}
              className={`p-1.5 rounded transition-colors ${showExport ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'} disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            {showExport && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                  Export {sorted.length} rows
                </div>
                <button onClick={() => triggerExport(false, 'csv')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-400">CSV</span> Visible columns
                </button>
                <button onClick={() => triggerExport(true, 'csv')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-400">CSV</span> All columns
                </button>
                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                <button onClick={() => triggerExport(false, 'xlsx')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
                  <span className="text-xs font-mono text-green-500">XLS</span> Visible columns
                </button>
                <button onClick={() => triggerExport(true, 'xlsx')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
                  <span className="text-xs font-mono text-green-500">XLS</span> All columns
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-3 pb-1 flex gap-1 flex-wrap flex-shrink-0">
        {filterOptions.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
              filter === value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Gear + Tone dropdowns */}
      <div className="px-3 pb-2 flex gap-1.5 flex-shrink-0">
        <select
          value={gearFilter}
          onChange={(e) => setGearFilter(e.target.value)}
          className={`text-xs py-0.5 px-2 rounded-full border transition-colors cursor-pointer appearance-none focus:outline-none ${
            gearFilter
              ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400'
              : 'bg-gray-200 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          <option value="" className="bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">Gear type…</option>
          {GEAR_TYPES.map((g) => <option key={g} value={g} className="bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">{g}</option>)}
        </select>
        <select
          value={toneFilter}
          onChange={(e) => setToneFilter(e.target.value)}
          className={`text-xs py-0.5 px-2 rounded-full border transition-colors cursor-pointer appearance-none focus:outline-none ${
            toneFilter
              ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400'
              : 'bg-gray-200 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          <option value="" className="bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">Tone type…</option>
          {TONE_TYPES.map((t) => <option key={t} value={t} className="bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300">{t}</option>)}
        </select>
        {/* Name-only filter */}
        <div className="relative ml-1">
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Name contains…"
            title="Filters to files where the capture name contains this text"
            className={`text-xs py-0.5 pl-2.5 pr-6 rounded-full border transition-colors focus:outline-none focus:border-indigo-500 ${
              nameSearch
                ? 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-400'
                : 'bg-gray-200 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 placeholder-gray-400 dark:placeholder-gray-600'
            }`}
            style={{ width: 130 }}
          />
          {nameSearch && (
            <button
              onClick={() => setNameSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-teal-500 hover:text-teal-700 dark:hover:text-teal-300"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">
          {sorted.length === files.length
            ? `${files.length} file${files.length !== 1 ? 's' : ''}`
            : `${sorted.length} / ${files.length}`}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </span>
        <div className="flex gap-1">
          <button onClick={onSelectAll} className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-1 transition-colors">All</button>
          <span className="text-gray-400 dark:text-gray-700">·</span>
          <button onClick={onDeselectAll} className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-1 transition-colors">None</button>
        </div>
      </div>

      {/* List or Grid */}
      {viewMode === 'grid' ? (
        <GridView
          files={sorted}
          selectedIds={selectedIds}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortClick={handleSortClick}
          anchorIndexRef={anchorIndexRef}
          onSelect={onSelect}
          onSelectRange={onSelectRange}
          solidPills={solidPills}
          draggable={draggable}
          visibleCols={visibleCols}
          onVisibleColsChange={handleVisibleColsChange}
          onContextMenu={(e, filePath) => {
            e.preventDefault()
            if (!selectedIds.has(filePath)) onSelect(filePath, false)
            setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 224), y: Math.min(e.clientY, window.innerHeight - 500), filePath })
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="flex items-center justify-center h-20">
              <p className="text-gray-400 dark:text-gray-600 text-xs">No matches</p>
            </div>
          ) : (
            sorted.map((file, index) => (
              <FileItem
                key={file.filePath}
                file={file}
                isSelected={selectedIds.has(file.filePath)}
                solidPills={solidPills}
                onSelect={(e) => {
                  if (e.shiftKey && anchorIndexRef.current >= 0) {
                    const lo = Math.min(anchorIndexRef.current, index)
                    const hi = Math.max(anchorIndexRef.current, index)
                    onSelectRange(sorted.slice(lo, hi + 1).map((f) => f.filePath))
                  } else {
                    anchorIndexRef.current = index
                    onSelect(file.filePath, e.ctrlKey || e.metaKey)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!selectedIds.has(file.filePath)) onSelect(file.filePath, false)
                  setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 224), y: Math.min(e.clientY, window.innerHeight - 500), filePath: file.filePath })
                }}
                onDragStart={draggable ? (e) => {
                  const paths = selectedIds.has(file.filePath) ? [...selectedIds] : [file.filePath]
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('application/x-nam-files', JSON.stringify(paths))
                } : undefined}
                onRemove={onRemove ? () => onRemove(file.filePath) : undefined}
              />
            ))
          )}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
            onClick={() => {
              window.api.revealFile(ctxMenu.filePath)
              setCtxMenu(null)
            }}
          >
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Show in folder
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
            onClick={() => {
              const names = files.filter((f) => selectedIds.has(f.filePath)).map((f) => f.metadata.name || f.fileName)
              navigator.clipboard.writeText(names.join('\n'))
              setCtxMenu(null)
            }}
          >
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Copy {selectedIds.size > 1 ? `${selectedIds.size} names` : 'name'} to clipboard
          </button>
          {onCopyToFolder && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => { onCopyToFolder([...selectedIds]); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy {selectedIds.size > 1 ? `${selectedIds.size} files` : 'file'} to folder…
            </button>
          )}
          {onMoveToFolder && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => { onMoveToFolder([...selectedIds]); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              Move {selectedIds.size > 1 ? `${selectedIds.size} files` : 'file'} to folder…
            </button>
          )}
          {onApplyDefaults && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => { onApplyDefaults([...selectedIds]); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Apply defaults to {selectedIds.size > 1 ? `${selectedIds.size} files` : 'file'}
            </button>
          )}
          {onTrashSelected && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
              onClick={() => { onTrashSelected([...selectedIds]); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete {selectedIds.size > 1 ? `${selectedIds.size} files` : 'file'} (trash)
            </button>
          )}
          {onBatchRename && selectedIds.size > 1 && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => { setCtxMenu(null); setShowBatchRename(true) }}
            >
              <svg className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Rename {selectedIds.size} selected…
            </button>
          )}
          {(onCopyMetadata || onPasteMetadata) && (
            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          )}
          {onCopyMetadata && selectedIds.size === 1 && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => { onCopyMetadata(ctxMenu.filePath); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Copy metadata
            </button>
          )}
          {onPasteMetadata && metadataClipboard && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => { onPasteMetadata([...selectedIds]); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m0 0v3" />
              </svg>
              <span>
                Paste metadata
                <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-600">from {metadataClipboard.sourceName}</span>
              </span>
            </button>
          )}
          {onClearNamLab && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors flex items-center gap-2"
              onClick={() => { onClearNamLab([...selectedIds]); setCtxMenu(null) }}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove NAM Lab Custom Metadata
            </button>
          )}
          {(onSaveSelected || onBatchEditSelected) && (
            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          )}
          {onSaveSelected && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => {
                onSaveSelected([...selectedIds])
                setCtxMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save {selectedIds.size} selected
            </button>
          )}
          {onBatchEditSelected && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              onClick={() => {
                onBatchEditSelected([...selectedIds])
                setCtxMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              Batch edit {selectedIds.size} selected
            </button>
          )}
        </div>
      )}

      {/* Batch rename modal */}
      {showBatchRename && onBatchRename && (
        <BatchRenameModal
          files={files.filter((f) => selectedIds.has(f.filePath))}
          onApply={(renames) => { onBatchRename(renames); setShowBatchRename(false) }}
          onClose={() => setShowBatchRename(false)}
        />
      )}
    </div>
  )
}

// ---- Grid view ----

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  name:             280,
  date:             100,
  modeled_by:       200,
  gear_make:        150,
  gear_model:       150,
  gear_type:        110,
  tone_type:        110,
  input_level_dbu:  110,
  output_level_dbu: 110,
  validation_esr:   100,
  loudness:         110,
  gain:             90,
  architecture:     130,
  nam_version:      100,
  model_size:         130,
  checks_passed:      120,
  latency_samples:    120,
  nb_trained_epochs:  110,
  nb_preset_name:     140,
  detected_preset:    130,
  nl_mics:            150,
  nl_cabinet:         160,
  nl_cabinet_config:  110,
  nl_amp_channel:     120,
  nl_boost_pedal:     160,
  nl_amp_settings:    180,
  nl_pedal_settings:  180,
  nl_amp_switches:    150,
  nl_comments:        200,
}

function GridView({
  files, selectedIds, sortKey, sortDir, onSortClick,
  anchorIndexRef, onSelect, onSelectRange, solidPills, draggable, visibleCols, onVisibleColsChange, onContextMenu
}: {
  files: NamFile[]
  selectedIds: Set<string>
  sortKey: string | null
  sortDir: SortDir
  onSortClick: (key: string) => void
  anchorIndexRef: React.MutableRefObject<number>
  onSelect: (id: string, multi: boolean) => void
  onSelectRange: (ids: string[]) => void
  solidPills: boolean
  draggable: boolean
  visibleCols: string[]
  onVisibleColsChange: (cols: string[]) => void
  onContextMenu: (e: React.MouseEvent, filePath: string) => void
}) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS)
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const activeColumns = ALL_GRID_COLUMNS.filter((c) => visibleCols.includes(c.key))

  const onResizeStart = (e: React.MouseEvent, key: string) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] }
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const next = Math.max(60, resizingRef.current.startWidth + ev.clientX - resizingRef.current.startX)
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: next }))
    }
    const onUp = () => {
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex-1 overflow-auto relative">
      <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: activeColumns.reduce((s, c) => s + colWidths[c.key], 24) }}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-100 dark:bg-gray-900 border-b-2 border-gray-300 dark:border-gray-700">
            <th className="border-r border-gray-200 dark:border-gray-700" style={{ width: 24 }} />
            {activeColumns.map((col) => (
              <th
                key={col.key}
                className="relative text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r border-gray-200 dark:border-gray-700 select-none"
                style={{ width: colWidths[col.key] }}
              >
                <div
                  className="flex items-center gap-1 px-3 py-2 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 whitespace-nowrap overflow-hidden pr-4"
                  onClick={() => onSortClick(col.key)}
                >
                  <span className="truncate">{col.label}</span>
                  {sortKey === col.key && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                        d={sortDir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                    </svg>
                  )}
                </div>
                <div
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/40 z-20"
                  onMouseDown={(e) => onResizeStart(e, col.key)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {files.length === 0 ? (
            <tr>
              <td colSpan={activeColumns.length + 1} className="text-center py-8 text-gray-400 dark:text-gray-600">No matches</td>
            </tr>
          ) : (
            files.map((file, index) => {
              const isSelected = selectedIds.has(file.filePath)
              return (
                <tr
                  key={file.filePath}
                  className={`border-b border-gray-200 dark:border-gray-700/60 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
                      : 'bg-white dark:bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                  draggable={draggable}
                  onDragStart={draggable ? (e) => {
                    const paths = selectedIds.has(file.filePath) ? [...selectedIds] : [file.filePath]
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('application/x-nam-files', JSON.stringify(paths))
                  } : undefined}
                  onClick={(e) => {
                    if (e.shiftKey && anchorIndexRef.current >= 0) {
                      const lo = Math.min(anchorIndexRef.current, index)
                      const hi = Math.max(anchorIndexRef.current, index)
                      onSelectRange(files.slice(lo, hi + 1).map((f) => f.filePath))
                    } else {
                      anchorIndexRef.current = index
                      onSelect(file.filePath, e.ctrlKey || e.metaKey)
                    }
                  }}
                  onContextMenu={(e) => onContextMenu(e, file.filePath)}
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
                >
                  <td className="border-r border-gray-200 dark:border-gray-700/60 text-center align-middle" style={{ width: 24 }}>
                    {file.isDirty
                      ? <div className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" title="Unsaved changes" />
                      : (() => {
                          const color = getCompletenessColor(file.metadata)
                          return color ? <div className={`w-1.5 h-1.5 rounded-full ${color} inline-block`} title="Incomplete metadata" /> : null
                        })()
                    }
                  </td>
                  {activeColumns.map((col) => {
                    const val = getCellValue(file, col.key)
                    return (
                      <td key={col.key} className="px-3 py-2 border-r border-gray-200 dark:border-gray-700/60 overflow-hidden" style={{ width: colWidths[col.key], maxWidth: colWidths[col.key] }}>
                        {col.key === 'tone_type' && val ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${toneChipClass(val, solidPills)}`}>{val}</span>
                        ) : col.key === 'gear_type' && val ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${gearChipClass(val, solidPills)}`}>{val}</span>
                        ) : col.key === 'name' ? (
                          <span className={`truncate block text-sm font-semibold ${val ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-600'}`}>
                            {val || '—'}
                          </span>
                        ) : col.key === 'validation_esr' && val ? (
                          <span className={`truncate block font-mono ${
                            parseFloat(val) < 0.01  ? 'text-green-500' :
                            parseFloat(val) < 0.05  ? 'text-amber-400' :
                                                      'text-red-400'
                          }`}>{val}</span>
                        ) : (
                          <span className={`truncate block ${val ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}`}>
                            {val || '—'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---- List item ----

function FileItem({
  file,
  isSelected,
  solidPills,
  onSelect,
  onDragStart,
  onRemove,
  onContextMenu
}: {
  file: NamFile
  isSelected: boolean
  solidPills: boolean
  onSelect: (e: React.MouseEvent) => void
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void
  onRemove?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const meta = file.metadata
  const subtitle = [meta.gear_make, meta.gear_model].filter(Boolean).join(' ') || meta.tone_type || file.architecture || ''
  const TRACKED: { key: keyof typeof meta; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'gear_type', label: 'Gear Type' },
    { key: 'gear_make', label: 'Manufacturer' },
    { key: 'gear_model', label: 'Model' },
    { key: 'modeled_by', label: 'Modeled By' },
    { key: 'tone_type', label: 'Tone Type' },
  ]
  const missingFields = TRACKED.filter((f) => !meta[f.key])
  const missing = missingFields.length

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-200/80 dark:border-gray-800/50 hover:bg-gray-100/80 dark:hover:bg-gray-800/50 transition-colors ${
        isSelected ? 'bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40' : ''
      }`}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={(e) => onSelect(e)}
      onContextMenu={onContextMenu}
      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
    >
      <div className="flex-shrink-0 flex items-center justify-center mt-2" style={{ width: 6 }}>
        {file.isDirty
          ? <div className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
          : (() => {
              const color = getCompletenessColor(file.metadata)
              return color
                ? <div className={`w-1.5 h-1.5 rounded-full ${color}`} title="Incomplete metadata" />
                : <div className="w-1.5 h-1.5 rounded-full bg-transparent" />
            })()
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold truncate ${file.isDirty ? 'text-amber-500 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`} title={file.fileName}>
          {meta.name || file.fileName}
        </div>
        {subtitle && (
          <div className="text-xs text-gray-500 dark:text-gray-500 truncate mt-0.5">{subtitle}</div>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          {meta.gear_type && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${gearChipClass(meta.gear_type, solidPills)}`}>{meta.gear_type}</span>
          )}
          {meta.tone_type && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${toneChipClass(meta.tone_type, solidPills)}`}>{meta.tone_type}</span>
          )}
          {missing > 0 && !file.isDirty && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-yellow-900/30 text-amber-700 dark:text-yellow-600"
              title={`Missing: ${missingFields.map((f) => f.label).join(', ')}`}
            >
              {missing} missing
            </span>
          )}
        </div>
      </div>

      {meta.gear_type && (() => {
        const src = getGearImageSrc(meta.gear_type)
        return src ? <img src={src} alt={meta.gear_type} className="flex-shrink-0 h-6 w-auto object-contain opacity-60" /> : null
      })()}

      {onRemove && (
        <button
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove from list"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

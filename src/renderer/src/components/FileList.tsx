import { useRef, useState, useEffect } from 'react'
import { NamFile } from '../types/nam'
import { gearChipClass, toneChipClass, getGearImageSrc } from '../assets/gear'

type FilterMode = 'all' | 'unnamed' | 'no-gear' | 'no-maker' | 'no-tone' | 'edited'
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
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  solidPills?: boolean
  draggable?: boolean
}

const GRID_COLUMNS: { key: string; label: string; minWidth: number }[] = [
  { key: 'name',       label: 'Capture Name',  minWidth: 180 },
  { key: 'date',       label: 'Date',           minWidth: 96  },
  { key: 'modeled_by', label: 'Modeled By',     minWidth: 130 },
  { key: 'gear_make',  label: 'Manufacturer',   minWidth: 120 },
  { key: 'gear_model', label: 'Model',          minWidth: 120 },
  { key: 'gear_type',  label: 'Gear Type',      minWidth: 90  },
  { key: 'tone_type',  label: 'Tone Type',      minWidth: 90  },
]

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
    default: return ''
  }
}

function getSortValue(file: NamFile, key: string): string | number {
  if (key === 'date') {
    const d = file.metadata.date
    return d ? d.year * 10000 + d.month * 100 + d.day : 0
  }
  return getCellValue(file, key).toLowerCase()
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
  viewMode,
  onViewModeChange,
  solidPills = false,
  draggable = false
}: FileListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const anchorIndexRef = useRef<number>(-1)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

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
    switch (filter) {
      case 'unnamed':   return !o.name
      case 'no-gear':   return !o.gear_type
      case 'no-maker':  return !o.gear_make && !o.gear_model
      case 'no-tone':   return !o.tone_type
      case 'edited':    return f.isDirty
      default:          return true
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
  const filterOptions: { value: FilterMode; label: string }[] = [
    { value: 'all',      label: 'All' },
    { value: 'edited',   label: editedCount > 0 ? `Edited (${editedCount})` : 'Edited' },
    { value: 'unnamed',  label: 'Unnamed' },
    { value: 'no-gear',  label: 'No Type' },
    { value: 'no-maker', label: 'No Maker' },
    { value: 'no-tone',  label: 'No Tone' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
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

        {/* View toggle */}
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
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-3 pb-2 flex gap-1 flex-wrap flex-shrink-0">
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
          onContextMenu={(e) => {
            if (selectedIds.size === 0) return
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
        />
      ) : (
        <div
          className="flex-1 overflow-y-auto"
          onContextMenu={(e) => {
            if (selectedIds.size === 0) return
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
        >
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
          className="fixed z-50 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
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
    </div>
  )
}

// ---- Grid view ----

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  name:       280,
  date:       100,
  modeled_by: 200,
  gear_make:  150,
  gear_model: 150,
  gear_type:  110,
  tone_type:  110,
}

function GridView({
  files, selectedIds, sortKey, sortDir, onSortClick,
  anchorIndexRef, onSelect, onSelectRange, solidPills, draggable, onContextMenu
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
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS)
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

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
    <div className="flex-1 overflow-auto" onContextMenu={onContextMenu}>
      <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: GRID_COLUMNS.reduce((s, c) => s + colWidths[c.key], 24) }}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-100 dark:bg-gray-900 border-b-2 border-gray-300 dark:border-gray-700">
            <th className="border-r border-gray-200 dark:border-gray-700" style={{ width: 24 }} />
            {GRID_COLUMNS.map((col) => (
              <th
                key={col.key}
                className="relative text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r border-gray-200 dark:border-gray-700 last:border-r-0 select-none"
                style={{ width: colWidths[col.key] }}
              >
                {/* Sort click area */}
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
                {/* Resize handle */}
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
              <td colSpan={GRID_COLUMNS.length + 1} className="text-center py-8 text-gray-400 dark:text-gray-600">No matches</td>
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
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
                >
                  <td className="border-r border-gray-200 dark:border-gray-700/60 text-center" style={{ width: 24 }}>
                    {file.isDirty && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" title="Unsaved changes" />}
                  </td>
                  {GRID_COLUMNS.map((col) => {
                    const val = getCellValue(file, col.key)
                    return (
                      <td key={col.key} className="px-3 py-2 border-r border-gray-200 dark:border-gray-700/60 last:border-r-0 overflow-hidden" style={{ width: colWidths[col.key], maxWidth: colWidths[col.key] }}>
                        {col.key === 'tone_type' && val ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${toneChipClass(val, solidPills)}`}>{val}</span>
                        ) : col.key === 'gear_type' && val ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${gearChipClass(val, solidPills)}`}>{val}</span>
                        ) : col.key === 'name' ? (
                          <span className={`truncate block text-sm font-semibold ${val ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-600'}`}>
                            {val || '—'}
                          </span>
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
  onRemove
}: {
  file: NamFile
  isSelected: boolean
  solidPills: boolean
  onSelect: (e: React.MouseEvent) => void
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void
  onRemove?: () => void
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
      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
    >
      <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2 transition-colors">
        {file.isDirty
          ? <div className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
          : <div className="w-1.5 h-1.5 rounded-full bg-transparent" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate" title={file.fileName}>
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
          {missing > 0 && (
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

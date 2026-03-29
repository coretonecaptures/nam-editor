import { useRef, useState, useEffect } from 'react'
import { NamFile } from '../types/nam'

type FilterMode = 'all' | 'unnamed' | 'no-gear' | 'no-maker' | 'no-tone' | 'edited'

interface FileListProps {
  files: NamFile[]
  selectedIds: Set<string>
  onSelect: (id: string, multi: boolean) => void
  onSelectRange: (ids: string[]) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRemove?: (id: string) => void  // omit to hide remove button (e.g. librarian mode)
  onBatchEditSelected?: (paths: string[]) => void
  onSaveSelected?: (paths: string[]) => void
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
  onSaveSelected
}: FileListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
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
        <p className="text-gray-600 text-xs text-center">No files loaded</p>
      </div>
    )
  }

  const filtered = files.filter((f) => {
    const m = f.metadata
    const o = f.originalMetadata  // original values from file, before defaults
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
      {/* Search */}
      <div className="px-3 pt-2 pb-1 flex-shrink-0">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="w-full pl-7 pr-7 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
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
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-b border-gray-800 flex-shrink-0">
        <span className="text-xs text-gray-500 font-medium">
          {filtered.length === files.length
            ? `${files.length} file${files.length !== 1 ? 's' : ''}`
            : `${filtered.length} / ${files.length}`}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </span>
        <div className="flex gap-1">
          <button onClick={onSelectAll} className="text-xs text-gray-500 hover:text-gray-300 px-1 transition-colors">All</button>
          <span className="text-gray-700">·</span>
          <button onClick={onDeselectAll} className="text-xs text-gray-500 hover:text-gray-300 px-1 transition-colors">None</button>
        </div>
      </div>

      {/* File list */}
      <div
        className="flex-1 overflow-y-auto"
        onContextMenu={(e) => {
          if (selectedIds.size === 0) return
          e.preventDefault()
          setCtxMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <p className="text-gray-600 text-xs">No matches</p>
          </div>
        ) : (
          filtered.map((file, index) => (
            <FileItem
              key={file.filePath}
              file={file}
              isSelected={selectedIds.has(file.filePath)}
              onSelect={(e) => {
                if (e.shiftKey && anchorIndexRef.current >= 0) {
                  const lo = Math.min(anchorIndexRef.current, index)
                  const hi = Math.max(anchorIndexRef.current, index)
                  onSelectRange(filtered.slice(lo, hi + 1).map((f) => f.filePath))
                } else {
                  anchorIndexRef.current = index
                  onSelect(file.filePath, e.ctrlKey || e.metaKey)
                }
              }}
              onRemove={onRemove ? () => onRemove(file.filePath) : undefined}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {onSaveSelected && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center gap-2"
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
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center gap-2"
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

function FileItem({
  file,
  isSelected,
  onSelect,
  onRemove
}: {
  file: NamFile
  isSelected: boolean
  onSelect: (e: React.MouseEvent) => void
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
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
        isSelected ? 'bg-indigo-900/30 hover:bg-indigo-900/40' : ''
      }`}
      onClick={(e) => onSelect(e)}
      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
    >
      <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2 transition-colors">
        {file.isDirty
          ? <div className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
          : <div className="w-1.5 h-1.5 rounded-full bg-transparent" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-200 truncate" title={file.fileName}>
          {meta.name || file.fileName}
        </div>
        {subtitle && (
          <div className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</div>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          {meta.gear_type && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{meta.gear_type}</span>
          )}
          {meta.tone_type && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-400">{meta.tone_type}</span>
          )}
          {missing > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-600"
              title={`Missing: ${missingFields.map((f) => f.label).join(', ')}`}
            >
              {missing} missing
            </span>
          )}
        </div>
      </div>

      {onRemove && (
        <button
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
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

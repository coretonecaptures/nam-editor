import { useState } from 'react'
import { NamFile } from '../types/nam'

type FilterMode = 'all' | 'unnamed' | 'no-gear' | 'no-maker' | 'no-tone'

interface FileListProps {
  files: NamFile[]
  selectedIds: Set<string>
  onSelect: (id: string, multi: boolean) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRemove: (id: string) => void
}

export function FileList({
  files,
  selectedIds,
  onSelect,
  onSelectAll,
  onDeselectAll,
  onRemove
}: FileListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')

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
      default:          return true
    }
  })

  const filterOptions: { value: FilterMode; label: string }[] = [
    { value: 'all',      label: 'All' },
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
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <p className="text-gray-600 text-xs">No matches</p>
          </div>
        ) : (
          filtered.map((file) => (
            <FileItem
              key={file.filePath}
              file={file}
              isSelected={selectedIds.has(file.filePath)}
              onSelect={(multi) => onSelect(file.filePath, multi)}
              onRemove={() => onRemove(file.filePath)}
            />
          ))
        )}
      </div>
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
  onSelect: (multi: boolean) => void
  onRemove: () => void
}) {
  const meta = file.metadata
  const subtitle = [meta.gear_make, meta.gear_model].filter(Boolean).join(' ') || meta.tone_type || file.architecture || ''
  const missing = (!meta.gear_type ? 1 : 0) + (!meta.gear_make ? 1 : 0) + (!meta.modeled_by ? 1 : 0)

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
        isSelected ? 'bg-indigo-900/30 hover:bg-indigo-900/40' : ''
      }`}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
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
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-600" title={`${missing} empty field${missing !== 1 ? 's' : ''}`}>
              {missing} empty
            </span>
          )}
        </div>
      </div>

      <button
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        title="Remove from list"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

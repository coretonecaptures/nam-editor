import { NamFile } from '../types/nam'

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
  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-gray-600 text-xs text-center">No files loaded</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs text-gray-500 font-medium">
          {files.length} file{files.length !== 1 ? 's' : ''}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </span>
        <div className="flex gap-1">
          <button
            onClick={onSelectAll}
            className="text-xs text-gray-500 hover:text-gray-300 px-1 transition-colors"
            title="Select all"
          >
            All
          </button>
          <span className="text-gray-700">·</span>
          <button
            onClick={onDeselectAll}
            className="text-xs text-gray-500 hover:text-gray-300 px-1 transition-colors"
            title="Deselect all"
          >
            None
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <FileItem
            key={file.filePath}
            file={file}
            isSelected={selectedIds.has(file.filePath)}
            onSelect={(multi) => onSelect(file.filePath, multi)}
            onRemove={() => onRemove(file.filePath)}
          />
        ))}
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
  const subtitle = [meta.gear_make, meta.gear_model].filter(Boolean).join(' ') || meta.tone_type || meta.architecture || ''

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
        isSelected ? 'bg-indigo-900/30 hover:bg-indigo-900/40' : ''
      }`}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
    >
      {/* Dirty indicator */}
      <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2 transition-colors">
        {file.isDirty ? (
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-transparent" />
        )}
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
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
              {meta.gear_type}
            </span>
          )}
          {meta.tone_type && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-400">
              {meta.tone_type}
            </span>
          )}
        </div>
      </div>

      <button
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        title="Remove from list"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

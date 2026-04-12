import { useState, useMemo } from 'react'
import { NamFile } from '../types/nam'

interface DuplicateGroup {
  key: string
  files: NamFile[]
  keepIndex: number
}

interface DuplicatesModalProps {
  files: NamFile[]
  rootFolder: string | null
  onClose: () => void
  onMoveDuplicates: (filePaths: string[]) => Promise<void>
  onTrashDuplicates: (filePaths: string[]) => Promise<void>
}

type DetectionMode = 'filename' | 'metaname'

const CORE_FIELDS: (keyof NamFile['metadata'])[] = [
  'name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu'
]

function completeness(f: NamFile): number {
  return CORE_FIELDS.filter((k) => f.metadata[k] != null && f.metadata[k] !== '').length
}

function computeGroups(files: NamFile[], mode: DetectionMode): DuplicateGroup[] {
  const map = new Map<string, NamFile[]>()
  for (const f of files) {
    const raw = mode === 'filename'
      ? f.fileName
      : (f.metadata.name ?? '').trim()
    const key = raw.toLowerCase()
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  return [...map.entries()]
    .filter(([, grpFiles]) => grpFiles.length >= 2)
    .map(([key, grpFiles]) => {
      // Default keep = most complete metadata; tie-break = first alphabetically by path
      let keepIndex = 0
      let best = -1
      grpFiles.forEach((f, i) => {
        const score = completeness(f)
        if (score > best) { best = score; keepIndex = i }
      })
      return { key, files: grpFiles, keepIndex }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
}

function relPath(filePath: string, rootFolder: string | null): string {
  const norm = filePath.replace(/\\/g, '/')
  if (rootFolder) {
    const root = rootFolder.replace(/\\/g, '/')
    if (norm.startsWith(root + '/')) return norm.slice(root.length + 1)
  }
  // Just show parent folder + filename
  const parts = norm.split('/')
  return parts.slice(-2).join('/')
}

export function DuplicatesModal({ files, rootFolder, onClose, onMoveDuplicates, onTrashDuplicates }: DuplicatesModalProps) {
  const [mode, setMode] = useState<DetectionMode>('filename')
  const [groups, setGroups] = useState<DuplicateGroup[]>(() => computeGroups(files, 'filename'))
  const [working, setWorking] = useState(false)

  const switchMode = (m: DetectionMode) => {
    setMode(m)
    setGroups(computeGroups(files, m))
  }

  const setKeep = (groupIdx: number, keepIndex: number) => {
    setGroups((prev) => prev.map((g, i) => i === groupIdx ? { ...g, keepIndex } : g))
  }

  const dupeFiles = useMemo(() => {
    return groups.flatMap((g) => g.files.filter((_, i) => i !== g.keepIndex))
  }, [groups])

  const dupeCount = dupeFiles.length
  const groupCount = groups.length

  const handleMove = async () => {
    if (dupeCount === 0) return
    setWorking(true)
    await onMoveDuplicates(dupeFiles.map((f) => f.filePath))
    setWorking(false)
    onClose()
  }

  const handleTrash = async () => {
    if (dupeCount === 0) return
    const confirmed = window.confirm(
      `Permanently trash ${dupeCount} duplicate file${dupeCount !== 1 ? 's' : ''}?\n\nFiles will be moved to the OS trash (recoverable).`
    )
    if (!confirmed) return
    setWorking(true)
    await onTrashDuplicates(dupeFiles.map((f) => f.filePath))
    setWorking(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[680px] max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Find Duplicates</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {groupCount === 0
                ? 'No duplicates found'
                : `${groupCount} group${groupCount !== 1 ? 's' : ''} — ${dupeCount} duplicate file${dupeCount !== 1 ? 's' : ''} (non-kept)`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          <button
            onClick={() => switchMode('filename')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'filename' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            By Filename
          </button>
          <button
            onClick={() => switchMode('metaname')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'metaname' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            By Metadata Name
          </button>
          <span className="ml-2 self-center text-xs text-gray-400 dark:text-gray-600">
            {mode === 'filename' ? 'Files with the same .nam filename in different folders' : 'Files with the same capture name in metadata'}
          </span>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-10 h-10 text-gray-300 dark:text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No duplicates found</p>
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">All {files.length} files are unique by {mode === 'filename' ? 'filename' : 'metadata name'}</p>
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={group.key} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate flex-1">{group.key}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{group.files.length} files</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {group.files.map((f, fi) => {
                    const isKeep = fi === group.keepIndex
                    const score = completeness(f)
                    const path = relPath(f.filePath, rootFolder)
                    const dir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '(root)'
                    return (
                      <div
                        key={f.filePath}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isKeep ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                        onClick={() => setKeep(gi, fi)}
                      >
                        {/* Radio */}
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isKeep ? 'border-emerald-500 bg-emerald-500' : 'border-gray-400 dark:border-gray-600'}`}>
                          {isKeep && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>

                        {/* File info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium truncate ${isKeep ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'}`}>
                              {f.fileName}.nam
                            </span>
                            {isKeep && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium flex-shrink-0">
                                keep
                              </span>
                            )}
                            {f.isDirty && (
                              <span className="text-xs text-amber-500 flex-shrink-0">unsaved</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-600 truncate mt-0.5">{dir}</div>
                          {mode === 'metaname' && f.fileName !== group.key && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 truncate">file: {f.fileName}</div>
                          )}
                        </div>

                        {/* Completeness */}
                        <div className="flex-shrink-0 text-right">
                          <div className="flex gap-0.5 justify-end">
                            {CORE_FIELDS.map((k) => (
                              <div
                                key={String(k)}
                                className={`w-1.5 h-4 rounded-sm ${f.metadata[k] != null && f.metadata[k] !== '' ? 'bg-indigo-400 dark:bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                                title={String(k)}
                              />
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">{score}/7</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {groups.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click a row to change which copy to keep. Non-kept files will be acted on.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Cancel
              </button>
              {rootFolder && (
                <button
                  onClick={handleMove}
                  disabled={working || dupeCount === 0}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition-colors"
                >
                  Move {dupeCount} to _Duplicates
                </button>
              )}
              <button
                onClick={handleTrash}
                disabled={working || dupeCount === 0}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white transition-colors"
              >
                Trash {dupeCount}
              </button>
            </div>
          </div>
        )}
        {groups.length === 0 && (
          <div className="flex justify-end px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

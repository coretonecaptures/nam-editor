import { useState, useMemo } from 'react'
import { NamFile } from '../types/nam'

interface DuplicateGroup {
  key: string
  files: NamFile[]
  keepIndex: number
  status: null | 'moved' | 'trashed'
}

interface DuplicatesModalProps {
  files: NamFile[]
  rootFolder: string | null
  onClose: () => void
  onMoveDuplicates: (moves: { filePath: string; destName: string }[]) => Promise<void>
  onTrashDuplicates: (filePaths: string[]) => Promise<void>
}

type DetectionMode = 'filename' | 'metaname'

const CORE_FIELDS: (keyof NamFile['metadata'])[] = [
  'name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu'
]

function completeness(f: NamFile): number {
  return CORE_FIELDS.filter((k) => f.metadata[k] != null && f.metadata[k] !== '').length
}

function buildGroups(files: NamFile[], mode: DetectionMode): Omit<DuplicateGroup, 'status'>[] {
  const map = new Map<string, NamFile[]>()
  for (const f of files) {
    const raw = mode === 'filename' ? f.fileName : (f.metadata.name ?? '').trim()
    const key = raw.toLowerCase()
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  return [...map.entries()]
    .filter(([, grpFiles]) => grpFiles.length >= 2)
    .map(([key, grpFiles]) => {
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
  const parts = norm.split('/')
  return parts.slice(-2).join('/')
}

function parentFolder(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const parts = norm.split('/')
  return parts[parts.length - 2] ?? ''
}

// When moving multiple files with the same basename to _Duplicates,
// disambiguate by appending the source folder name: "filename (from FolderA).nam"
function buildDestName(filePath: string, allDupePaths: string[]): string {
  const norm = filePath.replace(/\\/g, '/')
  const basename = norm.split('/').pop() ?? norm // e.g. "friedman-crunch.nam"
  // Check if any other file being moved has the same basename
  const siblings = allDupePaths.filter((p) => {
    const n = p.replace(/\\/g, '/')
    return n !== norm && (n.split('/').pop() ?? '') === basename
  })
  if (siblings.length === 0) return basename
  const folder = parentFolder(filePath)
  const ext = basename.toLowerCase().endsWith('.nam') ? '.nam' : ''
  const base = ext ? basename.slice(0, -ext.length) : basename
  return `${base} (from ${folder})${ext}`
}

export function DuplicatesModal({ files, rootFolder, onClose, onMoveDuplicates, onTrashDuplicates }: DuplicatesModalProps) {
  const [mode, setMode] = useState<DetectionMode>('filename')
  const [groups, setGroups] = useState<DuplicateGroup[]>(() =>
    buildGroups(files, 'filename').map((g) => ({ ...g, status: null }))
  )
  const [working, setWorking] = useState<number | null>(null) // group index being processed

  const switchMode = (m: DetectionMode) => {
    setMode(m)
    setGroups(buildGroups(files, m).map((g) => ({ ...g, status: null })))
  }

  const setKeep = (gi: number, keepIndex: number) => {
    setGroups((prev) => prev.map((g, i) => i === gi ? { ...g, keepIndex } : g))
  }

  const pendingGroups = useMemo(() => groups.filter((g) => g.status === null), [groups])
  const pendingDupeFiles = useMemo(
    () => pendingGroups.flatMap((g) => g.files.filter((_, i) => i !== g.keepIndex)),
    [pendingGroups]
  )

  const handleGroupMove = async (gi: number) => {
    if (!rootFolder) return
    const group = groups[gi]
    const dupeFiles = group.files.filter((_, i) => i !== group.keepIndex).map((f) => f.filePath)
    const allPaths = pendingDupeFiles.map((f) => f.filePath)
    const moves = dupeFiles.map((fp) => ({ filePath: fp, destName: buildDestName(fp, allPaths) }))
    setWorking(gi)
    await onMoveDuplicates(moves)
    setGroups((prev) => prev.map((g, i) => i === gi ? { ...g, status: 'moved' } : g))
    setWorking(null)
  }

  const handleGroupTrash = async (gi: number) => {
    const group = groups[gi]
    const dupeFiles = group.files.filter((_, i) => i !== group.keepIndex).map((f) => f.filePath)
    const names = dupeFiles.map((p) => p.replace(/\\/g, '/').split('/').pop()).join('\n')
    const confirmed = window.confirm(
      `Trash ${dupeFiles.length} file${dupeFiles.length !== 1 ? 's' : ''} from this group?\n\n${names}\n\nFiles will be moved to the OS trash.`
    )
    if (!confirmed) return
    setWorking(gi)
    await onTrashDuplicates(dupeFiles)
    setGroups((prev) => prev.map((g, i) => i === gi ? { ...g, status: 'trashed' } : g))
    setWorking(null)
  }

  const handleAllMove = async () => {
    if (!rootFolder || pendingGroups.length === 0) return
    const allPaths = pendingDupeFiles.map((f) => f.filePath)
    const moves = pendingDupeFiles.map((f) => ({ filePath: f.filePath, destName: buildDestName(f.filePath, allPaths) }))
    setWorking(-1)
    await onMoveDuplicates(moves)
    setGroups((prev) => prev.map((g) => g.status === null ? { ...g, status: 'moved' } : g))
    setWorking(null)
  }

  const handleAllTrash = async () => {
    if (pendingGroups.length === 0) return
    const n = pendingDupeFiles.length
    const confirmed = window.confirm(
      `Trash all ${n} non-kept duplicate file${n !== 1 ? 's' : ''} (${pendingGroups.length} group${pendingGroups.length !== 1 ? 's' : ''})?\n\nFiles will be moved to the OS trash.`
    )
    if (!confirmed) return
    setWorking(-1)
    await onTrashDuplicates(pendingDupeFiles.map((f) => f.filePath))
    setGroups((prev) => prev.map((g) => g.status === null ? { ...g, status: 'trashed' } : g))
    setWorking(null)
  }

  const totalGroups = groups.length
  const handledGroups = groups.filter((g) => g.status !== null).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[700px] max-h-[82vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Find Duplicates</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {totalGroups === 0
                ? 'No duplicates found'
                : `${totalGroups} group${totalGroups !== 1 ? 's' : ''} · ${handledGroups} handled · ${totalGroups - handledGroups} pending`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 pb-2 flex-shrink-0 border-b border-gray-100 dark:border-gray-800">
          <button onClick={() => switchMode('filename')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'filename' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}>
            By Filename
          </button>
          <button onClick={() => switchMode('metaname')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'metaname' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}>
            By Metadata Name
          </button>
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-600">
            {mode === 'filename' ? 'Same .nam filename in different folders' : 'Same capture name in metadata field'}
          </span>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-10 h-10 text-gray-300 dark:text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No duplicates found</p>
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">All {files.length} files are unique by {mode === 'filename' ? 'filename' : 'metadata name'}</p>
            </div>
          ) : (
            groups.map((group, gi) => {
              const isHandled = group.status !== null
              const isWorking = working === gi
              const dupesInGroup = group.files.filter((_, i) => i !== group.keepIndex).length
              return (
                <div key={group.key} className={`border rounded-lg overflow-hidden transition-opacity ${isHandled ? 'opacity-50 border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
                  {/* Group header */}
                  <div className={`flex items-center gap-2 px-3 py-2 ${isHandled ? 'bg-gray-50 dark:bg-gray-800/30' : 'bg-gray-100 dark:bg-gray-800'}`}>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate flex-1">{group.key}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{group.files.length} files</span>

                    {isHandled ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${group.status === 'moved' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        {group.status === 'moved' ? 'Moved' : 'Trashed'}
                      </span>
                    ) : (
                      <div className="flex gap-1.5 flex-shrink-0">
                        {rootFolder && (
                          <button
                            onClick={() => handleGroupMove(gi)}
                            disabled={isWorking || working === -1}
                            title={`Move ${dupesInGroup} non-kept file${dupesInGroup !== 1 ? 's' : ''} to _Duplicates`}
                            className="px-2 py-1 text-xs font-medium rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition-colors"
                          >
                            {isWorking ? '…' : `Move ${dupesInGroup} →`}
                          </button>
                        )}
                        <button
                          onClick={() => handleGroupTrash(gi)}
                          disabled={isWorking || working === -1}
                          title={`Trash ${dupesInGroup} non-kept file${dupesInGroup !== 1 ? 's' : ''}`}
                          className="px-2 py-1 text-xs font-medium rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white transition-colors"
                        >
                          {isWorking ? '…' : `Trash ${dupesInGroup}`}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* File rows */}
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {group.files.map((f, fi) => {
                      const isKeep = fi === group.keepIndex
                      const score = completeness(f)
                      const path = relPath(f.filePath, rootFolder)
                      const dir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '(root)'
                      return (
                        <div
                          key={f.filePath}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors select-none ${isHandled ? '' : isKeep ? 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                          onClick={() => !isHandled && setKeep(gi, fi)}
                          title={isHandled ? '' : isKeep ? 'This file will be kept' : 'Click to keep this file instead'}
                        >
                          {/* Keep radio */}
                          <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isKeep ? 'border-emerald-500 bg-emerald-500' : 'border-gray-400 dark:border-gray-600'}`}>
                            {isKeep && <div className="w-1 h-1 rounded-full bg-white" />}
                          </div>

                          {/* File info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium truncate ${isKeep ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                {f.fileName}.nam
                              </span>
                              {isKeep && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium flex-shrink-0">keep</span>
                              )}
                              {f.isDirty && <span className="text-xs text-amber-500 flex-shrink-0">unsaved</span>}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-600 truncate">{dir}</div>
                          </div>

                          {/* Completeness bars */}
                          <div className="flex-shrink-0 text-right">
                            <div className="flex gap-0.5 justify-end">
                              {CORE_FIELDS.map((k) => (
                                <div key={String(k)} className={`w-1.5 h-3.5 rounded-sm ${f.metadata[k] != null && f.metadata[k] !== '' ? 'bg-indigo-400 dark:bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'}`} title={String(k)} />
                              ))}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">{score}/7</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900 rounded-b-xl">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {pendingGroups.length > 0 ? (
              <>Click a file row to change which to keep. Use group buttons to handle one at a time.</>
            ) : totalGroups > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">All groups handled ✓</span>
            ) : null}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors">
              {handledGroups > 0 && pendingGroups.length === 0 ? 'Done' : 'Close'}
            </button>
            {pendingGroups.length > 1 && (
              <>
                {rootFolder && (
                  <button
                    onClick={handleAllMove}
                    disabled={working !== null}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition-colors"
                  >
                    {working === -1 ? 'Working…' : `Move all ${pendingDupeFiles.length} to _Duplicates`}
                  </button>
                )}
                <button
                  onClick={handleAllTrash}
                  disabled={working !== null}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white transition-colors"
                >
                  {working === -1 ? 'Working…' : `Trash all ${pendingDupeFiles.length}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

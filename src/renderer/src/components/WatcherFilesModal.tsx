import { useEffect, useState, useCallback, useRef } from 'react'
import type { WatcherFileEntry, WatcherFileStatus } from '../types/trainer'

type SortKey = 'name-asc' | 'name-desc' | 'date-new' | 'date-old'
type RetrainAction = 'wipe-retrain' | 'retrain-new' | 'mark-skipped'

interface Props {
  profileId: string
  profileName: string
  watchFolder: string
  architectures: string[]
  onClose: () => void
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatusBadge({ status }: { status: WatcherFileStatus }) {
  const styles: Record<WatcherFileStatus, string> = {
    pending:  'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    queued:   'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',
    running:  'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    done:     'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
    failed:   'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
    canceled: 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
    skipped:  'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  }
  const labels: Record<WatcherFileStatus, string> = {
    pending: 'Not queued', queued: 'In queue', running: 'Training',
    done: 'Done', failed: 'Failed', canceled: 'Canceled', skipped: 'Skipped',
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

export function WatcherFilesModal({ profileId, profileName, watchFolder, architectures, onClose }: Props) {
  const [files, setFiles] = useState<WatcherFileEntry[] | null>(null)
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState<Set<string>>(new Set())
  const [resetAll, setResetAll] = useState(false)
  const [sort, setSort] = useState<SortKey>('date-new')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setError('')
    const result = await window.api.getWatcherFilesStatus(profileId, watchFolder, architectures)
    if (!result.success) { setError(result.error ?? 'Failed to load files.'); return }
    setFiles(result.files ?? [])
  }, [profileId, watchFolder, architectures])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleReset = async (filePath: string) => {
    setResetting((prev) => new Set(prev).add(filePath))
    await window.api.resetWatcherFile(profileId, filePath)
    await load()
    setResetting((prev) => { const next = new Set(prev); next.delete(filePath); return next })
  }

  const handleAction = async (filePath: string, action: RetrainAction) => {
    setMenuOpen(null)
    setResetting((prev) => new Set(prev).add(filePath))
    await window.api.retrainFileAction(profileId, filePath, action)
    await load()
    setResetting((prev) => { const next = new Set(prev); next.delete(filePath); return next })
  }

  const handleResetAll = async () => {
    setResetAll(true)
    await window.api.clearProfileSkippedAndRescan(profileId)
    await load()
    setResetAll(false)
  }

  const pendingOrSkipped = files?.filter((f) =>
    f.statuses.some((s) => s.status === 'pending' || s.status === 'skipped' || s.status === 'failed' || s.status === 'canceled')
  ) ?? []

  const sortedFiles = files ? [...files].sort((a, b) => {
    if (sort === 'name-asc') return a.fileName.localeCompare(b.fileName)
    if (sort === 'name-desc') return b.fileName.localeCompare(a.fileName)
    if (sort === 'date-new') return b.mtimeMs - a.mtimeMs
    return a.mtimeMs - b.mtimeMs
  }) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{profileName} — Files</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-500 font-mono truncate mt-0.5">{watchFolder}</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        {files && files.length > 0 && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">
              {files.length} file{files.length !== 1 ? 's' : ''} · {pendingOrSkipped.length} need{pendingOrSkipped.length === 1 ? 's' : ''} attention
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="px-2 py-1 rounded text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-none outline-none cursor-pointer"
            >
              <option value="date-new">Date: Newest</option>
              <option value="date-old">Date: Oldest</option>
              <option value="name-asc">Name: A–Z</option>
              <option value="name-desc">Name: Z–A</option>
            </select>
            <button
              onClick={() => void load()}
              className="px-2.5 py-1 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
            >
              Refresh
            </button>
            {pendingOrSkipped.length > 0 && (
              <button
                onClick={() => void handleResetAll()}
                disabled={resetAll}
                className="px-2.5 py-1 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
              >
                {resetAll ? 'Resetting…' : 'Reset All & Re-queue'}
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!files && !error && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400 dark:text-gray-600">
              Scanning folder…
            </div>
          )}
          {error && (
            <div className="px-5 py-4 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}
          {files && files.length === 0 && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400 dark:text-gray-600">
              No WAV files found in this folder.
            </div>
          )}
          {files && files.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800/80">
                <tr className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-5 py-2 font-semibold">File</th>
                  <th className="text-left px-3 py-2 font-semibold">Size</th>
                  <th className="text-left px-3 py-2 font-semibold">Modified</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sortedFiles.map((file) => {
                  const isResetting = resetting.has(file.filePath)
                  const needsAttention = file.statuses.some((s) => s.status === 'pending' || s.status === 'skipped' || s.status === 'failed' || s.status === 'canceled')
                  return (
                    <tr key={file.filePath} className={needsAttention ? 'bg-amber-50/40 dark:bg-amber-900/5' : ''}>
                      <td className="px-5 py-2.5">
                        <div className="font-mono text-gray-800 dark:text-gray-200 break-all leading-tight">{file.fileName}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 dark:text-gray-600 whitespace-nowrap">
                        {formatBytes(file.sizeBytes)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 dark:text-gray-500 whitespace-nowrap font-mono text-[10px]">
                        {formatDate(file.mtimeMs)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {file.statuses.map((s) => (
                            <div key={s.architecture} className="flex items-center gap-1">
                              {file.statuses.length > 1 && (
                                <span className="text-[9px] text-gray-400 dark:text-gray-600 uppercase">{s.architecture}</span>
                              )}
                              <StatusBadge status={s.status} />
                            </div>
                          ))}
                          {file.statuses.length === 0 && (
                            <span className="text-[10px] text-gray-400 italic">No architectures</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right relative">
                        {isResetting ? (
                          <span className="text-xs text-gray-400 dark:text-gray-600 px-1">…</span>
                        ) : (
                          <div className="relative inline-block" ref={menuOpen === file.filePath ? menuRef : null}>
                            <button
                              onClick={() => setMenuOpen(menuOpen === file.filePath ? null : file.filePath)}
                              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              title="Actions"
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                                <circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
                              </svg>
                            </button>
                            {menuOpen === file.filePath && (
                              <div className="absolute right-0 top-7 z-50 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl py-1 text-xs">
                                <button
                                  onClick={() => void handleAction(file.filePath, 'wipe-retrain')}
                                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center gap-2"
                                >
                                  <span className="text-red-500">✕</span> Wipe output &amp; retrain
                                </button>
                                <button
                                  onClick={() => void handleAction(file.filePath, 'retrain-new')}
                                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center gap-2"
                                >
                                  <span className="text-indigo-500">+</span> Retrain as new file
                                </button>
                                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                                <button
                                  onClick={() => void handleAction(file.filePath, 'mark-skipped')}
                                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 flex items-center gap-2"
                                >
                                  <span>◌</span> Mark as skipped
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Legend */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-x-4 gap-y-1">
          {(['pending', 'queued', 'running', 'skipped', 'done', 'failed'] as WatcherFileStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <StatusBadge status={s} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

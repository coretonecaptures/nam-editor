import { useEffect, useMemo, useState } from 'react'
import type { FolderNode } from '../types/librarian'

export type LibraryCleanupLayout =
  | 'flat'
  | 'creator'
  | 'creator-amp'
  | 'creator-amp-di-cab'
  | 'creator-amp-di-cab-preset'

export interface LibraryCleanupFolderEntry {
  path: string
  label: string
  depth: number
  checked: boolean
  savedIgnore: boolean
}

export interface LibraryCleanupPreviewRow {
  sourcePath: string
  destinationPath: string
  note: string | null
  needsReview: boolean
  actionable: boolean
}

interface Props {
  openMode: 'library' | 'folder'
  sourceRoot: string | null
  destinationRoot: string | null
  actionMode: 'copy' | 'move'
  layout: LibraryCleanupLayout
  folderEntries: LibraryCleanupFolderEntry[]
  previewRows: LibraryCleanupPreviewRow[] | null
  busyLabel: string | null
  rememberUncheckedGlobally: boolean
  savedIgnoreCount: number
  onClose: () => void
  onPickSourceRoot: () => void
  onPickDestinationRoot: () => void
  onActionModeChange: (mode: 'copy' | 'move') => void
  onLayoutChange: (layout: LibraryCleanupLayout) => void
  onToggleFolder: (path: string, checked: boolean) => void
  onRememberUncheckedChange: (value: boolean) => void
  onPreview: () => void
  onRun: () => void
  onExportNeedsReview: (format: 'csv' | 'xlsx') => void
  onResetSavedIgnores: () => void
}

const LAYOUT_OPTIONS: Array<{ value: LibraryCleanupLayout; label: string }> = [
  { value: 'flat', label: 'Flat' },
  { value: 'creator', label: 'Creator' },
  { value: 'creator-amp', label: 'Creator > Amp' },
  { value: 'creator-amp-di-cab', label: 'Creator > Amp > DI/CAB' },
  { value: 'creator-amp-di-cab-preset', label: 'Creator > Amp > DI/CAB > Preset Type' },
]

function formatPath(path: string | null): string {
  if (!path) return 'Not selected'
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length <= 5 ? normalized : `.../${parts.slice(-5).join('/')}`
}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  parts.pop()
  return parts.join('/') || normalized
}

export function LibraryCleanupModal({
  openMode,
  sourceRoot,
  destinationRoot,
  actionMode,
  layout,
  folderEntries,
  previewRows,
  busyLabel,
  rememberUncheckedGlobally,
  savedIgnoreCount,
  onClose,
  onPickSourceRoot,
  onPickDestinationRoot,
  onActionModeChange,
  onLayoutChange,
  onToggleFolder,
  onRememberUncheckedChange,
  onPreview,
  onRun,
  onExportNeedsReview,
  onResetSavedIgnores,
}: Props) {
  const [previewFilter, setPreviewFilter] = useState<'all' | 'ready' | 'needs-review'>('all')
  const isRunning = !!busyLabel && busyLabel.toLowerCase().startsWith('running')
  const isBuildingPreview = !!busyLabel && !isRunning
  const canPreview = !!sourceRoot && !!destinationRoot && !busyLabel
  const previewUnchanged = previewRows?.filter((row) => !row.needsReview && !row.actionable).length ?? 0
  const previewReady = previewRows?.filter((row) => !row.needsReview && row.actionable).length ?? 0
  const canRun = !!previewRows && previewRows.some((row) => row.actionable) && !busyLabel
  const previewNeedsReview = previewRows?.filter((row) => row.needsReview).length ?? 0

  useEffect(() => {
    setPreviewFilter('all')
  }, [previewRows])

  const reasonCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of previewRows ?? []) {
      if (!row.needsReview) continue
      const key = row.note?.trim() || 'Needs review'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [previewRows])

  const filteredPreviewRows = useMemo(() => {
    if (!previewRows) return null
    if (previewFilter === 'ready') return previewRows.filter((row) => !row.needsReview && row.actionable)
    if (previewFilter === 'needs-review') return previewRows.filter((row) => row.needsReview)
    return previewRows
  }, [previewRows, previewFilter])

  const groupedNeedsReviewRows = useMemo(() => {
    const groups = new Map<string, LibraryCleanupPreviewRow[]>()
    for (const row of filteredPreviewRows ?? []) {
      if (!row.needsReview) continue
      const key = row.note?.trim() || 'Needs review'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [filteredPreviewRows])

  const filteredReadyRows = useMemo(() => {
    return (filteredPreviewRows ?? []).filter((row) => !row.needsReview && row.actionable)
  }, [filteredPreviewRows])

  const filteredUnchangedRows = useMemo(() => {
    return (filteredPreviewRows ?? []).filter((row) => !row.needsReview && !row.actionable)
  }, [filteredPreviewRows])

  const showGroupedNeedsReview = previewFilter !== 'ready' && groupedNeedsReviewRows.length > 0

  const renderPreviewTable = (rows: LibraryCleanupPreviewRow[]) => (
    <table className="min-w-full text-xs">
      <thead className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <tr className="text-left text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <th className="px-3 py-2">Capture</th>
          <th className="px-3 py-2">From</th>
          <th className="px-3 py-2">To</th>
          <th className="px-3 py-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.sourcePath}=>${row.destinationPath}`} className={`border-b border-gray-100 dark:border-gray-800 ${row.needsReview ? 'bg-amber-50/40 dark:bg-amber-900/10' : !row.actionable ? 'bg-gray-50/60 dark:bg-gray-800/20' : ''}`}>
            <td className="px-3 py-2 align-top">
              <div className="font-medium text-gray-800 dark:text-gray-100 break-all">{baseName(row.sourcePath)}</div>
            </td>
            <td className="px-3 py-2 align-top">
              <div className="text-gray-600 dark:text-gray-300 break-all">{parentPath(row.sourcePath)}</div>
            </td>
            <td className="px-3 py-2 align-top">
              <div className="text-gray-600 dark:text-gray-300 break-all">{row.destinationPath}</div>
            </td>
            <td className="px-3 py-2 align-top">
              <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${row.needsReview ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : row.actionable ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                {row.needsReview ? 'Needs Review' : row.actionable ? 'Ready' : 'No Change'}
              </div>
              {row.note && (
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{row.note}</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-6xl mx-4 flex flex-col max-h-[90vh]">
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Clean Up / Build Library</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Collect `.nam` files from a chosen parent root into a cleaner library structure, with preview-first safety rails.
          </p>
          {openMode === 'folder' && (
            <div className="mt-3 rounded border border-violet-200 dark:border-violet-900/60 bg-violet-50/60 dark:bg-violet-900/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-200">
              <strong>Folder mode:</strong> the selected folder is treated as an anchor. Matching creator / amp path segments already represented by this folder will not be rebuilt inside it.
            </div>
          )}
        </div>

        <div className="px-5 py-4 grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4 flex-1 overflow-hidden">
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-950/20">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Roots</div>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Parent Root</div>
                  <button onClick={onPickSourceRoot} className="w-full text-left px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {formatPath(sourceRoot)}
                  </button>
                </div>
                <div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Destination Library Root</div>
                  <button onClick={onPickDestinationRoot} className="w-full text-left px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {formatPath(destinationRoot)}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-950/20">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Run Options</div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onActionModeChange('copy')}
                    className={`px-3 py-2 rounded border text-sm transition-colors ${actionMode === 'copy' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => onActionModeChange('move')}
                    className={`px-3 py-2 rounded border text-sm transition-colors ${actionMode === 'move' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                  >
                    Move
                  </button>
                </div>
                {actionMode === 'move' && (
                  <div className="rounded border border-amber-300/70 dark:border-amber-700/70 bg-amber-50/60 dark:bg-amber-900/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    <strong>Warning:</strong> Move will relocate the source files and cannot be undone by NAM Lab.
                  </div>
                )}
                <div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Structure</div>
                  <select
                    value={layout}
                    onChange={(e) => onLayoutChange(e.target.value as LibraryCleanupLayout)}
                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200"
                  >
                    {LAYOUT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-950/20">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Folder Scope</div>
                {savedIgnoreCount > 0 && (
                  <button onClick={onResetSavedIgnores} className="text-[11px] text-indigo-500 hover:text-indigo-400 transition-colors">
                    Clear saved ignores ({savedIgnoreCount})
                  </button>
                )}
              </div>
              <label className="flex items-start gap-2 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberUncheckedGlobally}
                  onChange={(e) => onRememberUncheckedChange(e.target.checked)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  Remember unchecked folders as always-ignored exact paths on this computer
                </span>
              </label>
              <div className="text-[11px] text-gray-500 dark:text-gray-500 mb-3">
                Build this list by unchecking folders here before a preview or run, then leaving the remember option on.
              </div>
              <div className="max-h-64 overflow-y-auto rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                {folderEntries.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-500">Pick a parent root to scan folders.</div>
                ) : (
                  folderEntries.map((entry) => (
                    <label key={entry.path} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-gray-100 dark:border-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.checked}
                        onChange={(e) => onToggleFolder(entry.path, e.target.checked)}
                        className="accent-indigo-600"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1" style={{ paddingLeft: `${entry.depth * 14}px` }}>
                        {entry.label}
                      </span>
                      {entry.savedIgnore && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wider">Saved</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/20 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Preview</div>
                <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {previewRows ? `${previewRows.length} file${previewRows.length !== 1 ? 's' : ''} in this preview` : 'Build a preview before running'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!!previewRows && previewNeedsReview > 0 && (
                  <>
                    <button
                      onClick={() => onExportNeedsReview('csv')}
                      disabled={!!busyLabel}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${busyLabel ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/30'}`}
                    >
                      Export Needs Review CSV
                    </button>
                    <button
                      onClick={() => onExportNeedsReview('xlsx')}
                      disabled={!!busyLabel}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${busyLabel ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/30'}`}
                    >
                      Export Needs Review XLSX
                    </button>
                  </>
                )}
                <button
                  onClick={onPreview}
                  disabled={!canPreview}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${canPreview ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default'}`}
                >
                  <span className="inline-flex items-center gap-2">
                    {isBuildingPreview && (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
                        <path d="M21 12a9 9 0 00-9-9" className="opacity-90" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                    {isBuildingPreview ? 'Building...' : 'Build Preview'}
                  </span>
                </button>
                <button
                  onClick={onRun}
                  disabled={!canRun}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${canRun ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default'}`}
                >
                  <span className="inline-flex items-center gap-2">
                    {isRunning && (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
                        <path d="M21 12a9 9 0 00-9-9" className="opacity-90" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                    {isRunning ? 'Running...' : 'Run Cleanup'}
                  </span>
                </button>
              </div>
            </div>
            {busyLabel && (
              <div className="px-4 py-2 text-xs text-indigo-600 dark:text-indigo-300 border-b border-gray-200 dark:border-gray-800">
                {busyLabel}
              </div>
            )}
            {!!previewRows && (
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Total</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{previewRows.length}</div>
                  </div>
                  <div className="rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-900/10 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Ready</div>
                    <div className="mt-1 text-lg font-semibold text-emerald-800 dark:text-emerald-200">{previewReady}</div>
                  </div>
                  <div className="rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-900/10 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-300">Needs Review</div>
                    <div className="mt-1 text-lg font-semibold text-amber-800 dark:text-amber-200">{previewNeedsReview}</div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">No Change</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{previewUnchanged}</div>
                  </div>
                </div>

                {previewNeedsReview > 0 && (
                  <div className="rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-900/10 px-3 py-2">
                    <div className="text-xs font-medium text-amber-800 dark:text-amber-200">
                      “Needs Review” means these files would be copied into the destination library’s <span className="font-semibold">Needs Review</span> folder because the selected layout needs metadata that NAM Lab could not classify confidently.
                    </div>
                    {reasonCounts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {reasonCounts.map(([reason, count]) => (
                          <span key={reason} className="inline-flex items-center rounded-full border border-amber-300/70 dark:border-amber-700/60 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200">
                            {reason}: {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewFilter('all')}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${previewFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setPreviewFilter('ready')}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${previewFilter === 'ready' ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                  >
                    Ready
                  </button>
                  <button
                    onClick={() => setPreviewFilter('needs-review')}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${previewFilter === 'needs-review' ? 'bg-amber-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                  >
                    Needs Review
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              {!previewRows ? (
                <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-500">
                  Pick source and destination roots, tune the folder checklist, then build a preview.
                </div>
              ) : previewRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-500">
                  No `.nam` files matched the current scope.
                </div>
              ) : (
                <div className="space-y-4 p-3">
                  {filteredReadyRows.length > 0 && (
                    <div className="rounded border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
                      {showGroupedNeedsReview && (
                        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-emerald-50/50 dark:bg-emerald-900/10 text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                          Ready ({filteredReadyRows.length})
                        </div>
                      )}
                      {renderPreviewTable(filteredReadyRows)}
                    </div>
                  )}

                  {filteredUnchangedRows.length > 0 && previewFilter !== 'ready' && (
                    <div className="rounded border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
                      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                          Already Matches Selected Structure
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          {filteredUnchangedRows.length} file{filteredUnchangedRows.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {renderPreviewTable(filteredUnchangedRows)}
                    </div>
                  )}

                  {showGroupedNeedsReview && groupedNeedsReviewRows.map(([reason, rows]) => (
                    <div key={reason} className="rounded border border-amber-200 dark:border-amber-900/60 overflow-hidden bg-white dark:bg-gray-900">
                      <div className="px-3 py-2 border-b border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-900/10 flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          {reason}
                        </div>
                        <div className="text-[11px] text-amber-700 dark:text-amber-300">
                          {rows.length} file{rows.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {renderPreviewTable(rows)}
                    </div>
                  ))}

                  {filteredReadyRows.length === 0 && !showGroupedNeedsReview && (
                    <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-500">
                      No rows match the current preview filter.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={!!busyLabel}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${busyLabel ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'

export interface CompanionInboxItem {
  id: string
  kind: 'note' | 'photo' | 'cover'
  title: string
  detail: string
  createdAt: string
  folderPath: string
  assetPath: string | null
  status: 'new' | 'reviewed'
}

interface Props {
  items: CompanionInboxItem[]
  onRefresh: () => void
  onMarkReviewed: (item: CompanionInboxItem) => void
  onDelete: (item: CompanionInboxItem) => void
  onUseAsCover: (item: CompanionInboxItem) => void
  onRevealAsset: (item: CompanionInboxItem) => void
  onOpenFolder: (item: CompanionInboxItem) => void
  onClose: () => void
}

function toLocalFileUrl(p: string): string {
  return p.startsWith('/') ? `local-file://${p}` : `local-file:///${p}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function kindLabel(kind: CompanionInboxItem['kind']): string {
  if (kind === 'cover') return 'Cover'
  if (kind === 'photo') return 'Photo'
  return 'Note'
}

function kindBadgeClass(kind: CompanionInboxItem['kind']): string {
  if (kind === 'cover') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
  if (kind === 'photo') return 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

export function CompanionInboxPanel({
  items,
  onRefresh,
  onMarkReviewed,
  onDelete,
  onUseAsCover,
  onRevealAsset,
  onOpenFolder,
  onClose,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)

  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) setSelectedId(items[0].id)
  }, [items, selectedId])

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  )
  const pendingCount = items.filter((item) => item.status === 'new').length

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h10" />
        </svg>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1">Companion Inbox</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {pendingCount} new
        </span>
        <button
          onClick={onRefresh}
          className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          Refresh
        </button>
        <button
          onClick={onClose}
          className="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors ml-1"
          title="Close"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
          <svg className="w-9 h-9 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M4 12h10m-10 5h7" />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400">No companion items yet.</p>
          <p className="text-xs text-gray-400 dark:text-gray-600">Photos, cover candidates, and notes from the phone app will land here.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div className="w-[20rem] max-w-[40%] min-w-[15rem] border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
            <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {items.map((item) => {
                const selected = item.id === selectedItem?.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left px-3 py-3 transition-colors ${
                      selected
                        ? 'bg-sky-50 dark:bg-sky-950/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${kindBadgeClass(item.kind)}`}>
                            {kindLabel(item.kind)}
                          </span>
                          {item.status === 'new' && (
                            <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                              New
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">{item.detail || 'No notes added.'}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1.5">{formatTime(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto">
            {selectedItem && (
              <div className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${kindBadgeClass(selectedItem.kind)}`}>
                        {kindLabel(selectedItem.kind)}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        selectedItem.status === 'reviewed'
                          ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}>
                        {selectedItem.status === 'reviewed' ? 'Reviewed' : 'Needs review'}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 break-words">{selectedItem.title}</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatTime(selectedItem.createdAt)}</p>
                  </div>
                </div>

                {selectedItem.assetPath && (
                  <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40">
                    <img
                      src={toLocalFileUrl(selectedItem.assetPath)}
                      alt={selectedItem.title}
                      className="w-full max-h-[24rem] object-contain bg-black/5 dark:bg-black/20"
                    />
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/80 dark:bg-gray-950/40">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Notes</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-2">{selectedItem.detail || 'No notes added.'}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/80 dark:bg-gray-950/40">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Target Folder</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 break-all mt-2">{selectedItem.folderPath || 'No folder attached.'}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedItem.assetPath && selectedItem.folderPath && (
                    <button
                      onClick={() => onUseAsCover(selectedItem)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                    >
                      Use as cover
                    </button>
                  )}
                  {selectedItem.status !== 'reviewed' && (
                    <button
                      onClick={() => onMarkReviewed(selectedItem)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-sky-600 text-white hover:bg-sky-500 transition-colors"
                    >
                      Mark reviewed
                    </button>
                  )}
                  {selectedItem.folderPath && (
                    <button
                      onClick={() => onOpenFolder(selectedItem)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors"
                    >
                      Open folder
                    </button>
                  )}
                  {selectedItem.assetPath && (
                    <button
                      onClick={() => onRevealAsset(selectedItem)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 transition-colors"
                    >
                      Reveal image
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(selectedItem)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/40 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

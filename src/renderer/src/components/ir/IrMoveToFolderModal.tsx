import { useEffect, useMemo, useState } from 'react'

/**
 * "Move to…" folder picker (parity backlog item 4). A flat, depth-indented list rather than
 * reusing IrFolderTree wholesale — that component owns a lot of state (search, context menus,
 * remove-folder flow) this picker doesn't want any of; `irLibraryListAllFolders` is the same data
 * source, just laid out simply here. Scoped to the source item(s)' own library root — cross-root
 * moves are refused by fileOps.ts itself, so there's no point offering them here.
 */

interface FolderRow {
  id: number
  parent_id: number | null
  relative_path: string
  library_root_id: number
  library_root_label: string
}

function buildIndentedList(rows: FolderRow[], libraryRootId: number): Array<{ id: number; label: string; depth: number }> {
  const scoped = rows.filter((r) => r.library_root_id === libraryRootId)
  const byParent = new Map<number | null, FolderRow[]>()
  for (const row of scoped) {
    const list = byParent.get(row.parent_id) ?? []
    list.push(row)
    byParent.set(row.parent_id, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.relative_path.localeCompare(b.relative_path))

  const out: Array<{ id: number; label: string; depth: number }> = []
  const walk = (parentId: number | null, depth: number): void => {
    for (const row of byParent.get(parentId) ?? []) {
      const name = row.relative_path.split('/').pop() ?? row.relative_path
      out.push({ id: row.id, label: name, depth })
      walk(row.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function IrMoveToFolderModal({
  itemIds,
  libraryRootId,
  currentFolderId,
  onClose,
  onMoved
}: {
  itemIds: string[]
  libraryRootId: number
  currentFolderId: number | null
  onClose: () => void
  onMoved: (results: Array<{ itemId: string; success: boolean; error?: string; newAbsPath?: string }>) => void
}): React.ReactElement {
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(currentFolderId)
  const [newFolderPath, setNewFolderPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.irLibraryListAllFolders().then((rows) => setFolders(rows))
  }, [])

  const rows = useMemo(() => buildIndentedList(folders, libraryRootId), [folders, libraryRootId])

  const doMove = async (destFolderId: number | null): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const results = await window.api.irLibraryMoveItems(itemIds, destFolderId)
      const failed = results.filter((r) => !r.success)
      if (failed.length > 0 && failed.every((r) => r.error?.includes('already exists'))) {
        setError(`${failed.length} of ${itemIds.length} would collide with an existing file in that folder.`)
        return
      }
      onMoved(results)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const createAndMove = async (): Promise<void> => {
    const trimmed = newFolderPath.trim().replace(/^\/+|\/+$/g, '')
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const folderId = await window.api.irLibraryEnsureDestinationFolder(libraryRootId, trimmed)
      await doMove(folderId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[380px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-nm-border flex items-center justify-between flex-shrink-0">
          <div className="text-sm font-semibold text-nm-text">
            Move {itemIds.length} item{itemIds.length === 1 ? '' : 's'}
          </div>
          <button onClick={onClose} className="text-nm-text-3 hover:text-nm-text">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
              selectedFolderId === null ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov text-nm-text'
            }`}
          >
            <span>Library root (no folder)</span>
          </button>
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedFolderId(r.id)}
              style={{ paddingLeft: `${12 + r.depth * 14}px` }}
              className={`w-full text-left py-1.5 pr-3 text-xs truncate ${
                selectedFolderId === r.id ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov text-nm-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {error && <div className="px-4 py-2 text-[11px] text-red-500 border-t border-nm-border-s">{error}</div>}

        <div className="px-4 py-3 border-t border-nm-border-s flex flex-col gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <input
              value={newFolderPath}
              onChange={(e) => setNewFolderPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createAndMove() }}
              placeholder="Or type a new folder path…"
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
            />
            <button
              onClick={() => void createAndMove()}
              disabled={busy || !newFolderPath.trim()}
              className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40 flex-shrink-0"
            >
              Create &amp; Move
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov">
              Cancel
            </button>
            <button
              onClick={() => void doMove(selectedFolderId)}
              disabled={busy || selectedFolderId === currentFolderId}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Moving…' : 'Move'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlayGroup } from '../types/settings'

/**
 * The only place groups get created or gain members — deliberately. Group Administration can
 * rename/delete/remove-member, but adding always starts from browsing/search, per direction.
 */
export function AddToGroupPopover({
  paths,
  groups,
  onAddToGroup,
  onCreateGroup,
  onClose
}: {
  paths: string[]
  groups: PlayGroup[]
  onAddToGroup: (groupId: string) => void
  onCreateGroup: (name: string) => void
  onClose: () => void
}) {
  const [newName, setNewName] = useState('')

  function confirmCreate(): void {
    const trimmed = newName.trim()
    if (!trimmed) return
    onCreateGroup(trimmed)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg bg-white dark:bg-[var(--panel)] border border-gray-200 dark:border-[var(--border)] shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Add {paths.length > 1 ? `${paths.length} files` : '1 file'} to group
        </h3>

        {groups.length > 0 && (
          <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5 mb-3">
            {groups.map((g) => (
              <button
                key={g.id}
                className="text-left px-2.5 py-1.5 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[var(--hover)] flex items-center justify-between gap-2"
                onClick={() => onAddToGroup(g.id)}
              >
                <span className="truncate">{g.name}</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">{g.filePaths.length}</span>
              </button>
            ))}
          </div>
        )}
        {groups.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-600 mb-3">No groups yet — create one below.</p>
        )}

        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCreate()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="New group name"
            className="flex-1 h-8 rounded border border-gray-200 dark:border-[var(--border)] bg-white dark:bg-[var(--field)] text-sm px-2 text-gray-700 dark:text-gray-300"
          />
          <button
            disabled={!newName.trim()}
            onClick={confirmCreate}
            className="h-8 px-3 rounded text-sm font-medium border border-gray-200 dark:border-[var(--border)] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[var(--hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            New
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-3 text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}

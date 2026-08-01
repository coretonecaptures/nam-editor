import { useState } from 'react'
import type { NamFile } from '../types/nam'
import type { PlayGroup } from '../types/settings'

/**
 * Manage saved play groups — rename, delete, remove individual members, and jump into the player
 * scoped to one. Deliberately no "add member" here: adding always starts from browsing/search
 * (FileList's per-row/bulk "Add to group"), so this page doesn't duplicate that flow.
 *
 * "Resolved" below only checks membership in the in-memory `files` array, not the disk — a member
 * from a folder that hasn't been opened this session reads as unresolved even though the file is
 * fine. That's a deliberate simplification (matches how `playerIndex`/`visibleFiles` elsewhere in
 * the app never re-check disk either); the real fix would be probing every path on every render,
 * which is not worth the I/O for a list page.
 */
export function GroupsAdminPage({
  groups,
  files,
  onRename,
  onDelete,
  onRemoveMember,
  onLoadToPlayer
}: {
  groups: PlayGroup[]
  files: NamFile[]
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string) => void
  onRemoveMember: (groupId: string, filePath: string) => void
  onLoadToPlayer: (group: PlayGroup) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  function resolvedCount(group: PlayGroup): number {
    return group.filePaths.filter((p) => files.some((f) => f.filePath === p)).length
  }

  function startRename(group: PlayGroup): void {
    setRenamingId(group.id)
    setRenameValue(group.name)
  }

  function confirmRename(groupId: string): void {
    const trimmed = renameValue.trim()
    if (trimmed) onRename(groupId, trimmed)
    setRenamingId(null)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full px-6 py-6" style={{ maxWidth: 900 }}>
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1">Play groups</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Hand-picked shortlists for A/B comparison. Add captures to a group from the list or grid
          view; manage and load them here.
        </p>

        {groups.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-600">
            No groups yet — use "Add to group" on a capture in the file list to create one.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const resolved = resolvedCount(group)
            const total = group.filePaths.length
            const expanded = expandedId === group.id
            return (
              <div
                key={group.id}
                className="rounded-lg border border-gray-200 dark:border-[var(--border)] bg-gray-50 dark:bg-[var(--field)]"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {renamingId === group.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename(group.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => confirmRename(group.id)}
                      className="flex-1 h-8 rounded border border-gray-200 dark:border-[var(--border)] bg-white dark:bg-[var(--panel)] text-sm px-2 text-gray-700 dark:text-gray-300"
                    />
                  ) : (
                    <button
                      className="flex-1 text-left text-sm font-medium text-gray-800 dark:text-gray-100 truncate"
                      onClick={() => setExpandedId(expanded ? null : group.id)}
                      title="Show members"
                    >
                      {group.name}
                    </button>
                  )}

                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                    {resolved < total ? `${resolved} of ${total} resolved` : `${total} ${total === 1 ? 'capture' : 'captures'}`}
                  </span>

                  <button
                    className="flex-shrink-0 h-7 px-2.5 rounded text-xs font-medium border border-gray-200 dark:border-[var(--border)] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[var(--hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    onClick={() => onLoadToPlayer(group)}
                    disabled={resolved === 0}
                    title={resolved === 0 ? 'No members resolve to a loaded capture' : 'Open the player scoped to this group'}
                  >
                    Load to player
                  </button>
                  <button
                    className="flex-shrink-0 h-7 px-2.5 rounded text-xs font-medium border border-gray-200 dark:border-[var(--border)] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[var(--hover)] transition-colors"
                    onClick={() => startRename(group)}
                  >
                    Rename
                  </button>
                  <button
                    className="flex-shrink-0 h-7 px-2.5 rounded text-xs font-medium border border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    onClick={() => {
                      if (window.confirm(`Delete group "${group.name}"? This does not delete the captures themselves.`)) {
                        onDelete(group.id)
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-gray-200 dark:border-[var(--border)] px-4 py-2 flex flex-col gap-0.5">
                    {group.filePaths.length === 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-600 py-1.5">No members.</p>
                    )}
                    {group.filePaths.map((path) => {
                      const file = files.find((f) => f.filePath === path)
                      const label = file
                        ? (file.metadata.name?.trim() || file.fileName.replace(/\.nam$/i, ''))
                        : path.split(/[\\/]/).pop() ?? path
                      return (
                        <div key={path} className="flex items-center gap-2 py-1.5">
                          <span className={`flex-1 text-sm truncate ${file ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600 italic'}`} title={path}>
                            {label}
                            {!file && ' (not resolved)'}
                          </span>
                          <button
                            className="flex-shrink-0 p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-red-400 transition-colors"
                            onClick={() => onRemoveMember(group.id, path)}
                            title="Remove from group"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

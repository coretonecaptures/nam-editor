import { useState } from 'react'
import { FolderNode } from '../types/librarian'

interface FolderTreeProps {
  tree: FolderNode
  selectedFolder: string | null  // null = root selected
  onSelect: (path: string | null) => void
  dirtyPaths: Set<string>
}

export function FolderTree({ tree, selectedFolder, onSelect, dirtyPaths }: FolderTreeProps) {
  const rootDirty = dirtyPaths.size
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Library</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {/* Root node — shows all captures */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-sm mx-1 transition-colors ${
            selectedFolder === null
              ? 'bg-indigo-600/30 text-indigo-300'
              : 'text-gray-300 hover:bg-gray-800'
          }`}
          onClick={() => onSelect(null)}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-xs font-medium truncate flex-1">{tree.name}</span>
          <span className={`text-xs flex-shrink-0 ${rootDirty > 0 ? 'text-amber-500' : 'invisible'}`}>{rootDirty}</span>
          <span className="text-xs text-gray-500 flex-shrink-0">{tree.totalCount}</span>
        </div>

        {/* Recursive children */}
        {tree.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            selectedFolder={selectedFolder}
            onSelect={onSelect}
            depth={1}
            dirtyPaths={dirtyPaths}
          />
        ))}
      </div>
    </div>
  )
}

function TreeNode({
  node,
  selectedFolder,
  onSelect,
  depth,
  dirtyPaths
}: {
  node: FolderNode
  selectedFolder: string | null
  onSelect: (path: string | null) => void
  depth: number
  dirtyPaths: Set<string>
}) {
  const [expanded, setExpanded] = useState(depth <= 1)
  const isSelected = selectedFolder === node.path
  const hasChildren = node.children.length > 0

  const prefix = node.path + '/'
  let dirtyCount = 0
  for (const p of dirtyPaths) {
    if (p.startsWith(prefix) || p === node.path) dirtyCount++
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 pr-3 py-1.5 cursor-pointer rounded-sm mx-1 transition-colors ${
          isSelected
            ? 'bg-indigo-600/30 text-indigo-300'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          onSelect(node.path)
          if (hasChildren) setExpanded((e) => !e)
        }}
      >
        {/* Expand/collapse chevron */}
        <span
          className="w-3 h-3 flex-shrink-0 flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setExpanded((e) => !e)
          }}
        >
          {hasChildren ? (
            <svg
              className={`w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          ) : (
            <span className="w-1 h-1 rounded-full bg-gray-700" />
          )}
        </span>

        {/* Folder icon */}
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`}
          fill={expanded && hasChildren ? 'currentColor' : 'none'}
          viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>

        <span className="text-xs truncate flex-1">{node.name}</span>

        {/* Dirty count (amber) — invisible when 0 to keep alignment */}
        <span className={`text-xs flex-shrink-0 ${dirtyCount > 0 ? 'text-amber-500' : 'invisible'}`}>
          {dirtyCount}
        </span>

        {/* Total count (blue) */}
        {node.totalCount > 0 && (
          <span className={`text-xs flex-shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-600'}`}>
            {node.totalCount}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedFolder={selectedFolder}
              onSelect={onSelect}
              depth={depth + 1}
              dirtyPaths={dirtyPaths}
            />
          ))}
        </div>
      )}
    </div>
  )
}

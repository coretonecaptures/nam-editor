import { useEffect, useRef, useState } from 'react'
import { FolderNode } from '../types/librarian'

interface FolderTreeProps {
  tree: FolderNode
  selectedFolder: string | null  // null = root selected
  onSelect: (path: string | null) => void
  dirtyPaths: Set<string>
  onSaveFolder: (path: string | null) => void
  onRevertFolder: (path: string | null) => void
  onBatchEdit: (path: string | null, name: string) => void
  onRevealFolder: (path: string) => void
}

export function FolderTree({ tree, selectedFolder, onSelect, dirtyPaths, onSaveFolder, onRevertFolder, onBatchEdit, onRevealFolder }: FolderTreeProps) {
  const rootDirty = dirtyPaths.size
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Library</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {/* Root node — shows all captures */}
        <FolderRow
          label={tree.name}
          isRoot
          isSelected={selectedFolder === null}
          totalCount={tree.totalCount}
          dirtyCount={rootDirty}
          depth={0}
          hasChildren={tree.children.length > 0}
          expanded={true}
          onToggleExpand={() => {}}
          onClick={() => onSelect(null)}
          onSave={() => onSaveFolder(null)}
          onRevert={() => onRevertFolder(null)}
          onBatchEdit={() => onBatchEdit(null, tree.name)}
          onReveal={() => onRevealFolder(tree.path)}
        />

        {/* Recursive children */}
        {tree.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            selectedFolder={selectedFolder}
            onSelect={onSelect}
            depth={1}
            dirtyPaths={dirtyPaths}
            onSaveFolder={onSaveFolder}
            onRevertFolder={onRevertFolder}
            onBatchEdit={onBatchEdit}
            onRevealFolder={onRevealFolder}
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
  dirtyPaths,
  onSaveFolder,
  onRevertFolder,
  onBatchEdit,
  onRevealFolder
}: {
  node: FolderNode
  selectedFolder: string | null
  onSelect: (path: string | null) => void
  depth: number
  dirtyPaths: Set<string>
  onSaveFolder: (path: string | null) => void
  onRevertFolder: (path: string | null) => void
  onBatchEdit: (path: string | null, name: string) => void
  onRevealFolder: (path: string) => void
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
      <FolderRow
        label={node.name}
        isRoot={false}
        isSelected={isSelected}
        totalCount={node.totalCount}
        dirtyCount={dirtyCount}
        depth={depth}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggleExpand={() => setExpanded((e) => !e)}
        onClick={() => {
          onSelect(node.path)
          if (hasChildren) setExpanded((e) => !e)
        }}
        onSave={() => onSaveFolder(node.path)}
        onRevert={() => onRevertFolder(node.path)}
        onBatchEdit={() => onBatchEdit(node.path, node.name)}
        onReveal={() => onRevealFolder(node.path)}
      />

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
              onSaveFolder={onSaveFolder}
              onRevertFolder={onRevertFolder}
              onBatchEdit={onBatchEdit}
              onRevealFolder={onRevealFolder}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ContextMenuState {
  x: number
  y: number
}

function FolderRow({
  label,
  isRoot,
  isSelected,
  totalCount,
  dirtyCount,
  depth,
  hasChildren,
  expanded,
  onToggleExpand,
  onClick,
  onSave,
  onRevert,
  onBatchEdit,
  onReveal
}: {
  label: string
  isRoot: boolean
  isSelected: boolean
  totalCount: number
  dirtyCount: number
  depth: number
  hasChildren: boolean
  expanded: boolean
  onToggleExpand: () => void
  onClick: () => void
  onSave: () => void
  onRevert: () => void
  onBatchEdit: () => void
  onReveal: () => void
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className="relative group">
      <div
        className={`flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer rounded-sm mx-1 transition-colors ${
          isSelected
            ? 'bg-indigo-600/30 text-indigo-300'
            : isRoot
              ? 'text-gray-300 hover:bg-gray-800'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
        }`}
        style={{ paddingLeft: isRoot ? '12px' : `${depth * 12 + 8}px` }}
        onClick={onClick}
        onContextMenu={openMenu}
      >
        {/* Chevron / dot */}
        {!isRoot && (
          <span
            className="w-3 h-3 flex-shrink-0 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
          >
            {hasChildren ? (
              <svg className={`w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <span className="w-1 h-1 rounded-full bg-gray-700" />
            )}
          </span>
        )}

        {/* Folder icon */}
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-400' : isRoot ? 'text-indigo-400' : 'text-gray-500'}`}
          fill={!isRoot && expanded && hasChildren ? 'currentColor' : 'none'}
          viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isRoot ? 2 : 1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>

        <span className={`text-xs truncate flex-1 ${isRoot ? 'font-medium' : ''}`}>{label}</span>

        {/* ... button (hover) */}
        <button
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-all"
          onClick={openMenu}
          title="Folder actions"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>

        {/* Total count */}
        {totalCount > 0 && (
          <span className={`text-xs flex-shrink-0 ${isSelected ? 'text-indigo-400' : isRoot ? 'text-gray-500' : 'text-gray-600'}`}>
            {totalCount}
          </span>
        )}

        {/* Dirty count — invisible when 0 to keep alignment */}
        <span className={`text-xs flex-shrink-0 w-4 text-right ${dirtyCount > 0 ? 'text-amber-500' : 'invisible'}`}>
          {dirtyCount}
        </span>
      </div>

      {/* Context menu */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-44 text-xs"
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="px-3 py-1.5 text-gray-500 font-medium border-b border-gray-700 mb-1 truncate max-w-52">
            {label}
          </div>
          <button
            className={`w-full text-left px-3 py-1.5 transition-colors ${
              dirtyCount > 0
                ? 'text-gray-200 hover:bg-indigo-600/40'
                : 'text-gray-600 cursor-default'
            }`}
            disabled={dirtyCount === 0}
            onClick={() => { setMenu(null); onSave() }}
          >
            Save all in folder
            {dirtyCount > 0 && <span className="ml-2 text-amber-500">{dirtyCount}</span>}
          </button>
          <button
            className={`w-full text-left px-3 py-1.5 transition-colors ${
              dirtyCount > 0
                ? 'text-gray-200 hover:bg-red-900/40'
                : 'text-gray-600 cursor-default'
            }`}
            disabled={dirtyCount === 0}
            onClick={() => { setMenu(null); onRevert() }}
          >
            Revert all in folder
          </button>
          <div className="my-1 border-t border-gray-700" />
          <button
            className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-indigo-600/40 transition-colors"
            onClick={() => { setMenu(null); onBatchEdit() }}
          >
            Batch edit…
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-indigo-600/40 transition-colors"
            onClick={() => { setMenu(null); onReveal() }}
          >
            Reveal in Explorer
          </button>
        </div>
      )}
    </div>
  )
}

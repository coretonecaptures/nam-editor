import { useEffect, useRef, useState } from 'react'
import { NamFile, GEAR_TYPES, TONE_TYPES } from '../types/nam'
import { FolderNode } from '../types/librarian'

interface FolderTreeProps {
  tree: FolderNode
  files: NamFile[]
  selectedFolder: string | null  // null = root selected
  onSelect: (path: string | null) => void
  dirtyPaths: Set<string>
  onSaveFolder: (path: string | null) => void
  onRevertFolder: (path: string | null) => void
  onBatchEdit: (path: string | null, name: string) => void
  onRevealFolder: (path: string) => void
  onFilterChange: (matchingPaths: Set<string> | null) => void
  onDropFiles?: (filePaths: string[], destFolderPath: string) => void
}

function matchesFilter(
  f: NamFile,
  query: string,
  activeTones: Set<string>,
  activeGears: Set<string>
): boolean {
  // Text search across name, filename, make, model, modeled_by
  if (query) {
    const q = query.toLowerCase()
    const hay = [f.metadata.name, f.fileName, f.metadata.gear_make, f.metadata.gear_model, f.metadata.modeled_by]
      .filter(Boolean).join(' ').toLowerCase()
    if (!hay.includes(q)) return false
  }
  // Tone chip filter (OR within tones)
  if (activeTones.size > 0) {
    if (!f.metadata.tone_type || !activeTones.has(f.metadata.tone_type)) return false
  }
  // Gear chip filter (OR within gears)
  if (activeGears.size > 0) {
    if (!f.metadata.gear_type || !activeGears.has(f.metadata.gear_type)) return false
  }
  return true
}

export function FolderTree({
  tree, files, selectedFolder, onSelect, dirtyPaths,
  onSaveFolder, onRevertFolder, onBatchEdit, onRevealFolder, onFilterChange, onDropFiles
}: FolderTreeProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeTones, setActiveTones] = useState<Set<string>>(new Set())
  const [activeGears, setActiveGears] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const isFiltered = query.trim() !== '' || activeTones.size > 0 || activeGears.size > 0

  // Compute matching paths and notify parent
  useEffect(() => {
    if (!isFiltered) {
      onFilterChange(null)
      return
    }
    const q = query.trim()
    const matching = new Set(
      files.filter((f) => matchesFilter(f, q, activeTones, activeGears)).map((f) => f.filePath.replace(/\\/g, '/'))
    )
    onFilterChange(matching)
  }, [query, activeTones, activeGears, files, isFiltered])

  const toggleTone = (t: string) => setActiveTones((prev) => {
    const next = new Set(prev)
    next.has(t) ? next.delete(t) : next.add(t)
    return next
  })

  const toggleGear = (g: string) => setActiveGears((prev) => {
    const next = new Set(prev)
    next.has(g) ? next.delete(g) : next.add(g)
    return next
  })

  const clearFilter = () => {
    setQuery('')
    setActiveTones(new Set())
    setActiveGears(new Set())
  }

  const rootDirty = dirtyPaths.size

  // Build matchingPaths for count display in tree rows
  const matchingPaths: Set<string> | null = isFiltered
    ? new Set(files.filter((f) => matchesFilter(f, query.trim(), activeTones, activeGears)).map((f) => f.filePath.replace(/\\/g, '/')))
    : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Library</span>
        <button
          onClick={() => {
            setSearchOpen((v) => {
              if (!v) setTimeout(() => inputRef.current?.focus(), 50)
              else clearFilter()
              return !v
            })
          }}
          title={searchOpen ? 'Close search' : 'Search / filter library'}
          className={`p-1 rounded transition-colors ${searchOpen ? 'text-indigo-400 bg-indigo-900/30' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>

      {/* Search / filter panel */}
      {searchOpen && (
        <div className="px-2 pt-2 pb-1.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 space-y-1.5">
          {/* Text input */}
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, make, model…"
              className="w-full pl-6 pr-6 py-1.5 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Tone chips */}
          <div className="flex flex-wrap gap-1">
            {TONE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleTone(t)}
                className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
                  activeTones.has(t)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Gear chips */}
          <div className="flex flex-wrap gap-1">
            {GEAR_TYPES.map((g) => (
              <button
                key={g}
                onClick={() => toggleGear(g)}
                className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
                  activeGears.has(g)
                    ? 'bg-amber-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Clear all */}
          {isFiltered && (
            <button
              onClick={clearFilter}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Filtered banner */}
      {isFiltered && (
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-900/20 border-b border-amber-800/40 flex-shrink-0">
          <svg className="w-3 h-3 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-xs text-amber-400 font-semibold tracking-wider uppercase">Filtered</span>
          <span className="text-xs text-amber-600">— {matchingPaths?.size ?? 0} match{matchingPaths?.size !== 1 ? 'es' : ''}</span>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        <FolderRow
          label={tree.name}
          folderPath={tree.path}
          isRoot
          isSelected={selectedFolder === null}
          totalCount={matchingPaths ? matchingPaths.size : tree.totalCount}
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
          isFiltered={isFiltered}
          onDropFiles={onDropFiles}
        />

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
            matchingPaths={matchingPaths}
            onDropFiles={onDropFiles}
          />
        ))}
      </div>
    </div>
  )
}

function TreeNode({
  node, selectedFolder, onSelect, depth, dirtyPaths,
  onSaveFolder, onRevertFolder, onBatchEdit, onRevealFolder, matchingPaths, onDropFiles
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
  matchingPaths: Set<string> | null
  onDropFiles?: (filePaths: string[], destFolderPath: string) => void
}) {
  const [expanded, setExpanded] = useState(depth <= 1)
  const isSelected = selectedFolder === node.path
  const hasChildren = node.children.length > 0

  const prefix = node.path + '/'
  let dirtyCount = 0
  for (const p of dirtyPaths) {
    if (p.startsWith(prefix) || p === node.path) dirtyCount++
  }

  // When filtering: count matches in this subtree
  let matchCount = 0
  if (matchingPaths) {
    for (const p of matchingPaths) {
      if (p.startsWith(prefix) || p === node.path) matchCount++
    }
    // Hide this folder entirely if no matches
    if (matchCount === 0) return null
  }

  const displayCount = matchingPaths ? matchCount : node.totalCount

  return (
    <div>
      <FolderRow
        label={node.name}
        folderPath={node.path}
        isRoot={false}
        isSelected={isSelected}
        totalCount={displayCount}
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
        isFiltered={matchingPaths !== null}
        onDropFiles={onDropFiles}
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
              matchingPaths={matchingPaths}
              onDropFiles={onDropFiles}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ContextMenuState { x: number; y: number }

function FolderRow({
  label, folderPath, isRoot, isSelected, totalCount, dirtyCount, depth,
  hasChildren, expanded, onToggleExpand, onClick, onSave, onRevert,
  onBatchEdit, onReveal, isFiltered, onDropFiles
}: {
  label: string
  folderPath: string
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
  isFiltered: boolean
  onDropFiles?: (filePaths: string[], destFolderPath: string) => void
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const countColor = isFiltered
    ? (isSelected ? 'text-amber-600 dark:text-amber-300' : 'text-amber-600 dark:text-amber-500')
    : (isSelected ? 'text-indigo-600 dark:text-indigo-400' : isRoot ? 'text-gray-500 dark:text-gray-500' : 'text-gray-400 dark:text-gray-600')

  return (
    <div className="relative group">
      <div
        className={`flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer rounded-sm mx-1 transition-colors ${
          isDragOver
            ? 'bg-indigo-200 dark:bg-indigo-500/40 text-indigo-800 dark:text-indigo-200 ring-1 ring-indigo-400'
            : isSelected
              ? 'bg-indigo-100 dark:bg-indigo-600/30 text-indigo-700 dark:text-indigo-300'
              : isRoot
                ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
        }`}
        style={{ paddingLeft: isRoot ? '12px' : `${depth * 12 + 8}px` }}
        onClick={onClick}
        onContextMenu={openMenu}
        onDragOver={onDropFiles ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
        onDragEnter={onDropFiles ? (e) => { e.preventDefault(); setIsDragOver(true) } : undefined}
        onDragLeave={onDropFiles ? (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
        } : undefined}
        onDrop={onDropFiles ? (e) => {
          e.preventDefault()
          setIsDragOver(false)
          const raw = e.dataTransfer.getData('application/x-nam-files')
          if (!raw) return
          try {
            const paths: string[] = JSON.parse(raw)
            if (paths.length > 0) onDropFiles(paths, folderPath)
          } catch { /* ignore malformed data */ }
        } : undefined}
      >
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
              <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700" />
            )}
          </span>
        )}

        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-400' : isRoot ? 'text-indigo-400' : 'text-gray-500'}`}
          fill={!isRoot && expanded && hasChildren ? 'currentColor' : 'none'}
          viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isRoot ? 2 : 1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>

        <span className={`text-xs truncate flex-1 ${isRoot ? 'font-medium' : ''}`}>{label}</span>

        <button
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all"
          onClick={openMenu}
          title="Folder actions"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>

        {totalCount > 0 && (
          <span className={`text-xs flex-shrink-0 ${countColor}`}>
            {totalCount}
          </span>
        )}

        <span className={`text-xs flex-shrink-0 w-4 text-right ${dirtyCount > 0 ? 'text-amber-500' : 'invisible'}`}>
          {dirtyCount}
        </span>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-44 text-xs"
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="px-3 py-1.5 text-gray-500 font-medium border-b border-gray-300 dark:border-gray-700 mb-1 truncate max-w-52">
            {label}
          </div>
          <button
            className={`w-full text-left px-3 py-1.5 transition-colors ${dirtyCount > 0 ? 'text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40' : 'text-gray-400 dark:text-gray-600 cursor-default'}`}
            disabled={dirtyCount === 0}
            onClick={() => { setMenu(null); onSave() }}
          >
            Save all in folder
            {dirtyCount > 0 && <span className="ml-2 text-amber-500">{dirtyCount}</span>}
          </button>
          <button
            className={`w-full text-left px-3 py-1.5 transition-colors ${dirtyCount > 0 ? 'text-gray-800 dark:text-gray-200 hover:bg-red-900/40' : 'text-gray-400 dark:text-gray-600 cursor-default'}`}
            disabled={dirtyCount === 0}
            onClick={() => { setMenu(null); onRevert() }}
          >
            Revert all in folder
          </button>
          <div className="my-1 border-t border-gray-300 dark:border-gray-700" />
          <button
            className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
            onClick={() => { setMenu(null); onBatchEdit() }}
          >
            Batch edit…
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
            onClick={() => { setMenu(null); onReveal() }}
          >
            Reveal in Explorer
          </button>
        </div>
      )}
    </div>
  )
}

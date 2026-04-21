import { useEffect, useRef, useState } from 'react'
import { NamFile, GEAR_TYPES, TONE_TYPES } from '../types/nam'
import { FolderNode } from '../types/librarian'

// Folder color palette — excludes blue-500 (#3b82f6) which is reserved for pack-owning folders
export const FOLDER_COLOR_PALETTE: { name: string; hex: string }[] = [
  { name: 'Teal',   hex: '#14b8a6' },
  { name: 'Amber',  hex: '#f59e0b' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose',   hex: '#f43f5e' },
  { name: 'Lime',   hex: '#84cc16' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Cyan',   hex: '#06b6d4' },
  { name: 'Indigo', hex: '#6366f1' },
]

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
  onCreateFolder?: (parentPath: string, name: string) => Promise<{ success: boolean; error?: string }>
  onRenameFolder?: (folderPath: string, newName: string) => Promise<{ success: boolean; error?: string }>
  onMoveFolder?: (sourcePath: string, destParentPath: string) => Promise<{ success: boolean; error?: string }>
  onExportFolder?: (folderPath: string | null, format: 'csv' | 'xlsx') => void
  onGenerateTemplate?: (folderPath: string | null) => void
  onImportMetadata?: (folderPath: string | null) => void
  onSelectAllInFolder?: (folderPath: string | null) => void
  onCoverageReport?: (folderPath: string) => void
  scrollToFolder?: string | null
  packInfoFolders?: Set<string>
  folderNameColors?: Record<string, string>
  onSetFolderColor?: (folderName: string, color: string | null) => void
}

function matchesFilter(
  f: NamFile,
  query: string,
  activeTones: Set<string>,
  activeGears: Set<string>
): boolean {
  if (query) {
    const q = query.toLowerCase()
    const hay = [f.metadata.name, f.fileName, f.metadata.gear_make, f.metadata.gear_model, f.metadata.modeled_by]
      .filter(Boolean).join(' ').toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (activeTones.size > 0) {
    if (!f.metadata.tone_type || !activeTones.has(f.metadata.tone_type)) return false
  }
  if (activeGears.size > 0) {
    if (!f.metadata.gear_type || !activeGears.has(f.metadata.gear_type)) return false
  }
  return true
}

export function FolderTree({
  tree, files, selectedFolder, onSelect, dirtyPaths,
  onSaveFolder, onRevertFolder, onBatchEdit, onRevealFolder, onFilterChange, onDropFiles,
  onCreateFolder, onRenameFolder, onMoveFolder, onExportFolder, onGenerateTemplate, onImportMetadata,
  onSelectAllInFolder, onCoverageReport, scrollToFolder, packInfoFolders, folderNameColors, onSetFolderColor
}: FolderTreeProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [expandSeq, setExpandSeq] = useState(0)
  const [collapseSeq, setCollapseSeq] = useState(0)
  const [query, setQuery] = useState('')
  const [activeTones, setActiveTones] = useState<Set<string>>(new Set())
  const [activeGears, setActiveGears] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const isFiltered = query.trim() !== '' || activeTones.size > 0 || activeGears.size > 0

  useEffect(() => {
    if (!scrollToFolder) return
    requestAnimationFrame(() => {
      const els = document.querySelectorAll('[data-folder-path]')
      for (const el of els) {
        if ((el as HTMLElement).dataset.folderPath === scrollToFolder) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          break
        }
      }
    })
  }, [scrollToFolder])

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

  const matchingPaths: Set<string> | null = isFiltered
    ? new Set(files.filter((f) => matchesFilter(f, query.trim(), activeTones, activeGears)).map((f) => f.filePath.replace(/\\/g, '/')))
    : null

  const rootDirty = matchingPaths
    ? [...dirtyPaths].filter((p) => matchingPaths.has(p)).length
    : dirtyPaths.size

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Library</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setExpandSeq((s) => s + 1)}
            title="Expand all folders"
            className="p-1 rounded transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => setCollapseSeq((s) => s + 1)}
            title="Collapse all folders"
            className="p-1 rounded transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
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
      </div>

      {/* Search / filter panel */}
      {searchOpen && (
        <div className="px-2 pt-2 pb-1.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 space-y-1.5">
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

          <div className="flex flex-wrap gap-1">
            {TONE_TYPES.map((t) => (
              <button key={t} onClick={() => toggleTone(t)}
                className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${activeTones.has(t) ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              >{t}</button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {GEAR_TYPES.map((g) => (
              <button key={g} onClick={() => toggleGear(g)}
                className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${activeGears.has(g) ? 'bg-amber-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              >{g}</button>
            ))}
          </div>

          {isFiltered && (
            <button onClick={clearFilter} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Filtered banner */}
      {isFiltered && (
        <div className="flex items-center gap-2 px-3 py-1 bg-sky-900/20 border-b border-sky-800/40 flex-shrink-0">
          <svg className="w-3 h-3 text-sky-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-xs text-sky-400 font-semibold tracking-wider uppercase">Filtered</span>
          <span className="text-xs text-sky-600">— {matchingPaths?.size ?? 0} match{matchingPaths?.size !== 1 ? 'es' : ''}</span>
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
          onDropFolder={onMoveFolder ? (src) => onMoveFolder(src, tree.path) : undefined}
          onCreateFolder={onCreateFolder ? (name) => onCreateFolder(tree.path, name) : undefined}
          onExportFolder={onExportFolder ? (fmt) => onExportFolder(null, fmt) : undefined}
          onGenerateTemplate={onGenerateTemplate ? () => onGenerateTemplate(null) : undefined}
          onImportMetadata={onImportMetadata ? () => onImportMetadata(null) : undefined}
          onSelectAll={onSelectAllInFolder ? () => onSelectAllInFolder(null) : undefined}
          onCoverageReport={onCoverageReport ? () => onCoverageReport(tree.path) : undefined}
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
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onMoveFolder={onMoveFolder}
            onExportFolder={onExportFolder}
            onGenerateTemplate={onGenerateTemplate}
            onImportMetadata={onImportMetadata}
            onSelectAllInFolder={onSelectAllInFolder}
            onCoverageReport={onCoverageReport}
            expandSeq={expandSeq}
            collapseSeq={collapseSeq}
            scrollToFolder={scrollToFolder}
            packInfoFolders={packInfoFolders}
            folderNameColors={folderNameColors}
            onSetFolderColor={onSetFolderColor}
          />
        ))}
      </div>
    </div>
  )
}

function TreeNode({
  node, selectedFolder, onSelect, depth, dirtyPaths,
  onSaveFolder, onRevertFolder, onBatchEdit, onRevealFolder, matchingPaths, onDropFiles,
  onCreateFolder, onRenameFolder, onMoveFolder, onExportFolder, onGenerateTemplate, onImportMetadata,
  onSelectAllInFolder, onCoverageReport, expandSeq, collapseSeq, scrollToFolder, packInfoFolders, folderNameColors, onSetFolderColor
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
  onCreateFolder?: (parentPath: string, name: string) => Promise<{ success: boolean; error?: string }>
  onRenameFolder?: (folderPath: string, newName: string) => Promise<{ success: boolean; error?: string }>
  onMoveFolder?: (sourcePath: string, destParentPath: string) => Promise<{ success: boolean; error?: string }>
  onExportFolder?: (folderPath: string, format: 'csv' | 'xlsx') => void
  onGenerateTemplate?: (folderPath: string | null) => void
  onImportMetadata?: (folderPath: string | null) => void
  onSelectAllInFolder?: (folderPath: string | null) => void
  onCoverageReport?: (folderPath: string) => void
  expandSeq?: number
  collapseSeq?: number
  scrollToFolder?: string | null
  packInfoFolders?: Set<string>
  folderNameColors?: Record<string, string>
  onSetFolderColor?: (folderName: string, color: string | null) => void
}) {
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (expandSeq && expandSeq > 0) setExpanded(true)
  }, [expandSeq])

  useEffect(() => {
    if (collapseSeq && collapseSeq > 0) setExpanded(false)
  }, [collapseSeq])

  useEffect(() => {
    if (scrollToFolder && scrollToFolder.startsWith(node.path + '/')) {
      setExpanded(true)
    }
  }, [scrollToFolder, node.path])
  const isSelected = selectedFolder === node.path
  const hasChildren = node.children.length > 0
  const prefix = node.path + '/'

  let matchCount = 0
  if (matchingPaths) {
    for (const p of matchingPaths) {
      if (p.startsWith(prefix) || p === node.path) matchCount++
    }
    if (matchCount === 0) return null
  }

  const displayCount = matchingPaths ? matchCount : node.totalCount

  let dirtyCount = 0
  for (const p of dirtyPaths) {
    if ((p.startsWith(prefix) || p === node.path) && (!matchingPaths || matchingPaths.has(p))) dirtyCount++
  }

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
        onClick={() => onSelect(node.path)}
        onSave={() => onSaveFolder(node.path)}
        onRevert={() => onRevertFolder(node.path)}
        onBatchEdit={() => onBatchEdit(node.path, node.name)}
        onReveal={() => onRevealFolder(node.path)}
        isFiltered={matchingPaths !== null}
        isHighlighted={scrollToFolder === node.path}
        onDropFiles={onDropFiles}
        onDropFolder={onMoveFolder ? (src) => onMoveFolder(src, node.path) : undefined}
        onCreateFolder={onCreateFolder ? (name) => onCreateFolder(node.path, name) : undefined}
        onRenameFolder={onRenameFolder ? (newName) => onRenameFolder(node.path, newName) : undefined}
        onExportFolder={onExportFolder ? (fmt) => onExportFolder(node.path, fmt) : undefined}
        onGenerateTemplate={onGenerateTemplate ? () => onGenerateTemplate(node.path) : undefined}
        onImportMetadata={onImportMetadata ? () => onImportMetadata(node.path) : undefined}
        onSelectAll={onSelectAllInFolder ? () => onSelectAllInFolder(node.path) : undefined}
        onCoverageReport={onCoverageReport ? () => onCoverageReport(node.path) : undefined}
        isDraggableFolder
        hasPackInfo={packInfoFolders?.has(node.path.replace(/\\/g, '/')) ?? false}
        folderColor={folderNameColors?.[node.name] ?? null}
        onSetFolderColor={onSetFolderColor ? (color) => onSetFolderColor(node.name, color) : undefined}
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
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onMoveFolder={onMoveFolder}
              onExportFolder={onExportFolder}
              onGenerateTemplate={onGenerateTemplate}
              onImportMetadata={onImportMetadata}
              onSelectAllInFolder={onSelectAllInFolder}
              onCoverageReport={onCoverageReport}
              expandSeq={expandSeq}
              collapseSeq={collapseSeq}
              scrollToFolder={scrollToFolder}
              packInfoFolders={packInfoFolders}
              folderNameColors={folderNameColors}
              onSetFolderColor={onSetFolderColor}
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
  onBatchEdit, onReveal, isFiltered, isHighlighted, onDropFiles, onDropFolder, onCreateFolder, onRenameFolder, onExportFolder, onGenerateTemplate, onImportMetadata, onSelectAll, onCoverageReport, isDraggableFolder, hasPackInfo, folderColor, onSetFolderColor
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
  isHighlighted?: boolean
  onDropFiles?: (filePaths: string[], destFolderPath: string) => void
  onDropFolder?: (sourceFolderPath: string) => void
  onCreateFolder?: (name: string) => Promise<{ success: boolean; error?: string }>
  onRenameFolder?: (newName: string) => Promise<{ success: boolean; error?: string }>
  onExportFolder?: (format: 'csv' | 'xlsx') => void
  onGenerateTemplate?: () => void
  onImportMetadata?: () => void
  onSelectAll?: () => void
  onCoverageReport?: () => void
  isDraggableFolder?: boolean
  hasPackInfo?: boolean
  folderColor?: string | null
  onSetFolderColor?: (color: string | null) => void
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(label)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createValue, setCreateValue] = useState('')
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => {
    if (!colorPickerPos) return
    const close = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) setColorPickerPos(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [colorPickerPos])

  useEffect(() => {
    if (!menu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.bottom > window.innerHeight && rect.top > 0) {
      const clamped = Math.max(4, window.innerHeight - rect.height - 4)
      if (clamped !== menu.y) setMenu((m) => m ? { ...m, y: clamped } : m)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.x])

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(label)
      setTimeout(() => renameInputRef.current?.select(), 30)
    }
  }, [isRenaming, label])

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: e.clientY })
  }

  const commitRename = async () => {
    const trimmed = renameValue.trim()
    setIsRenaming(false)
    if (!trimmed || trimmed === label || !onRenameFolder) return
    const result = await onRenameFolder(trimmed)
    if (!result.success) alert(`Rename failed: ${result.error}`)
  }

  useEffect(() => {
    if (isCreating) {
      setCreateValue('')
      setTimeout(() => createInputRef.current?.focus(), 30)
    }
  }, [isCreating])

  const commitCreate = async () => {
    const trimmed = createValue.trim()
    setIsCreating(false)
    if (!trimmed || !onCreateFolder) return
    const result = await onCreateFolder(trimmed)
    if (!result.success) alert(`Create folder failed: ${result.error}`)
  }

  const countColor = isFiltered
    ? (isSelected ? 'text-sky-600 dark:text-sky-300' : 'text-sky-600 dark:text-sky-400')
    : (isSelected ? 'text-indigo-600 dark:text-indigo-400' : isRoot ? 'text-gray-500 dark:text-gray-500' : 'text-gray-400 dark:text-gray-600')

  const acceptsDrop = (types: readonly string[]) =>
    types.includes('application/x-nam-files') || types.includes('application/x-nam-folder')

  return (
    <div className="relative group" data-folder-path={folderPath}>
      <div
        className={`flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer rounded-sm mx-1 transition-colors ${
          isDragOver
            ? 'bg-indigo-200 dark:bg-indigo-500/40 text-indigo-800 dark:text-indigo-200 ring-1 ring-indigo-400'
            : isHighlighted
              ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 ring-1 ring-sky-400 dark:ring-sky-500'
              : isSelected
                ? 'bg-indigo-100 dark:bg-indigo-600/30 text-indigo-700 dark:text-indigo-300'
                : isRoot
                  ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
        }`}
        style={{ paddingLeft: isRoot ? '12px' : `${depth * 12 + 8}px` }}
        onClick={onClick}
        onContextMenu={openMenu}
        draggable={isDraggableFolder}
        onDragStart={isDraggableFolder ? (e) => {
          e.dataTransfer.setData('application/x-nam-folder', folderPath)
          e.dataTransfer.effectAllowed = 'move'
          e.stopPropagation()
        } : undefined}
        onDragOver={(e) => {
          if (!acceptsDrop(e.dataTransfer.types)) return
          if (e.dataTransfer.types.includes('application/x-nam-folder')) {
            const src = e.dataTransfer.getData('application/x-nam-folder')
            if (src && (folderPath === src || folderPath.startsWith(src + '/'))) return
          }
          e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'
        }}
        onDragEnter={(e) => {
          if (!acceptsDrop(e.dataTransfer.types)) return
          e.preventDefault(); setIsDragOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          if (e.dataTransfer.types.includes('application/x-nam-folder') && onDropFolder) {
            const src = e.dataTransfer.getData('application/x-nam-folder')
            if (src && src !== folderPath && !folderPath.startsWith(src + '/')) {
              onDropFolder(src)
            }
            return
          }
          const raw = e.dataTransfer.getData('application/x-nam-files')
          if (!raw || !onDropFiles) return
          try {
            const paths: string[] = JSON.parse(raw)
            if (paths.length > 0) onDropFiles(paths, folderPath)
          } catch { /* ignore */ }
        }}
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
          className={`w-3.5 h-3.5 flex-shrink-0 ${folderColor ? '' : hasPackInfo ? 'text-blue-500' : isSelected ? 'text-indigo-400' : isRoot ? 'text-indigo-400' : 'text-gray-500'}`}
          style={folderColor ? { color: folderColor } : undefined}
          fill={(hasPackInfo || folderColor) ? (expanded && hasChildren ? 'currentColor' : 'none') : (!isRoot && expanded && hasChildren ? 'currentColor' : 'none')}
          viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isRoot ? 2 : 1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="flex-1 text-xs bg-gray-100 dark:bg-gray-700 border border-indigo-500 rounded px-1 py-0 outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') setIsRenaming(false)
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={`text-xs truncate flex-1 ${isRoot ? 'font-medium' : ''}`}
            onDoubleClick={!isRoot && onRenameFolder ? (e) => { e.stopPropagation(); setIsRenaming(true) } : undefined}
          >{label}</span>
        )}

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
          <span className={`text-xs flex-shrink-0 ${countColor}`}>{totalCount}</span>
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
          {onSelectAll && (
            <button
              className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
              onClick={() => { setMenu(null); onSelectAll() }}
            >
              Select all in folder
            </button>
          )}
          {onCreateFolder && (
            <button
              className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
              onClick={() => { setMenu(null); setIsCreating(true) }}
            >
              New subfolder…
            </button>
          )}
          {!isRoot && onRenameFolder && (
            <button
              className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
              onClick={() => { setMenu(null); setIsRenaming(true) }}
            >
              Rename folder…
            </button>
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
            onClick={() => { setMenu(null); onReveal() }}
          >
            Reveal in Explorer
          </button>
          {onExportFolder && (
            <>
              <div className="my-1 border-t border-gray-300 dark:border-gray-700" />
              <button
                className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
                onClick={() => { setMenu(null); onExportFolder('csv') }}
              >
                Export folder as CSV
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
                onClick={() => { setMenu(null); onExportFolder('xlsx') }}
              >
                Export folder as Excel
              </button>
            </>
          )}
          {(onGenerateTemplate || onImportMetadata) && (
            <>
              <div className="my-1 border-t border-gray-300 dark:border-gray-700" />
              {onGenerateTemplate && (
                <button
                  className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
                  onClick={() => { setMenu(null); onGenerateTemplate() }}
                >
                  Generate import template…
                </button>
              )}
              {onImportMetadata && (
                <button
                  className="w-full text-left px-3 py-1.5 text-teal-700 dark:text-teal-400 hover:bg-indigo-600/40 transition-colors"
                  onClick={() => { setMenu(null); onImportMetadata() }}
                >
                  Import metadata from spreadsheet…
                </button>
              )}
            </>
          )}
          {onCoverageReport && (
            <>
              <div className="my-1 border-t border-gray-300 dark:border-gray-700" />
              <button
                className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors"
                onClick={() => { setMenu(null); onCoverageReport() }}
              >
                Training version report…
              </button>
            </>
          )}
          {!isRoot && onSetFolderColor && (
            <>
              <div className="my-1 border-t border-gray-300 dark:border-gray-700" />
              <button
                className="w-full text-left px-3 py-1.5 text-gray-800 dark:text-gray-200 hover:bg-indigo-600/40 transition-colors flex items-center gap-2"
                onClick={() => {
                  // Position picker near the menu — picker is ~180px wide, ~120px tall
                  const pickerW = 184, pickerH = 120
                  const x = Math.min(menu!.x, window.innerWidth - pickerW - 8)
                  const y = Math.min(menu!.y, window.innerHeight - pickerH - 8)
                  setMenu(null)
                  setColorPickerPos({ x, y })
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full border border-gray-400 flex-shrink-0"
                  style={folderColor ? { background: folderColor, borderColor: folderColor } : undefined}
                />
                Set folder color…
              </button>
            </>
          )}
        </div>
      )}

      {colorPickerPos && onSetFolderColor && (
        <div
          ref={colorPickerRef}
          className="fixed z-50 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl p-3"
          style={{ left: colorPickerPos.x, top: colorPickerPos.y }}
        >
          <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-2 truncate max-w-40">
            Color for all "{label}" folders
          </div>
          <div className="flex gap-1.5 mb-2">
            {FOLDER_COLOR_PALETTE.map((c) => {
              const isCurrent = folderColor === c.hex
              return (
                <button
                  key={c.hex}
                  title={c.name}
                  onClick={() => { onSetFolderColor(c.hex); setColorPickerPos(null) }}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110 focus:outline-none"
                  style={{
                    background: c.hex,
                    boxShadow: isCurrent ? `0 0 0 2px white, 0 0 0 3.5px ${c.hex}` : undefined,
                    opacity: 1
                  }}
                />
              )
            })}
          </div>
          {folderColor && (
            <button
              onClick={() => { onSetFolderColor(null); setColorPickerPos(null) }}
              className="w-full text-[10px] text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-center transition-colors"
            >
              ✕ Remove color
            </button>
          )}
        </div>
      )}

      {isCreating && (
        <div className="flex items-center gap-1.5 mx-1 py-1" style={{ paddingLeft: `${(isRoot ? 0 : 1) * 12 + 20}px` }}>
          <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <input
            ref={createInputRef}
            className="flex-1 text-xs bg-gray-100 dark:bg-gray-700 border border-indigo-500 rounded px-1 py-0.5 outline-none"
            value={createValue}
            placeholder="New folder name"
            onChange={(e) => setCreateValue(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitCreate() }
              if (e.key === 'Escape') setIsCreating(false)
              e.stopPropagation()
            }}
          />
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState, useCallback } from 'react'

type FolderRow = {
  id: number
  parent_id: number | null
  relative_path: string
  direct_item_count: number
  is_lab_project: number
}

interface TreeNode {
  id: number
  name: string
  parentId: number | null
  directCount: number
  /** Rolled up bottom-up during buildTree — every item under this folder, recursively. Mirrors
   * NAM Lab's own FolderTree.tsx "totalCount" convention (that component computes the same kind
   * of subtree rollup for its own badge). */
  totalCount: number
  /** True iff labProjectEnrichment.ts found an IR Lab Project anchored to this exact folder (plan
   * section 8c/§5) — drives the blue dot badge, mirroring NAM Lab's own pack-owning-folder dot
   * (FolderTree.tsx, bg-blue-500 — same color, same idiom, not a recolored icon/label). */
  isLabProject: boolean
  children: TreeNode[]
}

/** Flat folder list -> nested tree with rolled-up counts. Root's own row (relative_path === '')
 * excluded from display since it has no meaningful name of its own — its children render at the
 * top level instead, but its count still rolls up correctly since totals sum children first. */
function buildTree(rows: FolderRow[]): { roots: TreeNode[]; allIds: number[] } {
  const byId = new Map<number, TreeNode>()
  const childrenOf = new Map<number | null, TreeNode[]>()
  const allIds: number[] = []
  for (const row of rows) {
    const name = row.relative_path === '' ? '' : row.relative_path.split('/').pop() ?? row.relative_path
    const node: TreeNode = {
      id: row.id,
      name,
      parentId: row.parent_id,
      directCount: row.direct_item_count,
      totalCount: 0,
      isLabProject: !!row.is_lab_project,
      children: []
    }
    byId.set(row.id, node)
    allIds.push(row.id)
    const siblings = childrenOf.get(row.parent_id) ?? []
    siblings.push(node)
    childrenOf.set(row.parent_id, siblings)
  }
  // Children first (post-order) so a parent's totalCount can sum already-finalized children.
  const attach = (node: TreeNode): void => {
    node.children = (childrenOf.get(node.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    let sum = node.directCount
    for (const child of node.children) {
      attach(child)
      sum += child.totalCount
    }
    node.totalCount = sum
  }

  const rootRow = rows.find((r) => r.relative_path === '')
  if (rootRow) {
    const rootNode = byId.get(rootRow.id)!
    attach(rootNode)
    return { roots: rootNode.children, allIds }
  }
  const topLevel = (childrenOf.get(null) ?? []).sort((a, b) => a.name.localeCompare(b.name))
  for (const node of topLevel) attach(node)
  return { roots: topLevel, allIds }
}

/** ids of every node whose name matches `query`, plus every ancestor of a match (so the match is
 * actually reachable without manually expanding down to it) — same "show the path to a hit"
 * behavior search UIs generally use. Returns null when query is empty (no filtering active). */
function computeVisibleIds(roots: TreeNode[], query: string): Set<number> | null {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return null
  const visible = new Set<number>()
  const visit = (node: TreeNode, ancestors: number[]): boolean => {
    let matched = node.name.toLowerCase().includes(trimmed)
    for (const child of node.children) {
      if (visit(child, [...ancestors, node.id])) matched = true
    }
    if (matched) {
      visible.add(node.id)
      for (const a of ancestors) visible.add(a)
    }
    return matched
  }
  for (const root of roots) visit(root, [])
  return visible
}

/** Same path/convention as NAM Lab's own FolderTree.tsx (~line 828): outline when closed, filled
 * when expanded — "open = solid, closed = outline" per that component's existing icon language,
 * reused here rather than inventing a second visual convention for what's conceptually the same
 * kind of row. */
function FolderIcon({ expanded, isSelected }: { expanded: boolean; isSelected: boolean }): React.ReactElement {
  return (
    <svg
      className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-nm-accent' : 'text-nm-text-2'}`}
      fill={expanded ? 'currentColor' : 'none'}
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  )
}

function TreeRow({
  node,
  depth,
  selectedId,
  expandedIds,
  visibleIds,
  onSelect,
  onToggleExpand
}: {
  node: TreeNode
  depth: number
  selectedId: number | null
  expandedIds: Set<number>
  visibleIds: Set<number> | null
  onSelect: (id: number, name: string) => void
  onToggleExpand: (id: number) => void
}): React.ReactElement | null {
  if (visibleIds && !visibleIds.has(node.id)) return null
  const hasChildren = node.children.length > 0
  // While searching, force every visible node open so matches are actually shown, not hidden
  // behind manual collapse state that predates the search.
  const expanded = visibleIds ? true : expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  return (
    <div>
      <div
        onClick={() => onSelect(node.id, node.name)}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={`flex items-center gap-1.5 py-0.5 pr-2 text-xs cursor-pointer rounded ${
          isSelected ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov text-nm-text'
        }`}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.id)
            }}
            className="w-3 flex-shrink-0 text-nm-text-3"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <FolderIcon expanded={expanded && hasChildren} isSelected={isSelected} />
        {node.isLabProject && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" title="IR Lab Project" />
        )}
        <span className="truncate flex-1">{node.name}</span>
        {node.totalCount > 0 && (
          <span className={`text-xs flex-shrink-0 ${isSelected ? 'text-nm-accent' : 'text-nm-text-3'}`}>{node.totalCount}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              visibleIds={visibleIds}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Read-only folder navigation for IR mode (docs/ir-lab-manager-build-plan.md section 13's
 * folder-tree open decision, resolved: build it, as a side panel alongside search — not instead
 * of it). Deliberately much simpler than NAM Lab's own FolderTree.tsx (1241 lines: drag-drop,
 * rename, move, context menus) — a vendor IR library is read-only from this app's perspective,
 * the folder structure comes from disk, not from user reorganization. Selecting a folder both
 * opens its metadata panel (IrFolderPanel.tsx) and filters IrModeShell's item list to that
 * folder's subtree. Per-folder item counts (recursive, "totalCount") match NAM Lab's own tree
 * badge convention.
 */
export function IrFolderTree({
  libraryRootId,
  selectedFolderId,
  onSelectFolder
}: {
  libraryRootId: number | null
  selectedFolderId: number | null
  onSelectFolder: (folderId: number, name: string) => void
}): React.ReactElement {
  const [rows, setRows] = useState<FolderRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [treeSearch, setTreeSearch] = useState('')

  useEffect(() => {
    if (libraryRootId == null) {
      setRows([])
      return
    }
    window.api.irLibraryListFolders(libraryRootId).then((r) => {
      setRows(r)
      // Depth-0 expanded by default, matching the previous per-row default — built directly here
      // (not via the memoized `roots` below, which won't reflect this render's state yet).
      const { roots: topLevel } = buildTree(r)
      setExpandedIds(new Set(topLevel.map((node) => node.id)))
    })
  }, [libraryRootId])

  const { roots, allIds } = useMemo(() => buildTree(rows), [rows])
  const visibleIds = useMemo(() => computeVisibleIds(roots, treeSearch), [roots, treeSearch])

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => setExpandedIds(new Set(allIds)), [allIds])
  const collapseAll = useCallback(() => setExpandedIds(new Set()), [])

  if (libraryRootId == null) {
    return <div className="p-3 text-xs text-nm-text-3">Add a library folder to see its structure.</div>
  }
  if (roots.length === 0) {
    return <div className="p-3 text-xs text-nm-text-3">No subfolders.</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-nm-border-s flex-shrink-0">
        <input
          value={treeSearch}
          onChange={(e) => setTreeSearch(e.target.value)}
          placeholder="Filter folders…"
          className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
        />
        <button onClick={expandAll} title="Expand all" className="text-nm-text-3 hover:text-nm-accent px-1 text-xs flex-shrink-0">
          ⊞
        </button>
        <button onClick={collapseAll} title="Collapse all" className="text-nm-text-3 hover:text-nm-accent px-1 text-xs flex-shrink-0">
          ⊟
        </button>
      </div>
      <div className="py-1 overflow-y-auto flex-1">
        {roots.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedFolderId}
            expandedIds={expandedIds}
            visibleIds={visibleIds}
            onSelect={onSelectFolder}
            onToggleExpand={toggleExpand}
          />
        ))}
      </div>
    </div>
  )
}

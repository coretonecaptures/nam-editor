import { useEffect, useMemo, useState, useCallback } from 'react'

type FolderRow = {
  id: number
  parent_id: number | null
  relative_path: string
  direct_item_count: number
  is_lab_project: number
  library_root_id: number
  library_root_label: string
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
  /** A synthetic node (the "Library" wrapper, or a per-root node under it) with no real folder_id
   * behind it — never selectable/filterable, only expand-toggleable. Negative, sentinel `id`s so
   * they can never collide with a real folder's auto-increment id. */
  isVirtual?: boolean
  children: TreeNode[]
}

/** Flat, multi-root folder list -> nested tree. Grouped by library_root first (a user who's added
 * several roots — e.g. five separate IR Lab Projects, each its own root — should see all of them
 * at once, not only whichever one happens to be selected elsewhere in the UI): each root becomes
 * its own subtree, wrapped in a single synthetic "Library" top node once there's more than one
 * root to distinguish. A lone root skips the wrapper entirely — nothing to disambiguate yet, and
 * it keeps the single-root case visually identical to before this existed. */
function buildTree(rows: FolderRow[]): { roots: TreeNode[]; allIds: number[] } {
  const byRoot = new Map<number, { label: string; rows: FolderRow[] }>()
  for (const row of rows) {
    const group = byRoot.get(row.library_root_id) ?? { label: row.library_root_label, rows: [] }
    group.rows.push(row)
    byRoot.set(row.library_root_id, group)
  }

  const allIds: number[] = []
  const perRootNodes: TreeNode[] = []

  for (const group of byRoot.values()) {
    const byId = new Map<number, TreeNode>()
    const childrenOf = new Map<number | null, TreeNode[]>()
    for (const row of group.rows) {
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
    // Empty children (zero WAVs anywhere under them — no direct items, and nothing further down
    // either) are dropped from display once their own total is known: a folder that exists only to
    // hold a vendor's docs/images/session data, with no audio in it or beneath it, is clutter here,
    // not a real navigation target.
    const attach = (node: TreeNode): void => {
      const rawChildren = (childrenOf.get(node.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))
      let sum = node.directCount
      for (const child of rawChildren) {
        attach(child)
        sum += child.totalCount
      }
      node.totalCount = sum
      node.children = rawChildren.filter((c) => c.totalCount > 0)
    }

    // The root's own folder row (relative_path === '') always exists (importLibrary creates it
    // unconditionally) — reuse IT as the per-root tree node directly, relabeled with the root's
    // name, rather than wrapping its children in a separate synthetic node. This matters
    // concretely for a FLAT root (an IR Lab Project's outputRoot has no subfolders at all,
    // "Deliberately flat in phase 1" per the real ir-lab source) — a synthetic wrapper around an
    // EMPTY children array would render with no expand arrow and nothing to click, making that
    // Project permanently unselectable in the tree. Using the real row means it's always a real,
    // selectable folder_id with a correct is_lab_project flag, whether or not it has subfolders.
    const rootRow = group.rows.find((r) => r.relative_path === '')
    if (!rootRow) continue // shouldn't happen (importLibrary always creates this row), but don't crash if it somehow doesn't
    const rootNode = byId.get(rootRow.id)!
    attach(rootNode)
    rootNode.name = group.label
    perRootNodes.push(rootNode)
  }

  perRootNodes.sort((a, b) => a.name.localeCompare(b.name))

  if (perRootNodes.length === 0) return { roots: [], allIds }
  if (perRootNodes.length === 1) {
    const only = perRootNodes[0]
    // Skip showing the root's own node when it has real substructure underneath it (today's
    // established convention — jump straight to the vendor pack's actual subfolders rather than
    // an extra "click to expand the one root you added" layer). Only show the root node itself
    // when it has nothing beneath it, so a flat single Project is still reachable at all.
    return { roots: only.children.length > 0 ? only.children : [only], allIds }
  }

  const libraryNode: TreeNode = {
    id: -1,
    name: 'Library',
    parentId: null,
    directCount: 0,
    totalCount: perRootNodes.reduce((sum, n) => sum + n.totalCount, 0),
    isLabProject: false,
    isVirtual: true,
    children: perRootNodes
  }
  return { roots: [libraryNode], allIds }
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
  const isSelected = !node.isVirtual && selectedId === node.id
  return (
    <div>
      <div
        onClick={() => (node.isVirtual ? onToggleExpand(node.id) : onSelect(node.id, node.name))}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={`flex items-center gap-1.5 py-0.5 pr-2 text-xs cursor-pointer rounded ${
          isSelected ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov text-nm-text'
        } ${node.isVirtual ? 'font-medium text-nm-text-2' : ''}`}
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
 *
 * Always shows EVERY library_root at once under a virtual "Library" node once there's more than
 * one (raised directly: adding several roots — e.g. five separate IR Lab Projects — left every
 * root but one invisible, since the tree previously only ever rendered whichever single root a
 * separate dropdown had selected). `libraryRootCount` is purely a refetch trigger (bump it after a
 * scan completes and the roots list changes) — the tree itself is root-agnostic once fetched.
 */
export function IrFolderTree({
  libraryRootCount,
  selectedFolderId,
  onSelectFolder
}: {
  libraryRootCount: number
  selectedFolderId: number | null
  onSelectFolder: (folderId: number, name: string) => void
}): React.ReactElement {
  const [rows, setRows] = useState<FolderRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [treeSearch, setTreeSearch] = useState('')

  useEffect(() => {
    if (libraryRootCount === 0) {
      setRows([])
      return
    }
    window.api.irLibraryListAllFolders().then((r) => {
      setRows(r)
      // Depth-0 expanded by default, matching the previous per-row default — built directly here
      // (not via the memoized `roots` below, which won't reflect this render's state yet).
      const { roots: topLevel } = buildTree(r)
      setExpandedIds(new Set(topLevel.map((node) => node.id)))
    })
  }, [libraryRootCount])

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

  if (libraryRootCount === 0) {
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

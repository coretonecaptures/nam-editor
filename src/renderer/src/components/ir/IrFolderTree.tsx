import { useEffect, useMemo, useState, useCallback } from 'react'
import { ContextMenu } from '../ContextMenu'

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
  /** Which added library folder this node belongs to — needed so the context menu can offer
   * "Remove from Library" (the whole root) only on the node that IS that root. */
  libraryRootId: number
  /** True for the folder row that IS a library_root's own top-level folder (relative_path === ''
   * per importLibrary.ts) — right-clicking this one removes the WHOLE added library folder, not
   * just a subtree of it. */
  isRootNode: boolean
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
        libraryRootId: row.library_root_id,
        isRootNode: row.relative_path === '',
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
    libraryRootId: -1,
    isRootNode: false,
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
  onToggleExpand,
  onContextMenu
}: {
  node: TreeNode
  depth: number
  selectedId: number | null
  expandedIds: Set<number>
  visibleIds: Set<number> | null
  onSelect: (id: number, name: string) => void
  onToggleExpand: (id: number) => void
  onContextMenu: (node: TreeNode, x: number, y: number) => void
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
        onContextMenu={(e) => {
          if (node.isVirtual) return
          e.preventDefault()
          onContextMenu(node, e.clientX, e.clientY)
        }}
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
              onContextMenu={onContextMenu}
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
  onSelectFolder,
  onLibraryChanged
}: {
  libraryRootCount: number
  selectedFolderId: number | null
  onSelectFolder: (folderId: number, name: string) => void
  /** Called after a folder or whole root is actually removed, so the shell can clear the selected
   * folder if it was the one removed, refresh the root list, and refetch the browse list/Overview. */
  onLibraryChanged: () => void
}): React.ReactElement {
  const [rows, setRows] = useState<FolderRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [treeSearch, setTreeSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ node: TreeNode; itemCount: number; folderCount: number } | null>(null)
  const [removing, setRemoving] = useState(false)

  const refreshRows = useCallback(() => {
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

  useEffect(() => {
    refreshRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const openRemoveConfirm = useCallback((node: TreeNode) => {
    setContextMenu(null)
    const preview = node.isRootNode
      ? window.api.irLibraryPreviewLibraryRootRemoval(node.libraryRootId)
      : window.api.irLibraryPreviewFolderRemoval(node.id)
    preview.then((p) => setRemoveTarget({ node, itemCount: p.itemCount, folderCount: p.folderCount }))
  }, [])

  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return
    setRemoving(true)
    const { node } = removeTarget
    if (node.isRootNode) {
      await window.api.irLibraryRemoveLibraryRoot(node.libraryRootId)
    } else {
      await window.api.irLibraryRemoveFolderFromCatalog(node.id)
    }
    setRemoving(false)
    setRemoveTarget(null)
    refreshRows()
    onLibraryChanged()
  }, [removeTarget, refreshRows, onLibraryChanged])

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
        {/* Same chevron icons and button chrome NAM Lab's own FolderTree.tsx header uses, rather
            than the ⊞/⊟ text glyphs this had — one control, one look, across both halves. */}
        <button
          onClick={expandAll}
          title="Expand all folders"
          className="p-1 rounded transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={collapseAll}
          title="Collapse all folders"
          className="p-1 rounded transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
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
            onContextMenu={(n, x, y) => setContextMenu({ node: n, x, y })}
          />
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: contextMenu.node.isRootNode ? `Remove "${contextMenu.node.name}" from Library…` : `Remove "${contextMenu.node.name}" from Catalog…`,
              destructive: true,
              onClick: () => openRemoveConfirm(contextMenu.node)
            }
          ]}
        />
      )}

      {removeTarget && (
        <div
          className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center"
          onClick={() => !removing && setRemoveTarget(null)}
        >
          <div
            className="bg-panel border border-nm-border rounded-xl p-5 w-[380px] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-nm-text">
              {removeTarget.node.isRootNode ? 'Remove library folder?' : 'Remove folder from catalog?'}
            </div>
            <div className="text-xs text-nm-text-2 leading-relaxed">
              {removeTarget.node.isRootNode ? (
                <>
                  This stops tracking <span className="font-medium text-nm-text">"{removeTarget.node.name}"</span> entirely —{' '}
                  {removeTarget.itemCount.toLocaleString()} IR{removeTarget.itemCount === 1 ? '' : 's'} across{' '}
                  {removeTarget.folderCount.toLocaleString()} folder{removeTarget.folderCount === 1 ? '' : 's'} will be removed from
                  the catalog. Re-add it any time with "Add Library Folder…".
                </>
              ) : (
                <>
                  This removes <span className="font-medium text-nm-text">"{removeTarget.node.name}"</span> and everything under
                  it — {removeTarget.itemCount.toLocaleString()} IR{removeTarget.itemCount === 1 ? '' : 's'} across{' '}
                  {removeTarget.folderCount.toLocaleString()} folder{removeTarget.folderCount === 1 ? '' : 's'} — from the catalog.
                </>
              )}
              <br />
              <span className="font-medium">Files on disk are never touched.</span> This only affects the catalog index; run a
              rescan on the parent folder to bring it back.
            </div>
            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                onClick={() => setRemoveTarget(null)}
                disabled={removing}
                className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmRemove()}
                disabled={removing}
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

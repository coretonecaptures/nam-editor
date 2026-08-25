import { useEffect, useMemo, useState } from 'react'

type FolderRow = { id: number; parent_id: number | null; relative_path: string }

interface TreeNode {
  id: number
  name: string
  children: TreeNode[]
}

/** Flat folder list (id/parent_id/relative_path) -> nested tree, root's own row (relative_path
 * === '') excluded from display since it has no meaningful name of its own — its children render
 * at the top level instead. */
function buildTree(rows: FolderRow[]): TreeNode[] {
  const byId = new Map<number, TreeNode>()
  const childrenOf = new Map<number | null, TreeNode[]>()
  for (const row of rows) {
    const name = row.relative_path === '' ? '' : row.relative_path.split('/').pop() ?? row.relative_path
    const node: TreeNode = { id: row.id, name, children: [] }
    byId.set(row.id, node)
    const siblings = childrenOf.get(row.parent_id) ?? []
    siblings.push(node)
    childrenOf.set(row.parent_id, siblings)
  }
  const attach = (node: TreeNode): void => {
    node.children = (childrenOf.get(node.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    for (const child of node.children) attach(child)
  }
  const rootRow = rows.find((r) => r.relative_path === '')
  if (rootRow) {
    const rootNode = byId.get(rootRow.id)!
    attach(rootNode)
    return rootNode.children
  }
  // No explicit root row (shouldn't happen once a scan has run, but don't crash if it does).
  const topLevel = (childrenOf.get(null) ?? []).sort((a, b) => a.name.localeCompare(b.name))
  for (const node of topLevel) attach(node)
  return topLevel
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect
}: {
  node: TreeNode
  depth: number
  selectedId: number | null
  onSelect: (id: number) => void
}): React.ReactElement {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  return (
    <div>
      <div
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={`flex items-center gap-1 py-0.5 pr-2 text-xs cursor-pointer rounded ${
          selectedId === node.id ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
        }`}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            className="w-3 flex-shrink-0 text-gray-400"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
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
 * the folder structure comes from disk, not from user reorganization. This tree exists to give
 * folder-metadata editing (FolderPanel.tsx) somewhere to select a folder from, nothing more.
 */
export function IrFolderTree({
  libraryRootId,
  selectedFolderId,
  onSelectFolder
}: {
  libraryRootId: number | null
  selectedFolderId: number | null
  onSelectFolder: (folderId: number) => void
}): React.ReactElement {
  const [rows, setRows] = useState<FolderRow[]>([])

  useEffect(() => {
    if (libraryRootId == null) {
      setRows([])
      return
    }
    window.api.irLibraryListFolders(libraryRootId).then(setRows)
  }, [libraryRootId])

  const tree = useMemo(() => buildTree(rows), [rows])

  if (libraryRootId == null) {
    return <div className="p-3 text-xs text-gray-400 dark:text-gray-600">Add a library folder to see its structure.</div>
  }
  if (tree.length === 0) {
    return <div className="p-3 text-xs text-gray-400 dark:text-gray-600">No subfolders.</div>
  }

  return (
    <div className="py-1 overflow-y-auto">
      {tree.map((node) => (
        <TreeRow key={node.id} node={node} depth={0} selectedId={selectedFolderId} onSelect={onSelectFolder} />
      ))}
    </div>
  )
}

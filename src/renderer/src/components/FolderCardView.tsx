import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderNode } from '../types/librarian'
import { NamFile } from '../types/nam'

const COVER_RE = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i

function toFileUrl(p: string): string {
  return p.startsWith('/') ? `local-file://${p}` : `local-file:///${p}`
}

async function findCoverForNode(node: FolderNode): Promise<string | null> {
  const result = await window.api.scanImages(node.path)
  if (!result.success) return null
  const hit = result.images.find((p) => COVER_RE.test(p.split(/[\\/]/).pop() ?? ''))
  if (hit) return hit
  for (const child of node.children.slice(0, 5)) {
    const cr = await window.api.scanImages(child.path)
    if (!cr.success) continue
    const cc = cr.images.find((p) => COVER_RE.test(p.split(/[\\/]/).pop() ?? ''))
    if (cc) return cc
  }
  return null
}

interface CtxMenu { x: number; y: number; node: FolderNode }

interface FolderCardViewProps {
  rootNode: FolderNode
  rootFolder: string
  files: NamFile[]
  packInfoFolders: Set<string>
  onOpenFolder: (path: string) => void
  isDark: boolean
}

export function FolderCardView({ rootNode, rootFolder, files, packInfoFolders, onOpenFolder, isDark }: FolderCardViewProps) {
  // Drill-down stack: array of ancestor FolderNodes we've navigated into
  const [stack, setStack] = useState<FolderNode[]>([])
  const currentNode = stack.length > 0 ? stack[stack.length - 1] : rootNode
  const folders = currentNode.children

  const [covers, setCovers] = useState<Map<string, string | null>>(new Map())
  const [selected, setSelected] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [previewWidth, setPreviewWidth] = useState<number>(() => {
    const saved = localStorage.getItem('folderCardPreviewWidth')
    return saved ? Math.max(220, Math.min(600, Number(saved))) : 320
  })
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(0)

  // Reload covers whenever the displayed folder list changes
  useEffect(() => {
    let cancelled = false
    setCovers(new Map()) // clear stale covers immediately
    setSelected(null)
    const load = async () => {
      for (const node of folders) {
        if (cancelled) break
        const cover = await findCoverForNode(node)
        if (!cancelled) {
          setCovers((prev) => {
            const next = new Map(prev)
            next.set(node.path, cover)
            return next
          })
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentNode.path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close) }
  }, [ctxMenu])

  // Resize drag handle
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    startXRef.current = e.clientX
    startWRef.current = previewWidth
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = startXRef.current - ev.clientX
      const next = Math.max(220, Math.min(600, startWRef.current + delta))
      setPreviewWidth(next)
      localStorage.setItem('folderCardPreviewWidth', String(next))
    }
    const onUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [previewWidth])

  const drillInto = (node: FolderNode) => {
    if (node.children.length === 0) return
    setStack((s) => [...s, node])
    setCtxMenu(null)
  }

  const navigateTo = (index: number) => {
    // index -1 = root, 0 = first item in stack, etc.
    setStack((s) => index < 0 ? [] : s.slice(0, index + 1))
    setSelected(null)
  }

  const selectedNode = selected ? folders.find((f) => f.path === selected) ?? null : null
  const selectedCover = selected ? (covers.get(selected) ?? null) : null
  const relPath = selected ? selected.replace(rootFolder, '').replace(/^[\\/]/, '') : ''

  // Per-folder helpers
  const normalizedPath = (p: string) => p.replace(/\\/g, '/')
  const dirtyForFolder = (path: string) =>
    files.filter((f) => f.isDirty && normalizedPath(f.filePath).startsWith(normalizedPath(path) + '/')).length
  const completenessForFolder = (path: string) => {
    const all = files.filter((f) => normalizedPath(f.filePath).startsWith(normalizedPath(path) + '/'))
    if (all.length === 0) return null
    const complete = all.filter((f) => {
      const m = f.metadata
      return m.name && m.gear_make && m.gear_model && m.gear_type && m.tone_type && m.modeled_by
    }).length
    return Math.round((complete / all.length) * 100)
  }

  const rootName = rootFolder.split(/[\\/]/).pop() ?? rootFolder

  return (
    <div
      className={`flex flex-col flex-1 overflow-hidden ${isDark ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'}`}
      onClick={() => setCtxMenu(null)}
    >
      {/* Breadcrumb bar */}
      <div className={`flex items-center gap-1 px-4 py-2 border-b shrink-0 text-sm ${isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-white/70'}`}>
        <button
          onClick={() => navigateTo(-1)}
          className={`flex items-center gap-1 hover:underline truncate max-w-[140px] ${
            stack.length === 0
              ? isDark ? 'text-gray-300 font-medium cursor-default' : 'text-gray-700 font-medium cursor-default'
              : isDark ? 'text-gray-500 hover:text-gray-200' : 'text-gray-400 hover:text-gray-700'
          }`}
          title={rootFolder}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h3.586a2 2 0 011.414.586l1 1A2 2 0 0012.414 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span className="truncate">{rootName}</span>
        </button>
        {stack.map((node, i) => (
          <span key={node.path} className="flex items-center gap-1 min-w-0">
            <span className={isDark ? 'text-gray-700' : 'text-gray-300'}>›</span>
            <button
              onClick={() => navigateTo(i)}
              className={`truncate max-w-[140px] hover:underline ${
                i === stack.length - 1
                  ? isDark ? 'text-gray-300 font-medium cursor-default' : 'text-gray-700 font-medium cursor-default'
                  : isDark ? 'text-gray-500 hover:text-gray-200' : 'text-gray-400 hover:text-gray-700'
              }`}
              title={node.path}
            >
              {node.name}
            </button>
          </span>
        ))}
        <span className={`ml-auto shrink-0 text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          {folders.length} folder{folders.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Main content: card grid + preview panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Card grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {folders.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              No subfolders in this folder.
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {folders.map((node) => {
                const c = covers.get(node.path)
                const dirty = dirtyForFolder(node.path)
                const isSelected = selected === node.path
                return (
                  <div
                    key={node.path}
                    onClick={(e) => { e.stopPropagation(); setSelected(isSelected ? null : node.path) }}
                    onDoubleClick={() => onOpenFolder(node.path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelected(node.path)
                      setCtxMenu({ x: e.clientX, y: e.clientY, node })
                    }}
                    className={`rounded-xl border cursor-pointer transition-all select-none overflow-hidden ${
                      isSelected
                        ? isDark ? 'border-teal-500 ring-1 ring-teal-500/40 bg-gray-900' : 'border-teal-500 ring-1 ring-teal-500/30 bg-white'
                        : isDark ? 'border-gray-800 bg-gray-900 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-400'
                    }`}
                  >
                    {/* Image area */}
                    <div className={`w-full aspect-video overflow-hidden flex items-center justify-center ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                      {c !== undefined && c !== null ? (
                        <img src={toFileUrl(c)} alt={node.name} className="w-full h-full object-cover" draggable={false} />
                      ) : c === undefined ? (
                        <div className={`w-full h-full flex items-center justify-center ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                          <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        </div>
                      ) : (
                        <div className={`w-full h-full ${isDark ? 'bg-gray-800/60' : 'bg-gray-100'}`} />
                      )}
                    </div>
                    {/* Metadata */}
                    <div className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-1">
                        <div className={`text-sm font-medium leading-tight truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`} title={node.name}>
                          {node.name}
                        </div>
                        {dirty > 0 && (
                          <span className="shrink-0 text-[10px] font-semibold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 leading-none">{dirty}✎</span>
                        )}
                      </div>
                      <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {node.totalCount} capture{node.totalCount !== 1 ? 's' : ''}
                        {node.children.length > 0 && ` · ${node.children.length} folder${node.children.length !== 1 ? 's' : ''}`}
                      </div>
                      {packInfoFolders.has(node.path) && (
                        <div className="mt-1 flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                          <span className={`text-[10px] ${isDark ? 'text-blue-400' : 'text-blue-500'}`}>Pack</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Drag handle + preview panel */}
        {selected && selectedNode && (
          <>
            <div
              onMouseDown={onResizeMouseDown}
              className={`w-1 cursor-col-resize shrink-0 transition-colors ${isDark ? 'bg-gray-800 hover:bg-teal-500/60 active:bg-teal-500' : 'bg-gray-200 hover:bg-teal-400/60 active:bg-teal-400'}`}
            />
            <div
              className={`flex flex-col overflow-hidden border-l shrink-0 ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
              style={{ width: previewWidth }}
            >
              <FolderPreviewPanel
                node={selectedNode}
                cover={selectedCover}
                relPath={relPath}
                completeness={completenessForFolder(selectedNode.path)}
                hasPackInfo={packInfoFolders.has(selectedNode.path)}
                canDrillDown={selectedNode.children.length > 0}
                onOpen={() => onOpenFolder(selectedNode.path)}
                onDrillDown={() => drillInto(selectedNode)}
                onClose={() => setSelected(null)}
                isDark={isDark}
              />
            </div>
          </>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className={`fixed z-50 rounded-lg shadow-xl border py-1 min-w-[170px] text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onOpenFolder(ctxMenu.node.path); setCtxMenu(null) }}
            className={`w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2`}
          >
            <span>→</span> Open folder
          </button>
          {ctxMenu.node.children.length > 0 && (
            <button
              onClick={() => drillInto(ctxMenu.node)}
              className={`w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2`}
            >
              <span>⊞</span> Browse inside
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FolderPreviewPanel({
  node, cover, relPath, completeness, hasPackInfo, canDrillDown,
  onOpen, onDrillDown, onClose, isDark,
}: {
  node: FolderNode
  cover: string | null
  relPath: string
  completeness: number | null
  hasPackInfo: boolean
  canDrillDown: boolean
  onOpen: () => void
  onDrillDown: () => void
  onClose: () => void
  isDark: boolean
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`flex items-center justify-between px-3 py-2 border-b shrink-0 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Folder</span>
        <button onClick={onClose} className={`text-sm leading-none transition ${isDark ? 'text-gray-500 hover:text-gray-200' : 'text-gray-400 hover:text-gray-700'}`}>×</button>
      </div>

      <div className={`w-full aspect-video shrink-0 overflow-hidden ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
        {cover
          ? <img src={toFileUrl(cover)} alt={node.name} className="w-full h-full object-cover" draggable={false} />
          : <div className={`w-full h-full ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`} />
        }
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <div>
          <div className={`font-semibold text-sm leading-tight ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{node.name}</div>
          {relPath && relPath !== node.name && (
            <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`} title={relPath}>{relPath}</div>
          )}
        </div>

        <div className="space-y-1">
          <Row label="Captures" value={String(node.totalCount)} isDark={isDark} />
          <Row label="Direct" value={String(node.fileCount)} isDark={isDark} />
          {node.children.length > 0 && <Row label="Subfolders" value={String(node.children.length)} isDark={isDark} />}
          {hasPackInfo && <Row label="Pack info" value="✓" isDark={isDark} highlight />}
        </div>

        {completeness !== null && (
          <div>
            <div className={`text-xs mb-1 flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <span>Completeness</span><span>{completeness}%</span>
            </div>
            <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
              <div
                className={`h-full rounded-full transition-all ${completeness >= 90 ? 'bg-emerald-500' : completeness >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className={`px-3 py-3 border-t shrink-0 space-y-2 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        {canDrillDown && (
          <button
            onClick={onDrillDown}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition flex items-center justify-center gap-1.5 ${
              isDark ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Browse inside <span>⊞</span>
          </button>
        )}
        <button
          onClick={onOpen}
          className="w-full px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition flex items-center justify-center gap-1.5"
        >
          Open folder <span>→</span>
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, isDark, highlight }: { label: string; value: string; isDark: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
      <span className={`text-xs font-medium ${highlight ? (isDark ? 'text-teal-400' : 'text-teal-600') : isDark ? 'text-gray-300' : 'text-gray-700'}`}>{value}</span>
    </div>
  )
}

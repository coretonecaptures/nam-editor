import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { FolderNode } from '../types/librarian'
import { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'

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

// ── Stats computation (mirrors FolderDashboard) ─────────────────────────────

const CORE_FIELDS = ['name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu'] as const

const GEAR_COLORS: Record<string, string> = {
  amp: '#f97316', amp_cab: '#3b82f6', pedal: '#22c55e',
  pedal_amp: '#eab308', amp_pedal_cab: '#a855f7', preamp: '#f43f5e', studio: '#14b8a6',
}
const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp', amp_cab: 'Amp + Cab', pedal: 'Pedal',
  pedal_amp: 'Pedal + Amp', amp_pedal_cab: 'Amp + Pedal + Cab', preamp: 'Preamp', studio: 'Studio',
}
const TONE_COLORS: Record<string, string> = {
  clean: '#0ea5e9', crunch: '#f59e0b', hi_gain: '#dc2626',
  fuzz: '#9333ea', overdrive: '#16a34a', distortion: '#f43f5e', other: '#6b7280',
}
const TONE_LABELS: Record<string, string> = {
  clean: 'Clean', crunch: 'Crunch', hi_gain: 'Hi Gain',
  fuzz: 'Fuzz', overdrive: 'Overdrive', distortion: 'Distortion', other: 'Other',
}
const PRESET_COLORS: Record<string, string> = {
  Complex: '#a855f7', Standard: '#3b82f6', Lite: '#22c55e', Feather: '#f59e0b',
  Nano: '#f97316', REVySTD: '#06b6d4', REVyHI: '#0ea5e9', REVxSTD: '#8b5cf6', Unknown: '#6b7280',
}

function getEsr(file: NamFile): number | null {
  const esr = (file.metadata.training as Record<string, unknown> | undefined)?.validation_esr
  return typeof esr === 'number' ? esr : null
}

function computeStats(files: NamFile[]) {
  const total = files.length
  const missing = files.filter((f) => CORE_FIELDS.some((field) => !f.metadata[field] && f.metadata[field] !== 0)).length

  const dupCounts = new Map<string, number>()
  for (const f of files) {
    const k = f.fileName.trim().toLowerCase()
    if (k) dupCounts.set(k, (dupCounts.get(k) ?? 0) + 1)
  }
  const duplicateGroups = [...dupCounts.values()].filter((c) => c > 1).length

  const presetCounts = new Map<string, number>()
  for (const f of files) {
    const p = detectPreset(f.config) ?? 'Unknown'
    presetCounts.set(p, (presetCounts.get(p) ?? 0) + 1)
  }
  const presets = [...presetCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  const maxPreset = Math.max(...presets.map((r) => r.count), 1)

  let esrGood = 0, esrOk = 0, esrReview = 0, esrNone = 0
  for (const f of files) {
    const esr = getEsr(f)
    if (esr == null) esrNone++
    else if (esr < 0.01) esrGood++
    else if (esr <= 0.05) esrOk++
    else esrReview++
  }

  const gearCounts = new Map<string, number>()
  for (const f of files) {
    const g = f.metadata.gear_type
    if (g) gearCounts.set(g, (gearCounts.get(g) ?? 0) + 1)
  }
  const gearRows = [...gearCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  const maxGear = Math.max(...gearRows.map((r) => r.count), 1)

  const toneCounts = new Map<string, number>()
  for (const f of files) {
    const t = f.metadata.tone_type
    if (t) toneCounts.set(t, (toneCounts.get(t) ?? 0) + 1)
  }
  const toneRows = [...toneCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  const maxTone = Math.max(...toneRows.map((r) => r.count), 1)

  return { total, missing, duplicateGroups, presets, maxPreset, esrGood, esrOk, esrReview, esrNone, gearRows, maxGear, toneRows, maxTone }
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface CtxMenu { x: number; y: number; node: FolderNode }

// ── Main component ───────────────────────────────────────────────────────────

function buildStackToPath(root: FolderNode, targetPath: string): FolderNode[] {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const target = norm(targetPath)
  function search(node: FolderNode, path: FolderNode[]): FolderNode[] | null {
    if (norm(node.path) === target) return path
    for (const child of node.children) {
      const result = search(child, [...path, child])
      if (result) return result
    }
    return null
  }
  for (const child of root.children) {
    if (norm(child.path) === target) return [child]
    const result = search(child, [child])
    if (result) return result
  }
  return []
}

interface FolderCardViewProps {
  rootNode: FolderNode
  rootFolder: string
  files: NamFile[]
  packInfoFolders: Set<string>
  onOpenFolder: (path: string) => void
  isDark: boolean
  initialPath?: string | null
  onSearchTone3000?: (query: string, folderPath: string) => void
  rescanSignal?: number
  hidePreviewPanel?: boolean
  onRefresh?: () => void
}

export function FolderCardView({ rootNode, rootFolder, files, packInfoFolders, onOpenFolder, isDark, initialPath, onSearchTone3000, rescanSignal, hidePreviewPanel, onRefresh }: FolderCardViewProps) {
  const [stack, setStack] = useState<FolderNode[]>(() =>
    initialPath ? buildStackToPath(rootNode, initialPath) : []
  )
  const currentNode = stack.length > 0 ? stack[stack.length - 1] : rootNode
  const folders = currentNode.children

  const [covers, setCovers] = useState<Map<string, string | null>>(new Map())
  const [selected, setSelected] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [coverModal, setCoverModal] = useState<{ node: FolderNode } | null>(null)
  const [cardSize, setCardSize] = useState<'small' | 'medium' | 'large'>(() => {
    const saved = localStorage.getItem('folderCardSize')
    return (saved === 'small' || saved === 'medium' || saved === 'large') ? saved : 'medium'
  })
  const CARD_PX = cardSize === 'small' ? 180 : cardSize === 'large' ? 336 : 264
  const [previewWidth, setPreviewWidth] = useState<number>(() => {
    const saved = localStorage.getItem('folderCardPreviewWidth')
    return saved ? Math.max(260, Math.min(600, Number(saved))) : 320
  })
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(0)

  // Navigate to initialPath when it changes
  useEffect(() => {
    if (!initialPath) return
    setStack(buildStackToPath(rootNode, initialPath))
    setSelected(null)
  }, [initialPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload covers when the displayed folder changes
  useEffect(() => {
    let cancelled = false
    setCovers(new Map())
    setSelected(null)
    const load = async () => {
      for (const node of folders) {
        if (cancelled) break
        const cover = await findCoverForNode(node)
        if (!cancelled) setCovers((prev) => { const m = new Map(prev); m.set(node.path, cover); return m })
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentNode.path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rescan covers when rescanSignal changes (e.g. after a download)
  useEffect(() => {
    if (!rescanSignal) return
    let cancelled = false
    const rescan = async () => {
      for (const node of folders) {
        if (cancelled) break
        const cover = await findCoverForNode(node)
        if (!cancelled) setCovers((prev) => { const m = new Map(prev); m.set(node.path, cover); return m })
      }
    }
    void rescan()
    return () => { cancelled = true }
  }, [rescanSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // When rootNode changes (tree refresh), rebuild stack with fresh node references
  // so currentNode.children reflects the updated tree
  useEffect(() => {
    if (stack.length === 0) return
    const currentPath = stack[stack.length - 1].path
    const newStack = buildStackToPath(rootNode, currentPath)
    if (newStack.length > 0) setStack(newStack)
  }, [rootNode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scan any folders that newly appeared in the list (e.g. after a download + tree refresh)
  const foldersKey = folders.map((f) => f.path).join('|')
  useEffect(() => {
    const unscanned = folders.filter((n) => !covers.has(n.path))
    if (unscanned.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const node of unscanned) {
        if (cancelled) break
        const cover = await findCoverForNode(node)
        if (!cancelled) setCovers((prev) => { const m = new Map(prev); m.set(node.path, cover); return m })
      }
    })()
    return () => { cancelled = true }
  }, [foldersKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close) }
  }, [ctxMenu])

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    startXRef.current = e.clientX
    startWRef.current = previewWidth
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const next = Math.max(260, Math.min(600, startWRef.current - (ev.clientX - startXRef.current)))
      setPreviewWidth(next)
      localStorage.setItem('folderCardPreviewWidth', String(next))
    }
    const onUp = () => { draggingRef.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [previewWidth])

  const drillInto = (node: FolderNode) => { if (node.children.length > 0) { setStack((s) => [...s, node]); setCtxMenu(null) } }
  const navigateTo = (index: number) => { setStack((s) => index < 0 ? [] : s.slice(0, index + 1)); setSelected(null) }

  const selectedNode = selected ? folders.find((f) => f.path === selected) ?? null : null
  const selectedCover = selected ? (covers.get(selected) ?? null) : null
  const relPath = selected ? selected.replace(rootFolder, '').replace(/^[\\/]/, '') : ''

  const normalizedPath = (p: string) => p.replace(/\\/g, '/')
  const dirtyForFolder = (path: string) =>
    files.filter((f) => f.isDirty && normalizedPath(f.filePath).startsWith(normalizedPath(path) + '/')).length
  const filesForFolder = (path: string) =>
    files.filter((f) => normalizedPath(f.filePath).startsWith(normalizedPath(path) + '/'))

  const rootName = rootFolder.split(/[\\/]/).pop() ?? rootFolder

  return (
    <div className={`flex flex-col flex-1 overflow-hidden ${isDark ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'}`} onClick={() => setCtxMenu(null)}>

      {/* Breadcrumb bar */}
      <div className={`flex items-center gap-1 px-4 py-2 border-b shrink-0 text-sm ${isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-white/70'}`}>
        <button
          onClick={() => navigateTo(-1)}
          className={`flex items-center gap-1 truncate max-w-[160px] ${stack.length === 0 ? isDark ? 'text-gray-300 font-medium' : 'text-gray-700 font-medium' : isDark ? 'text-gray-500 hover:text-gray-200 hover:underline' : 'text-gray-400 hover:text-gray-700 hover:underline'}`}
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
              className={`truncate max-w-[160px] ${i === stack.length - 1 ? isDark ? 'text-gray-300 font-medium' : 'text-gray-700 font-medium' : isDark ? 'text-gray-500 hover:text-gray-200 hover:underline' : 'text-gray-400 hover:text-gray-700 hover:underline'}`}
              title={node.path}
            >{node.name}</button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Refresh button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh folder view"
              className={`p-1.5 rounded transition-colors ${isDark ? 'text-gray-500 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {/* Card size picker */}
          <div className={`flex items-center rounded-md border overflow-hidden ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            {(['small', 'medium', 'large'] as const).map((size) => {
              const active = cardSize === size
              const rects = size === 'small'
                ? [[1,1],[5,1],[1,5],[5,5],[9,1],[9,5]] // 3-col dense grid dots
                : size === 'medium'
                  ? [[1,1],[6,1],[1,6],[6,6]] // 2-col dots
                  : [[1,1],[6,1]] // 1-col dots (large)
              return (
                <button
                  key={size}
                  title={size.charAt(0).toUpperCase() + size.slice(1)}
                  onClick={() => { setCardSize(size); localStorage.setItem('folderCardSize', size) }}
                  className={`px-2 py-1.5 transition-colors ${active
                    ? isDark ? 'bg-teal-600 text-white' : 'bg-teal-500 text-white'
                    : isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <svg viewBox="0 0 12 12" className={size === 'small' ? 'w-3 h-3' : size === 'medium' ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill="currentColor">
                    {rects.map(([x, y], i) => (
                      <rect key={i} x={x} y={y} width={size === 'small' ? 3 : size === 'medium' ? 4 : 10} height={size === 'small' ? 3 : size === 'medium' ? 4 : 10} rx="0.5" />
                    ))}
                  </svg>
                </button>
              )
            })}
          </div>
          <span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            {folders.length} folder{folders.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {/* Card grid — always full width; preview panel overlays absolutely */}
        <div
          className="absolute inset-0 overflow-y-auto p-5"
          style={{ paddingRight: (!hidePreviewPanel && selected && selectedNode) ? previewWidth + 6 : undefined }}
        >
          {folders.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">No subfolders in this folder.</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_PX}px)` }}>
              {folders.map((node) => {
                const c = covers.get(node.path)
                const dirty = dirtyForFolder(node.path)
                const isSelected = selected === node.path
                return (
                  <div
                    key={node.path}
                    onClick={(e) => { e.stopPropagation(); setSelected(isSelected ? null : node.path) }}
                    onDoubleClick={() => { if (node.children.length > 0) drillInto(node) }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(node.path); setCtxMenu({ x: e.clientX, y: e.clientY, node }) }}
                    className={`rounded-xl border cursor-pointer transition-all select-none overflow-hidden ${
                      isSelected
                        ? isDark ? 'border-teal-500 ring-1 ring-teal-500/40 bg-gray-900' : 'border-teal-500 ring-1 ring-teal-500/30 bg-white'
                        : isDark ? 'border-gray-800 bg-gray-900 hover:border-gray-600' : 'border-gray-200 bg-white hover:border-gray-400'
                    }`}
                  >
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
                    <div className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-1">
                        <div className={`text-sm font-medium leading-tight truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`} title={node.name}>{node.name}</div>
                        {dirty > 0 && <span className="shrink-0 text-[10px] font-semibold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 leading-none">{dirty}✎</span>}
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

        {/* Drag handle + preview panel — absolutely positioned so grid width never changes */}
        {!hidePreviewPanel && selected && selectedNode && (
          <>
            <div
              onMouseDown={onResizeMouseDown}
              className={`absolute top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10 ${isDark ? 'bg-gray-800 hover:bg-teal-500/60 active:bg-teal-500' : 'bg-gray-200 hover:bg-teal-400/60 active:bg-teal-400'}`}
              style={{ right: previewWidth }}
            />
            <div
              className={`absolute top-0 right-0 bottom-0 flex flex-col overflow-hidden border-l ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
              style={{ width: previewWidth }}
            >
              <FolderPreviewPanel
                node={selectedNode}
                cover={selectedCover}
                relPath={relPath}
                folderFiles={filesForFolder(selectedNode.path)}
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
          <button onClick={() => { onOpenFolder(ctxMenu.node.path); setCtxMenu(null) }} className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2">
            <span>→</span> Open folder
          </button>
          {ctxMenu.node.children.length > 0 && (
            <button onClick={() => drillInto(ctxMenu.node)} className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2">
              <span>⊞</span> Browse inside
            </button>
          )}
          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
          <button onClick={() => { setCoverModal({ node: ctxMenu.node }); setCtxMenu(null) }} className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2">
            <span>🖼</span> Get cover image
          </button>
          {onSearchTone3000 && (
            <>
              <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
              <button onClick={() => { onSearchTone3000(ctxMenu.node.name, ctxMenu.node.path); setCtxMenu(null) }} className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 text-teal-700 dark:text-teal-400">
                <span>🔍</span> Find on Tone3000
              </button>
            </>
          )}
        </div>
      )}

      {/* Get Cover Image modal */}
      {coverModal && (
        <GetCoverModal
          node={coverModal.node}
          isDark={isDark}
          onClose={() => setCoverModal(null)}
          onSaved={async () => {
            setCoverModal(null)
            const fresh = await findCoverForNode(coverModal.node)
            setCovers((prev) => { const m = new Map(prev); m.set(coverModal.node.path, fresh); return m })
          }}
        />
      )}
    </div>
  )
}

// ── Get Cover Image modal ────────────────────────────────────────────────────

function GetCoverModal({ node, isDark, onClose, onSaved }: {
  node: FolderNode
  isDark: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const googleQuery = `${node.name} amp`
  const googleUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(googleQuery)}`

  const handleUrl = async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setError('Please enter an http(s) URL')
      return
    }
    setBusy(true); setError(null)
    const result = await window.api.downloadCoverFromUrl(trimmed, node.path)
    setBusy(false)
    if (result.success) onSaved()
    else setError(result.error ?? 'Unknown error')
  }

  const saveLocalFile = async (file: File) => {
    setBusy(true); setError(null)
    // Try Electron's .path property first
    const electronPath = (file as File & { path?: string }).path
    if (electronPath) {
      const result = await window.api.copyLocalCoverFile(electronPath, node.path)
      setBusy(false)
      if (result.success) onSaved()
      else setError(result.error ?? 'Unknown error')
      return
    }
    // Fallback: read as base64 and send bytes to main
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      const mimeType = file.type || 'image/jpeg'
      const result = await window.api.saveLocalCoverFromBase64(base64, mimeType, node.path)
      setBusy(false)
      if (result.success) onSaved()
      else setError(result.error ?? 'Unknown error')
    }
    reader.onerror = () => { setBusy(false); setError('Failed to read file') }
    reader.readAsDataURL(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) { await saveLocalFile(file); return }
    // Browser image drag — get URL from uri-list
    setBusy(true); setError(null)
    const uriList = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const imageUrl = uriList.split('\n').map((s) => s.trim()).find((s) => s.startsWith('http'))
    if (imageUrl) {
      const result = await window.api.downloadCoverFromUrl(imageUrl, node.path)
      setBusy(false)
      if (result.success) onSaved()
      else setError(result.error ?? 'Unknown error')
      return
    }
    setBusy(false)
    setError('Could not read a file or image URL from the dropped item')
  }

  const handleBrowse = async () => {
    const picked = await window.api.openImagePicker()
    if (!picked) return
    setBusy(true); setError(null)
    const result = await window.api.copyLocalCoverFile(picked, node.path)
    setBusy(false)
    if (result.success) onSaved()
    else setError(result.error ?? 'Unknown error')
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await saveLocalFile(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={`w-[420px] rounded-xl shadow-2xl border flex flex-col gap-4 p-5 ${isDark ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Get Cover Image</div>
            <div className={`text-xs mt-0.5 truncate max-w-[320px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{node.name}</div>
          </div>
          <button onClick={onClose} className={`text-sm leading-none ${isDark ? 'text-gray-500 hover:text-gray-200' : 'text-gray-400 hover:text-gray-700'}`}>×</button>
        </div>

        {/* Google Images button */}
        <button
          onClick={() => window.api.openExternal(googleUrl)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          Search Google Images for "{node.name}"
        </button>

        {/* Drag zone + Browse button */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${
            dragging
              ? isDark ? 'border-teal-400 bg-teal-900/20 text-teal-300' : 'border-teal-500 bg-teal-50 text-teal-700'
              : isDark ? 'border-gray-700 text-gray-500' : 'border-gray-300 text-gray-400'
          }`}
        >
          {busy ? 'Saving…' : 'Drag an image here from your browser or Explorer'}
          {!busy && (
            <div className="mt-3">
              <button
                onClick={handleBrowse}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
              >
                Browse for image…
              </button>
            </div>
          )}
        </div>

        {/* Hidden file input fallback */}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />

        {/* URL input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUrl(url) }}
            placeholder="Paste image URL…"
            className={`flex-1 text-sm px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-teal-500 ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-600' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'}`}
          />
          <button
            onClick={() => handleUrl(url)}
            disabled={busy || !url.trim()}
            className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            Use
          </button>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}

// ── Preview panel ────────────────────────────────────────────────────────────

function FolderPreviewPanel({
  node, cover, relPath, folderFiles, hasPackInfo, canDrillDown,
  onOpen, onDrillDown, onClose, isDark,
}: {
  node: FolderNode
  cover: string | null
  relPath: string
  folderFiles: NamFile[]
  hasPackInfo: boolean
  canDrillDown: boolean
  onOpen: () => void
  onDrillDown: () => void
  onClose: () => void
  isDark: boolean
}) {
  const stats = useMemo(() => computeStats(folderFiles), [folderFiles])
  const esrMaxCount = Math.max(stats.esrGood, stats.esrOk, stats.esrReview, stats.esrNone, 1)
  const esrCovered = stats.esrGood + stats.esrOk + stats.esrReview

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b shrink-0 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Folder</span>
        <button onClick={onClose} className={`text-sm leading-none transition ${isDark ? 'text-gray-500 hover:text-gray-200' : 'text-gray-400 hover:text-gray-700'}`}>×</button>
      </div>

      {/* Cover image */}
      <div className={`w-full aspect-video shrink-0 overflow-hidden ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
        {cover
          ? <img src={toFileUrl(cover)} alt={node.name} className="w-full h-full object-cover" draggable={false} />
          : <div className={`w-full h-full ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`} />
        }
      </div>

      {/* Scrollable stats body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Name + path */}
        <div>
          <div className={`font-semibold text-sm leading-tight ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{node.name}</div>
          {relPath && relPath !== node.name && (
            <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`} title={relPath}>{relPath}</div>
          )}
        </div>

        {/* Top stat boxes */}
        <div className="flex gap-2">
          <StatBox value={stats.total} label="captures" isDark={isDark} />
          <StatBox
            value={stats.duplicateGroups}
            label="duplicates"
            warn={stats.duplicateGroups > 0}
            isDark={isDark}
          />
          <StatBox
            value={stats.missing}
            label="missing meta"
            warn={stats.missing > 0}
            isDark={isDark}
          />
        </div>

        {/* Pack info badge */}
        {hasPackInfo && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span className={`text-xs ${isDark ? 'text-blue-400' : 'text-blue-500'}`}>Pack info present</span>
          </div>
        )}

        {/* Formats */}
        {stats.presets.length > 0 && (
          <div>
            <SectionLabel label="Formats" />
            {stats.presets.slice(0, 6).map((r) => (
              <BarRow key={r.key} label={r.key} count={r.count} maxCount={stats.maxPreset} color={PRESET_COLORS[r.key] ?? '#6b7280'} />
            ))}
          </div>
        )}

        {/* ESR Quality */}
        {stats.total > 0 && (
          <div>
            <SectionLabel label="ESR Quality" />
            {esrCovered === 0 ? (
              <div className={`text-xs py-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>No ESR data</div>
            ) : (
              <>
                {stats.esrGood > 0 && <BarRow label="Excellent < 0.01" count={stats.esrGood} maxCount={esrMaxCount} color="#22c55e" />}
                {stats.esrOk > 0 && <BarRow label="OK 0.01–0.05" count={stats.esrOk} maxCount={esrMaxCount} color="#f59e0b" />}
                {stats.esrReview > 0 && <BarRow label="Review > 0.05" count={stats.esrReview} maxCount={esrMaxCount} color="#dc2626" />}
              </>
            )}
            {stats.esrNone > 0 && <BarRow label="No data" count={stats.esrNone} maxCount={esrMaxCount} color="#4b5563" />}
          </div>
        )}

        {/* Gear Type */}
        {stats.gearRows.length > 0 && (
          <div>
            <SectionLabel label="Gear Type" />
            {stats.gearRows.slice(0, 5).map((r) => (
              <BarRow key={r.key} label={GEAR_LABELS[r.key] ?? r.key} count={r.count} maxCount={stats.maxGear} color={GEAR_COLORS[r.key] ?? '#6b7280'} />
            ))}
          </div>
        )}

        {/* Tone Type */}
        {stats.toneRows.length > 0 && (
          <div>
            <SectionLabel label="Tone Type" />
            {stats.toneRows.slice(0, 6).map((r) => (
              <BarRow key={r.key} label={TONE_LABELS[r.key] ?? r.key} count={r.count} maxCount={stats.maxTone} color={TONE_COLORS[r.key] ?? '#6b7280'} />
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className={`px-3 py-3 border-t shrink-0 space-y-2 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        {canDrillDown && (
          <button
            onClick={onDrillDown}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition flex items-center justify-center gap-1.5 ${isDark ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
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

// ── Shared sub-components ────────────────────────────────────────────────────

function StatBox({ value, label, isDark, warn }: { value: number; label: string; isDark: boolean; warn?: boolean }) {
  const isEmpty = value === 0
  return (
    <div className={`flex-1 rounded-xl border px-2 py-2 text-center ${isDark ? 'bg-gray-800/60 border-gray-700/40' : 'bg-gray-50 border-gray-200'}`}>
      <div className={`text-xl font-bold leading-none ${warn ? 'text-amber-400' : isEmpty ? isDark ? 'text-gray-500' : 'text-gray-400' : isDark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
      <div className={`text-[9px] mt-1 leading-tight ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{label}</div>
    </div>
  )
}

function BarRow({ label, count, maxCount, color }: { label: string; count: number; maxCount: number; color: string }) {
  const pct = maxCount > 0 ? count / maxCount : 0
  return (
    <div className="flex items-center gap-2 min-h-[24px]">
      <span className="text-[9px] leading-none shrink-0" style={{ color }}>●</span>
      <div className="flex-1 relative rounded overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(pct * 100, 6)}%`, backgroundColor: color + '2e' }} />
        <span className="relative block px-1.5 py-0.5 text-[10px] font-semibold truncate" style={{ color, opacity: 0.9 }}>{label}</span>
      </div>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 w-6 text-right flex-shrink-0 tabular-nums">{count}</span>
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-600 pt-1 pb-0.5">{label}</div>
}

import { useState, useCallback, useEffect, useRef } from 'react'
import beakerTransparent from './assets/images/beaker.only.transparent.png'
import { NamFile, TONE_TYPES, GEAR_TYPES } from './types/nam'
import { AppSettings, loadSettings, saveSettings } from './types/settings'
import { loadLayout, saveLayout } from './types/layout'
import { LibrarianState } from './types/librarian'
import { FileList, ALL_GRID_COLUMNS, doExportCSV, doExportXLSX } from './components/FileList'
import { MetadataEditor } from './components/MetadataEditor'
import { Toolbar } from './components/Toolbar'
import { BatchEditor, BatchApplyOptions } from './components/BatchEditor'
import { MultiSelectEditor } from './components/MultiSelectEditor'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { FolderTree } from './components/FolderTree'
import { DuplicatesModal } from './components/DuplicatesModal'
import { ImportMetadataModal, ImportMatch } from './components/ImportMetadataModal'
import { FolderGallery, FolderImagesData } from './components/FolderGallery'
import { PackInfoEditor } from './components/PackInfoEditor'
import * as XLSX from 'xlsx'
import { FolderNode } from './types/librarian'

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openFolder: (defaultPath?: string) => Promise<string | null>
      openImportFile: () => Promise<string | null>
      openImageFile: () => Promise<string | null>
      readFileBinary: (filePath: string) => Promise<{ data?: string; error?: string }>
      revealFile: (filePath: string) => Promise<void>
      openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      readFile: (filePath: string) => Promise<{
        success: boolean
        error?: string
        filePath?: string
        version?: string
        metadata?: NamFile['metadata']
        architecture?: string
        config?: unknown
      }>
      writeMetadata: (filePath: string, metadata: unknown) => Promise<{ success: boolean; error?: string }>
      moveFile: (sourcePath: string, destDir: string, force?: boolean) => Promise<{ success: boolean; error?: string; destPath?: string }>
      scanFolder: (folderPath: string, hiddenFolders?: string) => Promise<{ success: boolean; error?: string; files?: string[] }>
      scanTree: (folderPath: string, hiddenFolders?: string) => Promise<{ success: boolean; error?: string; tree?: FolderNode }>
      getErrorLogPath: () => Promise<string>
      getStartupLogPath: () => Promise<string>
      refocusWindow: () => Promise<void>
      statPath: (p: string) => Promise<{ isDirectory: boolean }>
      getPathForFile: (file: File) => string
      renameFile: (oldPath: string, newBaseName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      watchFolder: (path: string | null) => Promise<void>
      onFolderChanged: (cb: () => void) => () => void
      createFolder: (parentPath: string, name: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      renameFolder: (folderPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      moveFolder: (sourcePath: string, destParentPath: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      trashFiles: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; error?: string }[]>
      copyFiles: (filePaths: string[], destDir: string) => Promise<{ filePath: string; success: boolean; destPath?: string; error?: string }[]>
      clearNamLab: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; error?: string }[]>
      getPendingFiles: () => Promise<string[]>
      onOpenFiles: (cb: (paths: string[]) => void) => () => void
      checkForUpdates: (includeRc: boolean) => Promise<{ hasUpdate?: boolean; latestVersion?: string; releaseUrl?: string; error?: string }>
      openExternal: (url: string) => Promise<void>
      detectNamPlayer: () => Promise<boolean>
      browseExecutable: () => Promise<string | null>
      openInNam: (filePath: string, standalonePath: string) => Promise<{ success: boolean; error?: string }>
      scanImages: (folderPath: string) => Promise<{ success: boolean; images: string[] }>
      findPackOwner: (folderPath: string, rootPath: string) => Promise<string | null>
      findPackFolders: (rootPath: string) => Promise<string[]>
      readPackInfo: (folderPath: string) => Promise<{ success: boolean; data: unknown }>
      writePackInfo: (folderPath: string, data: unknown) => Promise<{ success: boolean; error?: string }>
      exportPackSheet: (html: string) => Promise<{ success: boolean; error?: string }>
      platform: string
    }
  }
}


function applyDefaults(meta: NamFile['metadata'], baseName: string, settings: AppSettings): NamFile['metadata'] {
  const m = { ...meta }

  // Name from filename
  if (!m.name && settings.populateNameFromFilename)
    m.name = baseName

  // Capture Defaults section
  if (settings.enableCaptureDefaults) {
    if (!m.modeled_by && settings.defaultModeledBy)
      m.modeled_by = settings.defaultModeledBy

    if (m.input_level_dbu == null && settings.defaultInputLevel !== '') {
      const n = parseFloat(settings.defaultInputLevel)
      if (!isNaN(n)) m.input_level_dbu = n
    }

    if (m.output_level_dbu == null && settings.defaultOutputLevel !== '') {
      const n = parseFloat(settings.defaultOutputLevel)
      if (!isNaN(n)) m.output_level_dbu = n
    }
  }

  // Current Amp Info section
  if (settings.enableAmpInfo) {
    if (!m.gear_make && settings.defaultManufacturer)
      m.gear_make = settings.defaultManufacturer
    if (!m.gear_model && settings.defaultModel)
      m.gear_model = settings.defaultModel
  }

  // Auto gear type from filename suffix
  if (!m.gear_type) {
    const nameUpper = baseName.replace(/\s+/g, '').toUpperCase()
    const ampSuffixes = settings.ampSuffix.split(',').map((s) => s.trim().replace(/\s+/g, '').toUpperCase()).filter(Boolean)
    if (ampSuffixes.some((s) => nameUpper.endsWith(s))) m.gear_type = 'amp'
    else if (settings.defaultToCab) m.gear_type = 'amp_cab'
    // else: leave blank
  }

  // Auto tone type from filename keywords (rightmost keyword wins)
  if (!m.tone_type && settings.autoDetectToneType) {
    const detected = detectToneType(baseName)
    if (detected) m.tone_type = detected
  }

  return m
}

// Keywords that map to each tone type — order within each array doesn't matter,
// detection picks the keyword that appears latest in the filename (rightmost wins)
const TONE_KEYWORDS: Record<typeof TONE_TYPES[number], string[]> = {
  'clean':      ['clean'],
  'crunch':     ['crunch'],
  'hi_gain':    ['highgain', 'hi-gain', 'higain', 'high-gain'],
  'fuzz':       ['fuzz'],
  'overdrive':  ['overdrive', 'od', 'edge', 'drive'],
  'distortion': ['distortion', 'dist'],
  'other':      [],
}

function detectToneType(baseName: string): typeof TONE_TYPES[number] | null {
  const lower = baseName.replace(/\s+/g, '').toLowerCase()
  let best: { tone: typeof TONE_TYPES[number]; index: number } | null = null
  for (const [tone, keywords] of Object.entries(TONE_KEYWORDS) as [typeof TONE_TYPES[number], string[]][]) {
    for (const kw of keywords) {
      const idx = lower.lastIndexOf(kw)
      if (idx !== -1 && (best === null || idx > best.index)) {
        best = { tone, index: idx }
      }
    }
  }
  return best ? best.tone : null
}


const EMPTY_LIBRARIAN: LibrarianState = {
  rootFolder: null,
  folderTree: null,
  selectedFolder: null
}

export default function App() {
  const [files, setFiles] = useState<NamFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error'; logPath?: string }>({
    message: 'Open .nam files or a folder to get started',
    type: 'info'
  })
  const [batchFolder, setBatchFolder] = useState<{ path: string | null; name: string; filePaths?: string[] } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [namPlayerDetected, setNamPlayerDetected] = useState(false)
  const [librarian, setLibrarian] = useState<LibrarianState>(EMPTY_LIBRARIAN)
  const [libraryFilter, setLibraryFilter] = useState<Set<string> | null>(null)
  const initialLayout = loadLayout()
  const initialSettings = loadSettings()
  const [treeWidth, setTreeWidth] = useState(initialLayout.treeWidth)
  const [listViewMode, setListViewMode] = useState<'list' | 'grid'>(initialSettings.defaultView ?? 'list')
  const [listWidth, setListWidth] = useState(() => {
    const raw = (initialSettings.defaultView ?? 'list') === 'grid' ? initialLayout.listWidthGrid : initialLayout.listWidthList
    const maxList = window.innerWidth - initialLayout.treeWidth - 300
    return Math.min(raw, Math.max(140, maxList))
  })
  const draggingRef = useRef<null | { panel: 'tree' | 'list'; startX: number; startWidth: number }>(null)
  const mainContentRef = useRef<HTMLDivElement>(null)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [gridMaximized, setGridMaximized] = useState(false)
  const [gridSlideOpen, setGridSlideOpen] = useState(false)
  const [treeScrollTarget, setTreeScrollTarget] = useState<string | null>(null)
  const treeScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [folderChanged, setFolderChanged] = useState(false)
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [metadataClipboard, setMetadataClipboard] = useState<{ sourceName: string; metadata: Partial<NamFile['metadata']> } | null>(null)
  const [importModal, setImportModal] = useState<{ folderName: string; exactMatches: ImportMatch[]; prefixMatches: ImportMatch[]; unmatchedNames: string[] } | null>(null)
  const [watcherKey, setWatcherKey] = useState(0)
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('nam-lab-recent-folders')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  const [folderImages, setFolderImages] = useState<FolderImagesData>(null)
  const [folderPanelTab, setFolderPanelTab] = useState<'pack' | 'gallery'>('pack')
  // Path of the ancestor that owns the pack info for the current folder (null = current folder may own one)
  const [packInfoAncestor, setPackInfoAncestor] = useState<string | null>(null)
  // Set of folder paths that have a valid nam-pack.json (non-empty title) — drives blue dot in tree
  const [packInfoFolders, setPackInfoFolders] = useState<Set<string>>(new Set())

  // Reset folder panel tab and check for pack-owning ancestor when selected folder changes
  useEffect(() => {
    setFolderPanelTab('pack')
    const sf = librarian.selectedFolder
    const rf = librarian.rootFolder
    if (!sf || !rf || sf === rf) {
      setPackInfoAncestor(null)
      return
    }
    let cancelled = false
    window.api.findPackOwner(sf, rf).then((owner) => {
      if (!cancelled) setPackInfoAncestor(owner)
    })
    return () => { cancelled = true }
  }, [librarian.selectedFolder, librarian.rootFolder])

  // Scan all pack-info folders when root folder changes (drives blue dot in tree)
  useEffect(() => {
    const rf = librarian.rootFolder
    if (!rf) {
      setPackInfoFolders(new Set())
      return
    }
    let cancelled = false
    window.api.findPackFolders(rf).then((paths) => {
      if (!cancelled) setPackInfoFolders(new Set(paths))
    })
    return () => { cancelled = true }
  }, [librarian.rootFolder])

  // Scan folder images when selected folder changes (only when feature is enabled)
  useEffect(() => {
    const sf = librarian.selectedFolder
    const rf = librarian.rootFolder
    if (!settings.showFolderImages) {
      setFolderImages(null)
      return
    }
    // When no subfolder is selected, scan the root folder itself
    const targetFolder = sf ?? rf
    if (!targetFolder) {
      setFolderImages(null)
      return
    }
    let cancelled = false
    const norm = (p: string) => p.replace(/\\/g, '/')
    const scan = async () => {
      const ownResult = await window.api.scanImages(targetFolder)
      if (cancelled) return
      const own = ownResult.success ? ownResult.images : []
      const inherited: { folderName: string; paths: string[] }[] = []
      // Only walk ancestors when a specific subfolder is selected (not root).
      // Stop BEFORE reaching root so root-level images don't cascade into every subfolder.
      if (sf && rf && norm(sf) !== norm(rf)) {
        let current = norm(sf)
        const normRoot = norm(rf)
        while (true) {
          const lastSlash = current.lastIndexOf('/')
          if (lastSlash <= 0) break
          const parent = current.substring(0, lastSlash)
          if (!parent.startsWith(normRoot) || parent.length < normRoot.length) break
          if (parent === normRoot) break  // stop before root — root images only show at root
          const parentResult = await window.api.scanImages(parent)
          if (cancelled) return
          if (parentResult.success && parentResult.images.length > 0) {
            const folderName = parent.substring(parent.lastIndexOf('/') + 1)
            inherited.push({ folderName, paths: parentResult.images })
          }
          current = parent
        }
      }
      setFolderImages({ own, inherited })
    }
    scan()
    return () => { cancelled = true }
  }, [librarian.selectedFolder, librarian.rootFolder, settings.showFolderImages])

  // Apply dark/light class to <html> whenever theme setting changes
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [settings.theme])

  // Watch folder for new .nam files when watchFolder setting is on.
  // watcherKey increments after each refresh so the effect re-runs even when rootFolder stays the same.
  useEffect(() => {
    if (settings.watchFolder && librarian.rootFolder) {
      window.api.watchFolder(librarian.rootFolder)
    } else {
      window.api.watchFolder(null)
    }
  }, [librarian.rootFolder, settings.watchFolder, watcherKey])

  // Subscribe to folder:changed IPC event
  useEffect(() => {
    const unsub = window.api.onFolderChanged(() => setFolderChanged(true))
    return unsub
  }, [])


  // Electron on Windows loses keyboard focus when the focused DOM element is removed
  // (e.g. BatchEditor unmounts) or after native confirm dialogs close. Chromium's
  // internal focus state gets stale. Fix: DOM focus as first attempt, then a blur→focus
  // cycle in main process which resets OS-level keyboard routing (same as Alt+Tab).
  useEffect(() => {
    mainContentRef.current?.focus()
  }, [showSettings, batchFolder])

  const onDragStart = (panel: 'tree' | 'list', e: React.MouseEvent) => {
    e.preventDefault()
    const startWidth = panel === 'tree' ? treeWidth : listWidth
    draggingRef.current = { panel, startX: e.clientX, startWidth }
    let latestTree = treeWidth
    let latestList = listWidth
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = ev.clientX - draggingRef.current.startX
      if (draggingRef.current.panel === 'tree') {
        const next = Math.max(140, draggingRef.current.startWidth + delta)
        setTreeWidth(next); latestTree = next
      } else {
        const maxList = window.innerWidth - treeWidth - 300
        const next = Math.min(Math.max(140, draggingRef.current.startWidth + delta), maxList)
        setListWidth(next); latestList = next
      }
    }
    const onUp = () => {
      draggingRef.current = null
      // Persist layout — save per-mode list width
      saveLayout({
        treeWidth: latestTree,
        listWidthList: listViewMode === 'list' ? latestList : loadLayout().listWidthList,
        listWidthGrid: listViewMode === 'grid' ? latestList : loadLayout().listWidthGrid,
      })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleSaveSettings = (updated: AppSettings) => {
    setSettings(updated)
    saveSettings(updated)
    // If default view changed, switch the current view immediately
    if (updated.defaultView !== settings.defaultView) {
      setListViewMode(updated.defaultView)
      setListWidth(updated.defaultView === 'grid' ? loadLayout().listWidthGrid : loadLayout().listWidthList)
    }
  }

  // Called by PackInfoEditor after saving — updates the blue-dot set in the tree
  const handlePackSaved = (folderPath: string, hasData: boolean) => {
    setPackInfoFolders((prev) => {
      const next = new Set(prev)
      if (hasData) next.add(folderPath)
      else next.delete(folderPath)
      return next
    })
  }

  // Auto-load default folder on startup (moved below loadFolderByPath — see combined startup effect)

  // mode='replace': clear existing, load fresh (open folder/files)
  // mode='append': dedup against current files (drag & drop)
  const loadFiles = useCallback(async (paths: string[], mode: 'replace' | 'append' = 'append') => {
    setStatus({ message: `Loading ${paths.length} file(s)...`, type: 'info' })
    const results = await Promise.all(paths.map((p) => window.api.readFile(p)))

    const loaded: NamFile[] = []
    let errors = 0
    for (const r of results) {
      if (r.success && r.filePath && r.metadata !== undefined) {
        const fileName = r.filePath.replace(/\\/g, '/').split('/').pop() ?? r.filePath
        const baseName = fileName.replace(/\.nam$/i, '')
        const rawMeta = r.metadata ?? {}
        // Sanitize unrecognized values into working copy only — originalMetadata
        // keeps the raw value so isDirty fires and the file surfaces for fixing
        const workingMeta: NamFile['metadata'] = { ...rawMeta }
        // Normalize numeric fields written as strings by a prior import bug — causes isDirty=true so Save All heals the file
        if (typeof workingMeta.input_level_dbu === 'string') workingMeta.input_level_dbu = parseFloat(workingMeta.input_level_dbu as unknown as string)
        if (typeof workingMeta.output_level_dbu === 'string') workingMeta.output_level_dbu = parseFloat(workingMeta.output_level_dbu as unknown as string)
        if (workingMeta.tone_type && !(TONE_TYPES as readonly string[]).includes(workingMeta.tone_type)) {
          workingMeta.tone_type = null
        }
        if (workingMeta.gear_type && !(GEAR_TYPES as readonly string[]).includes(workingMeta.gear_type)) {
          workingMeta.gear_type = null
        }
        const meta = applyDefaults(workingMeta, baseName, settings)
        const wasChanged = JSON.stringify(meta) !== JSON.stringify(rawMeta)
        // Track which fields were set by applyDefaults (weren't in workingMeta before)
        const autoFilledFields = (Object.keys(meta) as (keyof NamFile['metadata'])[]).filter(
          (k) => meta[k] != null && (workingMeta[k] == null || workingMeta[k] === '')
        )
        loaded.push({
          filePath: r.filePath,
          fileName: baseName,
          version: r.version ?? '?',
          metadata: meta,
          originalMetadata: rawMeta,
          autoFilledFields,
          architecture: r.architecture ?? '?',
          config: r.config,
          isDirty: wasChanged
        })
      } else {
        errors++
      }
    }

    // Dedup inside functional update so prev is always current (fixes stale closure bug)
    setFiles((prev) => {
      if (mode === 'replace') return loaded
      const existing = new Set(prev.map((f) => f.filePath))
      return [...prev, ...loaded.filter((f) => !existing.has(f.filePath))]
    })

    // Auto-select first file when replacing, or when nothing is selected on append
    setSelectedIds((prev) => {
      if (loaded.length === 0) return prev
      if (mode === 'replace') return new Set([loaded[0].filePath])
      if (prev.size === 0) return new Set([loaded[0].filePath])
      return prev
    })

    if (errors > 0) {
      const logPath = await window.api.getErrorLogPath()
      setStatus({
        message: `Loaded ${loaded.length} file(s) — ${errors} could not be parsed (skipped)`,
        type: 'error',
        logPath
      })
    } else {
      setStatus({ message: `Loaded ${loaded.length} file(s)`, type: 'success' })
    }
  }, [settings]) // no longer depends on files or selectedIds

  // Shared logic for opening a folder by path (used by Open Folder and Refresh)
  const loadFolderByPath = useCallback(async (folder: string) => {
    setStatus({ message: 'Scanning folder...', type: 'info' })
    setFolderChanged(false)
    // Stop watcher during reload so the scan itself doesn't re-trigger the banner
    window.api.watchFolder(null)
    // Save as default folder if rememberLastFolder is on
    setSettings((prev) => {
      if (!prev.rememberLastFolder) return prev
      const updated = { ...prev, defaultFolder: folder.replace(/\\/g, '/'), enableDefaultFolder: true }
      saveSettings(updated)
      return updated
    })
    const hiddenFolders = settings.hiddenFolders ?? ''
    const [flatResult, treeResult] = await Promise.all([
      window.api.scanFolder(folder, hiddenFolders),
      window.api.scanTree(folder, hiddenFolders)
    ])
    if (!flatResult.success) {
      setStatus({ message: `Error: ${flatResult.error}`, type: 'error' })
      return
    }
    if (!flatResult.files || flatResult.files.length === 0) {
      setStatus({ message: 'No .nam files found in that folder', type: 'info' })
      return
    }
    const normalizedFolder = folder.replace(/\\/g, '/')
    setLibrarian({
      rootFolder: normalizedFolder,
      folderTree: treeResult.success && treeResult.tree ? treeResult.tree : null,
      selectedFolder: null
    })
    // Track recent folders
    setRecentFolders((prev) => {
      const next = [normalizedFolder, ...prev.filter((f) => f !== normalizedFolder)].slice(0, 10)
      localStorage.setItem('nam-lab-recent-folders', JSON.stringify(next))
      return next
    })
    await loadFiles(flatResult.files, 'replace')
    // Bump watcherKey to restart the folder watcher now that the scan is done
    setWatcherKey((k) => k + 1)
  }, [loadFiles, settings])

  // Subscribe to app:openFiles — for files opened while app is already running
  useEffect(() => {
    const unsub = window.api.onOpenFiles((paths) => loadFiles(paths, 'append'))
    return unsub
  }, [loadFiles])

  // Detect NAM standalone once on mount
  useEffect(() => {
    window.api.detectNamPlayer().then(setNamPlayerDetected)
  }, [])

  // Combined startup effect: pending files take priority over default folder
  // Must be placed after loadFiles and loadFolderByPath are defined
  useEffect(() => {
    window.api.getPendingFiles().then((paths) => {
      if (paths.length > 0) {
        // File was opened via double-click / file association — load just those files
        loadFiles(paths, 'replace')
      } else if (settings.enableDefaultFolder && settings.defaultFolder) {
        // No pending files — restore last folder as normal
        loadFolderByPath(settings.defaultFolder)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — runs once on mount after React is ready

  // Returns false if user cancels, true if safe to proceed
  const confirmDiscardChanges = (): boolean => {
    const dirty = files.filter((f) => f.isDirty)
    if (dirty.length === 0) return true
    return window.confirm(
      `You have unsaved changes in ${dirty.length} file${dirty.length !== 1 ? 's' : ''}.\n\nDiscard changes and continue?`
    )
  }

  const handleCloseAll = () => {
    if (!confirmDiscardChanges()) return
    setFiles([])
    setSelectedIds(new Set())
    setBatchFolder(null)
    setShowSettings(false)
    setLibrarian(EMPTY_LIBRARIAN)
    setStatus({ message: 'Open .nam files or a folder to get started', type: 'info' })
    // Don't reopen on next launch — user explicitly closed
    setSettings((prev) => {
      const updated = { ...prev, enableDefaultFolder: false }
      saveSettings(updated)
      return updated
    })
  }

  const handleOpenFiles = async () => {
    if (!confirmDiscardChanges()) return
    const paths = await window.api.openFiles()
    if (paths.length === 0) return
    setLibrarian(EMPTY_LIBRARIAN)
    await loadFiles(paths, 'replace')
  }

  const handleOpenFolder = async () => {
    if (!confirmDiscardChanges()) return
    const folder = await window.api.openFolder()
    if (!folder) return
    await loadFolderByPath(folder)
  }

  const handleRefresh = async () => {
    if (!librarian.rootFolder) return
    if (!confirmDiscardChanges()) return
    await loadFolderByPath(librarian.rootFolder)
  }

  // OS drag/drop — use React synthetic onDrop on the root div (works in Electron;
  // native document-level listeners do NOT receive OS file drops in Electron 41+).
  // Guard against intra-app drags (application/x-nam-files) which are handled by FolderTree.
  const handleOsDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('application/x-nam-files')) return // intra-app drag, ignore

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    const namFiles: string[] = []
    const candidates: string[] = []

    for (const file of droppedFiles) {
      const p = window.api.getPathForFile(file)
      if (!p) continue
      if (file.name.toLowerCase().endsWith('.nam')) {
        namFiles.push(p)
      } else {
        candidates.push(p)
      }
    }

    // Check candidates via IPC to see if they are directories
    const folders: string[] = []
    for (const p of candidates) {
      const result = await window.api.statPath(p)
      if (result.isDirectory) folders.push(p)
    }

    if (folders.length === 0 && namFiles.length === 0) return

    if (folders.length > 0) {
      const dirty = files.filter((f) => f.isDirty)
      if (dirty.length > 0 && !window.confirm(`You have unsaved changes in ${dirty.length} file${dirty.length !== 1 ? 's' : ''}.\n\nDiscard changes and continue?`)) return
      await loadFolderByPath(folders[0])
    } else {
      await loadFiles(namFiles, files.length === 0 ? 'replace' : 'append')
    }
  }

  const handleMetadataChange = (filePath: string, updated: NamFile['metadata']) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath) return f
        // Remove field from autoFilledFields when user manually edits it
        const autoFilledFields = f.autoFilledFields.filter(
          (k) => updated[k] === f.metadata[k]
        )
        return { ...f, metadata: updated, isDirty: true, autoFilledFields }
      })
    )
  }

  const handleSave = async (filePath: string) => {
    const file = files.find((f) => f.filePath === filePath)
    if (!file) return
    const result = await window.api.writeMetadata(filePath, file.metadata)
    if (result.success) {
      setFiles((prev) => prev.map((f) =>
        f.filePath === filePath
          ? { ...f, isDirty: false, originalMetadata: { ...f.metadata }, autoFilledFields: [] }
          : f
      ))
      setStatus({ message: `Saved: ${file.fileName}`, type: 'success' })
    } else {
      setStatus({ message: `Save failed: ${result.error}`, type: 'error' })
    }
  }

  const handleSaveAndAdvance = async (filePath: string) => {
    await handleSave(filePath)
    // Use same visibility logic as visibleFiles (folder filter only — no FileList internal filters)
    const currentVisible = files.filter((f) => {
      const norm = f.filePath.replace(/\\/g, '/')
      if (librarian.selectedFolder && !norm.startsWith(librarian.selectedFolder + '/')) return false
      return true
    })
    const idx = currentVisible.findIndex((f) => f.filePath === filePath)
    if (idx !== -1 && idx < currentVisible.length - 1) {
      setSelectedIds(new Set([currentVisible[idx + 1].filePath]))
    }
  }

  const handleSelectAllInFolder = (folderPath: string | null) => {
    const prefix = folderPath ? folderPath + '/' : null
    const paths = files
      .filter((f) => {
        const norm = f.filePath.replace(/\\/g, '/')
        return prefix ? norm.startsWith(prefix) : true
      })
      .map((f) => f.filePath)
    setSelectedIds(new Set(paths))
    if (folderPath) setLibrarian((prev) => ({ ...prev, selectedFolder: folderPath }))
  }

  const handleSaveAll = async () => {
    const dirty = files.filter((f) => f.isDirty)
    if (dirty.length === 0) {
      setStatus({ message: 'No unsaved changes', type: 'info' })
      return
    }
    {
      const autoFillCount = dirty.filter((f) => f.autoFilledFields.length > 0).length
      const autoFillNote = autoFillCount > 0
        ? `\n\n⚠️ ${autoFillCount} file${autoFillCount !== 1 ? 's have' : ' has'} auto-filled fields (from Settings defaults) that will also be written.`
        : ''
      if (!settings.skipSaveAllConfirmation) {
        const confirmed = window.confirm(
          `⚠️ Save ALL changes across every loaded folder?\n\nThis will write ${dirty.length} file${dirty.length !== 1 ? 's' : ''} to disk — including files in all subfolders. This cannot be undone.${autoFillNote}\n\n(This warning can be toggled off in Settings → Behavior)`
        )
        if (!confirmed) return
      }
    }
    setStatus({ message: `Saving ${dirty.length} file(s)...`, type: 'info' })
    const savedPaths = new Set<string>()
    let failed = 0
    for (const f of dirty) {
      const result = await window.api.writeMetadata(f.filePath, f.metadata)
      if (result.success) savedPaths.add(f.filePath)
      else failed++
    }
    setFiles((prev) => prev.map((f) =>
      savedPaths.has(f.filePath)
        ? { ...f, isDirty: false, originalMetadata: { ...f.metadata }, autoFilledFields: [] }
        : f
    ))
    if (failed > 0) {
      setStatus({ message: `Saved ${savedPaths.size}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Saved ${savedPaths.size} file(s)`, type: 'success' })
    }
  }

  const handleRemoveFile = (filePath: string) => {
    setFiles((prev) => prev.filter((f) => f.filePath !== filePath))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(filePath)
      return next
    })
  }

  const handleBatchApply = async (batchFields: Partial<NamFile['metadata']>, options?: BatchApplyOptions) => {
    const folderPath = batchFolder?.path ?? null
    const batchPaths = batchFolder?.filePaths

    let targets: NamFile[]
    if (batchPaths) {
      const pathSet = new Set(batchPaths)
      targets = files.filter((f) => pathSet.has(f.filePath))
    } else {
      targets = folderPath === null
        ? files
        : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(folderPath + '/'))
    }

    // For each target:
    //   toWrite  = originalMetadata + batch fields only (what gets saved to disk)
    //   newMeta  = current working metadata with batch fields applied (keeps auto-fills)
    //   newOriginal = toWrite (reflects new on-disk state)
    //   isDirty  = newMeta still differs from newOriginal (auto-fills remain pending)
    const prepared = targets.map((f) => {
      const toWrite = { ...f.originalMetadata }
      const newMeta = { ...f.metadata }
      if (options?.revertToFilename) {
        const nameFromFile = f.fileName.replace(/\.nam$/i, '')
        ;(toWrite as Record<string, unknown>)['name'] = nameFromFile
        ;(newMeta as Record<string, unknown>)['name'] = nameFromFile
      }
      for (const [k, v] of Object.entries(batchFields)) {
        const val = v === '' ? null : v
        ;(toWrite as Record<string, unknown>)[k] = val
        ;(newMeta as Record<string, unknown>)[k] = val
      }
      const newIsDirty = JSON.stringify(newMeta) !== JSON.stringify(toWrite)
      return { filePath: f.filePath, toWrite, newMeta, newOriginal: toWrite, newIsDirty }
    })

    setBatchFolder(null)
    setStatus({ message: `Saving ${prepared.length} file(s)...`, type: 'info' })

    const savedPaths = new Set<string>()
    let failed = 0
    for (const p of prepared) {
      const result = await window.api.writeMetadata(p.filePath, p.toWrite)
      if (result.success) savedPaths.add(p.filePath)
      else failed++
    }

    // Fields that were actually written by this batch edit
    const savedBatchKeys = new Set(Object.keys(batchFields) as (keyof NamFile['metadata'])[])
    const resultMap = new Map(prepared.map((p) => [p.filePath, p]))
    setFiles((prev) => prev.map((f) => {
      if (!savedPaths.has(f.filePath)) return f
      const p = resultMap.get(f.filePath)!
      // Remove batch-saved fields from autoFilledFields always
      const autoFilledFields = f.autoFilledFields.filter((k) => !savedBatchKeys.has(k))
      return { ...f, metadata: p.newMeta, originalMetadata: p.newOriginal, isDirty: p.newIsDirty, autoFilledFields }
    }))

    if (failed > 0) {
      setStatus({ message: `Batch saved ${savedPaths.size}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Batch saved ${savedPaths.size} file(s)`, type: 'success' })
    }
  }

  const handleMultiSelectApply = async (
    filePaths: string[],
    fields: Partial<NamFile['metadata']>,
    options?: { revertToFilename?: boolean }
  ) => {
    const pathSet = new Set(filePaths)
    const targets = files.filter((f) => pathSet.has(f.filePath))

    const prepared = targets.map((f) => {
      const toWrite = { ...f.originalMetadata }
      const newMeta = { ...f.metadata }
      if (options?.revertToFilename) {
        const nameFromFile = f.fileName.replace(/\.nam$/i, '')
        ;(toWrite as Record<string, unknown>)['name'] = nameFromFile
        ;(newMeta as Record<string, unknown>)['name'] = nameFromFile
      }
      for (const [k, v] of Object.entries(fields)) {
        const val = v === '' ? null : v
        ;(toWrite as Record<string, unknown>)[k] = val
        ;(newMeta as Record<string, unknown>)[k] = val
      }
      const newIsDirty = JSON.stringify(newMeta) !== JSON.stringify(toWrite)
      return { filePath: f.filePath, toWrite, newMeta, newOriginal: toWrite, newIsDirty }
    })

    setStatus({ message: `Saving ${prepared.length} file(s)...`, type: 'info' })

    const savedPaths = new Set<string>()
    let failed = 0
    for (const p of prepared) {
      const result = await window.api.writeMetadata(p.filePath, p.toWrite)
      if (result.success) savedPaths.add(p.filePath)
      else failed++
    }

    const resultMap = new Map(prepared.map((p) => [p.filePath, p]))
    setFiles((prev) => prev.map((f) => {
      if (!savedPaths.has(f.filePath)) return f
      const p = resultMap.get(f.filePath)!
      return { ...f, metadata: p.newMeta, originalMetadata: p.newOriginal, isDirty: p.newIsDirty, autoFilledFields: p.newIsDirty ? f.autoFilledFields : [] }
    }))

    if (failed > 0) {
      setStatus({ message: `Saved ${savedPaths.size}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Saved ${savedPaths.size} file(s)`, type: 'success' })
    }
  }

  const handleFileDrop = async (filePaths: string[], destFolderPath: string) => {
    // Warn if any dragged files have unsaved changes
    const dirty = files.filter((f) => filePaths.includes(f.filePath) && f.isDirty)
    if (dirty.length > 0) {
      const confirmed = window.confirm(
        `${dirty.length} file${dirty.length > 1 ? 's have' : ' has'} unsaved changes that will be lost. Move anyway?`
      )
      if (!confirmed) return
    }

    // Attempt to move all files
    const results = await Promise.all(filePaths.map((fp) => window.api.moveFile(fp, destFolderPath)))

    const moved: { oldPath: string; newPath: string }[] = []
    let existsCount = 0
    let failCount = 0
    results.forEach((r, i) => {
      if (r.success && r.destPath) moved.push({ oldPath: filePaths[i], newPath: r.destPath })
      else if (r.error === 'exists') existsCount++
      else failCount++
    })

    if (existsCount > 0) {
      window.confirm(
        `${existsCount} file${existsCount > 1 ? 's' : ''} already exist in the destination and were skipped.`
      )
      window.api.refocusWindow()
    }

    if (moved.length === 0) return

    // Update files state — repath moved files, clear dirty flag
    const movedMap = new Map(moved.map((m) => [m.oldPath, m.newPath]))
    setFiles((prev) =>
      prev.map((f) => {
        const newPath = movedMap.get(f.filePath)
        if (!newPath) return f
        return { ...f, filePath: newPath, isDirty: false, autoFilledFields: [] }
      })
    )

    // Rescan folder tree to update counts
    if (librarian.rootFolder) {
      const treeResult = await window.api.scanTree(librarian.rootFolder, settings.hiddenFolders ?? '')
      if (treeResult.success && treeResult.tree) {
        setLibrarian((prev) => ({ ...prev, folderTree: treeResult.tree! }))
      }
    }

    // Switch selected folder to destination
    setLibrarian((prev) => ({ ...prev, selectedFolder: destFolderPath }))
    setSelectedIds(new Set())

    const msg = failCount > 0
      ? `Moved ${moved.length}, failed ${failCount}${existsCount > 0 ? `, skipped ${existsCount}` : ''}`
      : `Moved ${moved.length} file${moved.length > 1 ? 's' : ''} to ${destFolderPath.split('/').pop()}`
    setStatus({ message: msg, type: failCount > 0 ? 'error' : 'success' })
  }

  const handleNameFromFilename = () => {
    setFiles((prev) =>
      prev.map((f) =>
        !f.metadata.name
          ? { ...f, metadata: { ...f.metadata, name: f.fileName }, isDirty: true }
          : f
      )
    )
  }

  const handleRenameFile = async (filePath: string, newBaseName: string) => {
    const result = await window.api.renameFile(filePath, newBaseName)
    if (result.success && result.newPath) {
      setFiles((prev) => prev.map((f) =>
        f.filePath === filePath
          ? { ...f, filePath: result.newPath!, fileName: newBaseName }
          : f
      ))
      setSelectedIds((prev) => {
        if (!prev.has(filePath)) return prev
        const next = new Set(prev)
        next.delete(filePath)
        next.add(result.newPath!)
        return next
      })
      setStatus({ message: `Renamed to: ${newBaseName}.nam`, type: 'success' })
    } else {
      setStatus({ message: `Rename failed: ${result.error}`, type: 'error' })
    }
  }

  const handleBatchRename = async (renames: { filePath: string; newBaseName: string }[], renameFiles: boolean) => {
    const renameMap = new Map(renames.map((r) => [r.filePath, r.newBaseName]))
    // Keys that factor into isDirty so we can recalculate after a partial save
    const dirtyKeys: (keyof NamMetadata)[] = [
      'name', 'modeled_by', 'gear_type', 'gear_make', 'gear_model',
      'tone_type', 'input_level_dbu', 'output_level_dbu', 'nb_trained_epochs',
      'nl_mics', 'nl_cabinet', 'nl_cabinet_config', 'nl_amp_channel',
      'nl_boost_pedal', 'nl_amp_settings', 'nl_pedal_settings', 'nl_amp_switches', 'nl_comments'
    ]

    const saved = new Map<string, { newBaseName: string; newPath: string }>()
    let failed = 0

    for (const { filePath, newBaseName } of renames) {
      const file = files.find((f) => f.filePath === filePath)
      if (!file) continue

      let targetPath = filePath
      if (renameFiles) {
        const renameResult = await window.api.renameFile(filePath, newBaseName)
        if (!renameResult.success || !renameResult.newPath) { failed++; continue }
        targetPath = renameResult.newPath
      }

      // Write updated name to disk (surgical patch of the name field only)
      const writeResult = await window.api.writeMetadata(targetPath, { ...file.metadata, name: newBaseName })
      if (writeResult.success) {
        saved.set(filePath, { newBaseName, newPath: targetPath })
      } else {
        failed++
      }
    }

    if (saved.size > 0) {
      setFiles((prev) => prev.map((f) => {
        const s = saved.get(f.filePath)
        if (!s) return f
        const updatedMetadata = { ...f.metadata, name: s.newBaseName }
        const updatedOriginal = { ...f.originalMetadata, name: s.newBaseName }
        const isDirty = dirtyKeys.some((k) => updatedMetadata[k] !== updatedOriginal[k])
        return {
          ...f,
          filePath: s.newPath,
          fileName: renameFiles ? s.newBaseName : f.fileName,
          metadata: updatedMetadata,
          originalMetadata: updatedOriginal,
          isDirty,
          autoFilledFields: f.autoFilledFields.filter((k) => k !== 'name')
        }
      }))
      if (renameFiles) {
        setSelectedIds((prev) => {
          const next = new Set<string>()
          for (const id of prev) {
            next.add(saved.get(id)?.newPath ?? id)
          }
          return next
        })
      }

      const n = saved.size
      const msg = renameFiles
        ? `Renamed ${n} file${n !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}`
        : `Updated ${n} capture name${n !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}`
      setStatus({ message: msg, type: failed > 0 ? 'error' : 'success' })
      return
    }

    if (failed > 0) {
      setStatus({ message: `Rename failed (${failed} error${failed !== 1 ? 's' : ''})`, type: 'error' })
    }

  }

  const handleCreateFolder = async (parentPath: string, name: string) => {
    const result = await window.api.createFolder(parentPath, name)
    if (result.success) {
      if (librarian.rootFolder) await loadFolderByPath(librarian.rootFolder)
      setStatus({ message: `Created folder: ${name}`, type: 'success' })
    } else {
      setStatus({ message: `Create failed: ${result.error}`, type: 'error' })
    }
    return result
  }

  const handleRenameFolder = async (folderPath: string, newName: string) => {
    const result = await window.api.renameFolder(folderPath, newName)
    if (result.success && result.newPath) {
      const oldPrefix = folderPath.replace(/\\/g, '/') + '/'
      const newPrefix = result.newPath + '/'
      // Update all file paths under the renamed folder
      setFiles((prev) => prev.map((f) => {
        const norm = f.filePath.replace(/\\/g, '/')
        if (!norm.startsWith(oldPrefix)) return f
        const newFilePath = newPrefix + norm.slice(oldPrefix.length)
        return { ...f, filePath: newFilePath }
      }))
      setSelectedIds((prev) => {
        const next = new Set<string>()
        for (const id of prev) {
          const norm = id.replace(/\\/g, '/')
          next.add(norm.startsWith(oldPrefix) ? newPrefix + norm.slice(oldPrefix.length) : id)
        }
        return next
      })
      // Rescan tree
      if (librarian.rootFolder) await loadFolderByPath(librarian.rootFolder)
      setStatus({ message: `Folder renamed to: ${newName}`, type: 'success' })
    }
    return result
  }

  const handleMoveFolder = async (sourcePath: string, destParentPath: string) => {
    const result = await window.api.moveFolder(sourcePath, destParentPath)
    if (result.success && result.newPath) {
      const oldPrefix = sourcePath.replace(/\\/g, '/') + '/'
      const newPrefix = result.newPath + '/'
      setFiles((prev) => prev.map((f) => {
        const norm = f.filePath.replace(/\\/g, '/')
        if (!norm.startsWith(oldPrefix)) return f
        return { ...f, filePath: newPrefix + norm.slice(oldPrefix.length) }
      }))
      setSelectedIds((prev) => {
        const next = new Set<string>()
        for (const id of prev) {
          const norm = id.replace(/\\/g, '/')
          next.add(norm.startsWith(oldPrefix) ? newPrefix + norm.slice(oldPrefix.length) : id)
        }
        return next
      })
      if (librarian.rootFolder) await loadFolderByPath(librarian.rootFolder)
      setStatus({ message: `Folder moved`, type: 'success' })
    } else {
      setStatus({ message: `Move failed: ${result.error}`, type: 'error' })
    }
    return result
  }

  const handleTrashFiles = async (paths: string[]) => {
    const fileNames = paths.map((p) => p.replace(/\\/g, '/').split('/').pop()).join('\n')
    const confirmed = window.confirm(
      `Move ${paths.length} file${paths.length !== 1 ? 's' : ''} to trash?\n\n${fileNames}\n\nThis can be recovered from the trash.`
    )
    if (!confirmed) return
    const results = await window.api.trashFiles(paths)
    const trashed = results.filter((r) => r.success).map((r) => r.filePath)
    const failed = results.filter((r) => !r.success).length
    if (trashed.length > 0) {
      const trashedSet = new Set(trashed)
      setFiles((prev) => prev.filter((f) => !trashedSet.has(f.filePath)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const p of trashed) next.delete(p)
        return next
      })
    }
    if (failed > 0) {
      setStatus({ message: `Trashed ${trashed.length}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Moved ${trashed.length} file${trashed.length !== 1 ? 's' : ''} to trash`, type: 'success' })
    }
  }

  const handleClearNamLab = async (paths: string[]) => {
    const confirmed = window.confirm(
      `Remove NAM Lab Custom Metadata from ${paths.length} file${paths.length !== 1 ? 's' : ''}?\n\nThis will permanently delete the custom capture details (mics, amp settings, comments, etc.) from the file${paths.length !== 1 ? 's' : ''} on disk.`
    )
    if (!confirmed) return
    const results = await window.api.clearNamLab(paths)
    const cleared = results.filter((r) => r.success).map((r) => r.filePath)
    const failed = results.filter((r) => !r.success).length
    if (cleared.length > 0) {
      const clearedSet = new Set(cleared)
      const nlKeys: (keyof NamFile['metadata'])[] = [
        'nl_mics', 'nl_amp_channel', 'nl_cabinet', 'nl_cabinet_config',
        'nl_amp_settings', 'nl_boost_pedal', 'nl_pedal_settings', 'nl_amp_switches', 'nl_comments',
      ]
      setFiles((prev) => prev.map((f) => {
        if (!clearedSet.has(f.filePath)) return f
        const newMeta = { ...f.metadata }
        for (const k of nlKeys) delete newMeta[k]
        const newOrig = { ...f.originalMetadata }
        for (const k of nlKeys) delete newOrig[k]
        return { ...f, metadata: newMeta, originalMetadata: newOrig, isDirty: false }
      }))
    }
    if (failed > 0) {
      setStatus({ message: `Cleared ${cleared.length}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Removed NAM Lab metadata from ${cleared.length} file${cleared.length !== 1 ? 's' : ''}`, type: 'success' })
    }
  }

  const handleMoveToFolder = async (paths: string[]) => {
    const lastMove = localStorage.getItem('nam-lab-last-folder-move') ?? undefined
    const destFolder = await window.api.openFolder(lastMove)
    if (!destFolder) return
    localStorage.setItem('nam-lab-last-folder-move', destFolder)
    const destName = destFolder.replace(/\\/g, '/').split('/').pop()
    const movedPaths = new Set<string>()
    const conflictPaths: string[] = []
    let failed = 0

    // First pass — move non-conflicting files
    for (const p of paths) {
      const result = await window.api.moveFile(p, destFolder)
      if (result.success) movedPaths.add(p)
      else if (result.error === 'exists') conflictPaths.push(p)
      else failed++
    }

    // If conflicts, ask user
    if (conflictPaths.length > 0) {
      const names = conflictPaths.map((p) => p.replace(/\\/g, '/').split('/').pop()).join('\n')
      const overwrite = confirm(
        `${conflictPaths.length} file${conflictPaths.length !== 1 ? 's' : ''} already exist in "${destName}":\n\n${names}\n\nOverwrite?`
      )
      if (overwrite) {
        for (const p of conflictPaths) {
          const result = await window.api.moveFile(p, destFolder, true)
          if (result.success) movedPaths.add(p)
          else failed++
        }
      }
    }

    if (movedPaths.size > 0) {
      setFiles((prev) => prev.filter((f) => !movedPaths.has(f.filePath)))
    }
    const skipped = conflictPaths.length - conflictPaths.filter((p) => movedPaths.has(p)).length
    if (failed > 0) {
      setStatus({ message: `Moved ${movedPaths.size}, failed ${failed}`, type: 'error' })
    } else if (skipped > 0) {
      setStatus({ message: `Moved ${movedPaths.size} file${movedPaths.size !== 1 ? 's' : ''} to ${destName} — ${skipped} skipped (already exist)`, type: 'info' })
    } else {
      setStatus({ message: `Moved ${movedPaths.size} file${movedPaths.size !== 1 ? 's' : ''} to ${destName}`, type: 'success' })
    }
  }

  const handleShowInFolderTree = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/')
    const folderPath = normalized.split('/').slice(0, -1).join('/')
    if (treeScrollTimerRef.current) clearTimeout(treeScrollTimerRef.current)
    setTreeScrollTarget(folderPath)
    treeScrollTimerRef.current = setTimeout(() => setTreeScrollTarget(null), 5000)
  }

  const handleCopyToFolder = async (paths: string[]) => {
    const lastCopy = localStorage.getItem('nam-lab-last-folder-copy') ?? undefined
    const destFolder = await window.api.openFolder(lastCopy)
    if (!destFolder) return
    localStorage.setItem('nam-lab-last-folder-copy', destFolder)
    const results = await window.api.copyFiles(paths, destFolder)
    const copied = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    if (failed > 0) {
      setStatus({ message: `Copied ${copied}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Copied ${copied} file${copied !== 1 ? 's' : ''} to ${destFolder.split('/').pop()}`, type: 'success' })
    }
  }

  const handleApplyDefaultsToSelection = (paths: string[]) => {
    const pathSet = new Set(paths)
    setFiles((prev) => prev.map((f) => {
      if (!pathSet.has(f.filePath)) return f
      const baseName = f.fileName.replace(/\.nam$/i, '')
      const newMeta = applyDefaults({ ...f.metadata }, baseName, settings)
      const newAutoFilled = (Object.keys(newMeta) as (keyof NamFile['metadata'])[]).filter(
        (k) => newMeta[k] != null && (f.metadata[k] == null || f.metadata[k] === '') && !f.autoFilledFields.includes(k)
      )
      const wasChanged = JSON.stringify(newMeta) !== JSON.stringify(f.originalMetadata)
      return { ...f, metadata: newMeta, isDirty: wasChanged, autoFilledFields: [...f.autoFilledFields, ...newAutoFilled] }
    }))
    setStatus({ message: `Applied defaults to ${paths.length} file${paths.length !== 1 ? 's' : ''}`, type: 'success' })
  }

  // Fields that make sense to copy — editable metadata only, no read-only stats
  const COPYABLE_FIELDS: (keyof NamFile['metadata'])[] = [
    'modeled_by', 'gear_type', 'gear_make', 'gear_model', 'tone_type',
    'input_level_dbu', 'output_level_dbu', 'nb_trained_epochs',
    'nl_mics', 'nl_amp_channel', 'nl_cabinet', 'nl_cabinet_config',
    'nl_amp_settings', 'nl_boost_pedal', 'nl_pedal_settings', 'nl_amp_switches', 'nl_comments',
  ]

  const handleCopyMetadata = (filePath: string) => {
    const file = files.find((f) => f.filePath === filePath)
    if (!file) return
    const meta: Partial<NamFile['metadata']> = {}
    for (const k of COPYABLE_FIELDS) {
      if (file.metadata[k] != null) (meta as Record<string, unknown>)[k] = file.metadata[k]
    }
    setMetadataClipboard({ sourceName: file.metadata.name || file.fileName, metadata: meta })
    setStatus({ message: `Copied metadata from: ${file.metadata.name || file.fileName}`, type: 'info' })
  }

  const handlePasteMetadata = async (targetPaths: string[]) => {
    if (!metadataClipboard) return
    const { sourceName, metadata } = metadataClipboard

    // Build preview of non-empty fields being pasted
    const fieldLabels: Record<string, string> = {
      name: 'Capture Name', modeled_by: 'Modeled By', gear_type: 'Gear Type',
      gear_make: 'Manufacturer', gear_model: 'Model', tone_type: 'Tone Type',
      input_level_dbu: 'Input (dBu)', output_level_dbu: 'Output (dBu)', nb_trained_epochs: 'Trained Epochs',
      nl_mics: 'Mics', nl_amp_channel: 'Amp Channel', nl_cabinet: 'Cabinet',
      nl_cabinet_config: 'Cabinet Config', nl_amp_settings: 'Amp Settings',
      nl_boost_pedal: 'Boost Pedal(s)', nl_pedal_settings: 'Pedal Settings',
      nl_amp_switches: 'Amp Switches', nl_comments: 'Comments',
    }
    const fieldSummary = Object.entries(metadata)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${fieldLabels[k] ?? k}: ${v}`)
      .join('\n  ')

    const confirmed = window.confirm(
      `Paste metadata from "${sourceName}" to ${targetPaths.length} file${targetPaths.length !== 1 ? 's' : ''}?\n\n  ${fieldSummary}\n\nThis will overwrite those fields in the target file${targetPaths.length !== 1 ? 's' : ''}.`
    )
    if (!confirmed) return
    await handleMultiSelectApply(targetPaths, metadata)
  }

  const handleExportFolder = (folderPath: string | null, format: 'csv' | 'xlsx') => {
    const targets = folderPath === null
      ? files
      : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(folderPath + '/'))
    const folderName = folderPath ? folderPath.split('/').pop() : (librarian.rootFolder ? librarian.rootFolder.split('/').pop() : 'export')
    const filename = `nam-export-${folderName}`
    if (format === 'csv') doExportCSV(targets, ALL_GRID_COLUMNS, filename)
    else doExportXLSX(targets, ALL_GRID_COLUMNS, filename)
  }

  // Column definition for import/export template — editable fields only, in user-preferred order
  const IMPORT_COLUMNS: { header: string; field: keyof NamFile['metadata'] | null }[] = [
    { header: 'Capture Name',       field: 'name' },
    { header: 'Modeled By',         field: 'modeled_by' },
    { header: 'Manufacturer',       field: 'gear_make' },
    { header: 'Model',              field: 'gear_model' },
    { header: 'Gear Type',          field: 'gear_type' },
    { header: 'Tone Type',          field: 'tone_type' },
    { header: 'Amp Channel',        field: 'nl_amp_channel' },
    { header: 'Amp Settings',       field: 'nl_amp_settings' },
    { header: 'Amp Switches',       field: 'nl_amp_switches' },
    { header: 'Boost Pedal(s)',      field: 'nl_boost_pedal' },
    { header: 'Pedal Settings',     field: 'nl_pedal_settings' },
    { header: 'Cabinet',            field: 'nl_cabinet' },
    { header: 'Cab Config',         field: 'nl_cabinet_config' },
    { header: 'Reamp Send (dBu)',   field: 'input_level_dbu' },
    { header: 'Reamp Return (dBu)', field: 'output_level_dbu' },
    { header: 'Trained Epochs',     field: 'nb_trained_epochs' },
    { header: 'NAM-BOT Preset',     field: null }, // read-only — shown in template, skipped on import
    { header: 'Mic(s)',             field: 'nl_mics' },
    { header: 'Comments',           field: 'nl_comments' },
  ]

  const handleGenerateTemplate = (folderPath: string | null) => {
    const targets = folderPath === null
      ? files
      : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(folderPath.replace(/\\/g, '/') + '/') || f.filePath.replace(/\\/g, '/') === folderPath.replace(/\\/g, '/'))
    const rows = targets.map((f) => {
      const row: Record<string, unknown> = {}
      for (const col of IMPORT_COLUMNS) {
        if (col.field === null) {
          // NAM-BOT Preset is read-only
          row[col.header] = f.metadata.nb_preset_name ?? ''
        } else {
          const val = f.metadata[col.field]
          row[col.header] = val != null ? val : ''
        }
      }
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows, { header: IMPORT_COLUMNS.map((c) => c.header) })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Import Template')
    const folderName = folderPath ? folderPath.replace(/\\/g, '/').split('/').pop() : (librarian.rootFolder ? librarian.rootFolder.replace(/\\/g, '/').split('/').pop() : 'library')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `nam-import-template-${folderName}.xlsx`; a.click()
    URL.revokeObjectURL(url)
    setStatus({ message: `Template generated with ${rows.length} capture${rows.length !== 1 ? 's' : ''}`, type: 'success' })
  }

  const handleImportMetadata = async (folderPath: string | null) => {
    const filePath = await window.api.openImportFile()
    if (!filePath) return

    // Parse the spreadsheet
    let rows: Record<string, unknown>[]
    try {
      const binary = await window.api.readFileBinary(filePath)
      if (binary.error || !binary.data) { setStatus({ message: `Could not read file: ${binary.error}`, type: 'error' }); return }
      const wb = XLSX.read(binary.data, { type: 'base64' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    } catch (err) {
      setStatus({ message: `Failed to parse spreadsheet: ${String(err)}`, type: 'error' })
      return
    }

    // Build lookup: name (lowercase) → NamFile[], scoped to folderPath.
    // Stores arrays to handle multiple files sharing the same capture name (different subfolders).
    const scopedFiles = folderPath === null
      ? files
      : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(folderPath.replace(/\\/g, '/') + '/'))
    const nameToFiles = new Map<string, NamFile[]>()
    for (const f of scopedFiles) {
      const key = (f.metadata.name || f.fileName || '').toLowerCase().trim()
      if (key) {
        const arr = nameToFiles.get(key) ?? []
        arr.push(f)
        nameToFiles.set(key, arr)
      }
    }

    // Fields skipped for prefix (variant-specific) matches — nl_ cabinet/mic fields vary
    // per variant. gear_type is handled separately with cab-upgrade logic below.
    // tone_type is NOT skipped — it's the same across DI/cab variants of the same session.
    const PREFIX_SKIP: Set<keyof NamFile['metadata']> = new Set(['nl_cabinet', 'nl_cabinet_config', 'nl_mics'])

    // For prefix matches only: amp→amp_cab, pedal_amp→amp_pedal_cab. All other gear_types skipped.
    const CAB_UPGRADE: Record<string, string> = { amp: 'amp_cab', pedal_amp: 'amp_pedal_cab' }

    // Helper: build incoming fields from a row, optionally skipping prefix-skip fields
    const buildIncoming = (row: Record<string, unknown>, skipFields: Set<keyof NamFile['metadata']> = new Set(), isPrefix = false): Partial<NamFile['metadata']> => {
      const incoming: Partial<NamFile['metadata']> = {}
      for (const col of IMPORT_COLUMNS) {
        if (!col.field) continue
        if (col.field === 'name') continue
        if (skipFields.has(col.field)) continue
        const val = row[col.header]
        if (val === '' || val == null) continue
        const strVal = String(val).trim()
        if (strVal === '') continue
        if (col.field === 'gear_type') {
          if (isPrefix) {
            // Prefix match: upgrade amp→amp_cab / pedal_amp→amp_pedal_cab; skip everything else
            const upgraded = CAB_UPGRADE[strVal]
            if (upgraded) (incoming as Record<string, unknown>)[col.field] = upgraded
            continue
          }
          // Exact match: validate and write as-is (no upgrade)
          if (!(GEAR_TYPES as readonly string[]).includes(strVal)) continue
        }
        if (col.field === 'tone_type' && !(TONE_TYPES as readonly string[]).includes(strVal)) continue
        const isNumericField = col.field === 'input_level_dbu' || col.field === 'output_level_dbu' || col.field === 'nb_trained_epochs'
        ;(incoming as Record<string, unknown>)[col.field] = isNumericField ? Number(strVal) : strVal
      }
      return incoming
    }

    // Pass 1: exact matches — all files sharing a name get claimed; track which have explicit gear_type
    const exactMatches: ImportMatch[] = []
    const exactMatchedPaths = new Set<string>()
    const exactGearTypePaths = new Set<string>()  // files where exact row explicitly set gear_type
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const matchedFiles = nameToFiles.get(captureName.toLowerCase())
      if (!matchedFiles || matchedFiles.length === 0) continue
      for (const file of matchedFiles) {
        // Always mark exact-matched — prevents prefix from a different row overriding it
        exactMatchedPaths.add(file.filePath)
        const incoming = buildIncoming(row)
        if ('gear_type' in incoming) exactGearTypePaths.add(file.filePath)
        if (Object.keys(incoming).length > 0) {
          exactMatches.push({ file, incoming })
        }
      }
    }

    // Pass 2: prefix matches — only for files WITHOUT an exact match row
    const prefixSuffixSet = new Set(
      (settings.importPrefixSuffixes || 'DI')
        .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    )
    const prefixMatches: ImportMatch[] = []
    const prefixMatchedPaths = new Set<string>()
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const words = captureName.trim().split(/\s+/)
      if (words.length < 2) continue
      const lastWord = words[words.length - 1].toUpperCase()
      if (!prefixSuffixSet.has(lastWord)) continue  // only strip known suffixes
      const prefix = words.slice(0, -1).join(' ').toLowerCase()
      for (const f of scopedFiles) {
        const fName = (f.metadata.name || f.fileName || '').toLowerCase().trim()
        if (!fName.startsWith(prefix)) continue
        if (exactMatchedPaths.has(f.filePath)) continue  // file has its own exact row
        if (prefixMatchedPaths.has(f.filePath)) continue
        const incoming = buildIncoming(row, PREFIX_SKIP, true)
        if (Object.keys(incoming).length > 0) {
          prefixMatches.push({ file: f, incoming })
          prefixMatchedPaths.add(f.filePath)
        }
      }
    }

    // Pass 3: supplement gear_type for exact-matched files whose Excel row had no gear_type.
    // These files are blocked from prefix matching above, but should still inherit
    // the CAB_UPGRADE gear_type from a matching DI row (e.g. "BE100 Mars" has its own row
    // with tone_type set but no gear_type → "BE100 DI" row contributes amp_cab).
    const pathToFile = new Map(scopedFiles.map(f => [f.filePath, f]))
    const exactMatchByPath = new Map(exactMatches.map(m => [m.file.filePath, m]))
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const words = captureName.split(/\s+/)
      if (words.length < 2) continue
      const lastWord = words[words.length - 1].toUpperCase()
      if (!prefixSuffixSet.has(lastWord)) continue
      const rowGearType = String(row['Gear Type'] ?? '').trim()
      if (!rowGearType) continue
      const upgraded = CAB_UPGRADE[rowGearType]
      if (!upgraded) continue
      const prefix = words.slice(0, -1).join(' ').toLowerCase()
      for (const filePath of exactMatchedPaths) {
        if (exactGearTypePaths.has(filePath)) continue  // already has gear_type from exact row
        const f = pathToFile.get(filePath)
        if (!f) continue
        const fName = (f.metadata.name || f.fileName || '').toLowerCase().trim()
        if (!fName.startsWith(prefix)) continue
        // Supplement this file's incoming with the upgraded gear_type
        const existingMatch = exactMatchByPath.get(filePath)
        if (existingMatch) {
          existingMatch.incoming.gear_type = upgraded
        } else {
          const newMatch: ImportMatch = { file: f, incoming: { gear_type: upgraded } }
          exactMatches.push(newMatch)
          exactMatchByPath.set(filePath, newMatch)
        }
        exactGearTypePaths.add(filePath)  // prevent double-supplement from another DI row
      }
    }

    // Unmatched: rows with no exact match and no prefix match
    const unmatchedNames: string[] = []
    const allMatchedNames = new Set([
      ...exactMatches.map(m => (m.file.metadata.name || m.file.fileName || '').toLowerCase()),
      ...rows.filter(row => {
        const n = String(row['Capture Name'] ?? '').trim().toLowerCase()
        return exactMatches.some(m => (m.file.metadata.name || m.file.fileName || '').toLowerCase() === n)
      }).map(row => String(row['Capture Name'] ?? '').trim().toLowerCase())
    ])
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const hasExact = (nameToFiles.get(captureName.toLowerCase()) ?? []).length > 0
      if (hasExact) continue
      // Check if this row produced any prefix matches
      const words = captureName.trim().split(/\s+/)
      const lastWord = words.length >= 2 ? words[words.length - 1].toUpperCase() : ''
      const prefix = lastWord && prefixSuffixSet.has(lastWord)
        ? words.slice(0, -1).join(' ').toLowerCase() : ''
      const hasPrefixMatch = prefix ? scopedFiles.some(f => {
        const fName = (f.metadata.name || f.fileName || '').toLowerCase().trim()
        return fName.startsWith(prefix) && !exactMatchedPaths.has(f.filePath)
      }) : false
      if (!hasPrefixMatch) unmatchedNames.push(captureName)
    }

    if (exactMatches.length === 0 && prefixMatches.length === 0) {
      setStatus({ message: 'No matching captures found in spreadsheet', type: 'error' })
      return
    }

    const folderName = folderPath ? folderPath.replace(/\\/g, '/').split('/').pop()! : (librarian.rootFolder ? librarian.rootFolder.replace(/\\/g, '/').split('/').pop()! : 'library')
    setImportModal({ folderName, exactMatches, prefixMatches, unmatchedNames })
  }

  const handleImportConfirm = async (matches: ImportMatch[]) => {
    const unmatched = importModal?.unmatchedNames.length ?? 0
    setImportModal(null)
    let updated = 0; let failed = 0
    const successMap = new Map<string, NamFile['metadata']>()
    for (const { file, incoming } of matches) {
      const newMeta = { ...file.metadata, ...incoming }
      const result = await window.api.writeMetadata(file.filePath, newMeta)
      if ((result as { success: boolean }).success) {
        updated++
        successMap.set(file.filePath, newMeta)
      } else { failed++ }
    }
    if (successMap.size > 0) {
      setFiles((prev) => prev.map((f) => {
        const newMeta = successMap.get(f.filePath)
        return newMeta ? { ...f, metadata: newMeta, originalMetadata: newMeta, isDirty: false, autoFilledFields: [] } : f
      }))
    }
    let msg = `Imported metadata for ${updated} capture${updated !== 1 ? 's' : ''}`
    if (failed > 0) msg += `, ${failed} failed`
    if (unmatched > 0) msg += ` · ${unmatched} unmatched`
    setStatus({ message: msg, type: failed > 0 ? 'error' : 'success' })
  }

  const handleMoveDuplicates = async (moves: { filePath: string; destName: string }[]) => {
    if (!librarian.rootFolder) return
    // Create _Duplicates folder (ignore error if already exists)
    await window.api.createFolder(librarian.rootFolder, '_Duplicates')
    const destDir = librarian.rootFolder + '/_Duplicates'

    // Move each file; if destName differs from original basename, rename after move via the rename API
    const movedPairs: { oldPath: string; newPath: string }[] = []
    let failed = 0
    for (const { filePath, destName } of moves) {
      const result = await window.api.moveFile(filePath, destDir)
      if (!result.success || !result.destPath) { failed++; continue }
      // If the destName differs from the basename, rename it
      const movedPath = result.destPath
      const currentBaseName = movedPath.replace(/\\/g, '/').split('/').pop() ?? ''
      const targetBaseName = destName.replace(/\.nam$/i, '')
      if (currentBaseName.replace(/\.nam$/i, '') !== targetBaseName) {
        const renameResult = await window.api.renameFile(movedPath, targetBaseName)
        if (renameResult.success && renameResult.newPath) {
          movedPairs.push({ oldPath: filePath, newPath: renameResult.newPath })
        } else {
          movedPairs.push({ oldPath: filePath, newPath: movedPath })
        }
      } else {
        movedPairs.push({ oldPath: filePath, newPath: movedPath })
      }
    }

    if (movedPairs.length > 0) {
      const movedMap = new Map(movedPairs.map((m) => [m.oldPath, m.newPath]))
      setFiles((prev) => prev.map((f) => {
        const newPath = movedMap.get(f.filePath)
        if (!newPath) return f
        const newBaseName = newPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.nam$/i, '') ?? f.fileName
        return { ...f, filePath: newPath, fileName: newBaseName, isDirty: false, autoFilledFields: [] }
      }))
      // _Duplicates is hardcoded-hidden in scan, so no need to rescan tree
    }
    if (failed > 0) {
      setStatus({ message: `Moved ${movedPairs.length} to _Duplicates, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Moved ${movedPairs.length} duplicate${movedPairs.length !== 1 ? 's' : ''} to _Duplicates`, type: 'success' })
    }
  }

  const handleTrashDuplicates = async (filePaths: string[]) => {
    // Confirmation is handled inside DuplicatesModal per-group; just execute
    const results = await window.api.trashFiles(filePaths)
    const trashed = results.filter((r) => r.success).map((r) => r.filePath)
    if (trashed.length > 0) {
      const trashedSet = new Set(trashed)
      setFiles((prev) => prev.filter((f) => !trashedSet.has(f.filePath)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const p of trashed) next.delete(p)
        return next
      })
    }
    const failed = filePaths.length - trashed.length
    if (failed > 0) {
      setStatus({ message: `Trashed ${trashed.length}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Trashed ${trashed.length} duplicate${trashed.length !== 1 ? 's' : ''}`, type: 'success' })
    }
  }

  // Filter files by selected folder and/or library search filter
  const visibleFiles = files.filter((f) => {
    const norm = f.filePath.replace(/\\/g, '/')
    if (librarian.selectedFolder && !norm.startsWith(librarian.selectedFolder + '/')) return false
    if (libraryFilter && !libraryFilter.has(norm)) return false
    return true
  })

  const selectedFiles = visibleFiles.filter((f) => selectedIds.has(f.filePath))
  // Close slide panel if selection is empty (and no batch edit active)
  if (gridSlideOpen && selectedFiles.length === 0 && batchFolder === null) setGridSlideOpen(false)
  const dirtyCount = files.filter((f) => f.isDirty).length
  const unnamedCount = files.filter((f) => !f.metadata.name).length
  const hasTree = librarian.folderTree !== null
  const dirtyPaths = new Set(files.filter((f) => f.isDirty).map((f) => f.filePath.replace(/\\/g, '/')))

  const GEAR_MAKE_SEED = ['Marshall', 'Fender', 'Mesa Boogie', 'Bogner', 'Friedman', 'Dumble', 'Vox', 'Orange', 'Peavey', 'EVH', 'Carr', 'Two-Rock', 'Matchless', 'Bad Cat', 'Soldano', 'Dr. Z', 'Diezel', 'Morgan', 'Egnater', 'Suhr', 'Koch', 'Victory', 'Laney', 'Hiwatt', 'Engl', 'Rivera', 'Tone King', 'Divided by 13', 'Cornford', 'Komet', 'PRS', 'Kemper']
  const gearMakeSuggestions = Array.from(new Set([
    ...GEAR_MAKE_SEED,
    ...files.map((f) => f.metadata.gear_make).filter((v): v is string => !!v)
  ])).sort()
  const gearModelSuggestions = Array.from(new Set(
    files.map((f) => f.metadata.gear_model).filter((v): v is string => !!v)
  )).sort()

  return (
    <div
      className="flex flex-col h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden"
      onDrop={handleOsDrop}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDragEnter={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
    >
      <Toolbar
        onOpenFiles={handleOpenFiles}
        onOpenFolder={handleOpenFolder}
        onSaveAll={handleSaveAll}
        dirtyCount={dirtyCount}
        fileCount={files.length}
        isMac={window.api.platform === 'darwin'}
        showSettings={showSettings}
        onToggleSettings={() => { setShowSettings((s) => !s); setBatchFolder(null); if (gridMaximized) setGridSlideOpen(true) }}
        unnamedCount={unnamedCount}
        onNameFromFilename={handleNameFromFilename}
        onCloseAll={handleCloseAll}
        rootFolder={librarian.rootFolder}
        onRefresh={handleRefresh}
        recentFolders={recentFolders}
        onOpenRecentFolder={(path) => loadFolderByPath(path)}
        onFindDuplicates={files.length > 1 ? () => setShowDuplicates(true) : undefined}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Folder tree — only shown when a folder is open */}
        {hasTree && (
          <>
            <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: (treeCollapsed || gridMaximized) ? 0 : treeWidth, overflow: 'hidden' }}>
              <FolderTree
                tree={librarian.folderTree!}
                files={files}
                selectedFolder={librarian.selectedFolder}
                dirtyPaths={dirtyPaths}
                onFilterChange={(matching) => setLibraryFilter(matching)}
                onSelect={(path) => {
                  setLibrarian((prev) => ({ ...prev, selectedFolder: path }))
                  setSelectedIds(new Set())
                }}
                onSaveFolder={async (path) => {
                  const targets = path === null
                    ? files.filter((f) => f.isDirty)
                    : files.filter((f) => f.isDirty && f.filePath.replace(/\\/g, '/').startsWith(path + '/'))
                  if (targets.length === 0) return
                  if (!settings.skipSaveAllConfirmation) {
                    const confirmed = window.confirm(`Save changes to ${targets.length} file${targets.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.\n\n(This warning can be toggled off in Settings → Behavior)`)
                    if (!confirmed) return
                  }
                  const savedPaths = new Set<string>()
                  let failed = 0
                  for (const f of targets) {
                    const result = await window.api.writeMetadata(f.filePath, f.metadata)
                    if (result.success) savedPaths.add(f.filePath)
                    else failed++
                  }
                  setFiles((prev) => prev.map((f) =>
                    savedPaths.has(f.filePath)
                      ? { ...f, isDirty: false, originalMetadata: { ...f.metadata }, autoFilledFields: [] }
                      : f
                  ))
                  if (failed > 0) {
                    setStatus({ message: `Saved ${savedPaths.size}, failed ${failed}`, type: 'error' })
                  } else {
                    setStatus({ message: `Saved ${savedPaths.size} file(s)`, type: 'success' })
                  }
                }}
                onRevertFolder={(path) => {
                  const targets = path === null
                    ? files.filter((f) => f.isDirty)
                    : files.filter((f) => f.isDirty && f.filePath.replace(/\\/g, '/').startsWith(path + '/'))
                  if (targets.length === 0) return
                  if (!window.confirm(`Revert ${targets.length} unsaved file${targets.length !== 1 ? 's' : ''} in this folder?\n\nAll unsaved changes will be lost.`)) return
                  setFiles((prev) => prev.map((f) =>
                    targets.some((t) => t.filePath === f.filePath)
                      ? { ...f, metadata: { ...f.originalMetadata }, isDirty: false }
                      : f
                  ))
                  setStatus({ message: `Reverted ${targets.length} file(s)`, type: 'info' })
                }}
                onRevealFolder={(path) => window.api.revealFile(path)}
                onDropFiles={handleFileDrop}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onMoveFolder={handleMoveFolder}
                onBatchEdit={(path, name) => {
                  setShowSettings(false)
                  const sel = [...selectedIds]
                  if (sel.length > 0) {
                    setBatchFolder({
                      path: null,
                      name: `${sel.length} selected file${sel.length !== 1 ? 's' : ''}`,
                      filePaths: sel
                    })
                  } else {
                    setBatchFolder({ path, name })
                  }
                }}
                onExportFolder={handleExportFolder}
                onGenerateTemplate={handleGenerateTemplate}
                onImportMetadata={handleImportMetadata}
                onSelectAllInFolder={handleSelectAllInFolder}
                scrollToFolder={treeScrollTarget}
                packInfoFolders={packInfoFolders}
                folderNameColors={settings.folderNameColors}
                onSetFolderColor={(folderName, color) => {
                  const next = { ...settings.folderNameColors }
                  if (color === null) delete next[folderName]
                  else next[folderName] = color
                  handleSaveSettings({ ...settings, folderNameColors: next })
                }}
              />
            </div>
            {!gridMaximized && <DragHandle onMouseDown={(e) => onDragStart('tree', e)} onCollapse={() => setTreeCollapsed((v) => !v)} collapsed={treeCollapsed} />}
          </>
        )}

        {/* File list — only shown when files are loaded */}
        {files.length > 0 && <>
          <div className={gridMaximized ? 'flex-1 flex flex-col overflow-hidden' : 'flex-shrink-0 flex flex-col overflow-hidden'} style={gridMaximized ? undefined : { width: listCollapsed ? 0 : listWidth }}>
            <FileList
              files={visibleFiles}
              selectedIds={selectedIds}
              solidPills={settings.solidPillColors}
              draggable={!!librarian.rootFolder}
              viewMode={listViewMode}
              onViewModeChange={(mode) => {
                setListViewMode(mode)
                if (mode === 'list' && gridMaximized) { setGridMaximized(false); setGridSlideOpen(false) }
                const layout = loadLayout()
                const maxList = window.innerWidth - treeWidth - 300
                const raw = mode === 'grid' ? layout.listWidthGrid : layout.listWidthList
                setListWidth(Math.min(raw, maxList))
              }}
              onSelect={(id, multi) => {
                if (multi) {
                  setSelectedIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                } else {
                  setSelectedIds(new Set([id]))
                  setShowSettings(false)
                  setBatchFolder(null)
                }
              }}
              onSelectRange={(ids) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  for (const id of ids) next.add(id)
                  return next
                })
              }}
              onSelectAll={(filePaths) => setSelectedIds(new Set(filePaths))}
              onTrimSelection={(visiblePaths) => {
                const visibleSet = new Set(visiblePaths)
                setSelectedIds((prev) => {
                  const filtered = [...prev].filter((id) => visibleSet.has(id))
                  if (filtered.length === prev.size) return prev
                  return new Set(filtered)
                })
              }}
              onDeselectAll={() => setSelectedIds(new Set())}
              onRemove={hasTree ? undefined : handleRemoveFile}
              onBatchEditSelected={(paths) => {
                setShowSettings(false)
                setBatchFolder({
                  path: null,
                  name: `${paths.length} selected file${paths.length !== 1 ? 's' : ''}`,
                  filePaths: paths
                })
                if (gridMaximized) setGridSlideOpen(true)
              }}
              onSaveSelected={async (paths) => {
                const pathSet = new Set(paths)
                const targets = files.filter((f) => pathSet.has(f.filePath) && f.isDirty)
                if (targets.length === 0) {
                  setStatus({ message: 'No unsaved changes in selection', type: 'info' })
                  return
                }
                if (!settings.skipSaveAllConfirmation) {
                  const confirmed = window.confirm(`Save changes to ${targets.length} file${targets.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.\n\n(This warning can be toggled off in Settings → Behavior)`)
                  if (!confirmed) return
                }
                setStatus({ message: `Saving ${targets.length} file(s)...`, type: 'info' })
                const savedPaths = new Set<string>()
                let failed = 0
                for (const f of targets) {
                  const result = await window.api.writeMetadata(f.filePath, f.metadata)
                  if (result.success) savedPaths.add(f.filePath)
                  else failed++
                }
                setFiles((prev) => prev.map((f) =>
                  savedPaths.has(f.filePath)
                    ? { ...f, isDirty: false, originalMetadata: { ...f.metadata }, autoFilledFields: [] }
                    : f
                ))
                if (failed > 0) {
                  setStatus({ message: `Saved ${savedPaths.size}, failed ${failed}`, type: 'error' })
                } else {
                  setStatus({ message: `Saved ${savedPaths.size} file(s)`, type: 'success' })
                }
              }}
              onBatchRename={handleBatchRename}
              onTrashSelected={handleTrashFiles}
              onCopyToFolder={handleCopyToFolder}
              onMoveToFolder={handleMoveToFolder}
              onShowInFolderTree={handleShowInFolderTree}
              gridMaximized={gridMaximized}
              onToggleGridMaximize={() => setGridMaximized((v) => { if (v) { setGridSlideOpen(false); setBatchFolder(null) } return !v })}
              onOpenEditor={() => setGridSlideOpen(true)}
              onApplyDefaults={handleApplyDefaultsToSelection}
              metadataClipboard={metadataClipboard}
              onCopyMetadata={handleCopyMetadata}
              onPasteMetadata={handlePasteMetadata}
              onClearNamLab={handleClearNamLab}
              namPlayerAvailable={namPlayerDetected || !!settings.namStandalonePath}
              onOpenInNam={async (filePath) => {
                const result = await window.api.openInNam(filePath, settings.namStandalonePath)
                if (!result.success) setStatus({ message: `Could not open in NAM: ${result.error}`, type: 'error' })
              }}
            />
          </div>
          {!gridMaximized && <DragHandle onMouseDown={(e: React.MouseEvent) => onDragStart('list', e)} onCollapse={() => setListCollapsed((v) => !v)} collapsed={listCollapsed} />}
        </>}

        {/* Main content */}
        <div ref={mainContentRef} tabIndex={-1} className={`flex-1 overflow-hidden flex flex-col focus:outline-none${gridMaximized ? ' hidden' : ''}`} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {showSettings ? (
            <SettingsPanel settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
          ) : batchFolder !== null ? (
            <BatchEditor
              folderName={batchFolder.name}
              fileCount={batchFolder.filePaths
                ? batchFolder.filePaths.length
                : batchFolder.path === null
                  ? files.length
                  : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(batchFolder.path! + '/')).length}
              onApply={(fields, opts) => handleBatchApply(fields, opts)}
              onClose={() => setBatchFolder(null)}
              skipConfirmation={settings.skipBatchEditConfirmation}
              gearMakeSuggestions={gearMakeSuggestions}
              gearModelSuggestions={gearModelSuggestions}
            />
          ) : selectedFiles.length === 1 ? (
            <MetadataEditor
              key={selectedFiles[0].filePath}
              file={selectedFiles[0]}
              onChange={(m) => handleMetadataChange(selectedFiles[0].filePath, m)}
              onSave={() => handleSave(selectedFiles[0].filePath)}
              onSaveAndAdvance={() => handleSaveAndAdvance(selectedFiles[0].filePath)}
              onRevert={() => {
                const f = selectedFiles[0]
                setFiles((prev) => prev.map((x) =>
                  x.filePath === f.filePath
                    ? { ...x, metadata: { ...x.originalMetadata }, isDirty: false, autoFilledFields: [] }
                    : x
                ))
              }}
              onRevealInFinder={() => window.api.revealFile(selectedFiles[0].filePath)}
              renameTemplate={settings.renameTemplate}
              onRenameFile={handleRenameFile}
              gearMakeSuggestions={gearMakeSuggestions}
              gearModelSuggestions={gearModelSuggestions}
              showNamLabFields={settings.showNamLabFields}
              hasActiveDefaults={
                settings.enableAmpInfo ||
                settings.enableCaptureDefaults ||
                settings.populateNameFromFilename ||
                settings.autoDetectToneType ||
                !!settings.ampSuffix
              }
              onReapplyDefaults={() => {
                const f = selectedFiles[0]
                const baseName = f.fileName.replace(/\.nam$/i, '')
                const currentMeta = f.metadata
                const newMeta = applyDefaults(currentMeta, baseName, settings)
                const newAutoFilled = (Object.keys(newMeta) as (keyof NamFile['metadata'])[]).filter(
                  (k) => newMeta[k] != null && (currentMeta[k] == null || currentMeta[k] === '') && !f.autoFilledFields.includes(k)
                )
                const allAutoFilled = [...f.autoFilledFields, ...newAutoFilled]
                const wasChanged = JSON.stringify(newMeta) !== JSON.stringify(f.originalMetadata)
                setFiles((prev) => prev.map((x) =>
                  x.filePath === f.filePath
                    ? { ...x, metadata: newMeta, isDirty: wasChanged, autoFilledFields: allAutoFilled }
                    : x
                ))
              }}
            />
          ) : selectedFiles.length > 1 ? (
            <MultiSelectEditor
              files={selectedFiles}
              onApply={handleMultiSelectApply}
              skipConfirmation={settings.skipBatchEditConfirmation}
              gearMakeSuggestions={gearMakeSuggestions}
              gearModelSuggestions={gearModelSuggestions}
            />
          ) : selectedFiles.length === 0 && librarian.rootFolder !== null ? (() => {
            const activeFolderPath = (librarian.selectedFolder ?? librarian.rootFolder)!
            const activeFolderName = activeFolderPath.split('/').pop() ?? activeFolderPath
            const hasImages = folderImages !== null && (folderImages.own.length > 0 || folderImages.inherited.some((g) => g.paths.length > 0))
            const showGallery = hasImages && settings.showFolderImages
            // If an ancestor folder already owns a nam-pack.json, this folder is a sub-division
            // of that pack — only show gallery here, never a second pack info editor
            const isPackChild = packInfoAncestor !== null
            const hasPack = packInfoFolders.has(activeFolderPath)
            const showPackEditor = !isPackChild && hasPack
            const showCreatePrompt = !isPackChild && !hasPack
            const showGalleryTab = !isPackChild && showGallery
            return (
              <div className="h-full flex flex-col">
                {showGalleryTab && (showPackEditor || showCreatePrompt) && (
                  <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    {(['pack', 'gallery'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setFolderPanelTab(tab)}
                        className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                          folderPanelTab === tab
                            ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >
                        {tab === 'pack' ? 'Pack Info' : 'Gallery'}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  {showPackEditor && (!showGalleryTab || folderPanelTab === 'pack') ? (
                    <PackInfoEditor
                      key={activeFolderPath}
                      folderPath={activeFolderPath}
                      folderName={activeFolderName}
                      captures={visibleFiles}
                      defaultCapturedBy={settings.defaultModeledBy}
                      catalog={settings.packGearCatalog}
                      onCatalogChange={(catalog) => handleSaveSettings({ ...settings, packGearCatalog: catalog })}
                      onPackSaved={handlePackSaved}
                      logoLight={settings.packLogoLight}
                      logoDark={settings.packLogoDark}
                    />
                  ) : showCreatePrompt && (!showGalleryTab || folderPanelTab === 'pack') ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
                      <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No Pack Info for this folder</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{activeFolderName}</p>
                      </div>
                      <button
                        onClick={async () => {
                          const res = await window.api.writePackInfo(activeFolderPath, {})
                          if (res.success) handlePackSaved(activeFolderPath, true)
                        }}
                        className="px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors"
                      >
                        Create Pack Info
                      </button>
                    </div>
                  ) : showGallery ? (
                    <FolderGallery data={folderImages!} />
                  ) : null}
                </div>
              </div>
            )
          })()
          : selectedFiles.length === 0 && files.length === 0 ? (
            <EmptyState onOpenFiles={handleOpenFiles} onOpenFolder={handleOpenFolder} />
          ) : (
            <MultiSelectHint count={selectedFiles.length} />
          )}
        </div>

        {/* Slide-in editor overlay — maximized grid mode */}
        {gridMaximized && (selectedFiles.length >= 1 || batchFolder !== null || showSettings) && (
          <div className={`absolute top-0 right-0 bottom-0 w-[460px] z-40 flex flex-col bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-700 shadow-2xl transition-transform duration-200 ${gridSlideOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {showSettings ? 'Settings' : batchFolder !== null ? `Batch Edit — ${batchFolder.name}` : selectedFiles.length > 1 ? `Edit ${selectedFiles.length} captures` : 'Edit Capture'}
              </span>
              <button onClick={() => { setGridSlideOpen(false); if (batchFolder !== null) setBatchFolder(null); if (showSettings) setShowSettings(false) }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {showSettings ? (
              <SettingsPanel settings={settings} onSave={handleSaveSettings} onClose={() => { setShowSettings(false); setGridSlideOpen(false) }} />
            ) : batchFolder !== null ? (
              <BatchEditor
                folderName={batchFolder.name}
                fileCount={batchFolder.filePaths
                  ? batchFolder.filePaths.length
                  : batchFolder.path === null ? files.length
                  : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(batchFolder.path! + '/')).length}
                onApply={(fields, opts) => { handleBatchApply(fields, opts); setGridSlideOpen(false) }}
                onClose={() => { setBatchFolder(null); setGridSlideOpen(false) }}
                skipConfirmation={settings.skipBatchEditConfirmation}
                gearMakeSuggestions={gearMakeSuggestions}
                gearModelSuggestions={gearModelSuggestions}
              />
            ) : selectedFiles.length > 1 ? (
              <MultiSelectEditor
                files={selectedFiles}
                onApply={handleMultiSelectApply}
                skipConfirmation={settings.skipBatchEditConfirmation}
                gearMakeSuggestions={gearMakeSuggestions}
                gearModelSuggestions={gearModelSuggestions}
              />
            ) : selectedFiles.length === 1 ? (
              <MetadataEditor
                key={selectedFiles[0].filePath}
                file={selectedFiles[0]}
                onChange={(m) => handleMetadataChange(selectedFiles[0].filePath, m)}
                onSave={() => handleSave(selectedFiles[0].filePath)}
                onSaveAndAdvance={() => handleSaveAndAdvance(selectedFiles[0].filePath)}
                onRevert={() => {
                  const f = selectedFiles[0]
                  setFiles((prev) => prev.map((x) =>
                    x.filePath === f.filePath
                      ? { ...x, metadata: { ...x.originalMetadata }, isDirty: false, autoFilledFields: [] }
                      : x
                  ))
                }}
                onRevealInFinder={() => window.api.revealFile(selectedFiles[0].filePath)}
                renameTemplate={settings.renameTemplate}
                onRenameFile={handleRenameFile}
                gearMakeSuggestions={gearMakeSuggestions}
                gearModelSuggestions={gearModelSuggestions}
                showNamLabFields={settings.showNamLabFields}
                hasActiveDefaults={
                  settings.enableAmpInfo || settings.enableCaptureDefaults ||
                  settings.populateNameFromFilename || settings.autoDetectToneType || !!settings.ampSuffix
                }
                onReapplyDefaults={() => {
                  const f = selectedFiles[0]
                  const baseName = f.fileName.replace(/\.nam$/i, '')
                  const newMeta = applyDefaults({ ...f.metadata }, baseName, settings)
                  const newAutoFilled = (Object.keys(newMeta) as (keyof NamFile['metadata'])[]).filter(
                    (k) => newMeta[k] != null && (f.metadata[k] == null || f.metadata[k] === '') && !f.autoFilledFields.includes(k)
                  )
                  setFiles((prev) => prev.map((x) =>
                    x.filePath === f.filePath
                      ? { ...x, metadata: newMeta, isDirty: JSON.stringify(newMeta) !== JSON.stringify(f.originalMetadata), autoFilledFields: [...f.autoFilledFields, ...newAutoFilled] }
                      : x
                  ))
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      <DefaultsPill settings={settings} />
      {folderChanged && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-amber-500/10 border-t border-amber-500/30 flex-shrink-0">
          <span className="text-xs text-amber-600 dark:text-amber-400 flex-1">New .nam files detected in folder.</span>
          <button
            onClick={() => { setFolderChanged(false); handleRefresh() }}
            className="text-xs px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/40 text-amber-700 dark:text-amber-300 transition-colors font-medium"
          >
            Refresh
          </button>
          <button
            onClick={() => setFolderChanged(false)}
            className="text-xs text-amber-600/60 dark:text-amber-500/60 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            ✕
          </button>
        </div>
      )}
      <StatusBar message={status.message} type={status.type} logPath={status.logPath} />

      {showDuplicates && (
        <DuplicatesModal
          files={files}
          rootFolder={librarian.rootFolder}
          onClose={() => setShowDuplicates(false)}
          onMoveDuplicates={handleMoveDuplicates}
          onTrashDuplicates={handleTrashDuplicates}
        />
      )}

      {importModal && (
        <ImportMetadataModal
          folderName={importModal.folderName}
          exactMatches={importModal.exactMatches}
          prefixMatches={importModal.prefixMatches}
          unmatchedNames={importModal.unmatchedNames}
          onConfirm={handleImportConfirm}
          onClose={() => setImportModal(null)}
        />
      )}
    </div>
  )
}

function DefaultsPill({ settings }: { settings: AppSettings }) {
  const parts: string[] = []

  if (settings.enableAmpInfo && (settings.defaultManufacturer || settings.defaultModel)) {
    const label = [settings.defaultManufacturer, settings.defaultModel].filter(Boolean).join(' ')
    parts.push(`Amp: ${label}`)
  }

  if (settings.enableCaptureDefaults) {
    const sub: string[] = []
    if (settings.defaultModeledBy) sub.push(settings.defaultModeledBy)
    if (settings.defaultInputLevel) sub.push(`in ${settings.defaultInputLevel} dBu`)
    if (settings.defaultOutputLevel) sub.push(`out ${settings.defaultOutputLevel} dBu`)
    if (sub.length > 0) parts.push(`Capture: ${sub.join(', ')}`)
  }

  if (settings.populateNameFromFilename) parts.push('Name from filename')

  if (parts.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-1 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800/60 flex-shrink-0">
      <span className="text-xs text-gray-400 dark:text-gray-600 flex-shrink-0">On open:</span>
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {parts.map((p, i) => (
          <span key={i} className="text-xs text-gray-500 dark:text-gray-500 bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded whitespace-nowrap">
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}

function DragHandle({ onMouseDown, onCollapse, collapsed }: { onMouseDown: (e: React.MouseEvent) => void; onCollapse?: () => void; collapsed?: boolean }) {
  return (
    <div
      className="w-3 flex-shrink-0 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors group relative flex items-center justify-center"
      onMouseDown={onMouseDown}
    >
      {onCollapse && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onCollapse}
          title={collapsed ? 'Expand library' : 'Collapse library'}
          className="opacity-0 group-hover:opacity-100 absolute w-4 h-8 flex items-center justify-center rounded bg-indigo-500/60 hover:bg-indigo-500 text-white transition-all z-10"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
          </svg>
        </button>
      )}
    </div>
  )
}

function EmptyState({
  onOpenFiles,
  onOpenFolder
}: {
  onOpenFiles: () => void
  onOpenFolder: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center p-8">
      <div className="w-28 h-28 rounded-2xl bg-[#080F14] flex items-center justify-center">
        <img src={beakerTransparent} alt="NAM Lab" className="w-20 h-20 object-contain" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">NAM Lab</h2>
        <p className="text-sm font-medium text-indigo-400 mb-3">Organize, clean, and scale your NAM library.</p>
        <p className="text-gray-500 dark:text-gray-500 text-sm max-w-xs">
          Open a folder to manage your library, or open individual .nam files to edit their metadata.
        </p>
        <p className="text-gray-400 dark:text-gray-600 text-xs mt-2">
          You can also drag and drop .nam files or a folder directly into this window.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onOpenFiles}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Open Files
        </button>
        <button
          onClick={onOpenFolder}
          className="px-4 py-2 bg-gray-300 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
        >
          Open Folder
        </button>
      </div>
    </div>
  )
}

function MultiSelectHint({ count }: { count: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 flex items-center justify-center">
        <span className="text-2xl font-bold text-indigo-400">{count}</span>
      </div>
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1">{count} files selected</h3>
        <p className="text-gray-500 dark:text-gray-500 text-sm">Select a single file to edit its metadata,<br />or right-click the selection to batch edit.</p>
      </div>
    </div>
  )
}

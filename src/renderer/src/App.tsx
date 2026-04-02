import { useState, useCallback, useEffect, useRef } from 'react'
import { NamFile, TONE_TYPES, GEAR_TYPES } from './types/nam'
import { AppSettings, loadSettings, saveSettings } from './types/settings'
import { loadLayout, saveLayout } from './types/layout'
import { LibrarianState } from './types/librarian'
import { FileList } from './components/FileList'
import { MetadataEditor } from './components/MetadataEditor'
import { Toolbar } from './components/Toolbar'
import { BatchEditor, BatchApplyOptions } from './components/BatchEditor'
import { MultiSelectEditor } from './components/MultiSelectEditor'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { FolderTree } from './components/FolderTree'
import { FolderNode } from './types/librarian'

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openFolder: () => Promise<string | null>
      revealFile: (filePath: string) => Promise<void>
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
      moveFile: (sourcePath: string, destDir: string) => Promise<{ success: boolean; error?: string; destPath?: string }>
      scanFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; files?: string[] }>
      scanTree: (folderPath: string) => Promise<{ success: boolean; error?: string; tree?: FolderNode }>
      getErrorLogPath: () => Promise<string>
      refocusWindow: () => Promise<void>
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
  const [librarian, setLibrarian] = useState<LibrarianState>(EMPTY_LIBRARIAN)
  const [libraryFilter, setLibraryFilter] = useState<Set<string> | null>(null)
  const initialLayout = loadLayout()
  const initialSettings = loadSettings()
  const [treeWidth, setTreeWidth] = useState(initialLayout.treeWidth)
  const [listViewMode, setListViewMode] = useState<'list' | 'grid'>(initialSettings.defaultView ?? 'list')
  const [listWidth, setListWidth] = useState(
    (initialSettings.defaultView ?? 'list') === 'grid' ? initialLayout.listWidthGrid : initialLayout.listWidthList
  )
  const draggingRef = useRef<null | { panel: 'tree' | 'list'; startX: number; startWidth: number }>(null)
  const mainContentRef = useRef<HTMLDivElement>(null)
  const [treeCollapsed, setTreeCollapsed] = useState(false)

  // Apply dark/light class to <html> whenever theme setting changes
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [settings.theme])

  // Electron on Windows loses keyboard focus when the focused DOM element is removed
  // (e.g. BatchEditor unmounts) or after native confirm dialogs close. Chromium's
  // internal focus state gets stale. Fix: DOM focus as first attempt, then a blur→focus
  // cycle in main process which resets OS-level keyboard routing (same as Alt+Tab).
  useEffect(() => {
    mainContentRef.current?.focus()
    window.api.refocusWindow()
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
      const next = Math.max(140, draggingRef.current.startWidth + delta)
      if (draggingRef.current.panel === 'tree') { setTreeWidth(next); latestTree = next }
      else { setListWidth(next); latestList = next }
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

  // Auto-load default folder on startup
  useEffect(() => {
    if (settings.enableDefaultFolder && settings.defaultFolder) {
      loadFolderByPath(settings.defaultFolder)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — only runs once on mount

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
    // Save as default folder if rememberLastFolder is on
    setSettings((prev) => {
      if (!prev.rememberLastFolder) return prev
      const updated = { ...prev, defaultFolder: folder.replace(/\\/g, '/'), enableDefaultFolder: true }
      saveSettings(updated)
      return updated
    })
    const [flatResult, treeResult] = await Promise.all([
      window.api.scanFolder(folder),
      window.api.scanTree(folder)
    ])
    if (!flatResult.success) {
      setStatus({ message: `Error: ${flatResult.error}`, type: 'error' })
      return
    }
    if (!flatResult.files || flatResult.files.length === 0) {
      setStatus({ message: 'No .nam files found in that folder', type: 'info' })
      return
    }
    setLibrarian({
      rootFolder: folder.replace(/\\/g, '/'),
      folderTree: treeResult.success && treeResult.tree ? treeResult.tree : null,
      selectedFolder: null
    })
    await loadFiles(flatResult.files, 'replace')
  }, [loadFiles])

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

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const paths: string[] = []
      for (const item of Array.from(e.dataTransfer.files)) {
        if (item.name.endsWith('.nam')) {
          const p = (item as unknown as { path: string }).path
          if (p) paths.push(p)
        }
      }
      if (paths.length > 0) await loadFiles(paths, 'append')
    },
    [loadFiles]
  )

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

  const handleSaveAll = async () => {
    const dirty = files.filter((f) => f.isDirty)
    if (dirty.length === 0) {
      setStatus({ message: 'No unsaved changes', type: 'info' })
      return
    }
    if (!settings.skipSaveAllConfirmation) {
      const confirmed = window.confirm(`Save changes to ${dirty.length} file${dirty.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.`)
      if (!confirmed) return
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
      const treeResult = await window.api.scanTree(librarian.rootFolder)
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

  // Filter files by selected folder and/or library search filter
  const visibleFiles = files.filter((f) => {
    const norm = f.filePath.replace(/\\/g, '/')
    if (librarian.selectedFolder && !norm.startsWith(librarian.selectedFolder + '/')) return false
    if (libraryFilter && !libraryFilter.has(norm)) return false
    return true
  })

  const selectedFiles = visibleFiles.filter((f) => selectedIds.has(f.filePath))
  const dirtyCount = files.filter((f) => f.isDirty).length
  const unnamedCount = files.filter((f) => !f.metadata.name).length
  const hasTree = librarian.folderTree !== null
  const dirtyPaths = new Set(files.filter((f) => f.isDirty).map((f) => f.filePath.replace(/\\/g, '/')))

  return (
    <div
      className="flex flex-col h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Toolbar
        onOpenFiles={handleOpenFiles}
        onOpenFolder={handleOpenFolder}
        onSaveAll={handleSaveAll}
        dirtyCount={dirtyCount}
        fileCount={files.length}
        isMac={window.api.platform === 'darwin'}
        showSettings={showSettings}
        onToggleSettings={() => { setShowSettings((s) => !s); setBatchFolder(null) }}
        unnamedCount={unnamedCount}
        onNameFromFilename={handleNameFromFilename}
        onCloseAll={handleCloseAll}
        rootFolder={librarian.rootFolder}
        onRefresh={handleRefresh}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Folder tree — only shown when a folder is open */}
        {hasTree && (
          <>
            <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: treeCollapsed ? 0 : treeWidth, overflow: 'hidden' }}>
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
                    const confirmed = window.confirm(`Save changes to ${targets.length} file${targets.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.`)
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
              />
            </div>
            <DragHandle onMouseDown={(e) => onDragStart('tree', e)} onCollapse={() => setTreeCollapsed((v) => !v)} collapsed={treeCollapsed} />
          </>
        )}

        {/* File list — only shown when files are loaded */}
        {files.length > 0 && <>
          <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: listWidth }}>
            <FileList
              files={visibleFiles}
              selectedIds={selectedIds}
              solidPills={settings.solidPillColors}
              draggable={!!librarian.rootFolder}
              viewMode={listViewMode}
              onViewModeChange={(mode) => {
                setListViewMode(mode)
                const layout = loadLayout()
                setListWidth(mode === 'grid' ? layout.listWidthGrid : layout.listWidthList)
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
              onSelectAll={() => setSelectedIds(new Set(visibleFiles.map((f) => f.filePath)))}
              onDeselectAll={() => setSelectedIds(new Set())}
              onRemove={hasTree ? undefined : handleRemoveFile}
              onBatchEditSelected={(paths) => {
                setShowSettings(false)
                setBatchFolder({
                  path: null,
                  name: `${paths.length} selected file${paths.length !== 1 ? 's' : ''}`,
                  filePaths: paths
                })
              }}
              onSaveSelected={async (paths) => {
                const pathSet = new Set(paths)
                const targets = files.filter((f) => pathSet.has(f.filePath) && f.isDirty)
                if (targets.length === 0) {
                  setStatus({ message: 'No unsaved changes in selection', type: 'info' })
                  return
                }
                if (!settings.skipSaveAllConfirmation) {
                  const confirmed = window.confirm(`Save changes to ${targets.length} file${targets.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.`)
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
            />
          </div>
          <DragHandle onMouseDown={(e: React.MouseEvent) => onDragStart('list', e)} />
        </>}

        {/* Main content */}
        <div ref={mainContentRef} tabIndex={-1} className="flex-1 overflow-hidden flex flex-col focus:outline-none" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {showSettings ? (
            <SettingsPanel settings={settings} onSave={handleSaveSettings} />
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
            />
          ) : selectedFiles.length === 1 ? (
            <MetadataEditor
              key={selectedFiles[0].filePath}
              file={selectedFiles[0]}
              onChange={(m) => handleMetadataChange(selectedFiles[0].filePath, m)}
              onSave={() => handleSave(selectedFiles[0].filePath)}
              onRevert={() => {
                const f = selectedFiles[0]
                setFiles((prev) => prev.map((x) =>
                  x.filePath === f.filePath
                    ? { ...x, metadata: { ...x.originalMetadata }, isDirty: false, autoFilledFields: [] }
                    : x
                ))
              }}
              onRevealInFinder={() => window.api.revealFile(selectedFiles[0].filePath)}
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
            />
          ) : selectedFiles.length === 0 && files.length === 0 ? (
            <EmptyState onOpenFiles={handleOpenFiles} onOpenFolder={handleOpenFolder} />
          ) : (
            <MultiSelectHint count={selectedFiles.length} />
          )}
        </div>
      </div>

      <DefaultsPill settings={settings} />
      <StatusBar message={status.message} type={status.type} logPath={status.logPath} />
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
      <div className="w-20 h-20 rounded-2xl bg-indigo-900/40 flex items-center justify-center">
        <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-1">NAM Metadata Editor</h2>
        <p className="text-gray-500 dark:text-gray-500 text-sm max-w-xs">
          Open .nam files to edit their metadata. Drag & drop files anywhere to load them.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onOpenFiles}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
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
      <p className="text-gray-400 dark:text-gray-600 text-xs">Or drag & drop .nam files anywhere in the window</p>
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

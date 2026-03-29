import { useState, useCallback } from 'react'
import { NamFile } from './types/nam'
import { AppSettings, loadSettings, saveSettings } from './types/settings'
import { LibrarianState } from './types/librarian'
import { FileList } from './components/FileList'
import { MetadataEditor } from './components/MetadataEditor'
import { Toolbar } from './components/Toolbar'
import { BatchEditor } from './components/BatchEditor'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { FolderTree } from './components/FolderTree'
import { FolderNode } from './types/librarian'

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openFolder: () => Promise<string | null>
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
      scanFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; files?: string[] }>
      scanTree: (folderPath: string) => Promise<{ success: boolean; error?: string; tree?: FolderNode }>
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

  // Auto gear type from filename (always on, uses configurable suffix)
  if (!m.gear_type) {
    const suffix = (settings.ampSuffix || 'DI').replace(/\s+/g, '').toUpperCase()
    const nameUpper = baseName.replace(/\s+/g, '').toUpperCase()
    m.gear_type = nameUpper.endsWith(suffix) ? 'amp' : 'cab'
  }

  return m
}

const EMPTY_LIBRARIAN: LibrarianState = {
  rootFolder: null,
  folderTree: null,
  selectedFolder: null
}

export default function App() {
  const [files, setFiles] = useState<NamFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' }>({
    message: 'Open .nam files or a folder to get started',
    type: 'info'
  })
  const [batchMode, setBatchMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [librarian, setLibrarian] = useState<LibrarianState>(EMPTY_LIBRARIAN)

  const handleSaveSettings = (updated: AppSettings) => {
    setSettings(updated)
    saveSettings(updated)
  }

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
        const meta = applyDefaults({ ...rawMeta }, baseName, settings)
        const wasChanged = JSON.stringify(meta) !== JSON.stringify(rawMeta)
        loaded.push({
          filePath: r.filePath,
          fileName: baseName,
          version: r.version ?? '?',
          metadata: meta,
          originalMetadata: rawMeta,
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
      setStatus({ message: `Loaded ${loaded.length} file(s), ${errors} failed`, type: 'error' })
    } else {
      setStatus({ message: `Loaded ${loaded.length} file(s)`, type: 'success' })
    }
  }, [settings]) // no longer depends on files or selectedIds

  // Shared logic for opening a folder by path (used by Open Folder and Refresh)
  const loadFolderByPath = useCallback(async (folder: string) => {
    setStatus({ message: 'Scanning folder...', type: 'info' })
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
    setBatchMode(false)
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
      prev.map((f) => (f.filePath === filePath ? { ...f, metadata: updated, isDirty: true } : f))
    )
  }

  const handleSave = async (filePath: string) => {
    const file = files.find((f) => f.filePath === filePath)
    if (!file) return
    const result = await window.api.writeMetadata(filePath, file.metadata)
    if (result.success) {
      setFiles((prev) => prev.map((f) =>
        f.filePath === filePath
          ? { ...f, isDirty: false, originalMetadata: { ...f.metadata } }
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
    const confirmed = window.confirm(`Save changes to ${dirty.length} file${dirty.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.`)
    if (!confirmed) return
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
        ? { ...f, isDirty: false, originalMetadata: { ...f.metadata } }
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

  const handleBatchApply = async (metadata: Partial<NamFile['metadata']>) => {
    const targetIds = selectedIds.size > 0 ? selectedIds : new Set(visibleFiles.map((f) => f.filePath))
    setFiles((prev) =>
      prev.map((f) => {
        if (!targetIds.has(f.filePath)) return f
        const merged = { ...f.metadata }
        for (const [k, v] of Object.entries(metadata)) {
          if (v !== '' && v !== null && v !== undefined) {
            ;(merged as Record<string, unknown>)[k] = v
          }
        }
        return { ...f, metadata: merged, isDirty: true }
      })
    )
    setStatus({ message: `Applied batch changes to ${targetIds.size} file(s)`, type: 'success' })
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

  // Filter files by selected folder in librarian mode
  const visibleFiles = librarian.selectedFolder
    ? files.filter((f) => {
        const norm = f.filePath.replace(/\\/g, '/')
        return norm.startsWith(librarian.selectedFolder! + '/')
      })
    : files

  const selectedFiles = visibleFiles.filter((f) => selectedIds.has(f.filePath))
  const dirtyCount = files.filter((f) => f.isDirty).length
  const unnamedCount = files.filter((f) => !f.metadata.name).length
  const hasTree = librarian.folderTree !== null
  const dirtyPaths = new Set(files.filter((f) => f.isDirty).map((f) => f.filePath.replace(/\\/g, '/')))

  return (
    <div
      className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Toolbar
        onOpenFiles={handleOpenFiles}
        onOpenFolder={handleOpenFolder}
        onSaveAll={handleSaveAll}
        dirtyCount={dirtyCount}
        batchMode={batchMode}
        onToggleBatch={() => { setBatchMode((b) => !b); setShowSettings(false) }}
        fileCount={files.length}
        isMac={window.api.platform === 'darwin'}
        showSettings={showSettings}
        onToggleSettings={() => { setShowSettings((s) => !s); setBatchMode(false) }}
        unnamedCount={unnamedCount}
        onNameFromFilename={handleNameFromFilename}
        onCloseAll={handleCloseAll}
        rootFolder={librarian.rootFolder}
        onRefresh={handleRefresh}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Folder tree — only shown when a folder is open */}
        {hasTree && (
          <div className="w-48 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
            <FolderTree
              tree={librarian.folderTree!}
              selectedFolder={librarian.selectedFolder}
              dirtyPaths={dirtyPaths}
              onSelect={(path) => {
                setLibrarian((prev) => ({ ...prev, selectedFolder: path }))
                setSelectedIds(new Set())
              }}
            />
          </div>
        )}

        {/* File list */}
        <div className={`${hasTree ? 'w-64' : 'w-72'} flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden`}>
          <FileList
            files={visibleFiles}
            selectedIds={selectedIds}
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
                setBatchMode(false)
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
            onRemove={handleRemoveFile}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {showSettings ? (
            <SettingsPanel settings={settings} onSave={handleSaveSettings} />
          ) : batchMode ? (
            <BatchEditor
              selectedCount={selectedIds.size > 0 ? selectedIds.size : visibleFiles.length}
              onApply={handleBatchApply}
            />
          ) : selectedFiles.length === 1 ? (
            <MetadataEditor
              key={selectedFiles[0].filePath}
              file={selectedFiles[0]}
              onChange={(m) => handleMetadataChange(selectedFiles[0].filePath, m)}
              onSave={() => handleSave(selectedFiles[0].filePath)}
            />
          ) : selectedFiles.length === 0 && files.length === 0 ? (
            <EmptyState onOpenFiles={handleOpenFiles} onOpenFolder={handleOpenFolder} />
          ) : (
            <MultiSelectHint count={selectedFiles.length} onBatch={() => setBatchMode(true)} />
          )}
        </div>
      </div>

      <DefaultsPill settings={settings} />
      <StatusBar message={status.message} type={status.type} />
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
    <div className="flex items-center gap-2 px-4 py-1 bg-gray-900 border-t border-gray-800/60 flex-shrink-0">
      <span className="text-xs text-gray-600 flex-shrink-0">On open:</span>
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {parts.map((p, i) => (
          <span key={i} className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded whitespace-nowrap">
            {p}
          </span>
        ))}
      </div>
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
        <h2 className="text-xl font-semibold text-gray-200 mb-1">NAM Metadata Editor</h2>
        <p className="text-gray-500 text-sm max-w-xs">
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
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
        >
          Open Folder
        </button>
      </div>
      <p className="text-gray-600 text-xs">Or drag & drop .nam files anywhere in the window</p>
    </div>
  )
}

function MultiSelectHint({ count, onBatch }: { count: number; onBatch: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 flex items-center justify-center">
        <span className="text-2xl font-bold text-indigo-400">{count}</span>
      </div>
      <div>
        <h3 className="text-lg font-semibold text-gray-200 mb-1">{count} files selected</h3>
        <p className="text-gray-500 text-sm">Use batch edit to modify multiple files at once,<br />or select a single file to edit its metadata.</p>
      </div>
      <button
        onClick={onBatch}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
      >
        Open Batch Editor
      </button>
    </div>
  )
}

import { useState, useCallback } from 'react'
import { NamFile } from './types/nam'
import { AppSettings, loadSettings, saveSettings } from './types/settings'
import { FileList } from './components/FileList'
import { MetadataEditor } from './components/MetadataEditor'
import { Toolbar } from './components/Toolbar'
import { BatchEditor } from './components/BatchEditor'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'

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
      platform: string
    }
  }
}

function applyDefaults(meta: NamFile['metadata'], baseName: string, settings: AppSettings): NamFile['metadata'] {
  const m = { ...meta }

  // Capture name defaults to filename
  if (!m.name) m.name = baseName

  // Modeled By default
  if (!m.modeled_by && settings.defaultModeledBy)
    m.modeled_by = settings.defaultModeledBy

  // Input level default
  if (m.input_level_dbu == null && settings.defaultInputLevel !== '') {
    const n = parseFloat(settings.defaultInputLevel)
    if (!isNaN(n)) m.input_level_dbu = n
  }

  // Manufacturer / Model defaults
  if (!m.gear_make && settings.defaultManufacturer)
    m.gear_make = settings.defaultManufacturer
  if (!m.gear_model && settings.defaultModel)
    m.gear_model = settings.defaultModel

  // Auto gear type from filename
  if (!m.gear_type) {
    const nameUpper = baseName.replace(/\s+/g, '').toUpperCase()
    m.gear_type = nameUpper.endsWith('DI') ? 'amp' : 'cab'
  }

  return m
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

  const handleSaveSettings = (updated: AppSettings) => {
    setSettings(updated)
    saveSettings(updated)
  }

  const loadFiles = useCallback(async (paths: string[]) => {
    setStatus({ message: `Loading ${paths.length} file(s)...`, type: 'info' })
    const results = await Promise.all(paths.map((p) => window.api.readFile(p)))

    const loaded: NamFile[] = []
    let errors = 0
    for (const r of results) {
      if (r.success && r.filePath && r.metadata !== undefined) {
        const fileName = r.filePath.replace(/\\/g, '/').split('/').pop() ?? r.filePath
        if (!files.some((f) => f.filePath === r.filePath)) {
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
        }
      } else {
        errors++
      }
    }

    setFiles((prev) => [...prev, ...loaded])
    if (errors > 0) {
      setStatus({ message: `Loaded ${loaded.length} file(s), ${errors} failed`, type: 'error' })
    } else {
      setStatus({ message: `Loaded ${loaded.length} file(s)`, type: 'success' })
    }
    if (loaded.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set([loaded[0].filePath]))
    }
  }, [files, selectedIds, settings])

  const handleOpenFiles = async () => {
    const paths = await window.api.openFiles()
    if (paths.length > 0) await loadFiles(paths)
  }

  const handleOpenFolder = async () => {
    const folder = await window.api.openFolder()
    if (!folder) return
    setStatus({ message: 'Scanning folder...', type: 'info' })
    const result = await window.api.scanFolder(folder)
    if (result.success && result.files && result.files.length > 0) {
      await loadFiles(result.files)
    } else if (result.success) {
      setStatus({ message: 'No .nam files found in that folder', type: 'info' })
    } else {
      setStatus({ message: `Error: ${result.error}`, type: 'error' })
    }
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
      if (paths.length > 0) await loadFiles(paths)
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
      setFiles((prev) => prev.map((f) => (f.filePath === filePath ? { ...f, isDirty: false } : f)))
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
    setStatus({ message: `Saving ${dirty.length} file(s)...`, type: 'info' })
    let saved = 0
    let failed = 0
    for (const f of dirty) {
      const result = await window.api.writeMetadata(f.filePath, f.metadata)
      if (result.success) saved++
      else failed++
    }
    setFiles((prev) => prev.map((f) => ({ ...f, isDirty: false })))
    if (failed > 0) {
      setStatus({ message: `Saved ${saved}, failed ${failed}`, type: 'error' })
    } else {
      setStatus({ message: `Saved ${saved} file(s)`, type: 'success' })
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
    const targetIds = selectedIds.size > 0 ? selectedIds : new Set(files.map((f) => f.filePath))
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

  const selectedFiles = files.filter((f) => selectedIds.has(f.filePath))
  const dirtyCount = files.filter((f) => f.isDirty).length
  const unnamedCount = files.filter((f) => !f.metadata.name).length

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
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - file list */}
        <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
          <FileList
            files={files}
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
            onSelectAll={() => setSelectedIds(new Set(files.map((f) => f.filePath)))}
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
              selectedCount={selectedIds.size > 0 ? selectedIds.size : files.length}
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

      <StatusBar message={status.message} type={status.type} />
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

import { useState, useCallback, useEffect, useRef } from 'react'
import beakerTransparent from './assets/images/beaker.only.transparent.png'
import { NamFile, NamMetadata, TONE_TYPES, GEAR_TYPES } from './types/nam'
import { AppSettings, FolderWatchImportEntry, FolderWatchRule, MetadataSuggestRule, TrainingProfile, loadSettings, saveSettings } from './types/settings'
import { effectiveFormula } from './utils/resolveOutputFormula'
import { loadLayout, saveLayout } from './types/layout'
import { LibrarianState } from './types/librarian'
import { FileList, ALL_GRID_COLUMNS, doExportCSV, doExportXLSX } from './components/FileList'
import { MetadataEditor } from './components/MetadataEditor'
import { Toolbar } from './components/Toolbar'
import { BatchEditor, BatchApplyOptions } from './components/BatchEditor'
import { MultiSelectEditor } from './components/MultiSelectEditor'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { ToneStore, type ToneModel, type ToneStoreDownloadQueueJob } from './components/ToneStore'
import { FolderTree } from './components/FolderTree'
import { DuplicatesModal } from './components/DuplicatesModal'
import { ImportMetadataModal, ImportMatch } from './components/ImportMetadataModal'
import { SuggestMetadataModal } from './components/SuggestMetadataModal'
import { TrainingCoverageModal } from './components/TrainingCoverageModal'
import { FolderCompareModal } from './components/FolderCompareModal'
import { FolderGallery, FolderImagesData } from './components/FolderGallery'
import { FolderDashboard } from './components/FolderDashboard'
import { FolderReadmePanel } from './components/FolderReadmePanel'
import { WavCoverageTab } from './components/WavCoverageTab'
import { PackInfoEditor, type DeliveryMatrixData, type PackInfo, type PackChecklistItem } from './components/PackInfoEditor'
import { PackTargetsEditor } from './components/PackTargetsEditor'
import { TrainingPanel } from './components/TrainingPanel'
import { FolderSuggestRulesModal } from './components/FolderSuggestRulesModal'
import { BundleEditor } from './components/BundleEditor'
import { NamDashboard } from './components/NamDashboard'
import { FolderCardView } from './components/FolderCardView'
import { SessionHistoryPanel } from './components/SessionHistoryPanel'
import { LibraryCleanupModal, type LibraryCleanupFolderEntry, type LibraryCleanupLayout, type LibraryCleanupPreviewRow } from './components/LibraryCleanupModal'
import { HelpModal, type HelpModalTab } from './components/HelpModal'
import * as XLSX from 'xlsx'
import { buildMetadataSuggestionMatches, MetadataSuggestionMatch } from './utils/metadataSuggest'
import { cloneMetadataSuggestRule, isMetadataSuggestRuleComplete, isMetadataSuggestRuleLibraryCandidate, metadataSuggestRuleSignature } from './utils/metadataSuggestRuleLibrary'
import { detectPreset } from './utils/detectPreset'
import { IDLE_TRAINER_STATE, TRAINER_ARCHITECTURES, type TrainerArchitecture, type TrainerProfilesStateSnapshot, type TrainerStartPayload, type TrainerStateSnapshot } from './types/trainer'

export interface HistoryEntry {
  id: string
  timestamp: Date
  operation: string
  summary: string
}

interface ChecklistSummary {
  total: number
  completed: number
  percent: number
  targetDate: string
  liveDate: string
  isOverdue: boolean
  releasedLate: boolean
  releasedOnTime: boolean
}

interface DashboardChecklistEntry {
  folderPath: string
  folderLabel: string
  status: string
  progressLabel: string
  percent: number
}

interface DeliveryMatrixSummary {
  totalRows: number
  lastImportedAt: string
  tonexIncluded: number
  namIncluded: number
  proxyIncluded: number
  qcIncluded: number
}

interface FolderReadinessSummary {
  hasReadme: boolean
  galleryCount: number
  hasCoverImage: boolean
  recentUpdatedCount: number
}

interface LibraryCleanupClassifiedFile {
  sourcePath: string
  destinationDir: string
  destinationBaseName: string
  needsReview: boolean
  note: string | null
}

function cleanupSourceBaseName(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/')
  const baseName = normalized.split('/').pop() ?? normalized
  return /\.nam$/i.test(baseName) ? baseName : `${baseName}.nam`
}

function inferCleanupDiCabFromFile(file: NamFile): 'DI' | 'CAB' | null {
  const gearType = file.metadata.gear_type ?? ''
  if (gearType === 'amp') return 'DI'
  if (gearType.includes('cab')) return 'CAB'

  const hay = `${file.fileName} ${file.metadata.name ?? ''}`.toLowerCase()
  if (/\bdi\b/.test(hay) || /\bdirect\b/.test(hay)) return 'DI'
  if (/\b(?:1x12|2x12|4x12|8x10|112|212|410|412)\b/.test(hay) || /\bcab\b/.test(hay)) return 'CAB'
  return null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function migrateLegacyNamBotInMemory(meta: NamFile['metadata']): NamFile['metadata'] {
  const training = meta.training as Record<string, unknown> | undefined
  const legacy = training?.nam_bot as Record<string, unknown> | undefined
  if (!legacy) return meta

  const topLevel = (meta as Record<string, unknown>).nam_bot
  const nextTopLevel = topLevel && typeof topLevel === 'object' && !Array.isArray(topLevel)
    ? { ...legacy, ...(topLevel as Record<string, unknown>) }
    : { ...legacy }

  const nextMeta = {
    ...meta,
    nam_bot: nextTopLevel,
    nb_trained_epochs: (nextTopLevel.trained_epochs as number | undefined) ?? meta.nb_trained_epochs ?? null,
    nb_preset_name: (nextTopLevel.preset_name as string | undefined) ?? meta.nb_preset_name ?? null,
  } as NamFile['metadata'] & { nam_bot?: Record<string, unknown> }
  const nextTraining = { ...(training ?? {}) }
  delete nextTraining.nam_bot
  if (Object.keys(nextTraining).length === 0) delete nextMeta.training
  else nextMeta.training = nextTraining
  return nextMeta
}

function summarizeChecklist(packData: unknown): ChecklistSummary | null {
  if (!packData || typeof packData !== 'object') return null
  const pack = packData as Partial<PackInfo> & { checklistItems?: Partial<PackChecklistItem>[] }
  const items = Array.isArray(pack.checklistItems) ? pack.checklistItems : []
  if (items.length === 0) return null
  const completed = items.filter((item) => item?.completed === true).length
  const total = items.length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  const targetDate = typeof pack.targetDate === 'string' ? pack.targetDate : ''
  const liveDate = typeof pack.liveDate === 'string' ? pack.liveDate : ''
  const today = new Date().toISOString().slice(0, 10)
  const isReleased = !!liveDate
  return {
    total,
    completed,
    percent,
    targetDate,
    liveDate,
    isOverdue: !isReleased && !!targetDate && targetDate < today,
    releasedLate: !!liveDate && !!targetDate && liveDate > targetDate,
    releasedOnTime: !!liveDate && !!targetDate && liveDate <= targetDate,
  }
}

function formatChecklistStatus(summary: ChecklistSummary): string {
  if (summary.liveDate) {
    return summary.releasedLate ? 'Released late' : summary.releasedOnTime ? 'Released on time' : 'Released'
  }
  if (summary.isOverdue) return 'Overdue'
  if (summary.targetDate) return `Target ${summary.targetDate}`
  return 'In progress'
}

function summarizeDeliveryMatrix(packData: unknown): DeliveryMatrixSummary | null {
  if (!packData || typeof packData !== 'object') return null
  const matrix = (packData as { deliveryMatrix?: Partial<DeliveryMatrixData> }).deliveryMatrix
  if (!matrix || !Array.isArray(matrix.rows) || matrix.rows.length === 0) return null
  const rows = matrix.rows
  return {
    totalRows: rows.length,
    lastImportedAt: typeof matrix.lastImportedAt === 'string' ? matrix.lastImportedAt : '',
    tonexIncluded: rows.filter((row) => row?.includeToneX === true).length,
    namIncluded: rows.filter((row) => row?.includeNam === true).length,
    proxyIncluded: rows.filter((row) => row?.includeProxy === true).length,
    qcIncluded: rows.filter((row) => row?.includeQc === true).length,
  }
}

function formatPathLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length <= 3 ? normalized : `.../${parts.slice(-3).join('/')}`
}

function folderDisplayName(path: string | null): string {
  if (!path) return 'All loaded files'
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

function parentFolderPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return normalized
  const rootPrefix = normalized.match(/^[A-Za-z]:/)?.[0] ?? ''
  const parentParts = parts.slice(0, -1)
  if (rootPrefix) return `${rootPrefix}/${parentParts.slice(1).join('/')}`.replace(/\/+/g, '/')
  return parentParts.join('/')
}

function sanitizeCleanupPathPart(value: string): string {
  return value
    .replace(/[\\/]+/g, ' - ')
    .replace(/[:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

function isPathWithin(path: string, ancestor: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedAncestor = ancestor.replace(/\\/g, '/')
  return normalizedPath === normalizedAncestor || normalizedPath.startsWith(normalizedAncestor + '/')
}

function relativePathWithin(path: string, root: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedRoot = root.replace(/\\/g, '/')
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(normalizedRoot + '/')) return normalizedPath.slice(normalizedRoot.length + 1)
  return normalizedPath
}

function flattenFolderTree(node: FolderNode, depth = 0): Array<{ path: string; label: string; depth: number }> {
  const rows: Array<{ path: string; label: string; depth: number }> = []
  for (const child of node.children) {
    rows.push({ path: child.path.replace(/\\/g, '/'), label: child.name, depth })
    rows.push(...flattenFolderTree(child, depth + 1))
  }
  return rows
}

function makeFolderWatchKey(sourceFolder: string, destFolder: string): string {
  return `${sourceFolder.replace(/\\/g, '/')}=>${destFolder.replace(/\\/g, '/')}`
}

function resolveTrainingWatcherProfiles(settings: AppSettings): TrainingProfile[] {
  const presetMap = new Map(settings.trainingPresets.map((preset) => [preset.id, preset]))
  const globalOutputFormula = settings.trainingOutputFormula ?? ''
  const globalGraphFormula = settings.trainingGraphFormula ?? ''
  return settings.trainingWatchProfiles
    .map((watchProfile) => {
      const preset = presetMap.get(watchProfile.presetId)
      if (!preset) return null
      return {
        id: watchProfile.id,
        name: watchProfile.name,
        sourceMode: 'watcher' as const,
        enabled: watchProfile.enabled,
        autoRun: watchProfile.autoRun,
        initialScanMode: watchProfile.initialScanMode,
        namingTemplate: preset.namingTemplate,
        architectures: preset.architectures,
        epochs: preset.epochs,
        thresholdEsr: preset.thresholdEsr,
        latencyMode: preset.latencyMode,
        latencyValue: preset.latencyValue,
        savePlot: preset.savePlot,
        ignoreChecks: preset.ignoreChecks,
        sourcePostProcess: watchProfile.sourcePostProcess,
        watchFolder: watchProfile.watchFolder,
        processedWavRoot: watchProfile.processedWavRoot,
        graphRoot: watchProfile.graphRoot,
        effectiveOutputFormula: effectiveFormula(globalOutputFormula, preset.outputFormulaOverride),
        effectiveGraphFormula: effectiveFormula(globalGraphFormula, preset.graphOutputFormulaOverride),
        finalModelRoot: watchProfile.finalModelRoot,
      }
    })
    .filter((profile): profile is TrainingProfile => profile !== null)
}

const AMPCOVER_PATTERN = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i

const HISTORY_STORAGE_KEY = 'nam-lab-history'
const HISTORY_MAX = 100

function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as Array<{ id: string; timestamp: string; operation: string; summary: string }>
    return parsed.slice(0, HISTORY_MAX).map((e) => ({ ...e, timestamp: new Date(e.timestamp) }))
  } catch {
    return []
  }
}
import { FolderNode } from './types/librarian'

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openFolder: (defaultPath?: string) => Promise<string | null>
      openImportFile: () => Promise<string | null>
      openAudioFile: () => Promise<string | null>
      openAudioFiles: () => Promise<string[]>
      openImageFile: () => Promise<string | null>
      readFileBinary: (filePath: string) => Promise<{ data?: string; error?: string }>
      hashFiles: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; hash?: string; error?: string }[]>
      hashFilesWithoutMetadata: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; hash?: string; error?: string }[]>
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
        mtimeMs?: number
        birthtimeMs?: number
        sizeBytes?: number
      }>
      writeMetadata: (filePath: string, metadata: unknown) => Promise<{ success: boolean; error?: string }>
      moveFile: (sourcePath: string, destDir: string, force?: boolean, destBaseName?: string) => Promise<{ success: boolean; error?: string; destPath?: string }>
      scanFolder: (folderPath: string, hiddenFolders?: string) => Promise<{ success: boolean; error?: string; files?: string[] }>
      scanTree: (folderPath: string, hiddenFolders?: string) => Promise<{ success: boolean; error?: string; tree?: FolderNode }>
      getErrorLogPath: () => Promise<string>
      getStartupLogPath: () => Promise<string>
      refocusWindow: () => Promise<void>
      statPath: (p: string) => Promise<{ isDirectory: boolean }>
      getDeleteBehavior: (filePaths: string[]) => Promise<{ permanentOnly: boolean; reason?: string }>
      getPathForFile: (file: File) => string
      renameFile: (oldPath: string, newBaseName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      watchFolder: (path: string | null) => Promise<void>
      onFolderChanged: (cb: () => void) => () => void
      setFolderWatchState: (payload: { rules: FolderWatchRule[]; imports: Record<string, FolderWatchImportEntry[]> }) => Promise<void>
      onFolderWatchCopied: (cb: (event: { sourcePath: string; destPath: string; sourceFolder: string; destFolder: string; importEntry: FolderWatchImportEntry }) => void) => () => void
      onFolderWatchError: (cb: (event: { sourceFolder: string; destFolder: string; message: string }) => void) => () => void
      createFolder: (parentPath: string, name: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      renameFolder: (folderPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
      moveFolder: (sourcePath: string, destParentPath: string, allowMerge?: boolean) => Promise<{ success: boolean; newPath?: string; error?: string; mergedIntoExisting?: boolean; mergeTargetPath?: string; skippedPaths?: string[] }>
      deleteEmptyFolder: (folderPath: string) => Promise<{ success: boolean; error?: string; removedCount?: number }>
      trashFiles: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; error?: string; deleteMode?: 'trash' | 'delete' }[]>
      copyFiles: (filePaths: string[], destDir: string, destBaseNames?: string[]) => Promise<{ filePath: string; success: boolean; destPath?: string; error?: string }[]>
      clearNamLab: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; error?: string }[]>
      cleanOutdatedNamBot: (filePaths: string[]) => Promise<{ filePath: string; success: boolean; error?: string; changed?: boolean }[]>
      getPendingFiles: () => Promise<string[]>
      onOpenFiles: (cb: (paths: string[]) => void) => () => void
      checkForUpdates: (includeRc: boolean) => Promise<{ hasUpdate?: boolean; latestVersion?: string; releaseUrl?: string; error?: string }>
      openExternal: (url: string) => Promise<void>
      showMessageBox: (options: { type?: 'none' | 'info' | 'error' | 'question' | 'warning'; title?: string; message: string; detail?: string; buttons: string[]; defaultId?: number; cancelId?: number; noLink?: boolean }) => Promise<{ response: number }>
      detectNamPlayer: () => Promise<boolean>
      browseExecutable: () => Promise<string | null>
      getTrainerState: () => Promise<TrainerStateSnapshot>
      startTrainerRun: (payload: TrainerStartPayload) => Promise<{ success: boolean; error?: string }>
      enqueueTrainerRuns: (payloads: TrainerStartPayload[]) => Promise<{ success: boolean; error?: string; queued?: number }>
      setTrainerProfilesState: (payload: {
        pythonPath: string
        inputPath: string
        modeledBy: string
        inputLevelDbu: number | null
        outputLevelDbu: number | null
        retainGraphs: boolean
        normalizeWav: boolean
        normalizeWavTargetDb: number
        profiles: TrainingProfile[]
      }) => Promise<{ success: boolean }>
      getTrainerProfilesState: () => Promise<TrainerProfilesStateSnapshot>
      markTrainingWatchCurrentContentsSeen: (profileId: string) => Promise<{ success: boolean; error?: string; marked?: number }>
      setTrainerProfileRunning: (profileId: string, running: boolean) => Promise<{ success: boolean; error?: string }>
      runTrainerFolderOnce: (payload: { profile: TrainingProfile; folderPath: string; pythonPath: string; inputPath: string; submissionId?: string; submissionLabel?: string; submissionCreatedAt?: string }) => Promise<{ success: boolean; error?: string; queued?: number; scanned?: number }>
      cancelTrainerRun: () => Promise<{ success: boolean; error?: string }>
      setTrainerPauseAfterCurrent: (pause: boolean) => Promise<{ success: boolean }>
      retryFailedTrainerRuns: () => Promise<{ success: boolean; retried?: number }>
      retryTrainerJob: (jobId: string) => Promise<{ success: boolean; error?: string }>
      clearFinishedTrainerRuns: () => Promise<{ success: boolean }>
      removeQueuedTrainerRuns: () => Promise<{ success: boolean }>
      removeTrainerJob: (jobId: string) => Promise<{ success: boolean; error?: string }>
      watcherQueueAction: (jobId: string, action: 'remove' | 'skip' | 'move-canceled' | 'retry-now') => Promise<{ success: boolean; error?: string }>
      moveTrainerJob: (jobId: string, direction: 'up' | 'down') => Promise<{ success: boolean; error?: string }>
      makeTrainerJobNext: (jobId: string) => Promise<{ success: boolean; error?: string }>
      retryTrainerHistoryEntry: (historyId: string) => Promise<{ success: boolean; error?: string; queued?: number }>
      onTrainerUpdate: (cb: (state: TrainerStateSnapshot) => void) => () => void
      openInNam: (filePath: string, standalonePath: string) => Promise<{ success: boolean; error?: string }>
      scanImages: (folderPath: string) => Promise<{ success: boolean; images: string[] }>
      findPackOwner: (folderPath: string, rootPath: string) => Promise<string | null>
      findPackFolders: (rootPath: string) => Promise<string[]>
      readPackInfo: (folderPath: string) => Promise<{ success: boolean; data: unknown }>
      writePackInfo: (folderPath: string, data: unknown) => Promise<{ success: boolean; error?: string }>
      deletePackInfo: (folderPath: string) => Promise<{ success: boolean; error?: string }>
      readReadme: (folderPath: string) => Promise<{ success: boolean; exists: boolean; fileName: string; content: string; error?: string }>
      writeReadme: (folderPath: string, fileName: string, content: string) => Promise<{ success: boolean; fileName?: string; error?: string }>
      exportPackSheet: (html: string) => Promise<{ success: boolean; error?: string }>
      readBundle: (folderPath: string) => Promise<{ success: boolean; data: unknown }>
      writeBundle: (folderPath: string, data: unknown) => Promise<{ success: boolean; error?: string }>
      deleteBundle: (folderPath: string) => Promise<{ success: boolean; error?: string }>
      scanBundlePaths: (rootPath: string) => Promise<string[]>
      findBundlePackFolders: (rootPath: string) => Promise<{ folderPath: string; title: string }[]>
      tone3000Status: () => Promise<{ connected: boolean; username: string | null }>
      tone3000Connect: () => Promise<{ ok: boolean; username?: string | null; error?: string }>
      tone3000Disconnect: () => Promise<{ ok: boolean }>
        tone3000Search: (params: { query?: string; page?: number; pageSize?: number; gears?: string[]; sizes?: string[]; sort?: string }) => Promise<{ ok?: boolean; data?: unknown; error?: string }>
        tone3000UsersSearch: (params: { query: string; page?: number; pageSize?: number; sort?: string }) => Promise<{ ok?: boolean; data?: unknown; error?: string }>
        tone3000Created: (params: { page?: number; pageSize?: number }) => Promise<{ ok?: boolean; data?: unknown; error?: string }>
        tone3000Favorited: (params: { page?: number; pageSize?: number }) => Promise<{ ok?: boolean; data?: unknown; error?: string }>
        tone3000GetTone: (toneId: number) => Promise<{ ok?: boolean; tone?: unknown; error?: string }>
      tone3000GetModels: (toneId: number) => Promise<{ ok?: boolean; models?: unknown[]; error?: string }>
      tone3000Download: (modelUrl: string, name: string) => Promise<{ ok?: boolean; localPath?: string; error?: string }>
      tone3000FileExists: (destDir: string, name: string) => Promise<{ exists: boolean; destPath?: string }>
      tone3000SaveCoverImage: (imageUrl: string, destDir: string) => Promise<{ ok?: boolean; skipped?: boolean; destPath?: string; error?: string }>
      platform: string
      initialSettings: unknown
      saveSettingsToFile: (json: string) => void
    }
  }
}


// onLoad=true: per-field fillOnLoad flags are enforced (auto-fill on open)
// onLoad=false: manual re-apply / training — always apply if enableCaptureDefaults is on
function applyDefaults(meta: NamFile['metadata'], baseName: string, settings: AppSettings, onLoad = false): NamFile['metadata'] {
  const m = { ...meta }

  // Name from filename
  if (!m.name && settings.populateNameFromFilename)
    m.name = baseName

  // Capture Defaults section
  if (settings.enableCaptureDefaults) {
    if (!m.modeled_by && settings.defaultModeledBy && (!onLoad || settings.fillOnLoadModeledBy))
      m.modeled_by = settings.defaultModeledBy

    if (m.input_level_dbu == null && settings.defaultInputLevel !== '' && (!onLoad || settings.fillOnLoadInputLevel)) {
      const n = parseFloat(settings.defaultInputLevel)
      if (!isNaN(n)) m.input_level_dbu = n
    }

    if (m.output_level_dbu == null && settings.defaultOutputLevel !== '' && (!onLoad || settings.fillOnLoadOutputLevel)) {
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

// Keywords that map to each tone type Ã¢â‚¬â€ order within each array doesn't matter,
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

function normalizeCreatorName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function formatBatchEditHistorySummary(batchFields: Partial<NamFile['metadata']>, fileCount: number): string {
  const entries = Object.entries(batchFields) as Array<[keyof NamFile['metadata'], unknown]>
  const details = entries.map(([field, value]) => {
    if (value === null || value === undefined || value === '') return `${field}=(cleared)`
    return `${field}=${String(value)}`
  })
  return `Batch edited ${fileCount} file${fileCount !== 1 ? 's' : ''} (${details.join(', ')})`
}


const EMPTY_LIBRARIAN: LibrarianState = {
  rootFolder: null,
  folderTree: null,
  selectedFolders: []
}

export default function App() {
  const [helpView, setHelpView] = useState<HelpModalTab | null>(null)
  const [files, setFiles] = useState<NamFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error'; logPath?: string }>({
    message: 'Open .nam files or a folder to get started',
    type: 'info'
  })
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const folderWatchBatchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [batchFolder, setBatchFolder] = useState<{ path: string | null; name: string; filePaths?: string[] } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedFilePanelTab, setSelectedFilePanelTab] = useState<'metadata' | 'training'>('metadata')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [namPlayerDetected, setNamPlayerDetected] = useState(false)
  const [librarian, setLibrarian] = useState<LibrarianState>(EMPTY_LIBRARIAN)
  const [libraryFilter, setLibraryFilter] = useState<Set<string> | null>(null)
  const [cardView, setCardView] = useState(false)
  const [cardViewInitialPath, setCardViewInitialPath] = useState<string | null>(null)
  const [toneStoreDefaultDir, setToneStoreDefaultDir] = useState<string | null>(null)
  const [cardRescanSignal, setCardRescanSignal] = useState(0)
  const [toneStorePanelWidth, setToneStorePanelWidth] = useState(() => {
    const saved = localStorage.getItem('toneStorePanelWidth')
    return saved ? Math.max(300, Math.min(700, Number(saved))) : 380
  })
  const initialLayout = loadLayout()
  const initialSettings = loadSettings()
  const [treeWidth, setTreeWidth] = useState(initialLayout.treeWidth)
  const [listViewMode, setListViewMode] = useState<'list' | 'grid'>(initialSettings.defaultView ?? 'list')
  const [listWidth, setListWidth] = useState(() => {
    const raw = (initialSettings.defaultView ?? 'list') === 'grid' ? initialLayout.listWidthGrid : initialLayout.listWidthList
    const maxList = window.innerWidth - initialLayout.treeWidth - 300
    return Math.min(raw, Math.max(140, maxList))
  })
  const loadGenRef = useRef(0)  // increments on every new folder load; stale scans discard results
  const draggingRef = useRef<null | { panel: 'tree' | 'list'; startX: number; startWidth: number }>(null)
  const mainContentRef = useRef<HTMLDivElement>(null)
  const preserveFolderTabRef = useRef<'pack' | null>(null)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [gridMaximized, setGridMaximized] = useState(false)
  const [gridSlideOpen, setGridSlideOpen] = useState(false)
  const [treeScrollTarget, setTreeScrollTarget] = useState<string | null>(null)
  const treeScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [folderChanged, setFolderChanged] = useState(false)
  const [activeFolderChecklistSummary, setActiveFolderChecklistSummary] = useState<ChecklistSummary | null>(null)
  const [activeFolderDeliverySummary, setActiveFolderDeliverySummary] = useState<DeliveryMatrixSummary | null>(null)
  const [dashboardChecklistEntries, setDashboardChecklistEntries] = useState<DashboardChecklistEntry[]>([])
  const [metadataCoverPath, setMetadataCoverPath] = useState<string | null>(null)
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [duplicatesScopeFolder, setDuplicatesScopeFolder] = useState<string | null>(null)
  const [metadataClipboard, setMetadataClipboard] = useState<{ sourceName: string; metadata: Partial<NamFile['metadata']> } | null>(null)
  const [importModal, setImportModal] = useState<{ folderName: string; exactMatches: ImportMatch[]; prefixMatches: ImportMatch[]; unmatchedNames: string[] } | null>(null)
  const [suggestMetadataModal, setSuggestMetadataModal] = useState<{ folderName: string; matches: MetadataSuggestionMatch[] } | null>(null)
  const [suggestRulesEditorPath, setSuggestRulesEditorPath] = useState<string | null>(null)
  const [suggestRulesClipboard, setSuggestRulesClipboard] = useState<{ sourceFolderPath: string; rules: MetadataSuggestRule[] } | null>(null)
  const [showLibraryCleanup, setShowLibraryCleanup] = useState(false)
  const [libraryCleanupOpenMode, setLibraryCleanupOpenMode] = useState<'library' | 'folder'>('library')
  const [libraryCleanupSourceRoot, setLibraryCleanupSourceRoot] = useState<string | null>(null)
  const [libraryCleanupDestinationRoot, setLibraryCleanupDestinationRoot] = useState<string | null>(null)
  const [libraryCleanupActionMode, setLibraryCleanupActionMode] = useState<'copy' | 'move'>('copy')
  const [libraryCleanupLayout, setLibraryCleanupLayout] = useState<LibraryCleanupLayout>('creator-amp-di-cab')
  const [libraryCleanupFolderEntries, setLibraryCleanupFolderEntries] = useState<LibraryCleanupFolderEntry[]>([])
  const [libraryCleanupFilePaths, setLibraryCleanupFilePaths] = useState<string[]>([])
  const [libraryCleanupPreviewRows, setLibraryCleanupPreviewRows] = useState<LibraryCleanupPreviewRow[] | null>(null)
  const [libraryCleanupBusyLabel, setLibraryCleanupBusyLabel] = useState<string | null>(null)
  const [libraryCleanupRememberUnchecked, setLibraryCleanupRememberUnchecked] = useState(true)
  const [coverageReport, setCoverageReport] = useState<{ folderPath: string } | null>(null)
  const [watcherKey, setWatcherKey] = useState(0)
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('nam-lab-recent-folders')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  const [folderImages, setFolderImages] = useState<FolderImagesData | null>(null)
  const [activeFolderReadiness, setActiveFolderReadiness] = useState<FolderReadinessSummary | null>(null)
  const [folderPanelTab, setFolderPanelTab] = useState<'overview' | 'pack' | 'checklist' | 'gallery' | 'readme' | 'targets'>(settings.defaultFolderTab)
  // Path of the ancestor that owns the pack info for the current folder (null = current folder may own one)
  const [packInfoAncestor, setPackInfoAncestor] = useState<string | null>(null)
  // Set of folder paths that have a valid nam-pack.json (non-empty title) Ã¢â‚¬â€ drives blue dot in tree
  const [packInfoFolders, setPackInfoFolders] = useState<Set<string>>(new Set())
  // Set of folder paths that have a nam-bundle.json Ã¢â‚¬â€ drives chain-link icon in tree
  const [bundleFolders, setBundleFolders] = useState<Set<string>>(new Set())
  // Folder compare modal: array of paths to compare (null = closed)
  const [compareFolderPaths, setCompareFolderPaths] = useState<string[] | null>(null)
  const [showDashboard, setShowDashboard] = useState(settings.showDashboardOnLaunch)
  // Suppress auto-selection of the first file on startup when the dashboard is shown on launch,
  // so the dashboard stays visible after the default folder loads.
  const suppressStartupAutoSelectRef = useRef(settings.showDashboardOnLaunch)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [showToneStore, setShowToneStore] = useState(false)
  const [showTrainingWorkspace, setShowTrainingWorkspace] = useState(false)
  const [trainingWorkspaceMode, setTrainingWorkspaceMode] = useState<'files' | 'folder' | 'queue' | 'history'>('files')
  const [globalTrainerState, setGlobalTrainerState] = useState<TrainerStateSnapshot>(IDLE_TRAINER_STATE)
  const trainerWatcherAutoStartRecoveryRef = useRef('')
  const [toneStoreMounted, setToneStoreMounted] = useState(false)
  const [toneStoreQueueJob, setToneStoreQueueJob] = useState<ToneStoreDownloadQueueJob | null>(null)
  const toneStoreQueueRunningRef = useRef(false)
  const toneStoreQueueAbortRef = useRef(0)
  const loadFilesRef = useRef<null | ((paths: string[], mode: 'replace' | 'append' | 'append-passive', genToken?: number) => Promise<void>)>(null)
  const refreshFolderTreeRef = useRef<null | (() => Promise<void>)>(null)
  const [directFilesOnly, setDirectFilesOnly] = useState(false)
  const [toneStoreSearchRequest, setToneStoreSearchRequest] = useState<{ key: number; query: string } | null>(null)
  const [sessionHistory, setSessionHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null)
  const [gearTypeFilter, setGearTypeFilter] = useState<string | null>(null)
  const [toneTypeFilter, setToneTypeFilter] = useState<string | null>(null)
  const [presetFilterOverride, setPresetFilterOverride] = useState<string | null>(null)
  const [filterModeOverride, setFilterModeOverride] = useState<'all' | 'unnamed' | 'no-gear' | 'no-maker' | 'no-tone' | 'edited' | 'incomplete' | 'complete' | 'rated' | 'duplicates' | null>(null)
  const [esrFilterOverride, setEsrFilterOverride] = useState<string | null>(null)
  const [ratingFilter, setRatingFilter] = useState<number | null>(null)

  const runToneStoreQueueStep = useCallback(async (
    toneId: number,
    model: ToneModel
  ): Promise<{ localPath?: string; error?: string; retryable403?: boolean; refreshedModel?: ToneModel }> => {
    const initial = await window.api.tone3000Download(model.model_url, model.name)
    if (!initial.error || !/\(403\)/.test(initial.error)) return initial

    await wait(1500)
    const refreshedModels = await window.api.tone3000GetModels(toneId)
    if (refreshedModels.error || !refreshedModels.models) return { ...initial, retryable403: true }
    const refreshed = (refreshedModels.models as ToneModel[]).find((entry) => entry.id === model.id)
    if (!refreshed) return { ...initial, retryable403: true }
    const retried = await window.api.tone3000Download(refreshed.model_url, refreshed.name)
    if (retried.error && /\(403\)/.test(retried.error)) {
      return { ...retried, retryable403: true, refreshedModel: refreshed }
    }
    return { ...retried, refreshedModel: refreshed }
  }, [])

  useEffect(() => {
    if (!toneStoreQueueJob || toneStoreQueueJob.status !== 'cooldown') return
    const backoffMs = Math.min(5000 * Math.max(toneStoreQueueJob.resumePass, 1), 30000)
    const timer = window.setTimeout(() => {
      setToneStoreQueueJob((prev) => prev && prev.status === 'cooldown'
        ? { ...prev, status: 'running', message: `Resuming at file ${prev.nextIndex + 1} of ${prev.items.length}...` }
        : prev)
    }, backoffMs)
    return () => window.clearTimeout(timer)
  }, [toneStoreQueueJob])

  useEffect(() => {
    if (!toneStoreQueueJob) return
    if (toneStoreQueueJob.status === 'error') {
      setStatus({ message: toneStoreQueueJob.message, type: 'error' })
    }
  }, [toneStoreQueueJob])

  useEffect(() => {
    if (!toneStoreQueueJob || toneStoreQueueJob.status !== 'running' || toneStoreQueueRunningRef.current) return
    toneStoreQueueRunningRef.current = true

    const runQueue = async () => {
      const abortToken = toneStoreQueueAbortRef.current
      const items = [...toneStoreQueueJob.items]
      const downloadedPaths = [...toneStoreQueueJob.downloadedPaths]
      let skipped = toneStoreQueueJob.skipped

      for (let i = toneStoreQueueJob.nextIndex; i < items.length; i++) {
        if (toneStoreQueueAbortRef.current !== abortToken) return
        const model = items[i]

        const existingDest = await window.api.tone3000FileExists(toneStoreQueueJob.destDir, model.name)
        if (toneStoreQueueAbortRef.current !== abortToken) return
        if (existingDest.exists) {
          skipped++
          setToneStoreQueueJob((prev) => prev ? {
            ...prev,
            items,
            downloadedPaths: [...downloadedPaths],
            skipped,
            nextIndex: i + 1,
            resumePass: 0,
            message: `Skipping existing file ${i + 1} of ${items.length}...`
          } : prev)
          continue
        }

        setToneStoreQueueJob((prev) => prev ? { ...prev, nextIndex: i, message: `Downloading ${i + 1} of ${items.length}...` } : prev)

        const dlResult = await runToneStoreQueueStep(toneStoreQueueJob.toneId, model)
        if (toneStoreQueueAbortRef.current !== abortToken) return
        if (dlResult.refreshedModel) items[i] = dlResult.refreshedModel

        if (dlResult.retryable403) {
          const nextPass = toneStoreQueueJob.resumePass + 1
          if (nextPass > 10) {
            const errorMessage = `Tone3000 kept returning 403 near "${model.name}". Please retry this batch in a moment.`
            setToneStoreQueueJob((prev) => prev ? { ...prev, items, nextIndex: i, resumePass: nextPass, status: 'error', message: errorMessage } : prev)
            return
          }
          setToneStoreQueueJob((prev) => prev ? {
            ...prev,
            items,
            nextIndex: i,
            resumePass: nextPass,
            status: 'cooldown',
            message: `Tone3000 paused downloads near "${model.name}". Waiting for Tone3000 access to resume before retry ${nextPass} of 10...`
          } : prev)
          return
        }

        if (dlResult.error || !dlResult.localPath) {
          const errorMessage = `Failed on "${model.name}": ${dlResult.error ?? 'unknown error'}`
          setToneStoreQueueJob((prev) => prev ? { ...prev, items, nextIndex: i, status: 'error', message: errorMessage } : prev)
          return
        }

        const copyResults = await window.api.copyFiles([dlResult.localPath], toneStoreQueueJob.destDir)
        if (toneStoreQueueAbortRef.current !== abortToken) return
        const copied = copyResults[0]
        if (copied.success && copied.destPath) {
          downloadedPaths.push(copied.destPath)
        } else if (copied.error === 'exists') {
          skipped++
        } else {
          const errorMessage = `Failed on "${model.name}": ${copied.error ?? 'copy failed'}`
          setToneStoreQueueJob((prev) => prev ? { ...prev, items, nextIndex: i, skipped, status: 'error', message: errorMessage } : prev)
          return
        }

        setToneStoreQueueJob((prev) => prev ? {
          ...prev,
          items,
          downloadedPaths: [...downloadedPaths],
          skipped,
          nextIndex: i + 1,
          resumePass: 0,
          message: `Downloading ${Math.min(i + 2, items.length)} of ${items.length}...`
        } : prev)
        if (i < items.length - 1) {
          await wait(350)
          if (toneStoreQueueAbortRef.current !== abortToken) return
        }
      }

      let coverSaved = false
      if (toneStoreQueueJob.coverImageUrl) {
        const coverResult = await window.api.tone3000SaveCoverImage(toneStoreQueueJob.coverImageUrl, toneStoreQueueJob.destDir)
        if (toneStoreQueueAbortRef.current !== abortToken) return
        if (!coverResult.error && !coverResult.skipped) coverSaved = true
      }

      if (toneStoreQueueJob.packInfoSeed) {
        const existingPack = await window.api.readPackInfo(toneStoreQueueJob.destDir)
        if (toneStoreQueueAbortRef.current !== abortToken) return
        const seededPackInfo = {
          title: toneStoreQueueJob.packInfoSeed.title,
          subtitle: '',
          capturedBy: toneStoreQueueJob.packInfoSeed.capturedBy,
          description: toneStoreQueueJob.packInfoSeed.description,
          equipment: [],
          pedals: [],
          switches: [],
          glossary: [],
          footer: '',
          exportExcludedSubfolders: [],
          exportExcludedCaptures: [],
          exportColumns: ['name', 'maker', 'model', 'tone', 'input', 'output'],
          recommendedInputGain: '',
          checklistItems: [],
          checklistNotes: '',
          targetDate: '',
          liveDate: '',
          versionInfo: '',
        }

        let packToWrite: unknown | null = null
        if (existingPack.success && !existingPack.data) {
          packToWrite = seededPackInfo
        } else if (existingPack.success && existingPack.data && typeof existingPack.data === 'object') {
          const existingData = existingPack.data as Record<string, unknown>
          const existingTitle = typeof existingData.title === 'string' ? existingData.title.trim() : ''
          const existingCapturedBy = typeof existingData.capturedBy === 'string' ? existingData.capturedBy.trim() : ''
          const existingDescription = typeof existingData.description === 'string' ? existingData.description : ''
          const incomingTitle = toneStoreQueueJob.packInfoSeed.title.trim()
          const incomingCapturedBy = toneStoreQueueJob.packInfoSeed.capturedBy.trim()
          const looksDifferent =
            (incomingTitle && incomingTitle !== existingTitle) ||
            (incomingCapturedBy && incomingCapturedBy !== existingCapturedBy)

          if (looksDifferent) {
            const choice = await window.api.showMessageBox({
              type: 'question',
              title: 'Tone3000 Pack Info Already Exists',
              message: 'This destination folder already has Pack Info.',
              detail:
                `Existing title: ${existingTitle || '(blank)'}\n` +
                `Incoming title: ${incomingTitle || '(blank)'}\n\n` +
                'Choose how NAM Lab should handle the new Tone3000 notes.',
              buttons: ['Keep Existing', 'Append Notes', 'Replace Pack Info'],
              defaultId: 1,
              cancelId: 0,
              noLink: true,
            })
            if (toneStoreQueueAbortRef.current !== abortToken) return

            if (choice.response === 1) {
              const existingDescTrimmed = existingDescription.trim()
              const incomingDescTrimmed = toneStoreQueueJob.packInfoSeed.description.trim()
              const joinedDescription = [existingDescTrimmed, incomingDescTrimmed]
                .filter(Boolean)
                .join('\n\n---\n\n')
              packToWrite = {
                ...existingData,
                description: joinedDescription,
              }
            } else if (choice.response === 2) {
              packToWrite = seededPackInfo
            }
          }
        }

        if (packToWrite) {
          const writeResult = await window.api.writePackInfo(toneStoreQueueJob.destDir, packToWrite)
          if (toneStoreQueueAbortRef.current !== abortToken) return
          if (writeResult.success && toneStoreQueueJob.packInfoSeed.title.trim()) {
            const normalizedDest = toneStoreQueueJob.destDir.replace(/\\/g, '/')
            setPackInfoFolders((prev) => {
              const next = new Set(prev)
              next.add(normalizedDest)
              return next
            })
          }
        }
      }

      const selectedCount = items.length
      const msg = skipped > 0
        ? `${selectedCount} model${selectedCount !== 1 ? 's' : ''} selected, ${downloadedPaths.length} saved, ${skipped} skipped (already existed or duplicate filenames)${coverSaved ? ', ampcover image added' : ''}`
        : `${selectedCount} model${selectedCount !== 1 ? 's' : ''} selected, ${downloadedPaths.length} saved${coverSaved ? ', ampcover image added' : ''}`
      setToneStoreQueueJob((prev) => prev ? { ...prev, items, downloadedPaths, skipped, nextIndex: items.length, status: 'done', message: msg } : prev)
      setStatus({ message: `Tone3000 download complete: ${msg}`, type: 'success' })
      if (downloadedPaths.length > 0) await loadFilesRef.current?.(downloadedPaths, 'append')
      setCardRescanSignal((s) => s + 1)
      await refreshFolderTreeRef.current?.()
    }

    void runQueue().finally(() => {
      toneStoreQueueRunningRef.current = false
    })
  }, [runToneStoreQueueStep, toneStoreQueueJob])

  useEffect(() => {
    if (!settings.enableExperimentalTraining && selectedFilePanelTab === 'training') {
      setSelectedFilePanelTab('metadata')
    }
  }, [settings.enableExperimentalTraining, selectedFilePanelTab])

  useEffect(() => {
    if (!settings.enableExperimentalTraining && showTrainingWorkspace) {
      setShowTrainingWorkspace(false)
    }
  }, [settings.enableExperimentalTraining, showTrainingWorkspace])

  // Reset folder panel tab and check for pack-owning ancestor when selected folder changes
  useEffect(() => {
    const sf = librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null
    const rf = librarian.rootFolder
    const nextFolderTab = preserveFolderTabRef.current ?? settings.defaultFolderTab
    preserveFolderTabRef.current = null
    if (!sf || !rf || sf === rf) {
      setPackInfoAncestor(null)
      setFolderPanelTab(nextFolderTab)
      return
    }
    let cancelled = false
    window.api.findPackOwner(sf, rf).then((owner) => {
      if (cancelled) return
      setPackInfoAncestor(owner)
      setFolderPanelTab(nextFolderTab)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [librarian.selectedFolders, librarian.rootFolder])

  useEffect(() => {
    setDirectFilesOnly(false)
  }, [librarian.selectedFolders, librarian.rootFolder])

  useEffect(() => {
    const activeFolderPath = ((librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null) ?? librarian.rootFolder)
    if (!activeFolderPath || !packInfoFolders.has(activeFolderPath)) {
      setActiveFolderChecklistSummary(null)
      return
    }
    let cancelled = false
    window.api.readPackInfo(activeFolderPath).then((res) => {
      if (cancelled) return
      setActiveFolderChecklistSummary(res.success ? summarizeChecklist(res.data) : null)
    }).catch(() => {
      if (!cancelled) setActiveFolderChecklistSummary(null)
    })
    return () => { cancelled = true }
  }, [librarian.selectedFolders, librarian.rootFolder, packInfoFolders])

  useEffect(() => {
    const activeFolderPath = ((librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null) ?? librarian.rootFolder)
    if (!activeFolderPath || !packInfoFolders.has(activeFolderPath)) {
      setActiveFolderDeliverySummary(null)
      return
    }
    let cancelled = false
    window.api.readPackInfo(activeFolderPath).then((res) => {
      if (cancelled) return
      setActiveFolderDeliverySummary(res.success ? summarizeDeliveryMatrix(res.data) : null)
    }).catch(() => {
      if (!cancelled) setActiveFolderDeliverySummary(null)
    })
    return () => { cancelled = true }
  }, [librarian.selectedFolders, librarian.rootFolder, packInfoFolders])

  useEffect(() => {
    const activeFolderPath = ((librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null) ?? librarian.rootFolder)
    if (!activeFolderPath) return
    if (!packInfoFolders.has(activeFolderPath) && (folderPanelTab === 'checklist' || folderPanelTab === 'targets')) {
      setFolderPanelTab('pack')
    }
  }, [folderPanelTab, librarian.selectedFolders, librarian.rootFolder, packInfoFolders])

  useEffect(() => {
    const rootPath = librarian.rootFolder
    if (!rootPath || packInfoFolders.size === 0) {
      setDashboardChecklistEntries([])
      return
    }
    let cancelled = false
    Promise.all(
      [...packInfoFolders].map(async (folderPath) => {
        const res = await window.api.readPackInfo(folderPath)
        const summary = res.success ? summarizeChecklist(res.data) : null
        if (!summary || summary.completed >= summary.total) return null
        const normalizedRoot = rootPath.replace(/\\/g, '/')
        const normalizedFolder = folderPath.replace(/\\/g, '/')
        const relative = normalizedFolder === normalizedRoot
          ? normalizedFolder.split('/').pop() ?? normalizedFolder
          : normalizedFolder.startsWith(normalizedRoot + '/')
            ? `${normalizedRoot.split('/').pop() ?? normalizedRoot}\\${normalizedFolder.slice(normalizedRoot.length + 1).replace(/\//g, '\\')}`
            : normalizedFolder.replace(/\//g, '\\')
        return {
          folderPath,
          folderLabel: relative,
          status: formatChecklistStatus(summary),
          progressLabel: `${summary.completed}/${summary.total} complete`,
          percent: summary.percent,
        } satisfies DashboardChecklistEntry
      })
    ).then((entries) => {
      if (cancelled) return
      setDashboardChecklistEntries(entries.filter((entry): entry is DashboardChecklistEntry => entry !== null).sort((a, b) => a.folderLabel.localeCompare(b.folderLabel)))
    }).catch(() => {
      if (!cancelled) setDashboardChecklistEntries([])
    })
    return () => { cancelled = true }
  }, [librarian.rootFolder, packInfoFolders])

  // Scan all pack-info folders under the current root (drives blue dot in tree)
  const refreshPackInfoFolders = useCallback(() => {
    const rf = librarian.rootFolder
    if (!rf) {
      setPackInfoFolders(new Set())
      return
    }
    window.api.findPackFolders(rf).then((paths) => {
      setPackInfoFolders(new Set(paths))
    }).catch(() => {
      setPackInfoFolders(new Set())
    })
  }, [librarian.rootFolder])

  useEffect(() => {
    refreshPackInfoFolders()
  }, [refreshPackInfoFolders])

  // Scan bundle folders when root folder changes (drives chain-link icon in tree)
  const refreshBundleFolders = useCallback(() => {
    const rf = librarian.rootFolder
    if (!rf) { setBundleFolders(new Set()); return }
    window.api.scanBundlePaths(rf)
      .then((paths) => setBundleFolders(new Set(paths)))
      .catch(console.error)
  }, [librarian.rootFolder])

  useEffect(() => { refreshBundleFolders() }, [refreshBundleFolders])

  const handleCreateBundle = useCallback(async (folderPath: string) => {
    const empty = { title: '', subtitle: '', description: '', linkedPacks: [] }
    await window.api.writeBundle(folderPath, empty)
    refreshBundleFolders()
  }, [refreshBundleFolders])

  const handleDeleteBundle = useCallback((_folderPath: string) => {
    refreshBundleFolders()
    // navigate away from the bundle folder so BundleEditor unmounts cleanly
    setLibrarian((prev) => ({ ...prev, selectedFolders: prev.selectedFolders }))
  }, [refreshBundleFolders])

  // Scan folder images when selected folder changes (only when feature is enabled)
  useEffect(() => {
    const sf = librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null
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
      const own = ownResult.success ? ownResult.images.filter((imagePath) => {
        const fileName = imagePath.replace(/\\/g, '/').split('/').pop() ?? ''
        return !AMPCOVER_PATTERN.test(fileName)
      }) : []
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
          if (parent === normRoot) break  // stop before root Ã¢â‚¬â€ root images only show at root
          const parentResult = await window.api.scanImages(parent)
          if (cancelled) return
          const parentPaths = parentResult.success
            ? parentResult.images.filter((imagePath) => {
                const fileName = imagePath.replace(/\\/g, '/').split('/').pop() ?? ''
                return !AMPCOVER_PATTERN.test(fileName)
              })
            : []
          if (parentPaths.length > 0) {
            const folderName = parent.substring(parent.lastIndexOf('/') + 1)
            inherited.push({ folderName, paths: parentPaths })
          }
          current = parent
        }
      }
      setFolderImages({ own, inherited })
    }
    scan()
    return () => { cancelled = true }
  }, [librarian.selectedFolders, librarian.rootFolder, settings.showFolderImages])

  useEffect(() => {
    const targetFolder = (librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null) ?? librarian.rootFolder
    if (!targetFolder) {
      setActiveFolderReadiness(null)
      return
    }
    let cancelled = false
    Promise.all([
      window.api.readReadme(targetFolder),
      window.api.scanImages(targetFolder),
    ]).then(([readmeRes, imagesRes]) => {
      if (cancelled) return
      const imagePaths = imagesRes.success ? imagesRes.images : []
      const galleryCount = imagePaths.filter((imagePath) => {
        const fileName = imagePath.replace(/\\/g, '/').split('/').pop() ?? ''
        return !AMPCOVER_PATTERN.test(fileName)
      }).length
      const hasCoverImage = imagePaths.some((imagePath) => {
        const fileName = imagePath.replace(/\\/g, '/').split('/').pop() ?? ''
        return AMPCOVER_PATTERN.test(fileName)
      })
      const folderFiles = files.filter((file) => {
        const normalized = file.filePath.replace(/\\/g, '/')
        return normalized.startsWith(targetFolder.replace(/\\/g, '/') + '/')
      })
      const recentThreshold = Date.now() - (7 * 24 * 60 * 60 * 1000)
      const recentUpdatedCount = folderFiles.filter((file) => (file.mtimeMs ?? 0) >= recentThreshold).length
      setActiveFolderReadiness({
        hasReadme: !!readmeRes.success && !!readmeRes.exists,
        galleryCount,
        hasCoverImage,
        recentUpdatedCount,
      })
    }).catch(() => {
      if (!cancelled) setActiveFolderReadiness(null)
    })
    return () => { cancelled = true }
  }, [files, librarian.selectedFolders, librarian.rootFolder])

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

  function showTransientStatus(next: { message: string; type: 'info' | 'success' | 'error'; logPath?: string }, ms = 5000) {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current)
      statusTimeoutRef.current = null
    }
    setStatus(next)
    statusTimeoutRef.current = setTimeout(() => {
      setStatus((prev) => (
        prev.message === next.message && prev.type === next.type && prev.logPath === next.logPath
          ? { message: '', type: 'info' }
          : prev
      ))
      statusTimeoutRef.current = null
    }, ms)
  }

  useEffect(() => {
    void window.api.setFolderWatchState({
      rules: settings.folderWatchRules,
      imports: settings.folderWatchImports,
    })
  }, [settings.folderWatchImports, settings.folderWatchRules])

  useEffect(() => {
    const captureDefaultsEnabled = settings.enableCaptureDefaults
    const defaultInputLevel = captureDefaultsEnabled && settings.defaultInputLevel.trim() !== ''
      ? Number.parseFloat(settings.defaultInputLevel.trim())
      : null
    const defaultOutputLevel = captureDefaultsEnabled && settings.defaultOutputLevel.trim() !== ''
      ? Number.parseFloat(settings.defaultOutputLevel.trim())
      : null

    void window.api.setTrainerProfilesState({
      pythonPath: settings.namPythonPath,
      inputPath: settings.namTrainingInputWav,
      modeledBy: captureDefaultsEnabled ? settings.defaultModeledBy : '',
      inputLevelDbu: Number.isFinite(defaultInputLevel) ? defaultInputLevel : null,
      outputLevelDbu: Number.isFinite(defaultOutputLevel) ? defaultOutputLevel : null,
      retainGraphs: settings.trainingRetainGraphs,
      normalizeWav: settings.normalizeWavBeforeTraining ?? true,
      normalizeWavTargetDb: settings.normalizeWavTargetDb ?? -5.0,
      profiles: settings.enableExperimentalTraining ? resolveTrainingWatcherProfiles(settings) : [],
      userCaptureProfiles: settings.userCaptureProfiles ?? [],
    })
  }, [
    settings.enableCaptureDefaults,
    settings.enableExperimentalTraining,
    settings.namPythonPath,
    settings.namTrainingInputWav,
    settings.defaultModeledBy,
    settings.defaultInputLevel,
    settings.defaultOutputLevel,
    settings.trainingPresets,
    settings.trainingWatchProfiles,
    settings.trainingRetainGraphs,
    settings.normalizeWavBeforeTraining,
    settings.normalizeWavTargetDb,
    settings.userCaptureProfiles,
  ])

  useEffect(() => {
    const pendingBatches = new Map<string, {
      count: number
      sourceFolder: string
      destFolder: string
      lastFileName: string
    }>()

    const pushWatchHistoryEntry = (summary: string) => {
      setSessionHistory((current) => {
        const next: HistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date(),
          operation: 'watch-copy',
          summary,
        }
        return [next, ...current].slice(0, HISTORY_MAX)
      })
    }

    const unsubCopied = window.api.onFolderWatchCopied(async ({ destPath, destFolder, sourceFolder, importEntry }) => {
      const normalizedDestPath = destPath.replace(/\\/g, '/')
      const normalizedDestFolder = destFolder.replace(/\\/g, '/')
      const normalizedRoot = librarian.rootFolder?.replace(/\\/g, '/')
      const watchKey = makeFolderWatchKey(sourceFolder, destFolder)
      setSettings((prev) => {
        const existingEntries = prev.folderWatchImports[watchKey] ?? []
        const nextEntries = existingEntries
          .filter((entry) => entry.sourcePath !== importEntry.sourcePath)
          .concat(importEntry)
        const next = {
          ...prev,
          folderWatchImports: {
            ...prev.folderWatchImports,
            [watchKey]: nextEntries,
          },
        }
        saveSettings(next)
        return next
      })
      if (normalizedRoot && (normalizedDestFolder === normalizedRoot || normalizedDestFolder.startsWith(normalizedRoot + '/'))) {
        await loadFilesRef.current?.([normalizedDestPath], 'append-passive')
        await refreshFolderTreeRef.current?.()
      }
      const batchKey = `${sourceFolder}=>${normalizedDestFolder}`
      const fileName = normalizedDestPath.split('/').pop() ?? 'file'
      const batch = pendingBatches.get(batchKey) ?? {
        count: 0,
        sourceFolder,
        destFolder: normalizedDestFolder,
        lastFileName: fileName,
      }
      batch.count += 1
      batch.lastFileName = fileName
      pendingBatches.set(batchKey, batch)

      const existingTimer = folderWatchBatchTimersRef.current.get(batchKey)
      if (existingTimer) clearTimeout(existingTimer)
      const timer = setTimeout(() => {
        folderWatchBatchTimersRef.current.delete(batchKey)
        const current = pendingBatches.get(batchKey)
        if (!current) return
        pendingBatches.delete(batchKey)
        const summary = current.count === 1
          ? `Watch copied ${current.lastFileName} from ${formatPathLabel(current.sourceFolder)} to ${formatPathLabel(current.destFolder)}`
          : `Watch copied ${current.count} files from ${formatPathLabel(current.sourceFolder)} to ${formatPathLabel(current.destFolder)}`
        showTransientStatus({ message: summary, type: 'success' })
        pushWatchHistoryEntry(summary)
      }, 1500)
      folderWatchBatchTimersRef.current.set(batchKey, timer)
    })
    const unsubBackfilled = window.api.onFolderWatchImportsBackfilled(({ key, entries }) => {
      setSettings((prev) => {
        const existing = prev.folderWatchImports[key] ?? []
        const backfilledByPath = new Map(entries.map((e) => [e.sourcePath, e]))
        // Merge: update existing entries that gained a contentHash, keep entries not in backfill
        const merged = existing.map((e) => backfilledByPath.get(e.sourcePath) ?? e)
        const existingPaths = new Set(existing.map((e) => e.sourcePath))
        for (const e of entries) { if (!existingPaths.has(e.sourcePath)) merged.push(e) }
        const next = { ...prev, folderWatchImports: { ...prev.folderWatchImports, [key]: merged } }
        saveSettings(next)
        return next
      })
    })
    const unsubError = window.api.onFolderWatchError(({ destFolder, message }) => {
      setStatus({
        message: `Folder watch for ${formatPathLabel(destFolder)} failed: ${message}`,
        type: 'error'
      })
    })
    return () => {
      for (const timer of folderWatchBatchTimersRef.current.values()) clearTimeout(timer)
      folderWatchBatchTimersRef.current.clear()
      unsubCopied()
      unsubBackfilled()
      unsubError()
    }
  }, [librarian.rootFolder, showTransientStatus])


  // Electron on Windows loses keyboard focus when the focused DOM element is removed
  // (e.g. BatchEditor unmounts) or after native confirm dialogs close. Chromium's
  // internal focus state gets stale. Fix: DOM focus as first attempt, then a blurÃ¢â€ â€™focus
  // cycle in main process which resets OS-level keyboard routing (same as Alt+Tab).
  useEffect(() => {
    mainContentRef.current?.focus()
  }, [showSettings, batchFolder])

  useEffect(() => {
    if (selectedIds.size > 0 && !cardView) {
      setShowDashboard(false)
      setHistoryOpen(false)
      setShowToneStore(false)
    }
  }, [selectedIds, cardView])

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
      // Persist layout Ã¢â‚¬â€ save per-mode list width
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

  const mergeRulesIntoLibrary = useCallback((existingLibrary: MetadataSuggestRule[], sourceRules: MetadataSuggestRule[]) => {
    const existing = new Set(existingLibrary.map(metadataSuggestRuleSignature))
    const additions = sourceRules
      .filter(isMetadataSuggestRuleLibraryCandidate)
      .filter((rule) => !existing.has(metadataSuggestRuleSignature(rule)))
      .map((rule) => cloneMetadataSuggestRule(rule, 'library'))
    return additions.length > 0 ? [...existingLibrary, ...additions] : existingLibrary
  }, [])

  const updateFolderWatchRules = useCallback((updater: (rules: FolderWatchRule[]) => FolderWatchRule[]) => {
    setSettings((prev) => {
      const nextRules = updater(prev.folderWatchRules)
      const validKeys = new Set(nextRules.map((rule) => makeFolderWatchKey(rule.sourceFolder, rule.destFolder)))
      const nextImports = Object.fromEntries(
        Object.entries(prev.folderWatchImports).filter(([key]) => validKeys.has(key))
      ) as AppSettings['folderWatchImports']
      const next = { ...prev, folderWatchRules: nextRules, folderWatchImports: nextImports }
      saveSettings(next)
      return next
    })
  }, [])

  const handleSetWatchSource = useCallback(async (destFolder: string) => {
    const existing = settings.folderWatchRules.find((rule) => rule.destFolder === destFolder && rule.enabled)
    const picked = await window.api.openFolder(existing?.sourceFolder ?? destFolder)
    if (!picked) return
    const normalizedSource = picked.replace(/\\/g, '/')
    const normalizedDest = destFolder.replace(/\\/g, '/')
    if (normalizedSource === normalizedDest) {
      setStatus({ message: 'Watch source cannot be the same as the destination folder', type: 'error' })
      return
    }
    if (normalizedDest.startsWith(normalizedSource + '/') || normalizedSource.startsWith(normalizedDest + '/')) {
      setStatus({ message: 'Watch source and destination cannot be nested inside each other', type: 'error' })
      return
    }
    updateFolderWatchRules((rules) => {
      const next = rules.filter((rule) => rule.destFolder !== normalizedDest)
      next.push({ sourceFolder: normalizedSource, destFolder: normalizedDest, enabled: true })
      return next
    })
    showTransientStatus({
      message: `Watching ${formatPathLabel(normalizedSource)} for new .nam files into ${formatPathLabel(normalizedDest)}`,
      type: 'success'
    })
  }, [settings.folderWatchRules, showTransientStatus, updateFolderWatchRules])

  const handleClearWatchSource = useCallback((destFolder: string) => {
    const normalizedDest = destFolder.replace(/\\/g, '/')
    updateFolderWatchRules((rules) => rules.filter((rule) => rule.destFolder !== normalizedDest))
    showTransientStatus({
      message: `Stopped watching source for ${normalizedDest.split('/').pop()}`,
      type: 'info'
    })
  }, [showTransientStatus, updateFolderWatchRules])

  const handleDeletePackInfo = async (folderPath: string) => {
    if (!window.confirm(`Delete the Pack Info file for "${folderPath.split('/').pop()}"?\n\nThis cannot be undone.`)) return
    const res = await window.api.deletePackInfo(folderPath)
    if (res.success) handlePackSaved(folderPath, false)
    else setStatus({ message: `Failed to delete pack info: ${res.error}`, type: 'error' })
  }

  // Called by PackInfoEditor after saving Ã¢â‚¬â€ updates the blue-dot set in the tree
  const handlePackSaved = (folderPath: string, hasData: boolean) => {
    setPackInfoFolders((prev) => {
      const next = new Set(prev)
      if (hasData) next.add(folderPath)
      else next.delete(folderPath)
      return next
    })
  }

  // Auto-load default folder on startup (moved below loadFolderByPath Ã¢â‚¬â€ see combined startup effect)

  // mode='replace': clear existing, load fresh (open folder/files)
  // Shared: turn raw IPC read results into NamFile[] and update state
  const applyParsedResults = useCallback(async (
    results: { success: boolean; filePath?: string; metadata?: NamFile['metadata']; version?: string; architecture?: string; config?: unknown; error?: string; mtimeMs?: number; birthtimeMs?: number; sizeBytes?: number }[],
    mode: 'replace' | 'append' | 'append-passive'
  ) => {
    const loaded: NamFile[] = []
    let errors = 0
    for (const r of results) {
      if (r.success && r.filePath && r.metadata !== undefined) {
        const fileName = r.filePath.replace(/\\/g, '/').split('/').pop() ?? r.filePath
        const baseName = fileName.replace(/\.nam$/i, '')
        const rawMeta = r.metadata ?? {}
        const workingMeta: NamFile['metadata'] = { ...rawMeta }
        if (typeof workingMeta.input_level_dbu === 'string') workingMeta.input_level_dbu = parseFloat(workingMeta.input_level_dbu as unknown as string)
        if (typeof workingMeta.output_level_dbu === 'string') workingMeta.output_level_dbu = parseFloat(workingMeta.output_level_dbu as unknown as string)
        if (workingMeta.tone_type && !(TONE_TYPES as readonly string[]).includes(workingMeta.tone_type)) workingMeta.tone_type = null
        if (workingMeta.gear_type && !(GEAR_TYPES as readonly string[]).includes(workingMeta.gear_type)) workingMeta.gear_type = null
        const meta = applyDefaults(workingMeta, baseName, settings, true)
        const wasChanged = JSON.stringify(meta) !== JSON.stringify(rawMeta)
        const autoFilledFields = (Object.keys(meta) as (keyof NamFile['metadata'])[]).filter(
          (k) => meta[k] != null && (workingMeta[k] == null || workingMeta[k] === '')
        )
        loaded.push({ filePath: r.filePath, fileName: baseName, version: r.version ?? '?', notes: (r as Record<string, unknown>).notes as string[] | undefined, metadata: meta, originalMetadata: rawMeta, autoFilledFields, architecture: r.architecture ?? '?', config: r.config, isDirty: wasChanged, mtimeMs: r.mtimeMs, birthtimeMs: r.birthtimeMs, sizeBytes: r.sizeBytes })
      } else {
        errors++
      }
    }
    setFiles((prev) => {
      if (mode === 'replace') return loaded
      const existing = new Set(prev.map((f) => f.filePath))
      return [...prev, ...loaded.filter((f) => !existing.has(f.filePath))]
    })
    // Read and clear outside the updater Ã¢â‚¬â€ updaters can be called multiple times in Concurrent Mode
    const shouldSuppressSelect = suppressStartupAutoSelectRef.current
    suppressStartupAutoSelectRef.current = false
    setSelectedIds((prev) => {
      if (loaded.length === 0) return prev
      if (shouldSuppressSelect) return prev
      if (mode === 'replace') return new Set([loaded[0].filePath])
      if (mode === 'append-passive') return prev
      if (prev.size === 0) return new Set([loaded[0].filePath])
      return prev
    })
    if (errors > 0) {
      const logPath = await window.api.getErrorLogPath()
      setStatus({ message: `Loaded ${loaded.length} file(s) - ${errors} could not be parsed (skipped)`, type: 'error', logPath })
    } else {
      setStatus({ message: `Loaded ${loaded.length} file(s)`, type: 'success' })
    }
  }, [settings])

  // mode='append': dedup against current files (drag & drop)
  const loadFiles = useCallback(async (paths: string[], mode: 'replace' | 'append' | 'append-passive' = 'append', genToken?: number) => {
    setStatus({ message: `Loading ${paths.length} file(s)...`, type: 'info' })
    const CONCURRENCY = 50
    const results: Awaited<ReturnType<typeof window.api.readFile>>[] = []
    for (let i = 0; i < paths.length; i += CONCURRENCY) {
      if (genToken !== undefined && genToken !== loadGenRef.current) return
      const batch = paths.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(batch.map((p) => window.api.readFile(p)))
      results.push(...batchResults)
      if (paths.length > CONCURRENCY) {
        setStatus({ message: `Loading files... ${Math.min(i + CONCURRENCY, paths.length)} / ${paths.length}`, type: 'info' })
      }
    }
    if (genToken !== undefined && genToken !== loadGenRef.current) return
    await applyParsedResults(results, mode)
  }, [applyParsedResults]) // no longer depends on files or selectedIds

  useEffect(() => {
    loadFilesRef.current = loadFiles
  }, [loadFiles])

  const handleStartToneStoreQueue = useCallback((job: ToneStoreDownloadQueueJob) => {
    setToneStoreQueueJob(job)
    setStatus({
      message: `Tone3000 background download started: ${job.items.length} file${job.items.length !== 1 ? 's' : ''}`,
      type: 'info'
    })
  }, [])

  const handleCancelToneStoreQueue = useCallback(() => {
    toneStoreQueueAbortRef.current += 1
    toneStoreQueueRunningRef.current = false
    setToneStoreQueueJob(null)
    setStatus({
      message: 'Tone3000 download queue cancelled',
      type: 'info'
    })
  }, [])

  // Shared logic for opening a folder by path (used by Open Folder and Refresh)
  const loadFolderByPath = useCallback(async (folder: string) => {
    const gen = ++loadGenRef.current
    setCardView(false)
    setStatus({ message: 'Scanning folder... (large or network folders may take a minute)', type: 'info' })
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
    if (gen !== loadGenRef.current) return
    const normalizedFolder = folder.replace(/\\/g, '/')
    // Always apply the fresh tree so deleted/added folders are reflected immediately,
    // even if the scan returns an error or finds no .nam files.
    setLibrarian({
      rootFolder: normalizedFolder,
      folderTree: treeResult.success && treeResult.tree ? treeResult.tree : null,
      selectedFolders: []
    })
    if (!flatResult.success) {
      setStatus({ message: `Error: ${flatResult.error}`, type: 'error' })
      return
    }
    if (!flatResult.files || flatResult.files.length === 0) {
      setFiles([])
      setSelectedIds(new Set())
      setStatus({ message: 'No .nam files found in that folder', type: 'info' })
      return
    }
    setRecentFolders((prev) => {
      const next = [normalizedFolder, ...prev.filter((f) => f !== normalizedFolder)].slice(0, 10)
      localStorage.setItem('nam-lab-recent-folders', JSON.stringify(next))
      return next
    })
    await loadFiles(flatResult.files, 'replace', gen)
    if (gen !== loadGenRef.current) return
    setWatcherKey((k) => k + 1)
  }, [loadFiles, settings])

  // Subscribe to app:openFiles Ã¢â‚¬â€ for files opened while app is already running
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
        // File was opened via double-click / file association Ã¢â‚¬â€ load just those files
        loadFiles(paths, 'replace')
      } else if (settings.enableDefaultFolder && settings.defaultFolder) {
        // No pending files Ã¢â‚¬â€ restore last folder as normal
        loadFolderByPath(settings.defaultFolder)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty Ã¢â‚¬â€ runs once on mount after React is ready

  // Returns false if user cancels, true if safe to proceed
  const confirmDiscardChanges = (): boolean => {
    const dirty = files.filter((f) => f.isDirty)
    if (dirty.length === 0) return true
    const manuallyDirty = dirty.filter((f) => {
      const keys = new Set<keyof NamFile['metadata']>([
        ...(Object.keys(f.metadata) as (keyof NamFile['metadata'])[]),
        ...(Object.keys(f.originalMetadata) as (keyof NamFile['metadata'])[])
      ])
      for (const key of keys) {
        const current = f.metadata[key] ?? null
        const original = f.originalMetadata[key] ?? null
        if (current !== original && !f.autoFilledFields.includes(key)) return true
      }
      return false
    })
    if (manuallyDirty.length === 0) return true
    return window.confirm(
      `You have manual unsaved changes in ${manuallyDirty.length} file${manuallyDirty.length !== 1 ? 's' : ''}.\n\nDiscard changes and continue?`
    )
  }

  const handleCloseAll = () => {
    if (!confirmDiscardChanges()) return
    setFiles([])
    setSelectedIds(new Set())
    setBatchFolder(null)
    setShowSettings(false)
    setLibrarian(EMPTY_LIBRARIAN)
    setCardView(false)
    setStatus({ message: 'Open .nam files or a folder to get started', type: 'info' })
    // Don't reopen on next launch Ã¢â‚¬â€ user explicitly closed
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

  const refreshFolderTree = useCallback(async () => {
    if (!librarian.rootFolder) return
    const treeResult = await window.api.scanTree(librarian.rootFolder, settings.hiddenFolders ?? '')
    if (treeResult.success && treeResult.tree) {
      setLibrarian((prev) => ({ ...prev, folderTree: treeResult.tree! }))
    }
    refreshPackInfoFolders()
    refreshBundleFolders()
  }, [librarian.rootFolder, settings.hiddenFolders, refreshPackInfoFolders, refreshBundleFolders])

  useEffect(() => {
    refreshFolderTreeRef.current = refreshFolderTree
  }, [refreshFolderTree])

  // OS drag/drop Ã¢â‚¬â€ use React synthetic onDrop on the root div (works in Electron;
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
      if (!confirmDiscardChanges()) return
      await loadFolderByPath(folders[0])
    } else {
      await loadFiles(namFiles, files.length === 0 ? 'replace' : 'append')
    }
  }

  // Persist history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(sessionHistory))
  }, [sessionHistory])

  const addHistoryEntry = useCallback((entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => {
    setSessionHistory((current) => {
      const next: HistoryEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: new Date() }
      return [next, ...current].slice(0, HISTORY_MAX)
    })
  }, [])

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

  const clearAutoFilledFieldsFromMeta = (file: NamFile) => {
    if (file.autoFilledFields.length === 0) return file
    const metadata = { ...file.metadata }
    for (const key of file.autoFilledFields) {
      metadata[key] = file.originalMetadata[key] ?? null
    }
    const isDirty = JSON.stringify(metadata) !== JSON.stringify(file.originalMetadata)
    return { ...file, metadata, isDirty, autoFilledFields: [] }
  }

  const handleClearSuggestionsForFile = (filePath: string) => {
    setFiles((prev) => prev.map((file) => file.filePath === filePath ? clearAutoFilledFieldsFromMeta(file) : file))
    setStatus({ message: 'Cleared auto-filled suggestions for the selected file', type: 'success' })
  }

  const handleClearSuggestionsAll = () => {
    const affected = files.filter((file) => file.autoFilledFields.length > 0).length
    if (affected === 0) {
      setStatus({ message: 'No auto-filled suggestions to clear', type: 'info' })
      return
    }
    setFiles((prev) => prev.map((file) => clearAutoFilledFieldsFromMeta(file)))
    setStatus({ message: `Cleared auto-filled suggestions on ${affected} file${affected !== 1 ? 's' : ''}`, type: 'success' })
  }

  const handleSave = async (filePath: string) => {
    const file = files.find((f) => f.filePath === filePath)
    if (!file) return
    const result = await window.api.writeMetadata(filePath, file.metadata)
    if (result.success) {
      const savedAt = Date.now()
      setFiles((prev) => prev.map((f) =>
        f.filePath === filePath
          ? { ...f, isDirty: false, originalMetadata: { ...f.metadata }, autoFilledFields: [], mtimeMs: savedAt }
          : f
      ))
      addHistoryEntry({ operation: 'save', summary: `Saved ${file.fileName}` })
      setStatus({ message: `Saved: ${file.fileName}`, type: 'success' })
    } else {
      setStatus({ message: `Save failed: ${result.error}`, type: 'error' })
    }
  }

  const handleSaveAndAdvance = async (filePath: string) => {
    await handleSave(filePath)
    // Use same visibility logic as visibleFiles (folder filter only Ã¢â‚¬â€ no FileList internal filters)
    const currentVisible = files.filter((f) => {
      const norm = f.filePath.replace(/\\/g, '/')
      if (librarian.selectedFolders.length > 0 && !librarian.selectedFolders.some((sf) => norm.startsWith(sf + '/'))) return false
      if (directFilesOnly && librarian.selectedFolders.length === 1) {
        const parentFolder = norm.split('/').slice(0, -1).join('/')
        if (parentFolder !== librarian.selectedFolders[0]) return false
      }
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
    if (folderPath) setLibrarian((prev) => ({ ...prev, selectedFolders: [folderPath] }))
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
        ? `\n\nWarning: ${autoFillCount} file${autoFillCount !== 1 ? 's have' : ' has'} auto-filled fields (from Settings defaults) that will also be written.`
        : ''
      if (!settings.skipSaveAllConfirmation) {
        const confirmed = window.confirm(
          `Warning: Save ALL changes across every loaded folder?\n\nThis will write ${dirty.length} file${dirty.length !== 1 ? 's' : ''} to disk - including files in all subfolders. This cannot be undone.${autoFillNote}\n\n(This warning can be toggled off in Settings -> Behavior)`
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
      addHistoryEntry({ operation: 'save-all', summary: `Saved ${savedPaths.size} file${savedPaths.size !== 1 ? 's' : ''}` })
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
    const savedAt = Date.now()
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
      return { ...f, metadata: p.newMeta, originalMetadata: p.newOriginal, isDirty: p.newIsDirty, autoFilledFields, mtimeMs: savedAt }
    }))

    if (failed > 0) {
      setStatus({ message: `Batch saved ${savedPaths.size}, failed ${failed}`, type: 'error' })
    } else {
      addHistoryEntry({ operation: 'batch-edit', summary: formatBatchEditHistorySummary(batchFields, savedPaths.size) })
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
    const savedAt = Date.now()
    for (const p of prepared) {
      const result = await window.api.writeMetadata(p.filePath, p.toWrite)
      if (result.success) savedPaths.add(p.filePath)
      else failed++
    }

    const resultMap = new Map(prepared.map((p) => [p.filePath, p]))
    setFiles((prev) => prev.map((f) => {
      if (!savedPaths.has(f.filePath)) return f
      const p = resultMap.get(f.filePath)!
      return { ...f, metadata: p.newMeta, originalMetadata: p.newOriginal, isDirty: p.newIsDirty, autoFilledFields: p.newIsDirty ? f.autoFilledFields : [], mtimeMs: savedAt }
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

    // Update files state Ã¢â‚¬â€ repath moved files, clear dirty flag
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
    setLibrarian((prev) => ({ ...prev, selectedFolders: [destFolderPath] }))
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
      addHistoryEntry({ operation: 'rename', summary: `Renamed file to "${newBaseName}"` })
      setStatus({ message: `Renamed to: ${newBaseName}.nam`, type: 'success' })
    } else {
      setStatus({ message: `Rename failed: ${result.error}`, type: 'error' })
    }
  }

  const handleBatchRename = async (renames: { filePath: string; newBaseName: string }[], renameFiles: boolean) => {
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
      if (failed === 0) addHistoryEntry({ operation: 'batch-rename', summary: msg })
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

  const handleMoveFolder = async (sourcePath: string, destParentPath: string, allowMerge = false) => {
    const result = await window.api.moveFolder(sourcePath, destParentPath, allowMerge)
    if (!result.success && result.error === 'merge-required' && result.mergeTargetPath) {
      const sourceName = folderDisplayName(sourcePath)
      const targetName = folderDisplayName(result.mergeTargetPath)
      const confirmed = window.confirm(
        `A folder named "${targetName}" already exists in the destination.\n\nMerge "${sourceName}" into it?\n\nSame-name subfolders will be merged. Existing same-name files will be left where they are.`
      )
      if (!confirmed) return result
      return handleMoveFolder(sourcePath, destParentPath, true)
    }

    if (result.success && result.newPath) {
      if (result.mergedIntoExisting) {
        if (librarian.rootFolder) await loadFolderByPath(librarian.rootFolder)
        const skippedCount = result.skippedPaths?.length ?? 0
        setStatus({
          message: skippedCount > 0
            ? `Folder merged with ${skippedCount} existing file${skippedCount !== 1 ? 's' : ''} left in place`
            : 'Folder merged',
          type: skippedCount > 0 ? 'info' : 'success'
        })
        return result
      }

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

  const handleDeleteEmptyFolder = async (folderPath: string) => {
    const confirmed = window.confirm(
      `Delete the empty folder tree "${folderDisplayName(folderPath)}"?\n\nThis removes the selected folder and any empty child folders underneath it. It will stop if any files remain anywhere in that subtree.`
    )
    if (!confirmed) return { success: false, error: 'Cancelled' }

    const result = await window.api.deleteEmptyFolder(folderPath)
    if (result.success) {
      if (librarian.rootFolder) await loadFolderByPath(librarian.rootFolder)
      const removed = result.removedCount ?? 1
      setStatus({ message: `Deleted empty folder tree: ${folderDisplayName(folderPath)} (${removed} folder${removed !== 1 ? 's' : ''})`, type: 'success' })
    } else {
      setStatus({ message: `Delete failed: ${result.error}`, type: 'error' })
    }
    return result
  }

  const handleTrashFiles = async (paths: string[]) => {
    const fileNames = paths.map((p) => {
      const parts = p.replace(/\\/g, '/').split('/')
      return parts.length >= 2 ? parts.slice(-2).join('/') : parts[parts.length - 1]
    }).join('\n')
    const deleteBehavior = await window.api.getDeleteBehavior(paths)
    const actionLabel = deleteBehavior.permanentOnly ? 'Delete' : 'Move'
    const tailMessage = deleteBehavior.permanentOnly
      ? 'These files are on a shared or network-backed drive, so Recycle Bin is not available.'
      : 'This can be recovered from the trash.'
    const confirmed = window.confirm(
      `${actionLabel} ${paths.length} file${paths.length !== 1 ? 's' : ''}?\n\n${fileNames}\n\n${tailMessage}`
    )
    if (!confirmed) return
    const results = await window.api.trashFiles(paths)
    const trashed = results.filter((r) => r.success).map((r) => r.filePath)
    const failed = results.filter((r) => !r.success).length
    const permanentlyDeleted = results.filter((r) => r.success && r.deleteMode === 'delete').length
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
      const errors = results.filter((r) => !r.success).map((r) => r.error).filter(Boolean)
      const detail = errors.length > 0 ? `: ${errors[0]}` : ''
      setStatus({ message: `Trashed ${trashed.length}, failed ${failed}${detail}`, type: 'error' })
    } else if (permanentlyDeleted > 0) {
      setStatus({
        message: `Deleted ${trashed.length} file${trashed.length !== 1 ? 's' : ''} permanently (${permanentlyDeleted} could not be moved to trash)`,
        type: 'info'
      })
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

  const handleCleanOutdatedNamBot = async (paths: string[]) => {
    const confirmed = window.confirm(
      `Clean outdated NAM-BOT metadata in ${paths.length} file${paths.length !== 1 ? 's' : ''}?\n\nNAM-BOT moved its custom fields from metadata.training.nam_bot to metadata.nam_bot for better compatibility.\n\nThis will rewrite older exports to the new format. This cannot currently be undone.`
    )
    if (!confirmed) return
    const results = await window.api.cleanOutdatedNamBot(paths)
    const cleaned = results.filter((r) => r.success).map((r) => r.filePath)
    const changed = results.filter((r) => r.success && r.changed).map((r) => r.filePath)
    const failed = results.filter((r) => !r.success).length
    if (cleaned.length > 0) {
      const changedSet = new Set(changed)
      setFiles((prev) => prev.map((f) => {
        if (!changedSet.has(f.filePath)) return f
        const newMeta = migrateLegacyNamBotInMemory(f.metadata)
        const newOrig = migrateLegacyNamBotInMemory(f.originalMetadata)
        return { ...f, metadata: newMeta, originalMetadata: newOrig, isDirty: false, mtimeMs: Date.now() }
      }))
    }
    if (failed > 0) {
      setStatus({ message: `Cleaned ${changed.length} file${changed.length !== 1 ? 's' : ''}, failed ${failed}`, type: 'error' })
    } else if (changed.length > 0) {
      setStatus({ message: `Updated ${changed.length} file${changed.length !== 1 ? 's' : ''} to the current NAM-BOT metadata format`, type: 'success' })
    } else {
      setStatus({ message: 'No outdated NAM-BOT metadata found in the selected file(s)', type: 'info' })
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

    // First pass Ã¢â‚¬â€ move non-conflicting files
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
      await refreshFolderTree()
    }
    const skipped = conflictPaths.length - conflictPaths.filter((p) => movedPaths.has(p)).length
    if (failed > 0) {
      setStatus({ message: `Moved ${movedPaths.size}, failed ${failed}`, type: 'error' })
    } else if (skipped > 0) {
      setStatus({ message: `Moved ${movedPaths.size} file${movedPaths.size !== 1 ? 's' : ''} to ${destName} - ${skipped} skipped (already exist)`, type: 'info' })
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
    if (copied > 0) await refreshFolderTree()
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

  // Fields that make sense to copy Ã¢â‚¬â€ editable metadata only, no read-only stats
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

  // Column definition for import/export template Ã¢â‚¬â€ editable fields only, in user-preferred order
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
    { header: 'NAM-BOT Preset',     field: null }, // read-only Ã¢â‚¬â€ shown in template, skipped on import
    { header: 'Mic(s)',             field: 'nl_mics' },
    { header: 'Comments',           field: 'nl_comments' },
  ]

  const TARGET_MATRIX_TEMPLATE_HEADERS = [
    'ToneX',
    'NAM',
    'Proxy',
    'QC',
    'Capture Name',
    'Alt Proxy Name',
    'Alt QC Name',
  ] as const

  const uniqueTemplateValues = (values: Array<string | null | undefined>): string[] =>
    [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  const handleGenerateTemplate = (folderPath: string | null) => {
    const targets = folderPath === null
      ? files
      : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(folderPath.replace(/\\/g, '/') + '/') || f.filePath.replace(/\\/g, '/') === folderPath.replace(/\\/g, '/'))
    const templateHeaders = [...TARGET_MATRIX_TEMPLATE_HEADERS, ...IMPORT_COLUMNS.map((c) => c.header).filter((header) => header !== 'Capture Name')]
    const rows = targets.map((f) => {
      const row: Record<string, unknown> = {
        ToneX: '',
        NAM: 'X',
        Proxy: '',
        QC: '',
        'Capture Name': f.metadata.name ?? '',
        'Alt Proxy Name': '',
        'Alt QC Name': '',
      }
      for (const col of IMPORT_COLUMNS) {
        if (col.header === 'Capture Name') continue
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
    const ws = XLSX.utils.json_to_sheet(rows, { header: templateHeaders })
    const wb = XLSX.utils.book_new()
    ws['!cols'] = templateHeaders.map((header) => ({ wch: Math.max(header.length + 2, 16) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Import Template')

    const lookupColumns: Record<string, string[]> = {
      'Include Marker': ['X'],
      'Modeled By': uniqueTemplateValues(targets.map((f) => f.metadata.modeled_by)),
      Manufacturer: uniqueTemplateValues(targets.map((f) => f.metadata.gear_make)),
      Model: uniqueTemplateValues(targets.map((f) => f.metadata.gear_model)),
      'Gear Type': [...GEAR_TYPES],
      'Tone Type': [...TONE_TYPES],
    }
    const lookupHeaders = Object.keys(lookupColumns)
    const lookupRowCount = Math.max(...lookupHeaders.map((header) => lookupColumns[header].length), 1)
    const lookupData = [
      lookupHeaders,
      ...Array.from({ length: lookupRowCount }, (_, rowIndex) =>
        lookupHeaders.map((header) => lookupColumns[header][rowIndex] ?? '')
      ),
    ]
    const lookupWs = XLSX.utils.aoa_to_sheet(lookupData)
    lookupWs['!cols'] = lookupHeaders.map((header) => ({ wch: Math.max(header.length + 2, 18) }))
    XLSX.utils.book_append_sheet(wb, lookupWs, 'Lookup Values')

    const folderName = folderPath ? folderPath.replace(/\\/g, '/').split('/').pop() : (librarian.rootFolder ? librarian.rootFolder.replace(/\\/g, '/').split('/').pop() : 'library')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `nam-import-template-${folderName}.xlsx`; a.click()
    URL.revokeObjectURL(url)
    setStatus({ message: `Template generated with ${rows.length} capture${rows.length !== 1 ? 's' : ''} and a Lookup Values sheet`, type: 'success' })
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

    // Build lookup: name (lowercase) Ã¢â€ â€™ NamFile[], scoped to folderPath.
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

    // Fields skipped for prefix (variant-specific) matches Ã¢â‚¬â€ nl_ cabinet/mic fields vary
    // per variant. gear_type is handled separately with cab-upgrade logic below.
    // tone_type is NOT skipped Ã¢â‚¬â€ it's the same across DI/cab variants of the same session.
    const PREFIX_SKIP: Set<keyof NamFile['metadata']> = new Set(['nl_cabinet', 'nl_cabinet_config', 'nl_mics'])

    // For prefix matches only: ampÃ¢â€ â€™amp_cab, pedal_ampÃ¢â€ â€™amp_pedal_cab. All other gear_types skipped.
    const CAB_UPGRADE: Record<string, string> = { amp: 'amp_cab', pedal_amp: 'amp_pedal_cab' }

    // Defined early so Pass 1 can use it to detect DI files by their own name suffix.
    const prefixSuffixSet = new Set(
      (settings.importPrefixSuffixes || 'DI')
        .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    )

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
            // Prefix match: upgrade ampÃ¢â€ â€™amp_cab / pedal_ampÃ¢â€ â€™amp_pedal_cab; skip everything else
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

    // Pass 1: exact matches Ã¢â‚¬â€ all files sharing a name get claimed; track which have explicit gear_type
    const exactMatches: ImportMatch[] = []
    const exactMatchedPaths = new Set<string>()
    const exactGearTypePaths = new Set<string>()  // files where exact row explicitly set gear_type
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const matchedFiles = nameToFiles.get(captureName.toLowerCase())
      if (!matchedFiles || matchedFiles.length === 0) continue
      for (const file of matchedFiles) {
        // Always mark exact-matched Ã¢â‚¬â€ prevents prefix from a different row overriding it
        exactMatchedPaths.add(file.filePath)
        const incoming = buildIncoming(row)
        // Block Pass 3 cab upgrade if:
        //   (a) gear_type is already a cab-inclusive type (amp_cab / amp_pedal_cab), OR
        //   (b) this file's own name ends with a configured DI suffix Ã¢â‚¬â€ it IS the DI capture,
        //       not a cab variant, so it must keep its gear_type unchanged.
        // Non-DI files with amp/pedal_amp are left unprotected so Pass 3 can upgrade them.
        const fileWords = (file.metadata.name || file.fileName || '').trim().split(/\s+/)
        const fileEndsWithDiSuffix = prefixSuffixSet.has(fileWords[fileWords.length - 1]?.toUpperCase() ?? '')
        if ('gear_type' in incoming && (
          Object.values(CAB_UPGRADE).includes(incoming.gear_type as string) || fileEndsWithDiSuffix
        )) {
          exactGearTypePaths.add(file.filePath)
        }
        if (Object.keys(incoming).length > 0) {
          exactMatches.push({ file, incoming })
        }
      }
    }

    // Pass 1.5: full-name prefix matches Ã¢â‚¬â€ file name starts with "{rowName} "
    // Treated as direct matches (all fields, no cab upgrade). Covers variants like
    // "FMAN100V2 BE HG C45 DI HYPER" when the row is "FMAN100V2 BE HG C45 DI".
    const fullPrefixMatchedRowNames = new Set<string>()
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const rowPrefix = captureName.toLowerCase() + ' '
      for (const f of scopedFiles) {
        if (exactMatchedPaths.has(f.filePath)) continue
        const fName = (f.metadata.name || f.fileName || '').toLowerCase().trim()
        if (!fName.startsWith(rowPrefix)) continue
        exactMatchedPaths.add(f.filePath)
        const incoming = buildIncoming(row)
        if ('gear_type' in incoming) exactGearTypePaths.add(f.filePath)
        if (Object.keys(incoming).length > 0) {
          exactMatches.push({ file: f, incoming })
          fullPrefixMatchedRowNames.add(captureName.toLowerCase())
        }
      }
    }

    // Pass 2: prefix matches Ã¢â‚¬â€ only for files WITHOUT an exact match row.
    // Sort by prefix length descending so the most specific (longest) DI row wins
    // when multiple DI rows share a common base prefix.
    const prefixMatches: ImportMatch[] = []
    const prefixMatchedPaths = new Set<string>()
    const diRowsPass2 = rows
      .map(row => {
        const captureName = String(row['Capture Name'] ?? '').trim()
        const words = captureName.split(/\s+/)
        if (words.length < 2) return null
        const lastWord = words[words.length - 1].toUpperCase()
        if (!prefixSuffixSet.has(lastWord)) return null
        return { row, prefix: words.slice(0, -1).join(' ').toLowerCase() }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.prefix.length - a.prefix.length)
    for (const { row, prefix } of diRowsPass2) {
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
    // with tone_type set but no gear_type Ã¢â€ â€™ "BE100 DI" row contributes amp_cab).
    const pathToFile = new Map(scopedFiles.map(f => [f.filePath, f]))
    const exactMatchByPath = new Map(exactMatches.map(m => [m.file.filePath, m]))
    // Sort DI rows longest-prefix-first so the most specific row wins when multiple
    // DI rows share a common base (e.g. "FMAN100V2 Plexi HG Koko DI" beats "FMAN100V2 Plexi HG DI").
    const diRowsSorted = rows
      .map(row => {
        const captureName = String(row['Capture Name'] ?? '').trim()
        const words = captureName.split(/\s+/)
        const lastWord = words[words.length - 1]?.toUpperCase() ?? ''
        if (words.length < 2 || !prefixSuffixSet.has(lastWord)) return null
        const rowGearType = String(row['Gear Type'] ?? '').trim()
        const upgraded = CAB_UPGRADE[rowGearType]
        if (!upgraded) return null
        const prefix = words.slice(0, -1).join(' ').toLowerCase()
        return { row, prefix, upgraded }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.prefix.length - a.prefix.length)
    for (const { prefix, upgraded } of diRowsSorted) {
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
    for (const row of rows) {
      const captureName = String(row['Capture Name'] ?? '').trim()
      if (!captureName) continue
      const hasExact = (nameToFiles.get(captureName.toLowerCase()) ?? []).length > 0
      if (hasExact) continue
      // Check if this row produced Pass 1.5 full-name prefix matches
      if (fullPrefixMatchedRowNames.has(captureName.toLowerCase())) continue
      // Check if this row produced any suffix-strip prefix matches
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
    if (unmatched > 0) msg += ` - ${unmatched} unmatched`
    setStatus({ message: msg, type: failed > 0 ? 'error' : 'success' })
  }

  const handleSuggestMetadata = (folderPath: string | null) => {
    const normalizedFolder = folderPath ? folderPath.replace(/\\/g, '/') : null
    const scopedFiles = normalizedFolder === null
      ? files
      : files.filter((f) => f.filePath.replace(/\\/g, '/').startsWith(normalizedFolder + '/'))

    openSuggestMetadataModal(scopedFiles, folderDisplayName(folderPath))
  }

  const handleSuggestMetadataForSelection = (paths: string[]) => {
    const pathSet = new Set(paths)
    const scopedFiles = files.filter((file) => pathSet.has(file.filePath))
    const label = paths.length === 1 ? '1 selected capture' : `${paths.length} selected captures`
    openSuggestMetadataModal(scopedFiles, label)
  }

  const handleOpenSuggestRulesEditor = (folderPath: string) => {
    setSuggestRulesEditorPath(folderPath.replace(/\\/g, '/'))
  }

  const handleCopyScopedSuggestRules = (folderPath: string) => {
    const normalizedPath = folderPath.replace(/\\/g, '/')
    const rules = settings.metadataSuggestScopedRules.find((set) => set.scopePath.replace(/\\/g, '/') === normalizedPath)?.rules ?? []
    if (rules.length === 0) {
      setStatus({ message: `No folder suggestion rules to copy from ${folderDisplayName(folderPath)}`, type: 'info' })
      return
    }
    setSuggestRulesClipboard({
      sourceFolderPath: normalizedPath,
      rules: rules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-clipboard')),
    })
    setStatus({
      message: `Copied ${rules.length} folder suggestion rule${rules.length !== 1 ? 's' : ''} from ${folderDisplayName(folderPath)}`,
      type: 'success',
    })
  }

  const handlePasteScopedSuggestRules = (folderPath: string) => {
    if (!suggestRulesClipboard || suggestRulesClipboard.rules.length === 0) return
    const normalizedPath = folderPath.replace(/\\/g, '/')
    const existingRules = settings.metadataSuggestScopedRules.find((set) => set.scopePath.replace(/\\/g, '/') === normalizedPath)?.rules ?? []
    if (existingRules.length > 0) {
      const confirmed = window.confirm(
        `WARNING: ${folderDisplayName(folderPath)} already has ${existingRules.length} folder suggestion rule${existingRules.length !== 1 ? 's' : ''}.\n\nPasting will OVERWRITE the existing rules for this folder and cannot be undone.\n\nContinue?`
      )
      if (!confirmed) return
    }
    const pastedRules = suggestRulesClipboard.rules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-paste'))
    const nextSets = settings.metadataSuggestScopedRules.filter((set) => set.scopePath.replace(/\\/g, '/') !== normalizedPath)
    nextSets.push({ scopePath: normalizedPath, rules: pastedRules })
    handleSaveSettings({
      ...settings,
      metadataSuggestScopedRules: nextSets,
      metadataSuggestRuleLibrary: mergeRulesIntoLibrary(settings.metadataSuggestRuleLibrary, pastedRules),
    })
    setStatus({
      message: `Pasted ${pastedRules.length} folder suggestion rule${pastedRules.length !== 1 ? 's' : ''} into ${folderDisplayName(folderPath)}`,
      type: 'success',
    })
  }

  const handleSaveScopedSuggestRules = (folderPath: string, rules: MetadataSuggestRule[]) => {
    const normalizedPath = folderPath.replace(/\\/g, '/')
    const cleanedRules = rules.filter((rule) => rule.value.trim())
    const nextSets = settings.metadataSuggestScopedRules.filter((set) => set.scopePath.replace(/\\/g, '/') !== normalizedPath)
    if (cleanedRules.length > 0) {
      nextSets.push({ scopePath: normalizedPath, rules: cleanedRules })
    }
    handleSaveSettings({
      ...settings,
      metadataSuggestScopedRules: nextSets,
      metadataSuggestRuleLibrary: mergeRulesIntoLibrary(settings.metadataSuggestRuleLibrary, cleanedRules),
    })
    setSuggestRulesEditorPath(null)
    setStatus({
      message: cleanedRules.length > 0
        ? `Saved ${cleanedRules.length} folder suggestion rule${cleanedRules.length !== 1 ? 's' : ''}`
        : 'Removed folder suggestion rules',
      type: 'success',
    })
  }

  const handleSaveScopedSuggestRulesAndStayOpen = (folderPath: string, rules: MetadataSuggestRule[]) => {
    const normalizedPath = folderPath.replace(/\\/g, '/')
    const cleanedRules = rules.filter((rule) => rule.value.trim())
    const nextSets = settings.metadataSuggestScopedRules.filter((set) => set.scopePath.replace(/\\/g, '/') !== normalizedPath)
    if (cleanedRules.length > 0) {
      nextSets.push({ scopePath: normalizedPath, rules: cleanedRules })
    }
    handleSaveSettings({
      ...settings,
      metadataSuggestScopedRules: nextSets,
      metadataSuggestRuleLibrary: mergeRulesIntoLibrary(settings.metadataSuggestRuleLibrary, cleanedRules),
    })
    setStatus({
      message: cleanedRules.length > 0
        ? `Saved ${cleanedRules.length} folder suggestion rule${cleanedRules.length !== 1 ? 's' : ''}`
        : 'Removed folder suggestion rules',
      type: 'success',
    })
  }

  const getLibraryCleanupSavedIgnores = useCallback(() => {
    return (settings.libraryCleanupIgnoredPaths ?? []).map((path) => path.replace(/\\/g, '/'))
  }, [settings.libraryCleanupIgnoredPaths])

  const applyLibraryCleanupSavedIgnores = useCallback((entries: LibraryCleanupFolderEntry[]) => {
    const saved = new Set(getLibraryCleanupSavedIgnores())
    return entries.map((entry) => ({
      ...entry,
      savedIgnore: saved.has(entry.path),
      checked: saved.has(entry.path) ? false : entry.checked,
    }))
  }, [getLibraryCleanupSavedIgnores])

  const scanLibraryCleanupSourceRoot = useCallback(async (normalized: string) => {
    setLibraryCleanupBusyLabel('Scanning source root...')
    setLibraryCleanupPreviewRows(null)
    const [flatResult, treeResult] = await Promise.all([
      window.api.scanFolder(normalized, settings.hiddenFolders),
      window.api.scanTree(normalized, settings.hiddenFolders),
    ])
    setLibraryCleanupBusyLabel(null)
    if (!flatResult.success || !treeResult.success || !treeResult.tree || !flatResult.files) {
      setStatus({ message: `Library cleanup scan failed: ${flatResult.error ?? treeResult.error ?? 'Unknown error'}`, type: 'error' })
      return false
    }
    const entries = applyLibraryCleanupSavedIgnores(
      flattenFolderTree(treeResult.tree).map((entry) => ({
        ...entry,
        checked: true,
        savedIgnore: false,
      }))
    )
    setLibraryCleanupSourceRoot(normalized)
    setLibraryCleanupFolderEntries(entries)
    setLibraryCleanupFilePaths(flatResult.files.map((filePath) => filePath.replace(/\\/g, '/')))
    return true
  }, [applyLibraryCleanupSavedIgnores, settings.hiddenFolders])

  const handleOpenLibraryCleanup = () => {
    setLibraryCleanupOpenMode('library')
    setLibraryCleanupActionMode('copy')
    setShowLibraryCleanup(true)
    setLibraryCleanupPreviewRows(null)
  }

  const handleOpenFolderCleanup = async (folderPath: string) => {
    const normalized = folderPath.replace(/\\/g, '/')
    const folderName = folderDisplayName(normalized).toLowerCase()
    const defaultDestinationRoot = folderName === 'needs review'
      ? parentFolderPath(normalized)
      : normalized
    setLibraryCleanupOpenMode('folder')
    setLibraryCleanupDestinationRoot(defaultDestinationRoot)
    setLibraryCleanupActionMode('move')
    setShowLibraryCleanup(true)
    await scanLibraryCleanupSourceRoot(normalized)
  }

  const handlePickLibraryCleanupSourceRoot = async () => {
    const picked = await window.api.openFolder(libraryCleanupSourceRoot ?? librarian.rootFolder ?? undefined)
    if (!picked) return
    const normalized = picked.replace(/\\/g, '/')
    await scanLibraryCleanupSourceRoot(normalized)
  }

  const handlePickLibraryCleanupDestinationRoot = async () => {
    const picked = await window.api.openFolder(libraryCleanupDestinationRoot ?? librarian.rootFolder ?? undefined)
    if (!picked) return
    const normalized = picked.replace(/\\/g, '/')
    setLibraryCleanupDestinationRoot(normalized)
    setLibraryCleanupPreviewRows(null)
    setLibraryCleanupFolderEntries((prev) => applyLibraryCleanupSavedIgnores(
      prev.map((entry) => ({ ...entry, checked: true, savedIgnore: false })),
    ))
  }

  const buildLibraryCleanupExcludedPaths = useCallback(() => {
    return new Set(
      libraryCleanupFolderEntries
        .filter((entry) => !entry.checked)
        .map((entry) => entry.path.replace(/\\/g, '/'))
    )
  }, [libraryCleanupFolderEntries])

  const classifyLibraryCleanupFile = useCallback((file: NamFile): LibraryCleanupClassifiedFile => {
    const creator = file.metadata.modeled_by?.trim() ?? ''
    const make = file.metadata.gear_make?.trim() ?? ''
    const model = file.metadata.gear_model?.trim() ?? ''
    const fileName = cleanupSourceBaseName(file.filePath)
    const destParts: string[] = []
    let note: string | null = null
    let needsReview = false

    const requireCreator = libraryCleanupLayout !== 'flat'
    const requireAmp = libraryCleanupLayout === 'creator-amp' || libraryCleanupLayout === 'creator-amp-di-cab' || libraryCleanupLayout === 'creator-amp-di-cab-preset'
    const requireDiCab = libraryCleanupLayout === 'creator-amp-di-cab' || libraryCleanupLayout === 'creator-amp-di-cab-preset'
    const requirePreset = libraryCleanupLayout === 'creator-amp-di-cab-preset'
    let stopDeeperClassification = false

    if (requireCreator) {
      if (!creator) {
        needsReview = true
        note = 'Missing creator'
      } else {
        const safeCreator = sanitizeCleanupPathPart(creator)
        if (!safeCreator) {
          needsReview = true
          note = 'Creator name not usable as folder'
        } else {
          destParts.push(safeCreator)
        }
      }
    }

    if (!needsReview && requireAmp) {
      if (!make || !model) {
        stopDeeperClassification = true
        note = destParts.length > 0 ? 'Stopped at current folder: missing manufacturer/model' : 'Missing manufacturer/model'
      } else {
        const safeAmp = sanitizeCleanupPathPart(`${make} ${model}`.trim())
        if (!safeAmp) {
          needsReview = true
          note = 'Manufacturer/model not usable as folder'
        } else {
          destParts.push(safeAmp)
        }
      }
    }

    if (!needsReview && !stopDeeperClassification && requireDiCab) {
      const diCab = inferCleanupDiCabFromFile(file)
      if (diCab) destParts.push(diCab)
      else {
        stopDeeperClassification = true
        note = destParts.length > 0 ? 'Stopped at current folder: missing DI/CAB classification' : 'Missing DI/CAB classification'
      }
    }

    if (!needsReview && !stopDeeperClassification && requirePreset) {
      const preset = detectPreset(file.config)
      if (!preset) {
        stopDeeperClassification = true
        note = destParts.length > 0 ? 'Stopped at current folder: preset type not detected' : 'Preset type not detected'
      } else {
        const safePreset = sanitizeCleanupPathPart(preset)
        if (!safePreset) {
          needsReview = true
          note = 'Preset type not usable as folder'
        } else {
          destParts.push(safePreset)
        }
      }
    }

    const finalParts = [...destParts]
    if (
      libraryCleanupOpenMode === 'folder' &&
      librarian.rootFolder &&
      libraryCleanupSourceRoot &&
      finalParts.length > 0
    ) {
      const rootPath = librarian.rootFolder.replace(/\\/g, '/')
      const sourcePath = libraryCleanupSourceRoot.replace(/\\/g, '/')
      const relativeSource = sourcePath.startsWith(rootPath + '/')
        ? sourcePath.slice(rootPath.length + 1)
        : sourcePath === rootPath
          ? ''
          : sourcePath
      const sourceSegments = relativeSource
        .split('/')
        .filter(Boolean)
        .map((segment) => sanitizeCleanupPathPart(segment))
        .filter(Boolean)

      while (
        sourceSegments.length > 0 &&
        finalParts.length > 0 &&
        sourceSegments[0].toLowerCase() === finalParts[0].toLowerCase()
      ) {
        sourceSegments.shift()
        finalParts.shift()
      }
    }

    const destinationDir = needsReview
      ? [libraryCleanupDestinationRoot!, ...finalParts, 'Needs Review'].join('/')
      : [libraryCleanupDestinationRoot!, ...finalParts].join('/')

    return {
      sourcePath: file.filePath.replace(/\\/g, '/'),
      destinationDir,
      destinationBaseName: fileName,
      needsReview,
      note,
    }
  }, [libraryCleanupLayout, libraryCleanupDestinationRoot, libraryCleanupOpenMode, libraryCleanupSourceRoot, librarian.rootFolder])

  const handlePreviewLibraryCleanup = async () => {
    if (!libraryCleanupSourceRoot || !libraryCleanupDestinationRoot) {
      setStatus({ message: 'Pick both a source root and a destination library root first', type: 'error' })
      return
    }
    const sameRoot = libraryCleanupSourceRoot === libraryCleanupDestinationRoot
    const allowNestedFolderCleanup =
      libraryCleanupOpenMode === 'folder' &&
      isPathWithin(libraryCleanupSourceRoot, libraryCleanupDestinationRoot)
    if (!sameRoot && !allowNestedFolderCleanup && (isPathWithin(libraryCleanupSourceRoot, libraryCleanupDestinationRoot) || isPathWithin(libraryCleanupDestinationRoot, libraryCleanupSourceRoot))) {
      setStatus({ message: 'Source root and destination library root cannot be nested inside each other', type: 'error' })
      return
    }
    const excluded = Array.from(buildLibraryCleanupExcludedPaths())
    const candidatePaths = libraryCleanupFilePaths.filter((filePath) => !excluded.some((excludedPath) => isPathWithin(filePath, excludedPath)))
    const loadedFileMap = new Map(files.map((file) => [file.filePath.replace(/\\/g, '/'), file]))
    setLibraryCleanupBusyLabel(`Analyzing ${candidatePaths.length} file(s)...`)
    const validFiles: NamFile[] = []
    const diskPaths: string[] = []
    for (const filePath of candidatePaths) {
      const loaded = loadedFileMap.get(filePath.replace(/\\/g, '/'))
      if (loaded) validFiles.push(loaded)
      else diskPaths.push(filePath)
    }

    const results: Array<Awaited<ReturnType<typeof window.api.readFile>>> = []
    const concurrency = 40
    for (let i = 0; i < diskPaths.length; i += concurrency) {
      const chunk = diskPaths.slice(i, i + concurrency)
      const chunkResults = await Promise.all(chunk.map((filePath) => window.api.readFile(filePath)))
      results.push(...chunkResults)
    }
    const diskFiles: NamFile[] = results
      .filter((result): result is Awaited<ReturnType<typeof window.api.readFile>> & { success: true; filePath: string; version: string; metadata: NamFile['metadata']; architecture: string; config: unknown } =>
        !!result.success && !!result.filePath && !!result.version && !!result.metadata && !!result.architecture
      )
      .map((result) => ({
        filePath: result.filePath,
        fileName: result.filePath.replace(/\\/g, '/').split('/').pop() ?? result.filePath,
        version: result.version,
        notes: (result as Record<string, unknown>).notes as string[] | undefined,
        metadata: migrateLegacyNamBotInMemory(result.metadata),
        originalMetadata: migrateLegacyNamBotInMemory(result.metadata),
        autoFilledFields: [],
        architecture: result.architecture,
        config: result.config ?? null,
        isDirty: false,
        mtimeMs: result.mtimeMs,
        birthtimeMs: result.birthtimeMs,
        sizeBytes: result.sizeBytes,
      }))

    validFiles.push(...diskFiles)

    const previewRows = validFiles.map((file) => {
      const classified = classifyLibraryCleanupFile(file)
      const destinationPath = `${classified.destinationDir}/${classified.destinationBaseName}`.replace(/\\/g, '/')
      const sourcePath = classified.sourcePath.replace(/\\/g, '/')
      const actionable = libraryCleanupOpenMode === 'folder' && libraryCleanupSourceRoot && libraryCleanupDestinationRoot
        ? relativePathWithin(sourcePath, libraryCleanupSourceRoot) !== relativePathWithin(destinationPath, libraryCleanupDestinationRoot)
        : sourcePath !== destinationPath
      return {
        sourcePath,
        destinationPath,
        note: actionable
          ? classified.note
          : (classified.note ?? (libraryCleanupOpenMode === 'folder'
              ? 'Already matches selected structure beneath this folder'
              : 'Already matches selected structure')),
        needsReview: classified.needsReview,
        actionable,
      } satisfies LibraryCleanupPreviewRow
    })
    setLibraryCleanupBusyLabel(null)
    setLibraryCleanupPreviewRows(previewRows)
    setStatus({ message: `Library cleanup preview built for ${previewRows.length} file${previewRows.length !== 1 ? 's' : ''}`, type: 'success' })
  }

  const handleExportLibraryCleanupNeedsReview = (format: 'csv' | 'xlsx') => {
    const needsReviewRows = (libraryCleanupPreviewRows ?? []).filter((row) => row.needsReview)
    if (needsReviewRows.length === 0) {
      setStatus({ message: 'No Needs Review rows available to export', type: 'info' })
      return
    }

    const rows = needsReviewRows.map((row) => ({
      Capture: row.sourcePath.replace(/\\/g, '/').split('/').pop() ?? row.sourcePath,
      SourceFolder: row.sourcePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/'),
      SourcePath: row.sourcePath,
      DestinationPath: row.destinationPath,
      Reason: row.note ?? 'Needs review',
      Status: 'Needs Review',
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ['Capture', 'SourceFolder', 'SourcePath', 'DestinationPath', 'Reason', 'Status'],
    })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Needs Review')
    const rootLabel = folderDisplayName(libraryCleanupSourceRoot ?? librarian.rootFolder ?? 'library')
    const fileName = `needs-review-${rootLabel || 'library'}.${format}`
    XLSX.writeFile(workbook, fileName, { bookType: format })
    setStatus({
      message: `Exported ${needsReviewRows.length} Needs Review row${needsReviewRows.length !== 1 ? 's' : ''} to ${fileName}`,
      type: 'success',
    })
  }

  const ensureCleanupDestinationDir = async (destinationDir: string) => {
    const normalized = destinationDir.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length === 0) return
    let current = normalized.startsWith('//') ? '//' : ''
    let driveRoot = ''
    if (/^[A-Za-z]:$/.test(parts[0])) {
      current = parts[0]
      driveRoot = `${parts[0]}/`
      parts.shift()
    }
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      const stat = await window.api.statPath(current)
      if (!stat.isDirectory) {
        const currentParts = current.replace(/\\/g, '/').split('/').filter(Boolean)
        let parent = currentParts.slice(0, -1).join('/')
        if (driveRoot && currentParts.length === 2 && /^[A-Za-z]:$/.test(currentParts[0])) {
          parent = driveRoot
        } else if (!parent) {
          parent = current.match(/^[A-Za-z]:\//)?.[0] ?? ''
        }
        const name = current.replace(/\\/g, '/').split('/').pop() ?? current
        const result = await window.api.createFolder(parent, name)
        if (!result.success && !(await window.api.statPath(current)).isDirectory) {
          throw new Error(result.error ?? `Could not create ${current}`)
        }
      }
    }
  }

  const handleRunLibraryCleanup = async () => {
    if (!libraryCleanupPreviewRows || libraryCleanupPreviewRows.length === 0 || !libraryCleanupDestinationRoot) return
    const actionableRows = libraryCleanupPreviewRows.filter((row) => row.actionable)
    if (actionableRows.length === 0) {
      setStatus({ message: 'Nothing to do - the selected files already match the current cleanup structure', type: 'info' })
      return
    }
    if (libraryCleanupActionMode === 'move') {
      const confirmed = window.confirm('WARNING: Move will relocate the source files and cannot be undone by NAM Lab.\n\nContinue?')
      if (!confirmed) return
    }
    const uncheckedPaths = libraryCleanupFolderEntries.filter((entry) => !entry.checked).map((entry) => entry.path.replace(/\\/g, '/'))
    if (libraryCleanupRememberUnchecked) {
      const mergedIgnored = Array.from(new Set([
        ...getLibraryCleanupSavedIgnores(),
        ...uncheckedPaths,
      ]))
      handleSaveSettings({
        ...settings,
        libraryCleanupIgnoredPaths: mergedIgnored,
      })
    }

    setLibraryCleanupBusyLabel(`Running ${libraryCleanupActionMode} cleanup...`)
    let completed = 0
    let failed = 0
    let skipped = 0
    let autoSuffixed = 0
    let packInfoTransferred: 'copied' | 'moved' | 'kept-destination' | null = null
    const usedDestinations = new Set<string>()
    for (const row of actionableRows) {
      const normalizedDest = row.destinationPath.replace(/\\/g, '/')
      const destDir = normalizedDest.split('/').slice(0, -1).join('/')
      await ensureCleanupDestinationDir(destDir)
      const originalBaseName = normalizedDest.split('/').pop() ?? ''
      const sourceBaseName = cleanupSourceBaseName(row.sourcePath)
      let desiredBaseName = originalBaseName
      if (/\.nam$/i.test(sourceBaseName) && !/\.nam$/i.test(desiredBaseName)) {
        desiredBaseName = `${desiredBaseName}.nam`
      }
      const collisionBaseName = desiredBaseName
      let targetPath = `${destDir}/${desiredBaseName}`
      let suffix = 2
      // Avoid collisions with files already planned this run and with files already sitting in the destination.
      // `readFile` is enough here because the destination should only contain `.nam` files we care about organizing.
      while (usedDestinations.has(targetPath) || (await window.api.readFile(targetPath)).success) {
        const dotIndex = collisionBaseName.lastIndexOf('.')
        const stem = dotIndex > 0 ? collisionBaseName.slice(0, dotIndex) : collisionBaseName
        const ext = dotIndex > 0 ? collisionBaseName.slice(dotIndex) : ''
        desiredBaseName = `${stem} (${suffix})${ext}`
        targetPath = `${destDir}/${desiredBaseName}`
        suffix += 1
      }
      const normalizedSource = row.sourcePath.replace(/\\/g, '/')
      if (normalizedSource === targetPath) {
        usedDestinations.add(targetPath)
        skipped += 1
        continue
      }
      const result = libraryCleanupActionMode === 'copy'
        ? (await window.api.copyFiles([row.sourcePath], destDir, [desiredBaseName]))[0]
        : await window.api.moveFile(row.sourcePath, destDir, false, desiredBaseName)
      if (!result.success || !result.destPath) {
        failed += 1
        continue
      }
      const actualBaseName = result.destPath.replace(/\\/g, '/').split('/').pop() ?? ''
      if (actualBaseName !== desiredBaseName) {
        const renameResult = await window.api.renameFile(result.destPath, desiredBaseName.replace(/\.[^.]+$/, ''))
        if (!renameResult.success || !renameResult.newPath) {
          failed += 1
          continue
        }
        if (desiredBaseName !== actualBaseName) autoSuffixed += 1
      } else if (desiredBaseName !== originalBaseName) {
        autoSuffixed += 1
      }
      usedDestinations.add(targetPath)
      completed += 1
    }

    if (completed > 0 && libraryCleanupSourceRoot && libraryCleanupDestinationRoot && libraryCleanupSourceRoot !== libraryCleanupDestinationRoot) {
      const sourcePack = await window.api.readPackInfo(libraryCleanupSourceRoot)
      const destinationPack = await window.api.readPackInfo(libraryCleanupDestinationRoot)
      const sourcePackData = sourcePack.success ? sourcePack.data : null
      const destinationPackData = destinationPack.success ? destinationPack.data : null
      const destinationHasPackInfo = !!destinationPackData && typeof destinationPackData === 'object' && Object.keys(destinationPackData as Record<string, unknown>).length > 0

      if (sourcePackData && !destinationHasPackInfo) {
        const writeResult = await window.api.writePackInfo(libraryCleanupDestinationRoot, sourcePackData)
        if (writeResult.success) {
          if (libraryCleanupActionMode === 'move') {
            const deleteResult = await window.api.deletePackInfo(libraryCleanupSourceRoot)
            packInfoTransferred = deleteResult.success ? 'moved' : 'copied'
          } else {
            packInfoTransferred = 'copied'
          }
        }
      } else if (sourcePackData && destinationHasPackInfo) {
        packInfoTransferred = 'kept-destination'
      }
    }

    setLibraryCleanupBusyLabel(null)
    let message = `Library cleanup complete: ${completed} ${libraryCleanupActionMode === 'copy' ? 'copied' : 'moved'}, ${skipped} skipped, ${autoSuffixed} auto-suffixed, ${failed} failed`
    if (packInfoTransferred === 'moved') {
      message += ', Pack Info moved to destination root'
    } else if (packInfoTransferred === 'copied') {
      message += ', Pack Info copied to destination root'
    } else if (packInfoTransferred === 'kept-destination') {
      message += ', destination Pack Info kept'
    }
    setStatus({
      message,
      type: failed > 0 ? 'error' : 'success',
    })
    if (completed > 0) {
      setShowLibraryCleanup(false)
      if (libraryCleanupOpenMode === 'library') {
        await loadFolderByPath(libraryCleanupDestinationRoot)
      } else if (librarian.rootFolder) {
        await loadFolderByPath(librarian.rootFolder)
      }
    } else if (librarian.rootFolder) {
      await refreshFolderTree()
    }
  }

  const openSuggestMetadataModal = (scopedFiles: NamFile[], folderName: string) => {
    const scopeLabel = folderName

    if (scopedFiles.length === 0) {
      const message = `No files available in ${scopeLabel} to analyze`
      setStatus({ message, type: 'info' })
      window.alert(message)
      return
    }

    const matches = buildMetadataSuggestionMatches(scopedFiles, settings.metadataSuggestRules, settings.metadataSuggestScopedRules)
    if (matches.length === 0) {
      const message = `No metadata suggestions found for blank fields in ${scopeLabel}. Try adding a rule in Settings -> Metadata Suggestions, or test on files missing tone type / gear type.`
      setStatus({ message, type: 'info' })
      window.alert(message)
      return
    }

    setSuggestMetadataModal({
      folderName: scopeLabel,
      matches,
    })
  }

  const handleSuggestMetadataConfirm = async (matches: MetadataSuggestionMatch[]) => {
    setSuggestMetadataModal(null)
    let updated = 0
    let failed = 0
    const successMap = new Map<string, { writtenFields: Partial<NamFile['metadata']> }>()

    for (const match of matches) {
      const incoming = Object.fromEntries(match.suggestions.map((suggestion) => [suggestion.field, suggestion.value])) as Partial<NamFile['metadata']>
      if (Object.keys(incoming).length === 0) continue
      const result = await window.api.writeMetadata(match.file.filePath, incoming)
      if (result.success) {
        updated++
        successMap.set(match.file.filePath, { writtenFields: incoming })
      } else {
        failed++
      }
    }

    if (successMap.size > 0) {
      setFiles((prev) => prev.map((file) => {
        const saved = successMap.get(file.filePath)
        if (!saved) return file
        const metadata = { ...file.metadata, ...saved.writtenFields }
        const originalMetadata = { ...file.originalMetadata, ...saved.writtenFields }
        const savedKeys = new Set(Object.keys(saved.writtenFields) as (keyof NamFile['metadata'])[])
        const autoFilledFields = file.autoFilledFields.filter((k) => !savedKeys.has(k))
        const isDirty = JSON.stringify(metadata) !== JSON.stringify(originalMetadata)
        return { ...file, metadata, originalMetadata, isDirty, autoFilledFields }
      }))
    }

    if (updated > 0) {
      addHistoryEntry({
        operation: 'suggest-metadata',
        summary: `Applied metadata suggestions to ${updated} file${updated !== 1 ? 's' : ''}`,
      })
    }

    let message = `Applied metadata suggestions to ${updated} file${updated !== 1 ? 's' : ''}`
    if (failed > 0) message += `, ${failed} failed`
    setStatus({ message, type: failed > 0 ? 'error' : 'success' })
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
    const permanentlyDeleted = results.filter((r) => r.success && r.deleteMode === 'delete').length
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
    } else if (permanentlyDeleted > 0) {
      setStatus({
        message: `Deleted ${trashed.length} duplicate${trashed.length !== 1 ? 's' : ''} permanently (${permanentlyDeleted} could not be moved to trash)`,
        type: 'info'
      })
    } else {
      setStatus({ message: `Trashed ${trashed.length} duplicate${trashed.length !== 1 ? 's' : ''}`, type: 'success' })
    }
  }

  const handleFindDuplicatesInFolder = useCallback((folderPath: string) => {
    setDuplicatesScopeFolder(folderPath.replace(/\\/g, '/'))
    setShowDuplicates(true)
  }, [])

  const handleFilterLocalCreator = (creator: string) => {
    const target = normalizeCreatorName(creator)
    const savedTone3000Username = normalizeCreatorName(settings.tone3000Username || '')
    const localCreators = Array.from(new Set(
      files.map((f) => f.metadata.modeled_by?.trim()).filter((v): v is string => !!v)
    ))
    const normalizedMatches = localCreators.filter((name) => normalizeCreatorName(name) === target)
    const matchedCreator = normalizedMatches.length === 1
      ? normalizedMatches[0]
      : (savedTone3000Username && target === savedTone3000Username && settings.defaultModeledBy.trim()
          ? settings.defaultModeledBy.trim()
          : creator)

    setCreatorFilter(matchedCreator)
    setGearTypeFilter(null)
    setToneTypeFilter(null)
    setPresetFilterOverride(null)
    setFilterModeOverride(null)
    setEsrFilterOverride(null)
    setRatingFilter(null)
    setLibraryFilter(null)
    setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
    setSelectedIds(new Set())
  }

  const handleFindSimilarTone3000 = (filePath: string) => {
    const file = files.find((f) => f.filePath === filePath)
    if (!file) return
    const query = [file.metadata.gear_make, file.metadata.gear_model].filter(Boolean).join(' ').trim()
    if (!query) {
      setStatus({ message: 'This capture needs Manufacturer and/or Model metadata before searching Tone3000', type: 'error' })
      return
    }
    setToneStoreSearchRequest({ key: Date.now(), query })
    setShowToneStore(true)
    setShowSettings(false)
    setBatchFolder(null)
    setShowDashboard(false)
  }

  // Filter files by selected folder and/or library search filter
  const visibleFiles = files.filter((f) => {
    const norm = f.filePath.replace(/\\/g, '/')
    if (librarian.selectedFolders.length > 0 && !librarian.selectedFolders.some((sf) => norm.startsWith(sf + '/'))) return false
    if (directFilesOnly && librarian.selectedFolders.length === 1) {
      const parentFolder = norm.split('/').slice(0, -1).join('/')
      if (parentFolder !== librarian.selectedFolders[0]) return false
    }
    if (libraryFilter && !libraryFilter.has(norm)) return false
    return true
  })

  const selectedFiles = visibleFiles.filter((f) => selectedIds.has(f.filePath))
  const selectedSingleFilePath = selectedFiles.length === 1 ? selectedFiles[0].filePath : null
  const selectedFileSignature = selectedFiles.map((f) => f.filePath).sort().join('|')
  const skipNextTrainingWorkspaceSelectionCloseRef = useRef(false)
  const previousSelectionSignatureRef = useRef(selectedFileSignature)

  useEffect(() => {
    let alive = true
    void window.api.getTrainerState().then((state) => {
      if (alive) setGlobalTrainerState(state)
    }).catch(() => null)
    const unsubscribe = window.api.onTrainerUpdate((state) => {
      if (alive) setGlobalTrainerState(state)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const handleOpenExperimentalTraining = (mode: 'files' | 'folder' | 'queue' | 'history' = 'files') => {
    setShowSettings(false)
    setShowDashboard(false)
    setHistoryOpen(false)
    setShowToneStore(false)
    setBatchFolder(null)
    setTrainingWorkspaceMode(mode)
    skipNextTrainingWorkspaceSelectionCloseRef.current = true
    setShowTrainingWorkspace(true)

    if (!settings.enableExperimentalTraining) {
      setStatus({ message: 'Enable Local Training in Settings first.', type: 'info' })
      return
    }
    setStatus({ message: 'Opened the training workspace.', type: 'info' })
  }

  const handleTrainWavsFromCoverage = useCallback(async (wavPaths: string[]) => {
    if (!settings.enableExperimentalTraining) {
      setStatus({ message: 'Enable Local Training in Settings first.', type: 'info' })
      return
    }
    if (!settings.namPythonPath.trim() || !settings.namTrainingInputWav.trim()) {
      setStatus({ message: 'Configure Python path and input WAV in Settings before training.', type: 'info' })
      return
    }
    const folderPath = ((librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null) ?? librarian.rootFolder)
    if (!folderPath) return
    const preset = settings.trainingPresets[0] ?? null
    const architectures = (preset?.architectures ?? ['standard']).filter(
      (a): a is TrainerArchitecture => TRAINER_ARCHITECTURES.includes(a as TrainerArchitecture)
    )
    const epochs = preset?.epochs ?? 1000
    const latency = preset?.latencyMode === 'manual' ? (preset?.latencyValue ?? null) : null
    const thresholdEsr = preset?.thresholdEsr ?? null
    const savePlot = preset?.savePlot ?? false
    const ignoreChecks = preset?.ignoreChecks ?? false
    const modeledBy = settings.enableCaptureDefaults && settings.defaultModeledBy.trim() ? settings.defaultModeledBy.trim() : null
    const submissionId = `wav-check-${Date.now()}`
    const submissionLabel = `WAV Check – ${wavPaths.length} capture${wavPaths.length !== 1 ? 's' : ''}`
    const submissionCreatedAt = new Date().toISOString()
    const payloads: TrainerStartPayload[] = wavPaths.flatMap((wavPath) =>
      architectures.map((architecture) => ({
        pythonPath: settings.namPythonPath.trim(),
        inputPath: settings.namTrainingInputWav.trim(),
        outputPath: wavPath,
        trainPath: folderPath,
        architecture,
        epochs,
        latency,
        thresholdEsr,
        savePlot,
        silent: true,
        ignoreChecks,
        sourceMode: 'manual-direct' as const,
        finalModelRoot: folderPath,
        processedWavRoot: '',
        graphRoot: folderPath,
        sourcePostProcess: 'keep' as const,
        namingTemplate: '{basename}',
        profileId: preset?.id ?? null,
        profileName: preset?.name ?? null,
        modeledBy,
        inputLevelDbu: null,
        outputLevelDbu: null,
        submissionId,
        submissionLabel,
        submissionCreatedAt,
      }))
    )
    const result = await window.api.enqueueTrainerRuns(payloads)
    if (result.success) {
      handleOpenExperimentalTraining('queue')
      setStatus({ message: `Queued ${result.queued ?? payloads.length} training job${payloads.length !== 1 ? 's' : ''}.`, type: 'success' })
    } else {
      setStatus({ message: result.error ?? 'Failed to queue training jobs.', type: 'error' })
    }
  }, [settings, librarian, handleOpenExperimentalTraining])

  useEffect(() => {
    if (selectedFiles.length !== 1 && selectedFilePanelTab === 'training') {
      setSelectedFilePanelTab('metadata')
    }
  }, [selectedFiles.length, selectedFilePanelTab])
  const previousSelectedSingleFilePathRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousSelectedSingleFilePathRef.current
    if (
      previous &&
      selectedSingleFilePath &&
      previous !== selectedSingleFilePath &&
      selectedFilePanelTab === 'training'
    ) {
      setSelectedFilePanelTab('metadata')
    }
    previousSelectedSingleFilePathRef.current = selectedSingleFilePath
  }, [selectedFilePanelTab, selectedSingleFilePath])
  useEffect(() => {
    const previous = previousSelectionSignatureRef.current
    const changed = previous !== selectedFileSignature
    if (showTrainingWorkspace && changed) {
      if (trainingWorkspaceMode === 'files') {
        previousSelectionSignatureRef.current = selectedFileSignature
        return
      }
      if (skipNextTrainingWorkspaceSelectionCloseRef.current) {
        skipNextTrainingWorkspaceSelectionCloseRef.current = false
      } else {
        setShowTrainingWorkspace(false)
      }
    } else if (skipNextTrainingWorkspaceSelectionCloseRef.current && showTrainingWorkspace) {
      skipNextTrainingWorkspaceSelectionCloseRef.current = false
    }
    previousSelectionSignatureRef.current = selectedFileSignature
  }, [selectedFileSignature, showTrainingWorkspace, trainingWorkspaceMode])
  const showToneStorePanel = showToneStore && !showSettings && !showDashboard && !historyOpen && batchFolder === null
  const activeTrainingQueueCount = globalTrainerState.queue.filter((job) => ['queued', 'starting', 'running'].includes(job.status)).length
  const trainingQueueIsActive = globalTrainerState.status === 'starting' || globalTrainerState.status === 'running'

  useEffect(() => {
    const autoRunWatcherIds = new Set(
      settings.enableExperimentalTraining
        ? settings.trainingWatchProfiles
            .filter((profile) => profile.enabled && profile.autoRun)
            .map((profile) => profile.id)
        : []
    )
    const queuedWatcherJobs = globalTrainerState.queue.filter(
      (job) => job.status === 'queued' && job.sourceMode === 'watcher' && !!job.profileId && autoRunWatcherIds.has(job.profileId)
    )
    if (queuedWatcherJobs.length === 0 || trainingQueueIsActive) {
      trainerWatcherAutoStartRecoveryRef.current = ''
      return
    }
    const recoveryKey = queuedWatcherJobs.map((job) => job.jobId).join('|')
    if (!recoveryKey || trainerWatcherAutoStartRecoveryRef.current === recoveryKey) return
    trainerWatcherAutoStartRecoveryRef.current = recoveryKey
    void window.api.startQueuedTrainerRuns().catch(() => {
      trainerWatcherAutoStartRecoveryRef.current = ''
    })
  }, [
    globalTrainerState.queue,
    settings.enableExperimentalTraining,
    settings.trainingWatchProfiles,
    trainingQueueIsActive,
  ])

  useEffect(() => {
    if (showToneStore || toneStoreSearchRequest) setToneStoreMounted(true)
  }, [showToneStore, toneStoreSearchRequest])
  useEffect(() => {
    if (selectedFiles.length !== 1) {
      setMetadataCoverPath(null)
      return
    }
    let cancelled = false
    const selected = selectedFiles[0]
    const normalized = selected.filePath.replace(/\\/g, '/')
    const fileFolder = normalized.split('/').slice(0, -1).join('/')
    const normalizedRoot = librarian.rootFolder.replace(/\\/g, '/')
    const candidates: string[] = []
    let current: string | null = fileFolder
    while (current) {
      if (!candidates.includes(current)) candidates.push(current)
      if (current === normalizedRoot) break
      const lastSlash = current.lastIndexOf('/')
      if (lastSlash <= 0) break
      const parent = current.slice(0, lastSlash)
      if (!parent.startsWith(normalizedRoot) || parent.length < normalizedRoot.length) break
      current = parent
    }
    const resolveCover = async () => {
      for (const folderPath of candidates) {
        const result = await window.api.scanImages(folderPath)
        if (!result.success) continue
        const match = result.images.find((imagePath) => {
          const fileName = imagePath.replace(/\\/g, '/').split('/').pop() ?? ''
          return AMPCOVER_PATTERN.test(fileName)
        })
        if (match) {
          if (!cancelled) setMetadataCoverPath(match)
          return
        }
      }
      if (!cancelled) setMetadataCoverPath(null)
    }
    void resolveCover()
    return () => { cancelled = true }
  }, [librarian.rootFolder, selectedFiles])
  // Close slide panel if selection is empty (and no batch edit active)
  if (gridSlideOpen && selectedFiles.length === 0 && batchFolder === null) setGridSlideOpen(false)
  const dirtyCount = files.filter((f) => f.isDirty).length
  const autoFilledCount = files.filter((f) => f.autoFilledFields.length > 0).length
  const unnamedCount = files.filter((f) => !f.metadata.name).length
  const hasTree = librarian.folderTree !== null
  const dirtyPaths = new Set(files.filter((f) => f.isDirty).map((f) => f.filePath.replace(/\\/g, '/')))
  const folderWatchSourceByDest = Object.fromEntries(
    settings.folderWatchRules
      .filter((rule) => rule.enabled)
      .map((rule) => [rule.destFolder.replace(/\\/g, '/'), rule.sourceFolder.replace(/\\/g, '/')])
  ) as Record<string, string>
  const duplicateModalFiles = duplicatesScopeFolder
    ? files.filter((f) => {
        const normalized = f.filePath.replace(/\\/g, '/')
        return normalized.startsWith(duplicatesScopeFolder + '/')
      })
    : files

  const GEAR_MAKE_SEED = ['Marshall', 'Fender', 'Mesa Boogie', 'Bogner', 'Friedman', 'Dumble', 'Vox', 'Orange', 'Peavey', 'EVH', 'Carr', 'Two-Rock', 'Matchless', 'Bad Cat', 'Soldano', 'Dr. Z', 'Diezel', 'Morgan', 'Egnater', 'Suhr', 'Koch', 'Victory', 'Laney', 'Hiwatt', 'Engl', 'Rivera', 'Tone King', 'Divided by 13', 'Cornford', 'Komet', 'PRS', 'Kemper']
  const gearMakeSuggestions = Array.from(new Set([
    ...GEAR_MAKE_SEED,
    ...files.map((f) => f.metadata.gear_make).filter((v): v is string => !!v)
  ])).sort()
  const gearModelSuggestions = Array.from(new Set(
    files.map((f) => f.metadata.gear_model).filter((v): v is string => !!v)
  )).sort()
  const suggestRulesEditorExample = suggestRulesEditorPath
    ? (() => {
        const exampleFile = files.find((file) => file.filePath.replace(/\\/g, '/').startsWith(suggestRulesEditorPath + '/'))
        if (!exampleFile) return ''
        return exampleFile.metadata.name?.trim() || exampleFile.fileName.replace(/\.nam$/i, '')
      })()
    : ''

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
        autoFilledCount={autoFilledCount}
        fileCount={files.length}
        isMac={window.api.platform === 'darwin'}
        showSettings={showSettings}
        onToggleSettings={() => {
          setShowSettings((s) => !s)
          setBatchFolder(null)
          setShowToneStore(false)
          setShowTrainingWorkspace(false)
          if (gridMaximized) setGridSlideOpen(true)
        }}
        unnamedCount={unnamedCount}
        onNameFromFilename={handleNameFromFilename}
        onClearSuggestionsAll={handleClearSuggestionsAll}
        onCloseAll={handleCloseAll}
        rootFolder={librarian.rootFolder}
        onRefresh={handleRefresh}
        recentFolders={recentFolders}
        onOpenRecentFolder={(path) => loadFolderByPath(path)}
        onFindDuplicates={files.length > 0 ? () => { setDuplicatesScopeFolder(null); setShowDuplicates(true) } : undefined}
        onOpenLibraryCleanup={handleOpenLibraryCleanup}
        showExperimentalTraining={settings.enableExperimentalTraining}
        onOpenExperimentalTraining={() => handleOpenExperimentalTraining('files')}
        trainingQueueCount={activeTrainingQueueCount}
        trainingQueueActive={trainingQueueIsActive}
        onOpenTrainingQueue={() => handleOpenExperimentalTraining('queue')}
        showDashboard={files.length > 0}
        dashboardActive={showDashboard}
        onToggleDashboard={() => {
          setShowDashboard((v) => !v)
          setHistoryOpen(false)
          setShowSettings(false)
          setShowToneStore(false)
          setShowTrainingWorkspace(false)
          setBatchFolder(null)
        }}
        historyOpen={historyOpen}
        onHistoryToggle={() => {
          setHistoryOpen((v) => !v)
          setShowDashboard(false)
          setShowSettings(false)
          setShowToneStore(false)
          setShowTrainingWorkspace(false)
          setBatchFolder(null)
        }}
        toneStoreActive={showToneStorePanel}
        onToggleToneStore={() => {
          setToneStoreDefaultDir(null)
          setShowToneStore((v) => !v)
          setShowDashboard(false)
          setHistoryOpen(false)
          setShowSettings(false)
          setShowTrainingWorkspace(false)
          setBatchFolder(null)
        }}
        helpOpen={helpView !== null}
        onOpenHelp={() => setHelpView('workflows')}
        onOpenFeatureHelp={() => setHelpView('features')}
        onOpenAbout={() => setHelpView('about')}
        cardViewActive={cardView}
        cardViewEnabled={!!librarian.rootFolder && !!(librarian.folderTree?.children?.length)}
        onToggleCardView={() => { setCardViewInitialPath(null); setCardView((v) => !v) }}
      />

      {/* Content area: card view (left) + 3-panel / ToneStore (right) */}
      <div className="flex flex-1 overflow-hidden">
        {cardView && librarian.folderTree?.children && librarian.rootFolder && (
          <FolderCardView
            rootNode={librarian.folderTree}
            rootFolder={librarian.rootFolder}
            files={files}
            packInfoFolders={packInfoFolders}
            isDark={settings.theme !== 'light'}
            initialPath={cardViewInitialPath}
            rescanSignal={cardRescanSignal}
            hidePreviewPanel={showToneStorePanel}
            onOpenFolder={(path) => {
              setCardView(false)
              setCardViewInitialPath(null)
              setLibrarian((prev) => ({ ...prev, selectedFolders: [path] }))
            }}
            onSearchTone3000={(query, folderPath) => {
              setToneStoreDefaultDir(folderPath)
              setToneStoreSearchRequest({ key: Date.now(), query })
              setShowToneStore(true)
              setShowSettings(false)
              setBatchFolder(null)
              setShowDashboard(false)
              setHistoryOpen(false)
            }}
            onRefresh={async () => {
              await refreshFolderTree()
              setCardRescanSignal((s) => s + 1)
            }}
          />
        )}

      {/* Drag handle between card grid and ToneStore panel */}
      {cardView && showToneStorePanel && (
        <div
          className="w-1 cursor-col-resize shrink-0 bg-gray-200 dark:bg-gray-800 hover:bg-teal-500/60 active:bg-teal-500 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const startW = toneStorePanelWidth
            const onMove = (ev: MouseEvent) => {
              const next = Math.max(300, Math.min(700, startW - (ev.clientX - startX)))
              setToneStorePanelWidth(next)
              localStorage.setItem('toneStorePanelWidth', String(next))
            }
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        />
      )}

      {/* 3-panel layout — hidden in card view unless ToneStore is open (then right-panel only) */}
      <div className="flex flex-1 overflow-hidden relative" style={
        cardView && showToneStorePanel ? { width: toneStorePanelWidth, flexBasis: toneStorePanelWidth, flexShrink: 0, flexGrow: 0 }
        : cardView ? { display: 'none' }
        : undefined
      }>
        {/* Folder tree — only shown when a folder is open */}
        {hasTree && !(cardView && showToneStorePanel) && (
          <>
            <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: (treeCollapsed || gridMaximized || (cardView && showToneStorePanel)) ? 0 : treeWidth, overflow: 'hidden' }}>
              <FolderTree
                tree={librarian.folderTree!}
                files={files}
                selectedFolders={librarian.selectedFolders}
                dirtyPaths={dirtyPaths}
                foldersWithSuggestRules={new Set(settings.metadataSuggestScopedRules.map((set) => set.scopePath.replace(/\\/g, '/')))}
                onFilterChange={(matching) => setLibraryFilter(matching)}
                onSelect={(path, ctrl) => {
                  if (!ctrl) {
                    const isInFolderPanel =
                      !showSettings &&
                      !showDashboard &&
                      !historyOpen &&
                      !showToneStore &&
                      batchFolder === null &&
                      selectedIds.size === 0
                    preserveFolderTabRef.current = isInFolderPanel && folderPanelTab === 'pack' ? 'pack' : null
                  }
                  setLibrarian((prev) => {
                    if (path === null || !ctrl) return { ...prev, selectedFolders: path ? [path] : [] }
                    const isIn = prev.selectedFolders.includes(path)
                    return { ...prev, selectedFolders: isIn ? prev.selectedFolders.filter((f) => f !== path) : [...prev.selectedFolders, path] }
                  })
                  setCreatorFilter(null)
                  if (!ctrl) {
                    setSelectedIds(new Set())
                    setShowDashboard(false)
                    setHistoryOpen(false)
                    setShowSettings(false)
                    setShowToneStore(false)
                    setShowTrainingWorkspace(false)
                    setBatchFolder(null)
                  }
                }}
                onSaveFolder={async (path) => {
                  const targets = path === null
                    ? files.filter((f) => f.isDirty)
                    : files.filter((f) => f.isDirty && f.filePath.replace(/\\/g, '/').startsWith(path + '/'))
                  if (targets.length === 0) return
                  if (!settings.skipSaveAllConfirmation) {
                    const confirmed = window.confirm(`Save changes to ${targets.length} file${targets.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.\n\n(This warning can be toggled off in Settings -> Behavior)`)
                    if (!confirmed) return
                  }
                  setStatus({ message: `Saving ${targets.length} file(s)...`, type: 'info' })
                  const savedPaths = new Set<string>()
                  let failed = 0
                  const savedAt = Date.now()
                  for (const f of targets) {
                    const result = await window.api.writeMetadata(f.filePath, f.metadata)
                    if (result.success) savedPaths.add(f.filePath)
                    else failed++
                  }
                  setFiles((prev) => prev.map((f) =>
                    savedPaths.has(f.filePath)
                      ? { ...f, isDirty: false, originalMetadata: { ...f.metadata }, autoFilledFields: [], mtimeMs: savedAt }
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
                onDeleteEmptyFolder={handleDeleteEmptyFolder}
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
                onSuggestMetadata={handleSuggestMetadata}
                onEditSuggestRules={handleOpenSuggestRulesEditor}
                onSelectAllInFolder={handleSelectAllInFolder}
                onCoverageReport={(folderPath) => setCoverageReport({ folderPath })}
                scrollToFolder={treeScrollTarget}
                packInfoFolders={packInfoFolders}
                folderNameColors={settings.folderNameColors}
                onSetFolderColor={(folderName, color) => {
                  const next = { ...settings.folderNameColors }
                  if (color === null) delete next[folderName]
                  else next[folderName] = color
                  handleSaveSettings({ ...settings, folderNameColors: next })
                }}
                onCompareFolders={(paths) => setCompareFolderPaths(paths)}
                onDeletePackInfo={handleDeletePackInfo}
                bundleFolders={bundleFolders}
                onCreateBundle={(folderPath) => { void handleCreateBundle(folderPath) }}
                onDeleteBundle={(folderPath) => handleDeleteBundle(folderPath)}
                watchSourceByDest={folderWatchSourceByDest}
                onSetWatchSource={(folderPath) => { void handleSetWatchSource(folderPath) }}
                onClearWatchSource={handleClearWatchSource}
                onCopySuggestRules={handleCopyScopedSuggestRules}
                onPasteSuggestRules={suggestRulesClipboard ? handlePasteScopedSuggestRules : undefined}
                onFindDuplicates={handleFindDuplicatesInFolder}
                onCleanThisFolder={(folderPath) => { void handleOpenFolderCleanup(folderPath) }}
                onBrowseCards={(folderPath) => {
                  setCardViewInitialPath(folderPath)
                  setCardView(true)
                }}
              />
            </div>
            {!gridMaximized && <DragHandle onMouseDown={(e) => onDragStart('tree', e)} onCollapse={() => setTreeCollapsed((v) => !v)} collapsed={treeCollapsed} />}
          </>
        )}

        {/* File list Ã¢â‚¬â€ only shown when files are loaded */}
        {files.length > 0 && !(cardView && showToneStorePanel) && <>
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
                  if (prev.size === 1) return prev
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
              onSuggestMetadataSelected={handleSuggestMetadataForSelection}
              onSaveSelected={async (paths) => {
                const pathSet = new Set(paths)
                const targets = files.filter((f) => pathSet.has(f.filePath) && f.isDirty)
                if (targets.length === 0) {
                  setStatus({ message: 'No unsaved changes in selection', type: 'info' })
                  return
                }
                if (!settings.skipSaveAllConfirmation) {
                  const confirmed = window.confirm(`Save changes to ${targets.length} file${targets.length !== 1 ? 's' : ''}?\n\nThis will write to the original .nam files on disk.\n\n(This warning can be toggled off in Settings -> Behavior)`)
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
              onCleanOutdatedNamBot={handleCleanOutdatedNamBot}
              namPlayerAvailable={namPlayerDetected || !!settings.namStandalonePath}
              onOpenInNam={async (filePath) => {
                const result = await window.api.openInNam(filePath, settings.namStandalonePath)
                if (!result.success) setStatus({ message: `Could not open in NAM: ${result.error}`, type: 'error' })
              }}
              onFindSimilarTone3000={handleFindSimilarTone3000}
              defaultSearch={creatorFilter ?? undefined}
              defaultGearFilter={gearTypeFilter ?? undefined}
              defaultToneFilter={toneTypeFilter ?? undefined}
              defaultPresetFilter={presetFilterOverride ?? undefined}
              defaultFilterMode={filterModeOverride ?? undefined}
              esrFilter={esrFilterOverride}
              ratingFilter={ratingFilter}
              onGearFilterClear={() => setGearTypeFilter(null)}
              onToneFilterClear={() => setToneTypeFilter(null)}
              onPresetFilterClear={() => setPresetFilterOverride(null)}
              onFilterModeClear={() => setFilterModeOverride(null)}
              onRatingFilterClear={() => setRatingFilter(null)}
              activeFolderPath={librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null}
              directFilesOnly={directFilesOnly}
              onDirectFilesOnlyChange={setDirectFilesOnly}
            />
          </div>
          {!gridMaximized && <DragHandle onMouseDown={(e: React.MouseEvent) => onDragStart('list', e)} onCollapse={() => setListCollapsed((v) => !v)} collapsed={listCollapsed} />}
        </>}

        {/* Main content */}
        <div ref={mainContentRef} tabIndex={-1} className={`flex-1 overflow-hidden flex flex-col focus:outline-none${gridMaximized && !cardView ? ' hidden' : ''}`} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {toneStoreMounted && (
            <div
              className={showToneStorePanel ? 'flex-1 min-h-0 flex flex-col' : 'absolute inset-0 opacity-0 pointer-events-none -z-10'}
              aria-hidden={!showToneStorePanel}
            >
              <ToneStore
                onClose={() => {
                  setShowToneStore(false)
                  setToneStoreDefaultDir(null)
                  if (cardView) setCardRescanSignal((s) => s + 1)
                }}
                onDownloaded={(paths) => { loadFiles(paths, 'append'); if (cardView) setCardRescanSignal((s) => s + 1) }}
                onFilterLocalCreator={handleFilterLocalCreator}
                savedTone3000Username={settings.tone3000Username}
                searchRequest={toneStoreSearchRequest}
                queueJob={toneStoreQueueJob}
                onStartQueue={handleStartToneStoreQueue}
                onCancelQueue={handleCancelToneStoreQueue}
                defaultDownloadDir={toneStoreDefaultDir}
              />
            </div>
          )}
          {showSettings ? (
            <SettingsPanel settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
          ) : showToneStorePanel ? null : showTrainingWorkspace ? (
            <TrainingPanel
              settings={settings}
              onSaveSettings={handleSaveSettings}
              initialRunMode={trainingWorkspaceMode}
              onClose={() => setShowTrainingWorkspace(false)}
            />
          ) : showDashboard ? (
            <NamDashboard
              files={files}
              packChecklistRollup={dashboardChecklistEntries}
              activeCreator={creatorFilter ?? undefined}
              onCreatorClick={(creator) => {
                setCreatorFilter(creator)
                setGearTypeFilter(null)
                setToneTypeFilter(null)
                setFilterModeOverride(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
              }}
              onClearCreatorFilter={() => setCreatorFilter(null)}
              onGearTypeClick={(gearType) => {
                setGearTypeFilter(gearType)
                setCreatorFilter(null)
                setToneTypeFilter(null)
                setFilterModeOverride(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
              }}
              onToneTypeClick={(toneType) => {
                setToneTypeFilter(toneType)
                setCreatorFilter(null)
                setGearTypeFilter(null)
                setFilterModeOverride(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
              }}
              onCompleteClick={() => {
                setFilterModeOverride('complete')
                setGearTypeFilter(null)
                setToneTypeFilter(null)
                setCreatorFilter(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
                setShowDashboard(false)
              }}
              onIncompleteClick={() => {
                setFilterModeOverride('incomplete')
                setGearTypeFilter(null)
                setToneTypeFilter(null)
                setCreatorFilter(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
                setShowDashboard(false)
              }}
              onRatingClick={(rating) => {
                setRatingFilter(rating)
                setGearTypeFilter(null)
                setToneTypeFilter(null)
                setCreatorFilter(null)
                setFilterModeOverride(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [] }))
                setShowDashboard(false)
              }}
              activeRating={ratingFilter}
              onRecentFileClick={(filePath) => {
                const normalized = filePath.replace(/\\/g, '/')
                const folderPath = normalized.split('/').slice(0, -1).join('/')
                setGearTypeFilter(null)
                setToneTypeFilter(null)
                setCreatorFilter(null)
                setFilterModeOverride(null)
                setEsrFilterOverride(null)
                setPresetFilterOverride(null)
                setLibrarian((prev) => ({ ...prev, selectedFolders: [folderPath] }))
                setSelectedIds(new Set([filePath]))
                setShowDashboard(false)
              }}
            />
          ) : historyOpen ? (
            <SessionHistoryPanel
              entries={sessionHistory}
              onClear={() => setSessionHistory([])}
              onClose={() => setHistoryOpen(false)}
            />
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
            settings.enableExperimentalTraining ? (
              <div className="h-full flex flex-col">
                <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  {(['metadata', 'training'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setSelectedFilePanelTab(tab)}
                      className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                        selectedFilePanelTab === tab
                          ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {tab === 'metadata' ? 'Metadata' : 'Training'}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-hidden">
                  {selectedFilePanelTab === 'training' ? (
                    <TrainingPanel
                      settings={settings}
                      onSaveSettings={handleSaveSettings}
                    />
                  ) : (
                    <MetadataEditor
                      key={selectedFiles[0].filePath}
                      file={selectedFiles[0]}
                      coverImagePath={metadataCoverPath}
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
                      onClearSuggestions={() => handleClearSuggestionsForFile(selectedFiles[0].filePath)}
                    />
                  )}
                </div>
              </div>
            ) : (
              <MetadataEditor
                key={selectedFiles[0].filePath}
                file={selectedFiles[0]}
                coverImagePath={metadataCoverPath}
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
                onClearSuggestions={() => handleClearSuggestionsForFile(selectedFiles[0].filePath)}
              />
            )
          ) : selectedFiles.length > 1 ? (
            <MultiSelectEditor
              files={selectedFiles}
              onApply={handleMultiSelectApply}
              skipConfirmation={settings.skipBatchEditConfirmation}
              gearMakeSuggestions={gearMakeSuggestions}
              gearModelSuggestions={gearModelSuggestions}
            />
          ) : selectedFiles.length === 0 && librarian.rootFolder !== null ? (() => {
            const activeFolderPath = ((librarian.selectedFolders.length === 1 ? librarian.selectedFolders[0] : null) ?? librarian.rootFolder)!
            const activeFolderName = activeFolderPath.split('/').pop() ?? activeFolderPath
            const activeFolderWatchSource = folderWatchSourceByDest[activeFolderPath] ?? null
            const hasBundle = bundleFolders.has(activeFolderPath.replace(/\\/g, '/'))
            if (hasBundle) {
              return (
                <BundleEditor
                  key={activeFolderPath}
                  folderPath={activeFolderPath}
                  rootFolder={librarian.rootFolder!}
                  dark={(() => { try { return localStorage.getItem('nam-pack-dark-export') === '1' } catch { return false } })()}
                  logoLight={settings.packLogoLight}
                  logoDark={settings.packLogoDark}
                  darkAccentColor={settings.packExportDarkAccent}
                  defaultCapturedBy={settings.defaultModeledBy}
                  onSaved={() => refreshBundleFolders()}
                  onDeleted={() => handleDeleteBundle(activeFolderPath)}
                />
              )
            }
            const hasImages = folderImages !== null && (folderImages.own.length > 0 || folderImages.inherited.some((g) => g.paths.length > 0))
            const showGallery = hasImages && settings.showFolderImages
            const hasPack = packInfoFolders.has(activeFolderPath)
            const showCreatePrompt = !hasPack
            const showGalleryTab = showGallery
            const availableTabs = (['overview', 'pack', 'checklist', 'gallery', 'readme', 'targets', 'wav-check'] as const)
              .filter((tab) => (tab !== 'gallery' || showGalleryTab) && (tab !== 'checklist' || hasPack) && (tab !== 'targets' || hasPack))
            return (
              <div className="h-full flex flex-col">
                <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  {availableTabs.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setFolderPanelTab(tab)}
                        className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                          folderPanelTab === tab
                            ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >
                        {tab === 'overview'
                          ? 'Overview'
                          : tab === 'pack'
                            ? 'Pack Info'
                            : tab === 'checklist'
                              ? 'Checklist'
                              : tab === 'gallery'
                                ? 'Gallery'
                                : tab === 'targets'
                                  ? 'Targets'
                                  : tab === 'wav-check'
                                    ? 'WAV Check'
                                    : 'Read Me'}
                      </button>
                    ))}
                </div>
                <div className="flex-1 overflow-hidden">
                  {folderPanelTab === 'overview' ? (
                    <FolderDashboard
                      files={visibleFiles}
                      folderName={activeFolderName}
                      checklistSummary={activeFolderChecklistSummary}
                      hasPackInfo={hasPack}
                      hasReadme={activeFolderReadiness?.hasReadme ?? false}
                      hasCoverImage={activeFolderReadiness?.hasCoverImage ?? false}
                      galleryCount={activeFolderReadiness?.galleryCount ?? 0}
                      deliverySummary={activeFolderDeliverySummary}
                      watchSource={activeFolderWatchSource}
                      activeDuplicate={filterModeOverride === 'duplicates'}
                      activeGear={gearTypeFilter}
                      activeTone={toneTypeFilter}
                      activePreset={presetFilterOverride}
                      activeMissing={filterModeOverride === 'incomplete'}
                      activeEsr={esrFilterOverride}
                      activeRating={ratingFilter}
                      onRemoveWatch={activeFolderPath && activeFolderWatchSource ? () => handleClearWatchSource(activeFolderPath) : undefined}
                      onSyncWatch={activeFolderWatchSource ? () => { void window.api.folderWatchResync(activeFolderWatchSource) } : undefined}
                      onOpenWatchSource={(path) => { void window.api.revealFile(path) }}
                      onDuplicateClick={(on) => {
                        setFilterModeOverride(on ? 'duplicates' : null)
                        setGearTypeFilter(null)
                        setToneTypeFilter(null)
                        setPresetFilterOverride(null)
                        setEsrFilterOverride(null)
                        setRatingFilter(null)
                        setStatus({ message: on ? 'Showing duplicate captures in the list' : 'Duplicate filter cleared', type: 'info' })
                      }}
                      onGearClick={(gear) => { setGearTypeFilter(gear); setToneTypeFilter(null); setPresetFilterOverride(null); setFilterModeOverride(null); setEsrFilterOverride(null); setRatingFilter(null) }}
                      onToneClick={(tone) => { setToneTypeFilter(tone); setGearTypeFilter(null); setPresetFilterOverride(null); setFilterModeOverride(null); setEsrFilterOverride(null); setRatingFilter(null) }}
                      onPresetClick={(preset) => { setPresetFilterOverride(preset); setGearTypeFilter(null); setToneTypeFilter(null); setFilterModeOverride(null); setEsrFilterOverride(null); setRatingFilter(null) }}
                      onMissingClick={(on) => {
                        setFilterModeOverride(on ? 'incomplete' : null)
                        setGearTypeFilter(null)
                        setToneTypeFilter(null)
                        setPresetFilterOverride(null)
                        setEsrFilterOverride(null)
                        setRatingFilter(null)
                        setStatus({ message: on ? 'Showing captures with missing metadata in the list' : 'Missing metadata filter cleared', type: 'info' })
                      }}
                      onEsrClick={(tier) => { setEsrFilterOverride(tier); setGearTypeFilter(null); setToneTypeFilter(null); setPresetFilterOverride(null); setFilterModeOverride(null); setRatingFilter(null) }}
                      onRatingClick={(rating) => { setRatingFilter(rating); setGearTypeFilter(null); setToneTypeFilter(null); setPresetFilterOverride(null); setFilterModeOverride(null); setEsrFilterOverride(null) }}
                    />
                  ) : folderPanelTab === 'readme' ? (
                    <FolderReadmePanel
                      key={activeFolderPath}
                      folderPath={activeFolderPath}
                      folderName={activeFolderName}
                    />
                  ) : folderPanelTab === 'targets' ? (
                    <PackTargetsEditor
                      key={activeFolderPath}
                      folderPath={activeFolderPath}
                      folderName={activeFolderName}
                      targetChecklistTemplates={settings.targetChecklistTemplates}
                      onPackSaved={handlePackSaved}
                      logoLight={settings.packLogoLight}
                      logoDark={settings.packLogoDark}
                      darkAccentColor={settings.packExportDarkAccent}
                    />
                  ) : folderPanelTab === 'gallery' && showGalleryTab ? (
                    <FolderGallery data={folderImages!} />
                  ) : folderPanelTab === 'wav-check' ? (
                    <WavCoverageTab
                      key={activeFolderPath}
                      folderPath={activeFolderPath}
                      namFiles={visibleFiles}
                      comparisonFolder={settings.folderWavComparisonPaths[activeFolderPath.replace(/\\/g, '/')] ?? null}
                      onSetComparisonFolder={(path) => {
                        const next = { ...settings.folderWavComparisonPaths }
                        const key = activeFolderPath.replace(/\\/g, '/')
                        if (path) next[key] = path
                        else delete next[key]
                        handleSaveSettings({ ...settings, folderWavComparisonPaths: next })
                      }}
                      canTrain={settings.enableExperimentalTraining && !!settings.namPythonPath.trim() && !!settings.namTrainingInputWav.trim()}
                      onTrainWavs={handleTrainWavsFromCoverage}
                    />
                  ) : hasPack ? (
                    <PackInfoEditor
                      key={`${activeFolderPath}:${folderPanelTab}`}
                      folderPath={activeFolderPath}
                      folderName={activeFolderName}
                      captures={visibleFiles}
                      defaultCapturedBy={settings.defaultModeledBy}
                      catalog={settings.packGearCatalog}
                      onCatalogChange={(catalog) => handleSaveSettings({ ...settings, packGearCatalog: catalog })}
                      checklistTemplate={settings.packChecklistTemplate}
                      onChecklistTemplateChange={(items) => handleSaveSettings({ ...settings, packChecklistTemplate: items })}
                      onPackSaved={handlePackSaved}
                      logoLight={settings.packLogoLight}
                      logoDark={settings.packLogoDark}
                      darkAccentColor={settings.packExportDarkAccent}
                      parentPackPath={packInfoAncestor}
                      mode={folderPanelTab === 'checklist' ? 'checklist' : 'info'}
                      currentFolderSuggestRules={
                        settings.metadataSuggestScopedRules.find((set) => set.scopePath.replace(/\\/g, '/') === activeFolderPath.replace(/\\/g, '/'))?.rules ?? []
                      }
                      onCurrentFolderSuggestRulesChange={(rules) => handleSaveScopedSuggestRulesAndStayOpen(activeFolderPath, rules)}
                      onOpenCurrentFolderSuggestRulesEditor={() => handleOpenSuggestRulesEditor(activeFolderPath)}
                      allFolderPaths={(() => {
                        const paths: string[] = []
                        const walk = (node: typeof librarian.folderTree) => {
                          if (!node) return
                          paths.push(node.path)
                          node.children.forEach(walk)
                        }
                        walk(librarian.folderTree)
                        return paths
                      })()}
                    />
                  ) : showCreatePrompt ? (
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
                          const checklistItems = settings.packChecklistTemplate.map((item, index) => ({
                            id: `check-${Date.now()}-${index}`,
                            label: item.label,
                            completed: false,
                            completedDate: '',
                            notes: '',
                          }))
                          let initial: Record<string, unknown> = {
                            checklistItems,
                            checklistNotes: '',
                            targetDate: '',
                            liveDate: '',
                            versionInfo: '',
                          }
                          if (packInfoAncestor) {
                            const parentRes = await window.api.readPackInfo(packInfoAncestor)
                            if (parentRes.success && parentRes.data) {
                              const p = parentRes.data as Record<string, unknown>
                              initial = {
                                ...initial,
                                title: p.title ?? '',
                                subtitle: p.subtitle ?? '',
                                description: p.description ?? '',
                                equipment: p.equipment ?? [],
                                pedals: p.pedals ?? [],
                                glossary: p.glossary ?? [],
                                footer: p.footer ?? '',
                                recommendedInputGain: p.recommendedInputGain ?? '',
                              }
                            }
                          }
                          const res = await window.api.writePackInfo(activeFolderPath, initial)
                          if (res.success) handlePackSaved(activeFolderPath, true)
                        }}
                        className="px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors"
                      >
                        Create Pack Info
                      </button>
                      {packInfoAncestor && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Title, description, equipment, pedals & glossary will be copied from parent pack
                        </p>
                      )}
                    </div>
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

        {/* Slide-in editor overlay Ã¢â‚¬â€ maximized grid mode */}
        {gridMaximized && (selectedFiles.length >= 1 || batchFolder !== null || showSettings) && (
          <div className={`absolute top-0 right-0 bottom-0 w-[460px] z-40 flex flex-col bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-700 shadow-2xl transition-transform duration-200 ${gridSlideOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {showSettings ? 'Settings' : batchFolder !== null ? `Batch Edit - ${batchFolder.name}` : selectedFiles.length > 1 ? `Edit ${selectedFiles.length} captures` : 'Edit Capture'}
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
      </div>{/* end content area wrapper */}

      {helpView && (
        <HelpModal initialTab={helpView} onClose={() => setHelpView(null)} />
      )}

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
            x
          </button>
        </div>
      )}
      <StatusBar message={status.message} type={status.type} logPath={status.logPath} />

      {showDuplicates && (
        <DuplicatesModal
            files={duplicateModalFiles}
            rootFolder={librarian.rootFolder}
            scopeLabel={duplicatesScopeFolder ? `Selected folder and children: ${duplicatesScopeFolder.split('/').slice(-3).join('/')}` : null}
            onClose={() => { setShowDuplicates(false); setDuplicatesScopeFolder(null) }}
            onMoveDuplicates={handleMoveDuplicates}
            onTrashDuplicates={handleTrashDuplicates}
            getDeleteBehavior={(filePaths) => window.api.getDeleteBehavior(filePaths)}
            getContentHashes={(filePaths) => window.api.hashFiles(filePaths)}
            getModelHashes={(filePaths) => window.api.hashFilesWithoutMetadata(filePaths)}
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

      {suggestMetadataModal && (
        <SuggestMetadataModal
          folderName={suggestMetadataModal.folderName}
          matches={suggestMetadataModal.matches}
          onConfirm={handleSuggestMetadataConfirm}
          onClose={() => setSuggestMetadataModal(null)}
        />
      )}

      {showLibraryCleanup && (
          <LibraryCleanupModal
            openMode={libraryCleanupOpenMode}
            sourceRoot={libraryCleanupSourceRoot}
            destinationRoot={libraryCleanupDestinationRoot}
            actionMode={libraryCleanupActionMode}
            layout={libraryCleanupLayout}
            folderEntries={libraryCleanupFolderEntries}
            previewRows={libraryCleanupPreviewRows}
            busyLabel={libraryCleanupBusyLabel}
            rememberUncheckedGlobally={libraryCleanupRememberUnchecked}
            savedIgnoreCount={getLibraryCleanupSavedIgnores().length}
            onClose={() => {
              setShowLibraryCleanup(false)
              setLibraryCleanupBusyLabel(null)
          }}
          onPickSourceRoot={handlePickLibraryCleanupSourceRoot}
          onPickDestinationRoot={handlePickLibraryCleanupDestinationRoot}
          onActionModeChange={(mode) => {
            setLibraryCleanupActionMode(mode)
            setLibraryCleanupPreviewRows(null)
          }}
          onLayoutChange={(nextLayout) => {
            setLibraryCleanupLayout(nextLayout)
            setLibraryCleanupPreviewRows(null)
          }}
          onToggleFolder={(path, checked) => {
            setLibraryCleanupFolderEntries((prev) => prev.map((entry) => entry.path === path ? { ...entry, checked } : entry))
            setLibraryCleanupPreviewRows(null)
          }}
          onRememberUncheckedChange={setLibraryCleanupRememberUnchecked}
          onPreview={handlePreviewLibraryCleanup}
            onRun={handleRunLibraryCleanup}
            onExportNeedsReview={handleExportLibraryCleanupNeedsReview}
            onResetSavedIgnores={() => {
              handleSaveSettings({ ...settings, libraryCleanupIgnoredPaths: [] })
              setLibraryCleanupFolderEntries((prev) => prev.map((entry) => ({ ...entry, savedIgnore: false, checked: true })))
              setLibraryCleanupPreviewRows(null)
            }}
        />
      )}

      {suggestRulesEditorPath && (
        <FolderSuggestRulesModal
          folderPath={suggestRulesEditorPath}
          initialExample={suggestRulesEditorExample}
          globalRules={settings.metadataSuggestRules}
          scopedRuleSets={settings.metadataSuggestScopedRules}
          ruleLibrary={settings.metadataSuggestRuleLibrary}
          initialRules={
            settings.metadataSuggestScopedRules.find((set) => set.scopePath.replace(/\\/g, '/') === suggestRulesEditorPath)?.rules ?? []
          }
          onSaveRuleLibrary={(rules) => handleSaveSettings({ ...settings, metadataSuggestRuleLibrary: rules })}
          onSave={(rules) => handleSaveScopedSuggestRules(suggestRulesEditorPath, rules)}
          onSaveAndStayOpen={(rules) => handleSaveScopedSuggestRulesAndStayOpen(suggestRulesEditorPath, rules)}
          onClose={() => setSuggestRulesEditorPath(null)}
        />
      )}

      {coverageReport && (
        <TrainingCoverageModal
          files={files}
          folderPath={coverageReport.folderPath}
          prefixSuffixes={settings.importPrefixSuffixes || 'DI'}
          onClose={() => setCoverageReport(null)}
        />
      )}

      {compareFolderPaths && (
        <FolderCompareModal
          folderPaths={compareFolderPaths}
          files={files}
          onClose={() => setCompareFolderPaths(null)}
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

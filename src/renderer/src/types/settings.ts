export interface FolderOverride {
  manufacturer?: string
  model?: string
  modeledBy?: string
}

export interface AppSettings {
  // Current Amp Info
  enableAmpInfo: boolean
  defaultManufacturer: string
  defaultModel: string

  // Capture Defaults
  enableCaptureDefaults: boolean
  defaultModeledBy: string
  defaultInputLevel: string
  defaultOutputLevel: string

  // Behavior
  populateNameFromFilename: boolean
  ampSuffix: string          // filename suffix that auto-sets gear type to "amp" (e.g. "DI")
  defaultToCab: boolean      // if true, anything that doesn't match ampSuffix gets set to "cab"
  autoDetectToneType: boolean

  // Confirmations (false = show dialog, true = skip)
  skipSaveAllConfirmation: boolean
  skipBatchEditConfirmation: boolean

  // Startup
  enableDefaultFolder: boolean
  defaultFolder: string
  rememberLastFolder: boolean

  folderOverrides: Record<string, FolderOverride>

  // Appearance
  theme: 'dark' | 'light'
  defaultView: 'list' | 'grid'
  solidPillColors: boolean

  // File rename template
  renameTemplate: string

  // Watch folder
  watchFolder: boolean

  // Hidden folders (comma-separated folder names to exclude from scans)
  hiddenFolders: string

  // Show/edit NAM Lab extended capture detail fields
  showNamLabFields: boolean

  // Show folder image gallery in right panel when a folder is selected
  showFolderImages: boolean

  // Updates
  checkForRCBuilds: boolean

  // NAM Standalone
  namStandalonePath: string

  // Import: comma-separated suffix words that trigger prefix matching (e.g. "DI,DI2")
  importPrefixSuffixes: string

  // Pack Info: global gear catalog reused across packs
  packGearCatalog: { category: 'equipment' | 'pedals' | 'glossary'; label: string; value: string }[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  enableAmpInfo: false,
  defaultManufacturer: '',
  defaultModel: '',

  enableCaptureDefaults: true,
  defaultModeledBy: '',
  defaultInputLevel: '',
  defaultOutputLevel: '',

  populateNameFromFilename: true,
  ampSuffix: '',
  defaultToCab: false,
  autoDetectToneType: true,

  skipSaveAllConfirmation: false,
  skipBatchEditConfirmation: false,

  enableDefaultFolder: false,
  defaultFolder: '',
  rememberLastFolder: true,

  folderOverrides: {},

  theme: 'dark',
  defaultView: 'list',
  solidPillColors: true,

  renameTemplate: '{name}',
  watchFolder: false,
  hiddenFolders: 'lightning_logs,version_0,checkpoints',
  showNamLabFields: true,
  showFolderImages: true,
  checkForRCBuilds: false,
  namStandalonePath: '',
  importPrefixSuffixes: 'DI',
  packGearCatalog: []
}

const STORAGE_KEY = 'nam-editor-settings'

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

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
  ampSuffix: string          // filename suffix that auto-sets gear type to "amp" (default: "DI")
  autoDetectToneType: boolean

  // Startup
  enableDefaultFolder: boolean
  defaultFolder: string
  rememberLastFolder: boolean

  folderOverrides: Record<string, FolderOverride>
}

export const DEFAULT_SETTINGS: AppSettings = {
  enableAmpInfo: true,
  defaultManufacturer: '',
  defaultModel: '',

  enableCaptureDefaults: true,
  defaultModeledBy: '',
  defaultInputLevel: '',
  defaultOutputLevel: '',

  populateNameFromFilename: true,
  ampSuffix: 'DI',
  autoDetectToneType: true,

  enableDefaultFolder: false,
  defaultFolder: '',
  rememberLastFolder: true,

  folderOverrides: {}
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

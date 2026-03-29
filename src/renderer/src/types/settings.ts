export interface FolderOverride {
  manufacturer?: string
  model?: string
  modeledBy?: string
}

export interface AppSettings {
  defaultModeledBy: string
  defaultInputLevel: string
  defaultManufacturer: string
  defaultModel: string
  folderOverrides: Record<string, FolderOverride>  // keyed by normalized folder path
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModeledBy: '',
  defaultInputLevel: '',
  defaultManufacturer: '',
  defaultModel: '',
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

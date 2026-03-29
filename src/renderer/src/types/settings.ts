export interface AppSettings {
  defaultModeledBy: string
  defaultInputLevel: string
  defaultManufacturer: string
  defaultModel: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModeledBy: '',
  defaultInputLevel: '',
  defaultManufacturer: '',
  defaultModel: ''
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

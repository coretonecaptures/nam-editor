import { GEAR_TYPES, TONE_TYPES } from './nam'

export interface FolderOverride {
  manufacturer?: string
  model?: string
  modeledBy?: string
}

export interface PackChecklistTemplateItem {
  id: string
  label: string
}

export type TargetChecklistTemplateKey = 'nam' | 'tonex' | 'proxy' | 'qc'

export interface TargetChecklistTemplates {
  nam: PackChecklistTemplateItem[]
  tonex: PackChecklistTemplateItem[]
  proxy: PackChecklistTemplateItem[]
  qc: PackChecklistTemplateItem[]
}

export interface FolderWatchRule {
  sourceFolder: string
  destFolder: string
  enabled: boolean
}

export interface FolderWatchImportEntry {
  sourcePath: string
  sizeBytes: number
  mtimeMs: number
  importedAt: string
}

export const METADATA_SUGGEST_FIELD_OPTIONS = [
  { value: 'modeled_by', label: 'Modeled By' },
  { value: 'gear_type', label: 'Gear Type' },
  { value: 'gear_make', label: 'Manufacturer' },
  { value: 'gear_model', label: 'Model' },
  { value: 'tone_type', label: 'Tone Type' },
  { value: 'input_level_dbu', label: 'Input (dBu)' },
  { value: 'output_level_dbu', label: 'Output (dBu)' },
  { value: 'nb_trained_epochs', label: 'Trained Epochs' },
  { value: 'nl_mics', label: 'Microphone(s)' },
  { value: 'nl_cabinet', label: 'Cabinet' },
  { value: 'nl_cabinet_config', label: 'Cabinet Config' },
  { value: 'nl_amp_channel', label: 'Amp Channel' },
  { value: 'nl_amp_settings', label: 'Amp Settings' },
  { value: 'nl_boost_pedal', label: 'Boost Pedal(s)' },
  { value: 'nl_pedal_settings', label: 'Pedal Settings' },
  { value: 'nl_amp_switches', label: 'Amp Switches' },
  { value: 'nl_comments', label: 'Comments' },
] as const

export type MetadataSuggestField = typeof METADATA_SUGGEST_FIELD_OPTIONS[number]['value']
export type MetadataSuggestMatchIn = 'filename' | 'folder' | 'either'
export type MetadataSuggestMatchType = 'exact' | 'contains' | 'starts_with' | 'ends_with' | 'prefix_value'

export const METADATA_SUGGEST_LOOKUP_VALUES: Partial<Record<MetadataSuggestField, readonly string[]>> = {
  gear_type: GEAR_TYPES,
  tone_type: TONE_TYPES,
}

export interface MetadataSuggestRule {
  id: string
  token: string
  segmentIndex: number | null
  field: MetadataSuggestField
  value: string
  matchIn: MetadataSuggestMatchIn
  matchType: MetadataSuggestMatchType
  enabled: boolean
  overwriteExisting: boolean
  overwriteOnlyValues: string
}

export interface MetadataSuggestScopedRuleSet {
  scopePath: string
  rules: MetadataSuggestRule[]
}

export const DEFAULT_PACK_CHECKLIST_TEMPLATE: PackChecklistTemplateItem[] = [
  { id: 'all-captures-completed', label: 'All captures completed' },
  { id: 'test-all-captures-in-nam-player', label: 'Test all captures in NAM Player; remove weak/duplicate profiles' },
  { id: 'training-completed', label: 'Training completed (REVxSTD + required formats)' },
  { id: 'hyperaccurate-completed', label: 'HyperAccurate completed or marked N/A' },
  { id: 'import-into-nam-lab', label: 'Import into NAM Lab and update metadata (Excel + details)' },
  { id: 'review-esr-ratings', label: 'Review ESR ratings; retrain/recapture if needed' },
  { id: 'decide-release-format', label: 'Decide release format (Bundle vs DI / CAB / Bundle)' },
  { id: 'pack-info-sheets-completed', label: 'Pack info sheet(s) completed (incl. glossary + write-ups)' },
  { id: 'images-finalized', label: 'Images finalized' },
  { id: 'confirm-no-duplicates', label: 'Confirm no duplicates in pack' },
  { id: 'verify-final-folder-structure', label: 'Verify final folder structure' },
  { id: 'export-final-assets', label: 'Export final assets (captures, README, pack info, images)' },
  { id: 'shopify-product-page-completed', label: 'Shopify product page completed (description + pricing)' },
  { id: 'upload-to-shopify', label: 'Upload to Shopify and publish (attachments included)' },
  { id: 'email-campaign-sent', label: 'Email campaign sent (Shopify)' },
  { id: 'blog-post-published', label: 'Blog post published' },
  { id: 'forum-facebook-post-live', label: 'Forum / Facebook group post live' },
  { id: 'social-media-posts', label: 'Social media posts (Facebook, Instagram)' },
  { id: 'upload-samples-to-tone3000', label: 'Upload samples to Tone3000 (with metadata)' },
  { id: 'pack-released', label: 'Pack released' },
]

export function cloneChecklistTemplate(items: PackChecklistTemplateItem[]): PackChecklistTemplateItem[] {
  return items.map((item) => ({ ...item }))
}

export function cloneTargetChecklistTemplates(templates: TargetChecklistTemplates): TargetChecklistTemplates {
  return {
    nam: cloneChecklistTemplate(templates.nam),
    tonex: cloneChecklistTemplate(templates.tonex),
    proxy: cloneChecklistTemplate(templates.proxy),
    qc: cloneChecklistTemplate(templates.qc),
  }
}

export const DEFAULT_TARGET_CHECKLIST_TEMPLATES: TargetChecklistTemplates = {
  nam: cloneChecklistTemplate(DEFAULT_PACK_CHECKLIST_TEMPLATE),
  tonex: [],
  proxy: [],
  qc: [
    { id: 'qc-all-captures-completed', label: 'All captures completed' },
    { id: 'qc-import-captures-from-spreadsheet', label: 'Import Captures from Spreadsheet to QC Target' },
    { id: 'qc-decide-release-format', label: 'Decide release format (Bundle vs DI / CAB / Bundle)' },
    { id: 'qc-pack-info-sheets-completed', label: 'Pack info sheet(s) completed (incl. glossary + write-ups)' },
    { id: 'qc-include-irs', label: 'Include IR\'s? If so choose which to include' },
    { id: 'qc-build-presets-di', label: 'Build Presets containing any/all include DI captures' },
    { id: 'qc-build-presets-full-rig', label: 'Build Presets for Full Rig (Amp/Cab) presets' },
    { id: 'qc-build-starter-presets', label: 'Build a few "Starter Presets" with FX that showcase the tones' },
    { id: 'qc-confirm-no-duplicates', label: 'Confirm no duplicates in release' },
    { id: 'qc-upload-presets-to-cortex-cloud', label: 'Upload Presets to Cortex Cloud' },
    { id: 'qc-export-final-assets', label: 'Export final assets (captures, README, pack info, images)' },
    { id: 'qc-shopify-product-page-completed', label: 'Shopify product page completed (description + pricing)' },
    { id: 'qc-upload-to-shopify', label: 'Upload to Shopify and publish (attachments included)' },
    { id: 'qc-email-campaign-sent', label: 'Email campaign sent (Shopify)' },
    { id: 'qc-blog-post-published', label: 'Blog post published' },
    { id: 'qc-forum-facebook-post-live', label: 'Forum / Facebook group post live' },
    { id: 'qc-social-media-posts', label: 'Social media posts (Facebook, Instagram)' },
    { id: 'qc-pack-released', label: 'Pack released' },
  ],
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
  folderWatchRules: FolderWatchRule[]
  folderWatchImports: Record<string, FolderWatchImportEntry[]>

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

  // Experimental local NAM training
  enableExperimentalTraining: boolean
  namPythonPath: string
  namTrainingInputWav: string

  // Import: comma-separated suffix words that trigger prefix matching (e.g. "DI,DI2")
  importPrefixSuffixes: string

  // Pack Info: global gear catalog reused across packs
  packGearCatalog: { category: 'equipment' | 'pedals' | 'glossary'; label: string; value: string }[]
  packChecklistTemplate: PackChecklistTemplateItem[]
  targetChecklistTemplates: TargetChecklistTemplates

  // Folder tree colorization: maps folder name → hex color
  folderNameColors: Record<string, string>

  // Pack Info export logos (base64 data URIs, empty = no logo)
  packLogoLight: string
  packLogoDark: string
  packExportDarkAccent: string

  // Default tab shown when a folder is selected in the tree
  defaultFolderTab: 'overview' | 'pack' | 'gallery'

  // Show Library Overview in the right panel on app launch
  showDashboardOnLaunch: boolean

  // Optional Tone3000 username for creator matching / search helpers
  tone3000Username: string

  // Metadata suggestions: token-based rules used by Suggest Metadata preview/apply flow
  metadataSuggestRules: MetadataSuggestRule[]
  metadataSuggestScopedRules: MetadataSuggestScopedRuleSet[]
  metadataSuggestRuleLibrary: MetadataSuggestRule[]

  // Library cleanup: exact source folder paths to always exclude on this computer
  libraryCleanupIgnoredPaths: string[]
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
  folderWatchRules: [],
  folderWatchImports: {},
  hiddenFolders: 'lightning_logs,version_0,checkpoints',
  showNamLabFields: true,
  showFolderImages: true,
  checkForRCBuilds: false,
  namStandalonePath: '',
  enableExperimentalTraining: false,
  namPythonPath: '',
  namTrainingInputWav: '',
  importPrefixSuffixes: 'DI',
  packGearCatalog: [],
  packChecklistTemplate: cloneChecklistTemplate(DEFAULT_PACK_CHECKLIST_TEMPLATE),
  targetChecklistTemplates: cloneTargetChecklistTemplates(DEFAULT_TARGET_CHECKLIST_TEMPLATES),
  folderNameColors: {},
  packLogoLight: '',
  packLogoDark: '',
  packExportDarkAccent: '#f97316',
  defaultFolderTab: 'overview',
  showDashboardOnLaunch: true,
  tone3000Username: '',
  metadataSuggestRules: [],
  metadataSuggestScopedRules: [],
  metadataSuggestRuleLibrary: [],
  libraryCleanupIgnoredPaths: [],
}

const STORAGE_KEY = 'nam-editor-settings'

function normalizeMetadataSuggestRule(rule: Partial<MetadataSuggestRule> | null | undefined, index = 0): MetadataSuggestRule {
  return {
    id: rule?.id || `rule-${Date.now()}-${index}`,
    token: rule?.token ?? '',
    segmentIndex: typeof rule?.segmentIndex === 'number' && Number.isFinite(rule.segmentIndex) && rule.segmentIndex > 0
      ? Math.floor(rule.segmentIndex)
      : null,
    field: (rule?.field ?? 'gear_make') as MetadataSuggestField,
    value: rule?.value ?? '',
    matchIn: (rule?.matchIn ?? 'either') as MetadataSuggestMatchIn,
    matchType: (rule?.matchType ?? 'exact') as MetadataSuggestMatchType,
    enabled: rule?.enabled ?? true,
    overwriteExisting: rule?.overwriteExisting ?? false,
    overwriteOnlyValues: rule?.overwriteOnlyValues ?? '',
  }
}

function normalizeSettingsMetadataRules(settings: AppSettings): AppSettings {
  const rawTargetTemplates = settings.targetChecklistTemplates
  const looksLikeLegacyBlankTargetTemplates =
    Boolean(rawTargetTemplates) &&
    (rawTargetTemplates?.tonex?.length ?? 0) === 0 &&
    (rawTargetTemplates?.proxy?.length ?? 0) === 0 &&
    (rawTargetTemplates?.qc?.length ?? 0) === 0 &&
    JSON.stringify(rawTargetTemplates?.nam ?? []) === JSON.stringify(settings.packChecklistTemplate ?? DEFAULT_PACK_CHECKLIST_TEMPLATE)
  const normalizedTargetChecklistTemplates: TargetChecklistTemplates = {
    nam: cloneChecklistTemplate(rawTargetTemplates?.nam ?? settings.packChecklistTemplate ?? DEFAULT_PACK_CHECKLIST_TEMPLATE),
    tonex: cloneChecklistTemplate(rawTargetTemplates?.tonex ?? []),
    proxy: cloneChecklistTemplate(rawTargetTemplates?.proxy ?? []),
    qc: cloneChecklistTemplate(
      rawTargetTemplates?.qc && !looksLikeLegacyBlankTargetTemplates
        ? rawTargetTemplates.qc
        : DEFAULT_TARGET_CHECKLIST_TEMPLATES.qc
    ),
  }
  return {
    ...settings,
    targetChecklistTemplates: normalizedTargetChecklistTemplates,
    metadataSuggestRules: (settings.metadataSuggestRules ?? []).map((rule, index) => normalizeMetadataSuggestRule(rule, index)),
    metadataSuggestScopedRules: (settings.metadataSuggestScopedRules ?? []).map((set, setIndex) => ({
      scopePath: set.scopePath,
      rules: (set.rules ?? []).map((rule, ruleIndex) => normalizeMetadataSuggestRule(rule, setIndex * 1000 + ruleIndex)),
    })),
    metadataSuggestRuleLibrary: (settings.metadataSuggestRuleLibrary ?? []).map((rule, index) => normalizeMetadataSuggestRule(rule, index)),
  }
}

export function loadSettings(): AppSettings {
  try {
    // Primary: settings.json in userData (survives app updates/reinstalls)
    const api = (window as Window & { api?: { initialSettings?: unknown; saveSettingsToFile?: (json: string) => void } }).api
    if (api?.initialSettings) {
      const merged = { ...DEFAULT_SETTINGS, ...(api.initialSettings as Partial<AppSettings>) }
      const legacyIgnoredByDestination = (api.initialSettings as Partial<AppSettings>)?.libraryCleanupIgnoredPathsByDestination
      if ((!merged.libraryCleanupIgnoredPaths || merged.libraryCleanupIgnoredPaths.length === 0) && legacyIgnoredByDestination) {
        merged.libraryCleanupIgnoredPaths = Array.from(new Set(Object.values(legacyIgnoredByDestination).flat()))
      }
      return normalizeSettingsMetadataRules(merged)
    }
    // Migration: first launch after this change — read from localStorage and persist to file
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const raw = JSON.parse(stored) as Partial<AppSettings> & { libraryCleanupIgnoredPathsByDestination?: Record<string, string[]> }
      const parsed = { ...DEFAULT_SETTINGS, ...raw }
      if ((!parsed.libraryCleanupIgnoredPaths || parsed.libraryCleanupIgnoredPaths.length === 0) && raw.libraryCleanupIgnoredPathsByDestination) {
        parsed.libraryCleanupIgnoredPaths = Array.from(new Set(Object.values(raw.libraryCleanupIgnoredPathsByDestination).flat()))
      }
      api?.saveSettingsToFile?.(JSON.stringify(parsed))
      return normalizeSettingsMetadataRules(parsed)
    }
    return normalizeSettingsMetadataRules(DEFAULT_SETTINGS)
  } catch {
    return normalizeSettingsMetadataRules(DEFAULT_SETTINGS)
  }
}

export function saveSettings(settings: AppSettings): void {
  const json = JSON.stringify(settings)
  localStorage.setItem(STORAGE_KEY, json)
  try {
    const api = (window as Window & { api?: { saveSettingsToFile?: (json: string) => void } }).api
    api?.saveSettingsToFile?.(json)
  } catch { /* renderer-only context (tests/storybook) */ }
}

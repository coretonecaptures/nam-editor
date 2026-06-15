import { GEAR_TYPES, TONE_TYPES } from './nam'
import type { WaveNetConfig } from './trainer'

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
  contentHash?: string
}

export interface UserCaptureProfile {
  id: string
  name: string
  description: string
  waveNetConfig: WaveNetConfig
  lr: number
  lrDecay: number
  defaultEpochs: number
  batchSize: number
  ny: number
  fitMrstft: boolean
}

export const TRAINING_SOURCE_MODES = ['watcher', 'manual-folder-run'] as const
export type TrainingSourceMode = typeof TRAINING_SOURCE_MODES[number]

export const TRAINING_SOURCE_POST_PROCESS_OPTIONS = ['move', 'copy', 'keep'] as const
export type TrainingSourcePostProcessMode = typeof TRAINING_SOURCE_POST_PROCESS_OPTIONS[number]

export const TRAINING_LATENCY_MODES = ['auto', 'manual'] as const
export type TrainingLatencyMode = typeof TRAINING_LATENCY_MODES[number]

export const TRAINING_WATCH_INITIAL_SCAN_MODES = ['process-existing', 'new-only'] as const
export type TrainingWatchInitialScanMode = typeof TRAINING_WATCH_INITIAL_SCAN_MODES[number]

export interface TrainingProfile {
  id: string
  name: string
  sourceMode: TrainingSourceMode
  enabled: boolean
  autoRun: boolean
  initialScanMode?: TrainingWatchInitialScanMode
  namingTemplate: string
  architectures: string[]
  epochs: number
  thresholdEsr: number | null
  latencyMode: TrainingLatencyMode
  latencyValue: number | null
  savePlot: boolean
  ignoreChecks: boolean
  sourcePostProcess: TrainingSourcePostProcessMode
  watchFolder: string
  processedWavRoot: string
  graphRoot: string
  effectiveOutputFormula?: string
  effectiveGraphFormula?: string
  finalModelRoot: string
}

export interface TrainingPreset {
  id: string
  name: string
  namMode?: 'a1' | 'a2'
  architectures: string[]
  epochs: number
  thresholdEsr: number | null
  latencyMode: TrainingLatencyMode
  latencyValue: number | null
  savePlot: boolean
  ignoreChecks: boolean
  normalizeWav?: 'global' | 'on' | 'off'
  normalizeWavTargetDb?: number | null
  outputFormulaOverride?: string
  graphOutputFormulaOverride?: string
  namingTemplate: string
}

export interface TrainingWatchProfile {
  id: string
  name: string
  enabled: boolean
  autoRun: boolean
  initialScanMode: TrainingWatchInitialScanMode
  watchFolder: string
  presetId: string  // preset ID, or 'bundle:<bundleId>' for a training bundle
  sourcePostProcess: TrainingSourcePostProcessMode
  processedWavRoot: string
  graphRoot: string
  graphOutputFormula: string
  finalModelRoot: string
}

export interface TrainingBundle {
  id: string
  name: string
  presetIds: string[]
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
  // Per-field "fill blank on load" — when false the value is only used for training/manual re-apply
  fillOnLoadModeledBy: boolean
  fillOnLoadInputLevel: boolean
  fillOnLoadOutputLevel: boolean

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
  theme: 'dark' | 'light' | 'charcoal'
  uiTheme: 'dark' | 'midnight' | 'blue' | 'charcoal' | 'light'
  uiAccent: 'indigo' | 'violet' | 'sky' | 'emerald' | 'orange'
  chipStyle: 'soft' | 'solid' | 'minimal'
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
  normalizeWavBeforeTraining: boolean
  normalizeWavTargetDb: number
  trainingOutputFormula: string
  trainingGraphFormula: string
  trainingPresets: TrainingPreset[]
  trainingWatchProfiles: TrainingWatchProfile[]
  trainingRetainGraphs: boolean
  // Training Dashboard (Simple mode) favorites
  trainingFavoritePresetId: string
  trainingFavoriteRouting: string
  trainingDefaultInputDi: string
  // Last-used preset in Create Batch — persisted across restarts; falls back to trainingFavoritePresetId
  trainingLastSelectedPresetId?: string
  // Training bundles: named groups of presets submitted together as one batch
  trainingBundles: TrainingBundle[]

  // Queue auto-start on launch
  trainingAutoStartQueueOnLaunch: boolean
  trainingAutoStartSkipIfPaused: boolean

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

  // Mobile companion app bridge
  enableCompanionApp: boolean

  // Optional Tone3000 username for creator matching / search helpers
  tone3000Username: string

  // Metadata suggestions: token-based rules used by Suggest Metadata preview/apply flow
  metadataSuggestRules: MetadataSuggestRule[]
  metadataSuggestScopedRules: MetadataSuggestScopedRuleSet[]
  metadataSuggestRuleLibrary: MetadataSuggestRule[]

  // Library cleanup: exact source folder paths to always exclude on this computer
  libraryCleanupIgnoredPaths: string[]

  // WAV coverage check: per-folder comparison WAV folder paths
  folderWavComparisonPaths: Record<string, string>

  // User-defined capture profiles (custom WaveNet architectures)
  userCaptureProfiles: UserCaptureProfile[]

  // AI enrichment (keys stored in main via safeStorage — never in settings JSON)
  hasAnthropicKey: boolean
  hasOpenAiKey: boolean
  aiProvider: 'anthropic' | 'openai'
  aiAnthropicModel: string
  aiOpenAiModel: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  enableAmpInfo: false,
  defaultManufacturer: '',
  defaultModel: '',

  enableCaptureDefaults: false,
  defaultModeledBy: '',
  defaultInputLevel: '',
  defaultOutputLevel: '',
  fillOnLoadModeledBy: false,
  fillOnLoadInputLevel: false,
  fillOnLoadOutputLevel: false,

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
  uiTheme: 'dark',
  uiAccent: 'indigo',
  chipStyle: 'solid',
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
  normalizeWavBeforeTraining: false,
  normalizeWavTargetDb: -5.0,
  trainingOutputFormula: '',
  trainingGraphFormula: '',
  trainingPresets: [],
  trainingWatchProfiles: [],
  trainingRetainGraphs: true,
  trainingFavoritePresetId: '',
  trainingFavoriteRouting: '',
  trainingDefaultInputDi: '',
  trainingAutoStartQueueOnLaunch: false,
  trainingAutoStartSkipIfPaused: false,
  trainingBundles: [],
  importPrefixSuffixes: 'DI',
  packGearCatalog: [],
  packChecklistTemplate: cloneChecklistTemplate(DEFAULT_PACK_CHECKLIST_TEMPLATE),
  targetChecklistTemplates: cloneTargetChecklistTemplates(DEFAULT_TARGET_CHECKLIST_TEMPLATES),
  folderNameColors: {},
  packLogoLight: '',
  packLogoDark: '',
  packExportDarkAccent: '#f9b966',
  defaultFolderTab: 'overview',
  showDashboardOnLaunch: true,
  enableCompanionApp: false,
  tone3000Username: '',
  metadataSuggestRules: [],
  metadataSuggestScopedRules: [],
  metadataSuggestRuleLibrary: [],
  libraryCleanupIgnoredPaths: [],
  folderWavComparisonPaths: {},
  userCaptureProfiles: [],
  hasAnthropicKey: false,
  hasOpenAiKey: false,
  aiProvider: 'anthropic',
  aiAnthropicModel: 'claude-haiku-4-5-20251001',
  aiOpenAiModel: 'gpt-4o-mini',
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

function normalizeTrainingProfile(
  profile: Partial<TrainingProfile> | null | undefined,
  index = 0
): TrainingProfile {
  const sourceMode = profile?.sourceMode === 'manual-folder-run' ? 'manual-folder-run' : 'watcher'
  const rawArchitectures = Array.isArray(profile?.architectures)
    ? profile?.architectures.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  return {
    id: profile?.id || `training-profile-${Date.now()}-${index}`,
    name: profile?.name?.trim() || `Training Profile ${index + 1}`,
    sourceMode,
    enabled: profile?.enabled ?? true,
    autoRun: sourceMode === 'watcher' ? (profile?.autoRun ?? true) : false,
    namingTemplate: profile?.namingTemplate?.trim() || '{basename}',
    architectures: rawArchitectures,
    epochs: Number.isFinite(profile?.epochs) && (profile?.epochs ?? 0) > 0 ? Math.floor(profile!.epochs as number) : 1000,
    thresholdEsr: typeof profile?.thresholdEsr === 'number' && Number.isFinite(profile.thresholdEsr) && profile.thresholdEsr > 0
      ? profile.thresholdEsr
      : null,
    latencyMode: profile?.latencyMode === 'manual' ? 'manual' : 'auto',
    latencyValue: typeof profile?.latencyValue === 'number' && Number.isFinite(profile.latencyValue) && profile.latencyValue >= 0
      ? Math.floor(profile.latencyValue)
      : null,
    savePlot: profile?.savePlot ?? true,
    ignoreChecks: profile?.ignoreChecks ?? false,
    sourcePostProcess: profile?.sourcePostProcess === 'copy' || profile?.sourcePostProcess === 'keep' ? profile.sourcePostProcess : 'move',
    watchFolder: profile?.watchFolder?.trim() || '',
    processedWavRoot: profile?.processedWavRoot?.trim() || '',
    graphRoot: profile?.graphRoot?.trim() || '',
    finalModelRoot: profile?.finalModelRoot?.trim() || '',
  }
}

function normalizeTrainingPreset(
  preset: Partial<TrainingPreset> | null | undefined,
  index = 0
): TrainingPreset {
  const rawArchitectures = Array.isArray(preset?.architectures)
    ? preset?.architectures.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  return {
    id: preset?.id || `training-preset-${Date.now()}-${index}`,
    name: preset?.name?.trim() || `Preset ${index + 1}`,
    namMode: preset?.namMode === 'a2' ? 'a2' : 'a1',
    architectures: rawArchitectures,
    epochs: Number.isFinite(preset?.epochs) && (preset?.epochs ?? 0) > 0 ? Math.floor(preset!.epochs as number) : 1000,
    thresholdEsr: typeof preset?.thresholdEsr === 'number' && Number.isFinite(preset.thresholdEsr) && preset.thresholdEsr > 0
      ? preset.thresholdEsr
      : null,
    latencyMode: preset?.latencyMode === 'manual' ? 'manual' : 'auto',
    latencyValue: typeof preset?.latencyValue === 'number' && Number.isFinite(preset.latencyValue) && preset.latencyValue >= 0
      ? Math.floor(preset.latencyValue)
      : null,
    savePlot: preset?.savePlot ?? true,
    ignoreChecks: preset?.ignoreChecks ?? false,
    normalizeWav: preset?.normalizeWav === 'on' ? 'on' : preset?.normalizeWav === 'global' ? 'global' : 'off',
    normalizeWavTargetDb: typeof preset?.normalizeWavTargetDb === 'number' && Number.isFinite(preset.normalizeWavTargetDb)
      ? preset.normalizeWavTargetDb
      : null,
    graphOutputFormulaOverride: preset?.graphOutputFormulaOverride?.trim() || undefined,
    namingTemplate: (preset as Partial<TrainingPreset> & { namingTemplate?: string })?.namingTemplate?.trim() || '{basename}',
  }
}

function normalizeTrainingWatchProfile(
  profile: Partial<TrainingWatchProfile> | null | undefined,
  legacyPreset: Partial<TrainingPreset> | Partial<TrainingProfile> | null | undefined = null,
  index = 0
): TrainingWatchProfile {
  return {
    id: profile?.id || `training-watch-${Date.now()}-${index}`,
    name: profile?.name?.trim() || `Watcher ${index + 1}`,
    enabled: profile?.enabled ?? true,
    autoRun: profile?.autoRun ?? true,
    initialScanMode: profile?.initialScanMode === 'new-only' ? 'new-only' : 'process-existing',
    watchFolder: profile?.watchFolder?.trim() || '',
    presetId: profile?.presetId?.trim() || '',
    sourcePostProcess: 'keep',
    processedWavRoot: profile?.processedWavRoot?.trim() || legacyPreset?.processedWavRoot?.trim() || '',
    graphRoot: profile?.graphRoot?.trim() || legacyPreset?.graphRoot?.trim() || '',
    graphOutputFormula: profile?.graphOutputFormula?.trim() ?? '',
    finalModelRoot: profile?.finalModelRoot?.trim() || legacyPreset?.finalModelRoot?.trim() || '',
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
  const legacyProfiles = (settings as Partial<AppSettings> & { trainingProfiles?: Partial<TrainingProfile>[] }).trainingProfiles ?? []
  const hasExplicitTrainingPresets = Array.isArray(settings.trainingPresets)
  const hasExplicitTrainingWatchProfiles = Array.isArray(settings.trainingWatchProfiles)
  const migratedPresets = legacyProfiles.map((profile, index) => normalizeTrainingPreset(profile, index))
  const migratedWatchProfiles = legacyProfiles
    .filter((profile) => profile?.sourceMode === 'watcher')
    .map((profile, index) => normalizeTrainingWatchProfile({
      id: profile?.id,
      name: profile?.name,
      enabled: profile?.enabled,
      autoRun: profile?.autoRun,
      watchFolder: profile?.watchFolder,
      presetId: profile?.id,
    }, profile, index))
  const presetLookup = new Map((hasExplicitTrainingPresets ? settings.trainingPresets : migratedPresets).map((preset) => [preset.id, preset]))
  return {
    ...settings,
    targetChecklistTemplates: normalizedTargetChecklistTemplates,
    trainingPresets: (hasExplicitTrainingPresets ? settings.trainingPresets : migratedPresets).map((preset, index) => normalizeTrainingPreset(preset, index)),
    trainingWatchProfiles: (hasExplicitTrainingWatchProfiles ? settings.trainingWatchProfiles : migratedWatchProfiles).map((profile, index) => normalizeTrainingWatchProfile(profile, presetLookup.get(profile?.presetId?.trim?.() || '') ?? null, index)),
    metadataSuggestRules: (settings.metadataSuggestRules ?? []).map((rule, index) => normalizeMetadataSuggestRule(rule, index)),
    metadataSuggestScopedRules: (settings.metadataSuggestScopedRules ?? []).map((set, setIndex) => ({
      scopePath: set.scopePath,
      rules: (set.rules ?? []).map((rule, ruleIndex) => normalizeMetadataSuggestRule(rule, setIndex * 1000 + ruleIndex)),
    })),
    metadataSuggestRuleLibrary: (settings.metadataSuggestRuleLibrary ?? []).map((rule, index) => normalizeMetadataSuggestRule(rule, index)),
    userCaptureProfiles: (settings.userCaptureProfiles ?? []).filter(
      (p): p is UserCaptureProfile => Boolean(p?.id && p?.name && p?.waveNetConfig?.layers_configs)
    ),
    trainingBundles: (settings.trainingBundles ?? []).filter(
      (b): b is TrainingBundle => Boolean(b?.id && b?.name && Array.isArray(b?.presetIds))
    ),
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

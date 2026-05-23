import { useEffect, useRef, useState } from 'react'
import {
  AppSettings,
  DEFAULT_TARGET_CHECKLIST_TEMPLATES,
  DEFAULT_PACK_CHECKLIST_TEMPLATE,
  METADATA_SUGGEST_FIELD_OPTIONS,
  METADATA_SUGGEST_LOOKUP_VALUES,
  MetadataSuggestRule,
  MetadataSuggestMatchIn,
  MetadataSuggestMatchType,
  TrainingPreset,
  TrainingWatchProfile,
  TargetChecklistTemplateKey,
  cloneChecklistTemplate,
  cloneTargetChecklistTemplates,
} from '../types/settings'
import { MetadataSuggestRuleLibraryModal } from './MetadataSuggestRuleLibraryModal'
import { OutputFormulaField } from './OutputFormulaField'
import { resolveOutputFormula, effectiveFormula } from '../utils/resolveOutputFormula'
import { FilenameRecipeBuilderModal } from './FilenameRecipeBuilderModal'
import { TRAINER_ARCHITECTURES, BUILT_IN_CAPTURE_PROFILES } from '../types/trainer'
import type { CaptureProfile, TrainerProfilesStateSnapshot } from '../types/trainer'
import type { UserCaptureProfile } from '../types/settings'
import {
  cloneMetadataSuggestRule,
  isMetadataSuggestRuleLibraryCandidate,
  isMetadataSuggestRuleComplete,
  metadataSuggestRuleSignature,
} from '../utils/metadataSuggestRuleLibrary'
import { ArchitectureProfilePicker } from './ArchitectureProfilePicker'
import { CaptureProfileEditor } from './CaptureProfileEditor'
import { WatcherFilesModal } from './WatcherFilesModal'

const PACK_DARK_ACCENT_PRESETS = [
  '#f9b966',
  '#f97316',
  '#f59e0b',
  '#2dd4bf',
  '#60a5fa',
  '#f87171',
  '#4ade80',
  '#a78bfa',
]

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  | { status: 'available'; version: string; url: string }
  | { status: 'error'; message: string }

const METADATA_SUGGEST_MATCH_TYPE_OPTIONS: Array<{ value: MetadataSuggestMatchType; label: string }> = [
  { value: 'exact', label: 'Exact token' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'prefix_value', label: 'Prefix + value' },
]

interface SettingsPanelProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onSave, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings })
  const [settingsTab, setSettingsTab] = useState<'global' | 'defaults' | 'metadata' | 'pack' | 'training'>('global')
  const [maximized, setMaximized] = useState(false)
  const [saved, setSaved] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [checklistTemplateOpen, setChecklistTemplateOpen] = useState(false)
  const [activeChecklistTemplate, setActiveChecklistTemplate] = useState<TargetChecklistTemplateKey>('nam')
  const [packCatalogOpen, setPackCatalogOpen] = useState(false)
  const [metadataSuggestOpen, setMetadataSuggestOpen] = useState(false)
  const [showRuleLibraryPicker, setShowRuleLibraryPicker] = useState(false)
  const [showRecipeBuilder, setShowRecipeBuilder] = useState(false)
  const [folderWatchesOpen, setFolderWatchesOpen] = useState(false)
  const [trainingWatchersOpen, setTrainingWatchersOpen] = useState(false)
  const [trainingPresetsOpen, setTrainingPresetsOpen] = useState(false)
  const [trainingProfilesState, setTrainingProfilesState] = useState<TrainerProfilesStateSnapshot>({ watchers: [], graphRetentionEnabled: draft.trainingRetainGraphs })
  const [captureProfilesOpen, setCaptureProfilesOpen] = useState(false)
  const [captureProfileEditorOpen, setCaptureProfileEditorOpen] = useState(false)
  const [captureProfileEditorTarget, setCaptureProfileEditorTarget] = useState<UserCaptureProfile | null>(null)
  const [newItemId, setNewItemId] = useState<string | null>(null)
  const newItemRef = useRef<HTMLDivElement | null>(null)
  const [watcherFilesModal, setWatcherFilesModal] = useState<{ profileId: string; profileName: string; watchFolder: string; architectures: string[] } | null>(null)

  useEffect(() => {
    if (!newItemId || !newItemRef.current) return
    newItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setNewItemId(null)
  }, [newItemId])

  const handleCheckForUpdates = async () => {
    setUpdateState({ status: 'checking' })
    const result = await window.api.checkForUpdates(draft.checkForRCBuilds)
    if (result.error) {
      setUpdateState({ status: 'error', message: result.error })
    } else if (result.hasUpdate && result.latestVersion && result.releaseUrl) {
      setUpdateState({ status: 'available', version: result.latestVersion, url: result.releaseUrl })
    } else {
      const currentVersion = import.meta.env.VITE_APP_VERSION as string ?? ''
      setUpdateState({ status: 'up-to-date', version: currentVersion })
    }
  }

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const checklistTemplateLabels: Record<TargetChecklistTemplateKey, string> = {
    nam: 'NAM / Base',
    tonex: 'ToneX',
    proxy: 'Proxy',
    qc: 'QC',
  }

  const activeChecklistTemplateItems =
    activeChecklistTemplate === 'nam'
      ? draft.packChecklistTemplate
      : draft.targetChecklistTemplates[activeChecklistTemplate]

  const updateChecklistTemplateItems = (key: TargetChecklistTemplateKey, items: AppSettings['packChecklistTemplate']) => {
    if (key === 'nam') {
      update('packChecklistTemplate', items)
      return
    }
    update('targetChecklistTemplates', {
      ...draft.targetChecklistTemplates,
      [key]: items,
    })
  }

  const resetChecklistTemplateToDefaults = (key: TargetChecklistTemplateKey) => {
    if (key === 'nam') {
      update('packChecklistTemplate', cloneChecklistTemplate(DEFAULT_PACK_CHECKLIST_TEMPLATE))
      return
    }
    update('targetChecklistTemplates', {
      ...draft.targetChecklistTemplates,
      [key]: cloneChecklistTemplate(DEFAULT_TARGET_CHECKLIST_TEMPLATES[key]),
    })
  }

  const resetAllChecklistTemplatesToDefaults = () => {
    update('packChecklistTemplate', cloneChecklistTemplate(DEFAULT_PACK_CHECKLIST_TEMPLATE))
    update('targetChecklistTemplates', cloneTargetChecklistTemplates(DEFAULT_TARGET_CHECKLIST_TEMPLATES))
  }

  // Theme applies immediately without requiring Save
  const handleThemeChange = (theme: 'dark' | 'light') => {
    const updated = { ...draft, theme }
    setDraft(updated)
    onSave(updated)
    setSaved(false)
  }

  const handleSave = () => {
    if (duplicatePresetIds.size > 0 || duplicateProfileIds.size > 0) return
    const existing = new Set(draft.metadataSuggestRuleLibrary.map(metadataSuggestRuleSignature))
    const additions = draft.metadataSuggestRules
      .filter(isMetadataSuggestRuleLibraryCandidate)
      .filter((rule) => !existing.has(metadataSuggestRuleSignature(rule)))
      .map((rule) => cloneMetadataSuggestRule(rule, 'library'))
    const mergedDraft = additions.length > 0
      ? { ...draft, metadataSuggestRuleLibrary: [...draft.metadataSuggestRuleLibrary, ...additions] }
      : draft
    onSave(mergedDraft)
    setDraft(mergedDraft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  useEffect(() => {
    if (!draft.enableExperimentalTraining) return
    void window.api.getTrainerProfilesState().then((state) => setTrainingProfilesState(state as TrainerProfilesStateSnapshot)).catch(() => null)
  }, [draft.enableExperimentalTraining, draft.trainingWatchProfiles, draft.trainingPresets, draft.trainingRetainGraphs])

  const updateTrainingPreset = (presetId: string, patch: Partial<TrainingPreset>) => {
    update('trainingPresets', draft.trainingPresets.map((preset) => (
      preset.id === presetId ? { ...preset, ...patch } : preset
    )))
  }

  const updateTrainingWatchProfile = (watchId: string, patch: Partial<TrainingWatchProfile>) => {
    update('trainingWatchProfiles', draft.trainingWatchProfiles.map((profile) => (
      profile.id === watchId ? { ...profile, ...patch } : profile
    )))
  }

  const addTrainingPreset = () => {
    const nextIndex = draft.trainingPresets.length + 1
    const id = `training-preset-${Date.now()}-${nextIndex}`
    const nextPreset: TrainingPreset = {
      id,
      name: `Preset ${nextIndex}`,
      architectures: ['standard'],
      epochs: 1000,
      thresholdEsr: null,
      latencyMode: 'auto',
      latencyValue: null,
      savePlot: true,
      ignoreChecks: false,
      namingTemplate: '{basename}',
    }
    update('trainingPresets', [...draft.trainingPresets, nextPreset])
    setTrainingPresetsOpen(true)
    setNewItemId(id)
  }

  const duplicateTrainingPreset = (presetId: string) => {
    const source = draft.trainingPresets.find((p) => p.id === presetId)
    if (!source) return
    const id = `training-preset-${Date.now()}`
    const clone: TrainingPreset = { ...source, id, name: `${source.name} (copy)` }
    update('trainingPresets', [...draft.trainingPresets, clone])
    setTrainingPresetsOpen(true)
    setNewItemId(id)
  }

  const addTrainingWatchProfile = () => {
    const nextIndex = draft.trainingWatchProfiles.length + 1
    const id = `training-watch-${Date.now()}-${nextIndex}`
    const nextProfile: TrainingWatchProfile = {
      id,
      name: `Watcher ${nextIndex}`,
      enabled: true,
      autoRun: true,
      initialScanMode: 'process-existing',
      watchFolder: '',
      presetId: draft.trainingPresets[0]?.id ?? '',
      sourcePostProcess: 'keep',
      processedWavRoot: '',
      graphRoot: '',
      graphOutputFormula: '',
      finalModelRoot: '',
    }
    update('trainingWatchProfiles', [...draft.trainingWatchProfiles, nextProfile])
    setTrainingWatchersOpen(true)
    setNewItemId(id)
  }

  const duplicateTrainingWatchProfile = (profileId: string) => {
    const source = draft.trainingWatchProfiles.find((p) => p.id === profileId)
    if (!source) return
    const id = `training-watch-${Date.now()}`
    const clone: TrainingWatchProfile = { ...source, id, name: `${source.name} (copy)` }
    update('trainingWatchProfiles', [...draft.trainingWatchProfiles, clone])
    setTrainingWatchersOpen(true)
    setNewItemId(id)
  }

  const presetSignature = (p: TrainingPreset) =>
    JSON.stringify({ name: p.name, architectures: p.architectures, epochs: p.epochs, thresholdEsr: p.thresholdEsr, latencyMode: p.latencyMode, latencyValue: p.latencyValue, savePlot: p.savePlot, ignoreChecks: p.ignoreChecks })

  const watchProfileSignature = (p: TrainingWatchProfile) =>
    JSON.stringify({ name: p.name, watchFolder: p.watchFolder, presetId: p.presetId, finalModelRoot: p.finalModelRoot, graphRoot: p.graphRoot, initialScanMode: p.initialScanMode, enabled: p.enabled, autoRun: p.autoRun })

  const duplicatePresetIds = new Set(
    draft.trainingPresets
      .map((p) => presetSignature(p))
      .filter((sig, i, arr) => arr.indexOf(sig) !== i)
      .flatMap((sig) => draft.trainingPresets.filter((p) => presetSignature(p) === sig).map((p) => p.id))
  )

  const duplicateProfileIds = new Set(
    draft.trainingWatchProfiles
      .map((p) => watchProfileSignature(p))
      .filter((sig, i, arr) => arr.indexOf(sig) !== i)
      .flatMap((sig) => draft.trainingWatchProfiles.filter((p) => watchProfileSignature(p) === sig).map((p) => p.id))
  )

  const formatWatchPath = (path: string) => {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.length <= 4 ? normalized : `.../${parts.slice(-4).join('/')}`
  }



  const markTrainingWatchCurrentContentsAsSeen = async (watchId: string) => {
    const result = await window.api.markTrainingWatchCurrentContentsSeen(watchId)
    if (!result.success) {
      window.alert(result.error || 'Could not mark current watcher contents as seen.')
      return
    }
    window.alert(result.marked && result.marked > 0
      ? `Marked ${result.marked} watcher item${result.marked === 1 ? '' : 's'} as already seen.`
      : 'No untracked watcher items needed to be marked as seen.')
  }

  const openNewCaptureProfile = (seedFrom?: CaptureProfile) => {
    if (seedFrom) {
      const seed: UserCaptureProfile = {
        id: `profile-${Date.now()}`,
        name: `${seedFrom.name} (copy)`,
        description: seedFrom.description,
        waveNetConfig: JSON.parse(JSON.stringify(seedFrom.waveNetConfig)),
        lr: seedFrom.lr,
        lrDecay: seedFrom.lrDecay,
        defaultEpochs: seedFrom.defaultEpochs,
        batchSize: seedFrom.batchSize,
        ny: seedFrom.ny,
        fitMrstft: seedFrom.fitMrstft,
      }
      setCaptureProfileEditorTarget(seed)
    } else {
      setCaptureProfileEditorTarget(null)
    }
    setCaptureProfileEditorOpen(true)
    setCaptureProfilesOpen(true)
  }

  const saveCaptureProfile = (profile: UserCaptureProfile) => {
    const existing = (draft.userCaptureProfiles ?? []).findIndex((p) => p.id === profile.id)
    if (existing >= 0) {
      update('userCaptureProfiles', (draft.userCaptureProfiles ?? []).map((p) => p.id === profile.id ? profile : p))
    } else {
      update('userCaptureProfiles', [...(draft.userCaptureProfiles ?? []), profile])
    }
    setCaptureProfileEditorOpen(false)
    setCaptureProfileEditorTarget(null)
  }

  const deleteCaptureProfile = (profileId: string) => {
    update('userCaptureProfiles', (draft.userCaptureProfiles ?? []).filter((p) => p.id !== profileId))
  }

  const appendLibraryRulesToGlobal = (selectedRules: MetadataSuggestRule[]) => {
    if (selectedRules.length === 0) return
    update('metadataSuggestRules', [
      ...draft.metadataSuggestRules,
      ...selectedRules.map((rule) => cloneMetadataSuggestRule(rule, 'global-lib')),
    ])
    setShowRuleLibraryPicker(false)
  }

  const deleteRuleLibraryEntry = (ruleId: string) => {
    update(
      'metadataSuggestRuleLibrary',
      draft.metadataSuggestRuleLibrary.filter((rule) => rule.id !== ruleId)
    )
  }

  const appendRecipeRulesToGlobal = (selectedRules: MetadataSuggestRule[]) => {
    if (selectedRules.length === 0) return
    update('metadataSuggestRules', [
      ...draft.metadataSuggestRules,
      ...selectedRules,
    ])
    setShowRecipeBuilder(false)
  }

  return (
    <div className={`flex flex-col overflow-hidden ${maximized ? 'fixed inset-4 z-[70] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl h-auto' : 'h-full'}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Defaults are applied when opening files that have empty fields.
          </p>
        </div>
        <div className="flex items-center gap-2">
        <button
          onClick={() => setMaximized((v) => !v)}
          title={maximized ? 'Restore settings panel' : 'Maximize settings panel'}
          className={`p-2 rounded-lg transition-colors ${
            maximized
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {maximized
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            }
          </svg>
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
        >
          Close
        </button>
        <button
          onClick={handleSave}
          disabled={duplicatePresetIds.size > 0 || duplicateProfileIds.size > 0}
          title={duplicatePresetIds.size > 0 || duplicateProfileIds.size > 0 ? 'Resolve exact duplicates before saving' : undefined}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saved ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save Settings
            </>
          )}
        </button>
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 px-6 bg-white dark:bg-gray-950">
        <div className="flex flex-wrap gap-6 -mb-px">
          {([
            ['global', 'Global'],
            ['defaults', 'Capture Defaults'],
            ['metadata', 'Metadata'],
            ['pack', 'Pack'],
            ['training', 'Training'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSettingsTab(value)}
              className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                settingsTab === value
                  ? 'border-cyan-400 text-cyan-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className={`${maximized ? 'max-w-none' : 'max-w-2xl'} space-y-8`}>

          {/* Appearance */}
          {settingsTab === 'global' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">UI</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Appearance</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium w-20">Theme</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
                  <button
                    onClick={() => handleThemeChange('dark')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                      draft.theme === 'dark'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => handleThemeChange('light')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                      draft.theme === 'light'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    Light
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium w-20">Default View</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
                  {(['list', 'grid'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => update('defaultView', v)}
                      className={`px-4 py-1.5 text-xs font-medium transition-colors capitalize ${
                        draft.defaultView === v
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {v === 'list' ? 'List' : 'Grid'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium w-20">Label Style</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
                  {([false, true] as const).map((solid) => (
                    <button
                      key={String(solid)}
                      onClick={() => update('solidPillColors', solid)}
                      className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                        draft.solidPillColors === solid
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {solid ? 'Solid Colors' : 'Subtle'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Capture Defaults */}
          {settingsTab === 'defaults' && (
          <Section
            icon="Fill"
            title="Capture Defaults"
            enabled={draft.enableCaptureDefaults}
            onToggle={(v) => update('enableCaptureDefaults', v)}
            description="Default values used for training and manual re-apply. Check 'Auto-fill on load' to also populate blank fields automatically when opening captures."
          >
            <SettingsField label="Default Modeled By" hint="Used for training; optionally auto-fills blank modeled_by on load">
              <input
                type="text"
                value={draft.defaultModeledBy}
                onChange={(e) => update('defaultModeledBy', e.target.value)}
                disabled={!draft.enableCaptureDefaults}
                placeholder="e.g. Core Tone Captures"
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <label className={`flex items-center gap-2 mt-1.5 cursor-pointer select-none ${!draft.enableCaptureDefaults ? 'opacity-40 pointer-events-none' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.fillOnLoadModeledBy}
                  onChange={(e) => update('fillOnLoadModeledBy', e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">Auto-fill blank captures on load</span>
              </label>
            </SettingsField>
            <SettingsField label="Default Input Level (dBu)" hint="Used for training; optionally auto-fills blank input_level_dbu on load">
              <input
                type="number"
                value={draft.defaultInputLevel}
                onChange={(e) => update('defaultInputLevel', e.target.value)}
                disabled={!draft.enableCaptureDefaults}
                placeholder="e.g. 12.5"
                step={0.5}
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <label className={`flex items-center gap-2 mt-1.5 cursor-pointer select-none ${!draft.enableCaptureDefaults ? 'opacity-40 pointer-events-none' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.fillOnLoadInputLevel}
                  onChange={(e) => update('fillOnLoadInputLevel', e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">Auto-fill blank captures on load</span>
              </label>
            </SettingsField>
            <SettingsField label="Default Output Level (dBu)" hint="Used for training; optionally auto-fills blank output_level_dbu on load">
              <input
                type="number"
                value={draft.defaultOutputLevel}
                onChange={(e) => update('defaultOutputLevel', e.target.value)}
                disabled={!draft.enableCaptureDefaults}
                placeholder="e.g. -20"
                step={0.5}
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <label className={`flex items-center gap-2 mt-1.5 cursor-pointer select-none ${!draft.enableCaptureDefaults ? 'opacity-40 pointer-events-none' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.fillOnLoadOutputLevel}
                  onChange={(e) => update('fillOnLoadOutputLevel', e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">Auto-fill blank captures on load</span>
              </label>
            </SettingsField>
          </Section>
          )}

          {/* Behavior */}
          {settingsTab === 'global' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">App</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Behavior</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">Confirmation dialogs</p>
                <div className="space-y-3">
                  <CheckboxField
                    label="Skip save confirmation"
                    description="Don't show the 'This will write to disk' warning before saving files. Applies to Save All, folder saves, and save selection."
                    checked={draft.skipSaveAllConfirmation}
                    onChange={(v) => update('skipSaveAllConfirmation', v)}
                  />
                  <CheckboxField
                    label="Skip Batch Edit confirmation"
                    description="Don't show the warning before applying batch edits or multi-select edits."
                    checked={draft.skipBatchEditConfirmation}
                    onChange={(v) => update('skipBatchEditConfirmation', v)}
                  />
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Startup */}
          {settingsTab === 'global' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Start</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Startup</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Remember last opened folder"
                description="Each time you open a folder it becomes the default. On next launch it reopens automatically."
                checked={draft.rememberLastFolder}
                onChange={(v) => update('rememberLastFolder', v)}
              />
              <CheckboxField
                label="Show Library Overview on launch"
                description="Open the Library Overview panel automatically when the app starts. Turn off if you prefer to start with the capture editor."
                checked={draft.showDashboardOnLaunch}
                onChange={(v) => update('showDashboardOnLaunch', v)}
              />
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Default folder panel tab</span>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">Which tab shows when you click a folder in the tree.</p>
                </div>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 flex-shrink-0">
                  {([['overview', 'Overview'], ['pack', 'Pack Info'], ['gallery', 'Gallery']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => update('defaultFolderTab', v)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        draft.defaultFolderTab === v
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <CheckboxField
                label="Watch folder for new files"
                description="Automatically detect when new .nam files are added to the open folder and show a refresh prompt. Not supported on Linux."
                checked={draft.watchFolder}
                onChange={(v) => update('watchFolder', v)}
              />
              <CheckboxField
                label="Open default folder on launch"
                description="Automatically load the folder below when the app starts. Enabled automatically when Remember last opened folder is on."
                checked={draft.enableDefaultFolder}
                onChange={(v) => update('enableDefaultFolder', v)}
              />
              {draft.enableDefaultFolder && (
                <SettingsField label="Default Folder" hint="Full path to your library folder">
                  <input
                    type="text"
                    value={draft.defaultFolder}
                    onChange={(e) => update('defaultFolder', e.target.value)}
                    placeholder="e.g. C:\Users\You\NAM Library"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1.5">Updated automatically when Remember last opened folder is on. Edit manually to pin a specific path.</p>
                </SettingsField>
              )}
            </div>
          </div>
          )}

          {/* Library */}
          {settingsTab === 'global' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Lib</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Library</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Show folder images"
                description="When a folder is selected with no captures chosen, display image files from that folder (and parent folders) in the right panel."
                checked={draft.showFolderImages}
                onChange={(v) => update('showFolderImages', v)}
              />
              <SettingsField label="Hidden Folders" hint="Folder names to exclude when scanning - subfolders are also excluded">
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={draft.hiddenFolders}
                    onChange={(e) => update('hiddenFolders', e.target.value)}
                    placeholder="e.g. lightning_logs,version_0,checkpoints"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Comma-separated. Case-insensitive. Matched by folder name only, not full path.
                  </p>
                </div>
              </SettingsField>
              <SettingsField label="Tone3000 Username" hint="Optional username used to help match Tone3000 creators to your local modeled_by naming">
                <input
                  type="text"
                  value={draft.tone3000Username}
                  onChange={(e) => update('tone3000Username', e.target.value)}
                  placeholder="e.g. CoreToneCaptures"
                  className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                />
              </SettingsField>
            </div>
          </div>
          )}

          {settingsTab === 'global' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">App</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Application</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-3 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={updateState.status === 'checking'}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex-shrink-0"
                  >
                    {updateState.status === 'checking' ? 'Checking...' : 'Check for Updates'}
                  </button>
                  {updateState.status === 'idle' && (
                    <span className="text-xs text-gray-500 dark:text-gray-500">v{import.meta.env.VITE_APP_VERSION}</span>
                  )}
                  {updateState.status === 'up-to-date' && (
                    <span className="text-xs text-green-600 dark:text-green-400">Up to date (v{updateState.version})</span>
                  )}
                  {updateState.status === 'available' && (
                    <span className="text-xs text-amber-500 dark:text-amber-400">
                      v{updateState.version} available -{' '}
                      <button
                        onClick={() => window.api.openExternal((updateState as { url: string }).url)}
                        className="underline hover:text-amber-400 transition-colors"
                      >
                        Download
                      </button>
                    </span>
                  )}
                  {updateState.status === 'error' && (
                    <span className="text-xs text-red-500 dark:text-red-400">Could not check: {(updateState as { message: string }).message}</span>
                  )}
                  <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={draft.checkForRCBuilds}
                      onChange={(e) => {
                        const updated = { ...draft, checkForRCBuilds: e.target.checked }
                        setDraft(updated)
                        onSave(updated)
                        setUpdateState({ status: 'idle' })
                      }}
                      className="w-3.5 h-3.5 rounded accent-indigo-500"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-500">Include RC builds</span>
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">NAM Standalone</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1 font-mono">
                    {draft.namStandalonePath || <span className="italic text-gray-400 dark:text-gray-600">Not configured</span>}
                  </span>
                  <button
                    onClick={async () => {
                      const p = await window.api.browseExecutable()
                      if (p) {
                        const updated = { ...draft, namStandalonePath: p }
                        setDraft(updated)
                        onSave(updated)
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 flex-shrink-0"
                  >
                    Browse...
                  </button>
                  {draft.namStandalonePath && (
                    <button
                      onClick={() => {
                        const updated = { ...draft, namStandalonePath: '' }
                        setDraft(updated)
                        onSave(updated)
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-red-500/20 text-gray-500 dark:text-gray-400 flex-shrink-0"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Pack Info Catalog */}
          {settingsTab === 'pack' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Cat</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Pack Info Catalog</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Your personal gear library. Items saved here appear in the "From catalog" picker when editing a Pack Info sheet, so you never retype your standard rig.
            </p>
            <div className="mb-3 flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setPackCatalogOpen((v) => !v)}
                className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <svg
                  className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${packCatalogOpen ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Gear Catalog</span>
                {draft.packGearCatalog.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                    {draft.packGearCatalog.length}
                  </span>
                )}
              </button>
            </div>
            {packCatalogOpen && (
            <div className="space-y-5">
              {(['equipment', 'pedals', 'glossary'] as const).map((cat) => {
                const items = draft.packGearCatalog.filter((i) => i.category === cat)
                const others = draft.packGearCatalog.filter((i) => i.category !== cat)
                const label = cat === 'glossary' ? 'Glossary' : cat === 'equipment' ? 'Equipment' : 'Pedals'
                const ph0 = cat === 'glossary' ? 'DI' : cat === 'equipment' ? 'Amp' : 'Boost'
                const ph1 = cat === 'glossary' ? 'Direct Inject - no cabinet' : cat === 'equipment' ? 'Friedman BE-100 Deluxe V2' : 'Klon Centaur (unity gain)'
                return (
                  <div key={cat}>
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">{label}</p>
                    <div className="space-y-1.5">
                      {items.map((item, i) => (
                        <div key={i} className="flex gap-1.5 items-center">
                          <input
                            value={item.label}
                            placeholder={ph0}
                            onChange={(e) => {
                              const updated = items.map((x, j) => j === i ? { ...x, label: e.target.value } : x)
                              update('packGearCatalog', [...others, ...updated])
                            }}
                            className="w-28 flex-shrink-0 px-2 py-1.5 text-xs bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                          />
                          <input
                            value={item.value}
                            placeholder={ph1}
                            onChange={(e) => {
                              const updated = items.map((x, j) => j === i ? { ...x, value: e.target.value } : x)
                              update('packGearCatalog', [...others, ...updated])
                            }}
                            className="flex-1 px-2 py-1.5 text-xs bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            onClick={() => update('packGearCatalog', [...others, ...items.filter((_, j) => j !== i)])}
                            className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                            title="Remove"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => update('packGearCatalog', [...draft.packGearCatalog, { category: cat, label: '', value: '' }])}
                        className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
                      >
                        + Add {label.toLowerCase()} item
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          </div>
          )}

          {/* Pack Export Logos */}
          {settingsTab === 'pack' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Logo</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Pack Export Logos</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Optional logo shown in the top-right corner of exported Pack Info sheets. Set one for each export theme. Recommended max size ~200 KB.
            </p>
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Dark mode accent color</p>
              <div className="flex items-center gap-2 flex-wrap">
                {PACK_DARK_ACCENT_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => update('packExportDarkAccent', hex)}
                    className={`w-6 h-6 rounded border-2 transition-colors ${
                      draft.packExportDarkAccent.toLowerCase() === hex.toLowerCase()
                        ? 'border-white ring-2 ring-indigo-500'
                        : 'border-gray-300 dark:border-gray-700'
                    }`}
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
                <input
                  type="color"
                  value={draft.packExportDarkAccent}
                  onChange={(e) => update('packExportDarkAccent', e.target.value)}
                  className="h-8 w-10 rounded border border-gray-300 dark:border-gray-700 bg-transparent p-0 cursor-pointer"
                  title="Custom accent color"
                />
                <code className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                  {draft.packExportDarkAccent}
                </code>
              </div>
            </div>
            <div className="space-y-4">
              {(['Light mode logo', 'Dark mode logo'] as const).map((label, idx) => {
                const key = idx === 0 ? 'packLogoLight' : 'packLogoDark'
                const val = draft[key]
                return (
                  <div key={key}>
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">{label}</p>
                    <div className="flex items-center gap-3">
                      {val ? (
                        <img
                          src={val}
                          alt={label}
                          className="h-10 max-w-[120px] object-contain rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-1"
                        />
                      ) : (
                        <div className="h-10 w-24 rounded border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                          <span className="text-[10px] text-gray-400">No logo</span>
                        </div>
                      )}
                      <button
                        onClick={async () => {
                          const filePath = await window.api.openImageFile()
                          if (!filePath) return
                          const result = await window.api.readFileBinary(filePath)
                          if (!result.data) return
                          const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
                          const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
                          const dataUri = `data:${mime};base64,${result.data}`
                          const approxKb = result.data.length * 0.75 / 1024
                          if (approxKb > 200) {
                            alert(`This image is approximately ${Math.round(approxKb)} KB. Large logos will bloat your settings storage. Consider resizing to under 200 KB.`)
                          }
                          update(key, dataUri)
                        }}
                        className="text-xs px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-teal-500 dark:hover:border-teal-500 transition-colors"
                      >
                        Choose...
                      </button>
                      {val && (
                        <button
                          onClick={() => update(key, '')}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove logo"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          )}

          {/* Checklist Templates */}
          {settingsTab === 'pack' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">List</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Checklist Templates</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Store separate default checklist steps for the NAM/base workflow and for target-specific workflows like ToneX, Proxy, and QC. New target checklists are seeded from the matching template.
            </p>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setChecklistTemplateOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <svg
                    className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${checklistTemplateOpen ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Checklist Templates</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                    {draft.packChecklistTemplate.length + draft.targetChecklistTemplates.tonex.length + draft.targetChecklistTemplates.proxy.length + draft.targetChecklistTemplates.qc.length}
                  </span>
                </button>
              </div>
              <button
                onClick={resetAllChecklistTemplatesToDefaults}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                title="Replace all checklist templates with the current NAM Lab defaults"
              >
                Reset all to defaults
              </button>
            </div>
            {checklistTemplateOpen && (
              <div className="space-y-1.5 rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-900/30">
                <div className="flex items-center gap-2 flex-wrap pb-2">
                  {(Object.keys(checklistTemplateLabels) as TargetChecklistTemplateKey[]).map((key) => {
                    const count = key === 'nam' ? draft.packChecklistTemplate.length : draft.targetChecklistTemplates[key].length
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveChecklistTemplate(key)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          activeChecklistTemplate === key
                            ? 'bg-teal-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {checklistTemplateLabels[key]}
                        <span className="ml-1 text-[10px] opacity-80">{count}</span>
                      </button>
                    )
                  })}
                  <button
                    onClick={() => resetChecklistTemplateToDefaults(activeChecklistTemplate)}
                    className="ml-auto inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                    title={`Replace the ${checklistTemplateLabels[activeChecklistTemplate]} checklist template with its current default`}
                  >
                    Reset {checklistTemplateLabels[activeChecklistTemplate]}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 pb-1">
                  Editing template: <span className="font-medium text-gray-700 dark:text-gray-300">{checklistTemplateLabels[activeChecklistTemplate]}</span>
                </p>
                {activeChecklistTemplateItems.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-1.5">
                    <div className="flex flex-col flex-shrink-0">
                      <button
                        onClick={() => {
                          if (i === 0) return
                          const next = [...activeChecklistTemplateItems]
                          ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                          updateChecklistTemplateItems(activeChecklistTemplate, next)
                        }}
                        disabled={i === 0}
                        className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20 disabled:pointer-events-none transition-colors leading-none"
                        title="Move up"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          if (i === activeChecklistTemplateItems.length - 1) return
                          const next = [...activeChecklistTemplateItems]
                          ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                          updateChecklistTemplateItems(activeChecklistTemplate, next)
                        }}
                        disabled={i === activeChecklistTemplateItems.length - 1}
                        className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20 disabled:pointer-events-none transition-colors leading-none"
                        title="Move down"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => {
                        const next = activeChecklistTemplateItems.map((step, idx) =>
                          idx === i ? { ...step, label: e.target.value } : step
                        )
                        updateChecklistTemplateItems(activeChecklistTemplate, next)
                      }}
                      placeholder="Checklist step"
                      className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => updateChecklistTemplateItems(activeChecklistTemplate, activeChecklistTemplateItems.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                      title="Remove"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => updateChecklistTemplateItems(activeChecklistTemplate, [...activeChecklistTemplateItems, { id: `step-${Date.now()}`, label: '' }])}
                  className="pt-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
                >
                  + Add checklist step
                </button>
              </div>
            )}
          </div>
          )}

          {settingsTab === 'metadata' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Tags</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Metadata Suggestions</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              These rules can populate missing metadata across files you open. For more granular control within a specific subtree, use folder metadata and folder-scoped rules.
            </p>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setMetadataSuggestOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <svg
                    className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${metadataSuggestOpen ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Suggestion Rules</span>
                  {draft.metadataSuggestRules.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                      {draft.metadataSuggestRules.filter((rule) => rule.enabled).length}/{draft.metadataSuggestRules.length}
                    </span>
                  )}
                </button>
              </div>
              <button
                onClick={() => setShowRuleLibraryPicker(true)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              >
                Add from library...
                <span className="text-[10px] text-violet-500/80">{draft.metadataSuggestRuleLibrary.length}</span>
              </button>
              <button
                onClick={() => setShowRecipeBuilder(true)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
              >
                Build from example...
              </button>
            </div>
            {metadataSuggestOpen && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-900/30 space-y-2">
                {draft.metadataSuggestRules.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-500">No custom rules yet. Add one below to teach NAM Lab your naming shorthand.</p>
                ) : (
                  draft.metadataSuggestRules.map((rule, index) => (
                    <div key={rule.id} className={`rounded border p-2 ${rule.overwriteExisting ? 'border-amber-300/70 dark:border-amber-700/70 bg-amber-50/40 dark:bg-amber-900/10' : 'border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/30'}`}>
                      <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)_84px_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_auto_auto_auto] gap-2 items-center">
                        <label className="inline-flex items-center justify-center text-xs text-gray-600 dark:text-gray-400">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(e) => {
                              const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, enabled: e.target.checked } : item
                              )
                              update('metadataSuggestRules', next)
                            }}
                            className="accent-indigo-600"
                            title="Rule enabled"
                          />
                        </label>
                        <input
                          value={rule.token}
                          placeholder={rule.matchType === 'prefix_value' ? 'Prefix, e.g. G' : 'Token, e.g. Mesa (blank = scope-wide default)'}
                          onChange={(e) => {
                            const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, token: e.target.value } : item
                            )
                            update('metadataSuggestRules', next)
                          }}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        />
                        <input
                          type="number"
                          min={1}
                          value={rule.segmentIndex ?? ''}
                          placeholder="#"
                          onChange={(e) => {
                            const raw = e.target.value.trim()
                            const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, segmentIndex: raw === '' ? null : Math.max(1, Math.floor(Number(raw) || 1)) } : item
                            )
                            update('metadataSuggestRules', next)
                          }}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                          title="Optional filename segment number, starting at 1"
                        />
                        <select
                          value={rule.field}
                          onChange={(e) => {
                            const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                              itemIndex === index ? {
                                ...item,
                                field: e.target.value as typeof rule.field,
                                value: METADATA_SUGGEST_LOOKUP_VALUES[e.target.value as typeof rule.field]?.includes(item.value)
                                  ? item.value
                                  : ''
                              } : item
                            )
                            update('metadataSuggestRules', next)
                          }}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        >
                          {METADATA_SUGGEST_FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <select
                          value={rule.matchType}
                          onChange={(e) => {
                            const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, matchType: e.target.value as MetadataSuggestMatchType } : item
                            )
                            update('metadataSuggestRules', next)
                          }}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        >
                          {METADATA_SUGGEST_MATCH_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        {METADATA_SUGGEST_LOOKUP_VALUES[rule.field] ? (
                          <select
                            value={rule.value}
                            onChange={(e) => {
                              const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, value: e.target.value } : item
                              )
                              update('metadataSuggestRules', next)
                            }}
                            className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                          >
                            <option value="">Pick value...</option>
                            {METADATA_SUGGEST_LOOKUP_VALUES[rule.field]!.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={rule.value}
                            placeholder={rule.matchType === 'prefix_value' ? 'Template, e.g. Gain {value} or {match}' : 'Suggested value'}
                            onChange={(e) => {
                              const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, value: e.target.value } : item
                              )
                              update('metadataSuggestRules', next)
                            }}
                            className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                          />
                        )}
                        <select
                          value={rule.matchIn}
                          onChange={(e) => {
                            const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, matchIn: e.target.value as MetadataSuggestMatchIn } : item
                            )
                            update('metadataSuggestRules', next)
                          }}
                          className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="either">Filename or folder</option>
                          <option value="filename">Filename only</option>
                          <option value="folder">Folder only</option>
                        </select>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium whitespace-nowrap justify-self-start">
                          <input
                            type="checkbox"
                            checked={rule.overwriteExisting}
                            onChange={(e) => {
                              const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, overwriteExisting: e.target.checked } : item
                              )
                              update('metadataSuggestRules', next)
                            }}
                            className="accent-amber-600"
                          />
                          Overwrite
                        </label>
                        <button
                          onClick={() => update('metadataSuggestRules', [
                            ...draft.metadataSuggestRules.slice(0, index + 1),
                            cloneMetadataSuggestRule(rule, 'rule-clone'),
                            ...draft.metadataSuggestRules.slice(index + 1),
                          ])}
                          className="text-gray-400 hover:text-violet-500 transition-colors justify-self-center"
                          title="Clone rule"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8a2 2 0 012 2v8m-2 0H8a2 2 0 01-2-2V7m2-2h8a2 2 0 012 2v8" />
                          </svg>
                        </button>
                        <button
                          onClick={() => update('metadataSuggestRules', draft.metadataSuggestRules.filter((item) => item.id !== rule.id))}
                          className="text-gray-400 hover:text-red-500 transition-colors justify-self-center"
                          title="Remove rule"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {rule.overwriteExisting && (
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-2 items-center">
                          <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Overwrite only if current value is</div>
                          <input
                            value={rule.overwriteOnlyValues}
                            placeholder="Optional comma list, e.g. tz-make, Unknown, N/A"
                            onChange={(e) => {
                              const next = draft.metadataSuggestRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, overwriteOnlyValues: e.target.value } : item
                              )
                              update('metadataSuggestRules', next)
                            }}
                            className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-amber-300/60 dark:border-amber-700/60 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      )}
                    </div>
                  ))
                )}
                <button
                  onClick={() => update('metadataSuggestRules', [
                    ...draft.metadataSuggestRules,
                    {
                      id: `rule-${Date.now()}`,
                      token: '',
                      segmentIndex: null,
                      field: 'gear_make',
                      value: '',
                      matchIn: 'either',
                      matchType: 'exact',
                      enabled: true,
                      overwriteExisting: false,
                      overwriteOnlyValues: '',
                    },
                  ])}
                  className="pt-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
                >
                  + Add suggestion rule
                </button>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 pt-1">
                  Tip: repeat the same token across multiple rows if one detection should fill multiple fields. Leave the token blank to make a scope-wide default rule. Use <code>Segment #</code> to target a specific filename slot such as <code>JCM800 Lo P6 B8 M4 T7 G10</code>. Use <code>Prefix + value</code> with templates like <code>{'{match}'}</code> or <code>Gain {'{value}'}</code> for settings strings such as <code>G5.5</code>. Repeated rules can build up <code>Amp Settings</code> into a combined value.
                </p>
              </div>
            )}
          </div>
          )}

          {settingsTab === 'metadata' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Meta</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Naming and Detection</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Populate name from filename"
                description="When a file has no name, automatically set it to the filename without the .nam extension."
                checked={draft.populateNameFromFilename}
                onChange={(v) => update('populateNameFromFilename', v)}
              />
              <CheckboxField
                label="Auto-detect tone type from filename"
                description={
                  <>
                    Scans the filename for tone keywords and sets Tone Type if empty. When multiple keywords match, the <em>rightmost</em> one wins, so{' '}
                    <strong>Clean Crunch DI</strong> becomes <strong>Crunch</strong>.
                  </>
                }
                checked={draft.autoDetectToneType}
                onChange={(v) => update('autoDetectToneType', v)}
              />
              <SettingsField label="Amp Suffix" hint="Filename endings that identify a capture as Amp type - comma separated">
                <div className="space-y-1">
                  <input
                    type="text"
                    value={draft.ampSuffix}
                    onChange={(e) => update('ampSuffix', e.target.value)}
                    placeholder="e.g. DI, DIR, DIRECT"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500">Leave blank to disable. Case-insensitive, spaces ignored.</p>
                </div>
              </SettingsField>
              <CheckboxField
                label="Default to Cab if no amp suffix match"
                description="When a file has no gear type and the filename does not match the amp suffix, set it to Cab. Leave off to keep gear type blank."
                checked={draft.defaultToCab}
                onChange={(v) => update('defaultToCab', v)}
              />
              <SettingsField label="File Rename Template" hint="Used by the Rename button in the metadata editor">
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={draft.renameTemplate}
                    onChange={(e) => update('renameTemplate', e.target.value)}
                    placeholder="{name} or {gear_make} {gear_model} - {name}"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500">Tokens: {'{name}'} {'{gear_make}'} {'{gear_model}'} {'{gear_type}'} {'{tone_type}'} {'{modeled_by}'}</p>
                </div>
              </SettingsField>
            </div>
          </div>
          )}

          {settingsTab === 'metadata' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Tool</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Metadata Tools</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Show NAM Lab metadata fields"
                description="Show and edit extended capture details like mics, cabinet, amp channel, settings, and comments in the metadata editor."
                checked={draft.showNamLabFields}
                onChange={(v) => update('showNamLabFields', v)}
              />
              <SettingsField label="Import Prefix Suffixes" hint="Last-word suffixes that trigger prefix matching during spreadsheet import">
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={draft.importPrefixSuffixes}
                    onChange={(e) => update('importPrefixSuffixes', e.target.value)}
                    placeholder="e.g. DI"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500">Comma-separated. When a row's last word matches one of these, the app strips it and looks for captures whose name starts with the remainder.</p>
                </div>
              </SettingsField>
            </div>
          </div>
          )}

          {/* Current Amp Info */}
          {settingsTab === 'metadata' && (
          <Section
            icon="Amp"
            title="Current Amp Info"
            enabled={draft.enableAmpInfo}
            onToggle={(v) => update('enableAmpInfo', v)}
            description="These values populate any file you open where Manufacturer or Model is empty. For more granular control within a specific subtree, use folder metadata."
          >
            <SettingsField label="Manufacturer" hint="Applied if file has no gear_make value">
              <input
                type="text"
                value={draft.defaultManufacturer}
                onChange={(e) => update('defaultManufacturer', e.target.value)}
                disabled={!draft.enableAmpInfo}
                placeholder="e.g. Friedman"
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </SettingsField>
            <SettingsField label="Model" hint="Applied if file has no gear_model value">
              <input
                type="text"
                value={draft.defaultModel}
                onChange={(e) => update('defaultModel', e.target.value)}
                disabled={!draft.enableAmpInfo}
                placeholder="e.g. BE100 Deluxe"
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </SettingsField>
          </Section>
          )}

          {showRuleLibraryPicker && (
            <MetadataSuggestRuleLibraryModal
              title="Rule Library"
              confirmLabel="Add selected to global rules"
              rules={draft.metadataSuggestRuleLibrary}
              onConfirm={appendLibraryRulesToGlobal}
              onDeleteRule={deleteRuleLibraryEntry}
              onClose={() => setShowRuleLibraryPicker(false)}
            />
          )}
          {showRecipeBuilder && (
            <FilenameRecipeBuilderModal
              title="Build Global Rules From Example Filename"
              initialExample=""
              onConfirm={appendRecipeRulesToGlobal}
              onClose={() => setShowRecipeBuilder(false)}
            />
          )}

          {settingsTab === 'global' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Watch</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">New .nam Auto-Copy Rules</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Destination folders in NAM Lab can watch a source folder and automatically copy in new top-level <code>.nam</code> files.
            </p>
            <div className="mb-3 flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setFolderWatchesOpen((v) => !v)}
                className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <svg
                  className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${folderWatchesOpen ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Auto-Copy Rules</span>
                {draft.folderWatchRules.filter((rule) => rule.enabled).length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                    {draft.folderWatchRules.filter((rule) => rule.enabled).length}
                  </span>
                )}
              </button>
            </div>
            {folderWatchesOpen && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-900/30">
                {draft.folderWatchRules.filter((rule) => rule.enabled).length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-500">No auto-copy rules configured yet.</p>
                ) : (
                  <div className="space-y-2">
                    {draft.folderWatchRules.filter((rule) => rule.enabled).map((rule) => (
                      <div key={`${rule.destFolder}=>${rule.sourceFolder}`} className="flex items-start gap-3 rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/30 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300 break-all">
                            Into: <span className="text-gray-900 dark:text-gray-100">{formatWatchPath(rule.destFolder)}</span>
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5 break-all">
                            From: {formatWatchPath(rule.sourceFolder)}
                          </div>
                        </div>
                        <button
                          onClick={() => update('folderWatchRules', draft.folderWatchRules.filter((item) => item !== rule))}
                          className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                          title="Remove watch"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {settingsTab === 'training' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Train</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Training</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Enable local training"
                description="Turns on NAM Lab's training workspace and launches the local NAM trainer in the background using your configured Python environment."
                checked={draft.enableExperimentalTraining}
                onChange={(v) => update('enableExperimentalTraining', v)}
              />

              {draft.enableExperimentalTraining && (
                <>
                  <SettingsField label="NAM Python executable" hint="Python executable with neural-amp-modeler installed (≥ 0.12.3 recommended)">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={draft.namPythonPath}
                        onChange={(e) => update('namPythonPath', e.target.value)}
                        placeholder="e.g. C:\\Users\\Admin\\.conda\\envs\\nam\\python.exe"
                        className="flex-1 px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <button
                        onClick={async () => {
                          const p = await window.api.browseExecutable()
                          if (p) update('namPythonPath', p)
                        }}
                        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 flex-shrink-0"
                      >
                        Browse...
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField label="Default trainer input WAV" hint="Optional starter value for the experimental Training tab">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={draft.namTrainingInputWav}
                        onChange={(e) => update('namTrainingInputWav', e.target.value)}
                        placeholder="Select the input / DI WAV used for training"
                        className="flex-1 px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <button
                        onClick={async () => {
                          const p = await window.api.openAudioFile()
                          if (p) update('namTrainingInputWav', p)
                        }}
                        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 flex-shrink-0"
                      >
                        Browse...
                      </button>
                    </div>
                  </SettingsField>

                  <CheckboxField
                    label="Retain graphs after training"
                    description="Keep ESR / comparison PNG graphs as user-facing artifacts. When off, NAM Lab keeps the final .nam but leaves graph files in the internal run workspace only."
                    checked={draft.trainingRetainGraphs}
                    onChange={(v) => update('trainingRetainGraphs', v)}
                  />

                  <div className="flex items-center gap-3 flex-wrap">
                    <CheckboxField
                      label="Normalize WAV pair before training"
                      description="Applies identical linked peak gain to both input and output WAVs before each training run. Originals are never modified — normalized copies are used only within the run workspace."
                      checked={draft.normalizeWavBeforeTraining ?? true}
                      onChange={(v) => update('normalizeWavBeforeTraining', v)}
                    />
                    {(draft.normalizeWavBeforeTraining ?? true) && (
                      <div className="flex items-center gap-2 ml-6">
                        <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Target</label>
                        <input
                          type="number"
                          step="0.5"
                          max="0"
                          min="-30"
                          value={draft.normalizeWavTargetDb ?? -5.0}
                          onChange={(e) => update('normalizeWavTargetDb', Number(e.target.value))}
                          className="w-20 px-2 py-1.5 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">dBFS</span>
                      </div>
                    )}
                  </div>

                  <SettingsField
                    label="NAM output path formula"
                    hint="Derive the .nam output folder from the staging WAV path using tokens. Leave blank to use a fixed path per run."
                  >
                    <OutputFormulaField
                      value={draft.trainingOutputFormula ?? ''}
                      onChange={(v) => update('trainingOutputFormula', v)}
                      exampleStagingPath={draft.namTrainingInputWav ? draft.namTrainingInputWav.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined}
                    />
                  </SettingsField>

                  <SettingsField
                    label="Graph output path formula"
                    hint="Derive the graph output folder from the staging WAV path using tokens. Leave blank to use a fixed path per run."
                  >
                    <OutputFormulaField
                      value={draft.trainingGraphFormula ?? ''}
                      onChange={(v) => update('trainingGraphFormula', v)}
                      exampleStagingPath={draft.namTrainingInputWav ? draft.namTrainingInputWav.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined}
                      suggestionFormula="../../Graphs/{architecture}/{folder}"
                    />
                  </SettingsField>

                  <div className="space-y-3">
                    <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => setTrainingWatchersOpen((v) => !v)}
                        className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                      >
                        <svg
                          className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${trainingWatchersOpen ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Watch Folders</span>
                        {draft.trainingWatchProfiles.length > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                            {draft.trainingWatchProfiles.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={addTrainingWatchProfile}
                        className="flex items-center gap-1.5 px-3 py-2.5 border-l border-gray-200 dark:border-gray-700 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 transition-colors text-xs font-medium"
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add
                      </button>
                    </div>
                    {trainingWatchersOpen && (
                      <div className="ml-3 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
                        {draft.trainingWatchProfiles.length === 0 ? (
                          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-3 text-xs text-gray-500 dark:text-gray-500">
                            No training watch folders yet. Add one, choose a preset, and it can feed the shared queue whenever new WAVs appear.
                          </div>
                        ) : (
                          draft.trainingWatchProfiles.map((profile, profileIndex) => (
                            <div key={profile.id} ref={profile.id === newItemId ? newItemRef : undefined} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                              <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                                <span className="w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">{profileIndex + 1}</span>
                                <input
                                  type="text"
                                  value={profile.name}
                                  onChange={(e) => updateTrainingWatchProfile(profile.id, { name: e.target.value })}
                                  className="flex-1 px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                />
                                <select
                                  value={profile.presetId}
                                  onChange={(e) => updateTrainingWatchProfile(profile.id, { presetId: e.target.value })}
                                  className="px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 min-w-[180px]"
                                >
                                  <option value="">Pick preset...</option>
                                  {draft.trainingPresets.map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => duplicateTrainingWatchProfile(profile.id)}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex-shrink-0"
                                  title="Duplicate watcher"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => update('trainingWatchProfiles', draft.trainingWatchProfiles.filter((item) => item.id !== profile.id))}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-red-300/60 dark:border-red-800/60 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0"
                                  title="Remove watcher"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                              {duplicateProfileIds.has(profile.id) && (
                                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/50 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                                  Exact duplicate of another watcher — change at least one field before saving.
                                </div>
                              )}
                              <div className="px-3 py-3 bg-white dark:bg-gray-900/50 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-[auto_auto_1fr] gap-3 items-start">
                                <CheckboxField label="Enabled" description="" checked={profile.enabled} onChange={(v) => updateTrainingWatchProfile(profile.id, { enabled: v })} />
                                <CheckboxField label="Auto-run" description="" checked={profile.autoRun} onChange={(v) => updateTrainingWatchProfile(profile.id, { autoRun: v })} />
                                {(() => {
                                  const isRunning = trainingProfilesState.watchers.find((item) => item.profileId === profile.id)?.running ?? false
                                  return (
                                    <div className="flex items-center gap-2 pt-0.5">
                                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRunning ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-600'}`} />
                                      <span className="text-xs text-gray-500 dark:text-gray-400">{isRunning ? 'Watching' : 'Stopped'}</span>
                                      <button
                                        onClick={async () => { await window.api.setTrainerProfileRunning(profile.id, !isRunning) }}
                                        disabled={!profile.enabled}
                                        className={`ml-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                          isRunning
                                            ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400'
                                            : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                                        }`}
                                      >
                                        {isRunning ? 'Stop' : 'Start'}
                                      </button>
                                    </div>
                                  )
                                })()}
                              </div>
                              {(() => {
                                const linkedPreset = draft.trainingPresets.find((preset) => preset.id === profile.presetId)
                                if (!linkedPreset) return null
                                return (
                                  <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                                    {linkedPreset.architectures.map((item) => item.toUpperCase()).join(', ') || 'No architectures'} · {linkedPreset.epochs} epochs · {linkedPreset.thresholdEsr != null ? `Target ESR ${linkedPreset.thresholdEsr}` : 'No ESR target'}
                                  </div>
                                )
                              })()}
                              <SettingsField label="Watch Folder">
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={profile.watchFolder}
                                    onChange={(e) => updateTrainingWatchProfile(profile.id, { watchFolder: e.target.value })}
                                    className="flex-1 px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 font-mono"
                                  />
                                  <button
                                    onClick={async () => {
                                      const picked = await window.api.openFolder(profile.watchFolder || undefined)
                                      if (picked) updateTrainingWatchProfile(profile.id, { watchFolder: picked })
                                    }}
                                    className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                                  >
                                    Browse...
                                  </button>
                                </div>
                              </SettingsField>
                              <SettingsField
                                label="Watcher start mode"
                                labelTitle="Choose whether this watcher should process older untracked WAVs already in the folder, or only react to new files that appear after the watcher starts."
                              >
                                <div className="flex gap-2 items-center flex-wrap">
                                  <select
                                    value={profile.initialScanMode ?? 'process-existing'}
                                    onChange={(e) => updateTrainingWatchProfile(profile.id, { initialScanMode: e.target.value as TrainingWatchProfile['initialScanMode'] })}
                                    className="flex-1 min-w-[160px] px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                  >
                                    <option value="process-existing">Process existing untracked files</option>
                                    <option value="new-only">Watch new files only</option>
                                  </select>
                                  <button
                                    onClick={() => void markTrainingWatchCurrentContentsAsSeen(profile.id)}
                                    disabled={!profile.watchFolder.trim() || !profile.presetId}
                                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    title="Record the current WAVs in this folder as already seen so the watcher skips them until you explicitly retry them later."
                                  >
                                    Mark seen
                                  </button>
                                  <button
                                    onClick={() => {
                                      const linkedPreset = draft.trainingPresets.find((p) => p.id === profile.presetId)
                                      setWatcherFilesModal({ profileId: profile.id, profileName: profile.name, watchFolder: profile.watchFolder, architectures: linkedPreset?.architectures ?? [] })
                                    }}
                                    disabled={!profile.watchFolder.trim()}
                                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    title="View all WAV files in this folder and their queue/history status"
                                  >
                                    View Files…
                                  </button>
                                </div>
                              </SettingsField>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Capture Profiles section */}
                  <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => setCaptureProfilesOpen((v) => !v)}
                        className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                      >
                        <svg
                          className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${captureProfilesOpen ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Capture Profiles</span>
                        <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                          {8 + (draft.userCaptureProfiles ?? []).length}
                        </span>
                        {(draft.userCaptureProfiles ?? []).length > 0 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            · {(draft.userCaptureProfiles ?? []).length} custom
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => openNewCaptureProfile()}
                        className="flex items-center gap-1.5 px-3 py-2.5 border-l border-gray-200 dark:border-gray-700 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 transition-colors text-xs font-medium"
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        New
                      </button>
                    </div>
                    {captureProfilesOpen && (
                      <div className="ml-3 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 px-3 py-3">
                        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-3">
                          All 8 built-in architectures run via dynamic registration — no core.py edits needed. Clone any built-in or create a custom profile from scratch.
                        </p>
                        <ArchitectureProfilePicker
                          selectedIds={[]}
                          onChange={() => {}}
                          userProfiles={draft.userCaptureProfiles ?? []}
                          onClone={(profile) => openNewCaptureProfile(profile)}
                          onEdit={(profile) => { setCaptureProfileEditorTarget(profile); setCaptureProfileEditorOpen(true) }}
                          onDelete={deleteCaptureProfile}
                          onNew={() => openNewCaptureProfile()}
                        />
                      </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex items-stretch rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => setTrainingPresetsOpen((v) => !v)}
                        className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                      >
                        <svg
                          className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${trainingPresetsOpen ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Training Presets</span>
                        {draft.trainingPresets.length > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
                            {draft.trainingPresets.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={addTrainingPreset}
                        className="flex items-center gap-1.5 px-3 py-2.5 border-l border-gray-200 dark:border-gray-700 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 transition-colors text-xs font-medium"
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add
                      </button>
                    </div>
                    {trainingPresetsOpen && (
                      <div className="ml-3 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
                        {draft.trainingPresets.length === 0 ? (
                          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-3 text-xs text-gray-500 dark:text-gray-500">
                            No training presets yet. Add one to store a reusable training recipe for watchers and manual runs.
                          </div>
                        ) : (
                          draft.trainingPresets.map((preset, presetIndex) => (
                            <div key={preset.id} ref={preset.id === newItemId ? newItemRef : undefined} className="rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                              <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
                                <span className="w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">{presetIndex + 1}</span>
                                <input
                                  type="text"
                                  value={preset.name}
                                  onChange={(e) => updateTrainingPreset(preset.id, { name: e.target.value })}
                                  className="flex-1 px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                />
                                <button
                                  onClick={() => duplicateTrainingPreset(preset.id)}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex-shrink-0"
                                  title="Duplicate preset"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => update('trainingPresets', draft.trainingPresets.filter((item) => item.id !== preset.id))}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-red-300/60 dark:border-red-800/60 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0"
                                  title="Remove preset"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                              {duplicatePresetIds.has(preset.id) && (
                                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/50 text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                                  Exact duplicate of another preset — change at least one field before saving.
                                </div>
                              )}
                              <div className="px-3 py-3 bg-white dark:bg-gray-900/50 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <SettingsField label="NAM Version">
                                  <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
                                    <button
                                      onClick={() => updateTrainingPreset(preset.id, {
                                        namMode: 'a1',
                                        architectures: preset.architectures.filter((a) => a !== 'a2'),
                                      })}
                                      className={`flex-1 py-1.5 px-3 font-medium transition-colors ${
                                        (preset.namMode ?? 'a1') === 'a1'
                                          ? 'bg-indigo-600 text-white'
                                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                                      }`}
                                    >
                                      A1 WaveNet
                                    </button>
                                    <button
                                      disabled
                                      title="A2 (PackedWaveNet) training is not yet available in the NAM trainer. Coming soon."
                                      className="flex-1 py-1.5 px-3 font-medium bg-white dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                                    >
                                      A2 — Coming Soon
                                    </button>
                                  </div>
                                </SettingsField>
                                {(preset.namMode ?? 'a1') === 'a1' && (
                                <SettingsField label="Architecture(s)">
                                  <SettingsArchitectureMultiSelect
                                    values={preset.architectures}
                                    onChange={(next) => updateTrainingPreset(preset.id, { architectures: next })}
                                    userProfiles={draft.userCaptureProfiles ?? []}
                                  />
                                </SettingsField>
                                )}
                                <SettingsField label="Epochs">
                                  <input
                                    type="number"
                                    min={1}
                                    value={preset.epochs}
                                    onChange={(e) => updateTrainingPreset(preset.id, { epochs: Math.max(1, Number(e.target.value) || 1) })}
                                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                  />
                                </SettingsField>
                                <SettingsField label="Latency">
                                  <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
                                    <select
                                      value={preset.latencyMode}
                                      onChange={(e) => updateTrainingPreset(preset.id, { latencyMode: e.target.value as TrainingPreset['latencyMode'] })}
                                      className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                    >
                                      <option value="auto">Auto</option>
                                      <option value="manual">Manual</option>
                                    </select>
                                    <input
                                      type="number"
                                      min={0}
                                      value={preset.latencyValue ?? ''}
                                      disabled={preset.latencyMode !== 'manual'}
                                      onChange={(e) => updateTrainingPreset(preset.id, { latencyValue: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
                                      placeholder="Samples"
                                      className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                                    />
                                  </div>
                                </SettingsField>
                                <SettingsField label="Target ESR" labelTitle="Stop training early once this ESR is reached. Quality: <0.01 = Great · <0.035 = Good · <0.1 = Acceptable">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.0001"
                                    value={preset.thresholdEsr ?? ''}
                                    onChange={(e) => updateTrainingPreset(preset.id, { thresholdEsr: e.target.value === '' ? null : Number(e.target.value) })}
                                    placeholder="e.g. 0.005"
                                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                  />
                                </SettingsField>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <CheckboxField label="Save graph" description="" checked={preset.savePlot} onChange={(v) => updateTrainingPreset(preset.id, { savePlot: v })} />
                                <CheckboxField label="Ignore trainer checks" description="" checked={preset.ignoreChecks} onChange={(v) => updateTrainingPreset(preset.id, { ignoreChecks: v })} />
                              </div>
                              <SettingsField label="Normalize WAV" hint="Override the global normalize setting for this preset">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={preset.normalizeWav ?? 'global'}
                                    onChange={(e) => updateTrainingPreset(preset.id, { normalizeWav: e.target.value as 'global' | 'on' | 'off' })}
                                    className="px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                  >
                                    <option value="global">Global default</option>
                                    <option value="on">On</option>
                                    <option value="off">Off</option>
                                  </select>
                                  {(preset.normalizeWav ?? 'global') !== 'off' && (
                                    <>
                                      <input
                                        type="number"
                                        step="0.5"
                                        max="0"
                                        min="-30"
                                        value={preset.normalizeWavTargetDb ?? ''}
                                        onChange={(e) => updateTrainingPreset(preset.id, { normalizeWavTargetDb: e.target.value === '' ? null : Number(e.target.value) })}
                                        placeholder={String(draft.normalizeWavTargetDb ?? -5.0)}
                                        className="w-20 px-2 py-1.5 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                                      />
                                      <span className="text-xs text-gray-500 dark:text-gray-400">dBFS</span>
                                    </>
                                  )}
                                </div>
                              </SettingsField>
                              <SettingsField label="NAM output path formula" hint="Override the global NAM output formula for this preset. Leave blank to inherit global.">
                                <OutputFormulaField
                                  value={preset.outputFormulaOverride ?? ''}
                                  onChange={(v) => updateTrainingPreset(preset.id, { outputFormulaOverride: v })}
                                  exampleStagingPath={draft.namTrainingInputWav ? draft.namTrainingInputWav.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined}
                                  exampleArchitecture={preset.architectures[0]}
                                  isPresetOverride
                                  globalFormula={draft.trainingOutputFormula ?? ''}
                                />
                              </SettingsField>
                              <SettingsField label="Graph output path formula" hint="Override the global graph output formula for this preset. Leave blank to inherit global.">
                                <OutputFormulaField
                                  value={preset.graphOutputFormulaOverride ?? ''}
                                  onChange={(v) => updateTrainingPreset(preset.id, { graphOutputFormulaOverride: v })}
                                  exampleStagingPath={draft.namTrainingInputWav ? draft.namTrainingInputWav.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined}
                                  exampleArchitecture={preset.architectures[0]}
                                  isPresetOverride
                                  suggestionFormula="../../Graphs/{architecture}/{folder}"
                                  globalFormula={draft.trainingGraphFormula ?? ''}
                                />
                              </SettingsField>
                              <SettingsField label="Naming template" hint="Output filename pattern. Use {basename} for the source WAV filename without extension.">
                                <input
                                  value={preset.namingTemplate ?? '{basename}'}
                                  onChange={(e) => updateTrainingPreset(preset.id, { namingTemplate: e.target.value })}
                                  placeholder="{basename}"
                                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
                                />
                              </SettingsField>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Watch folders pick a preset and feed the shared queue. Presets are the reusable training recipes used by watchers and one-time folder runs.
                  </p>
                </>
              )}
            </div>
          </div>
          )}

        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
        {/* About row */}
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="text-xs text-gray-400 dark:text-gray-600">
            Built by{' '}
            <button
              onClick={() => window.open('https://coretonecaptures.com/', '_blank')}
              className="text-indigo-400 hover:text-indigo-300 transition-colors underline"
            >
              Core Tone Captures
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const p = await window.api.getStartupLogPath()
                window.api.revealFile(p)
              }}
              className="text-xs text-gray-500 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-400 transition-colors underline"
              title="Open the startup log folder - useful for reporting issues"
            >
              Open Log
            </button>
            <div className="text-xs text-gray-500 dark:text-gray-600">NAM Lab</div>
          </div>
        </div>
      </div>
      {captureProfileEditorOpen && (
        <CaptureProfileEditor
          profile={captureProfileEditorTarget}
          onSave={saveCaptureProfile}
          onCancel={() => { setCaptureProfileEditorOpen(false); setCaptureProfileEditorTarget(null) }}
        />
      )}
      {watcherFilesModal && (
        <WatcherFilesModal
          profileId={watcherFilesModal.profileId}
          profileName={watcherFilesModal.profileName}
          watchFolder={watcherFilesModal.watchFolder}
          architectures={watcherFilesModal.architectures}
          onClose={() => setWatcherFilesModal(null)}
        />
      )}
    </div>
  )
}

function Section({
  icon,
  title,
  enabled,
  onToggle,
  description,
  children
}: {
  icon: string
  title: string
  enabled: boolean
  onToggle: (v: boolean) => void
  description: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{title}</h3>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        <label className="flex items-center gap-2 cursor-pointer ml-2">
          <span className="text-xs text-gray-500 dark:text-gray-500">{enabled ? 'Enabled' : 'Disabled'}</span>
          <div
            className={`relative w-8 h-4 rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'}`}
            onClick={() => onToggle(!enabled)}
          >
            <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
        </label>
      </div>
      <p className={`text-xs mb-4 transition-colors ${enabled ? 'text-gray-500 dark:text-gray-500' : 'text-gray-400 dark:text-gray-600'}`}>
        {description}
      </p>
      {enabled && (
        <div className="space-y-4 transition-opacity opacity-100">
          {children}
        </div>
      )}
    </div>
  )
}

function CheckboxField({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: React.ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-gray-400 dark:border-gray-600 bg-gray-200 dark:bg-gray-800 text-indigo-500 focus:ring-indigo-500/50 focus:ring-offset-0 cursor-pointer"
      />
      <div>
        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{label}</span>
        {description ? <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{description}</p> : null}
      </div>
    </label>
  )
}

function SettingsField({
  label,
  hint,
  labelTitle,
  children
}: {
  label: string
  hint?: string
  labelTitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label title={labelTitle} className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
        {hint && <span className="ml-2 text-gray-500 dark:text-gray-500 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function SettingsArchitectureMultiSelect({
  values,
  onChange,
  userProfiles = [],
}: {
  values: string[]
  onChange: (next: string[]) => void
  userProfiles?: UserCaptureProfile[]
}) {
  const [open, setOpen] = useState(false)
  const allOptions = [
    ...TRAINER_ARCHITECTURES.map((id) => ({ id, name: id })),
    ...userProfiles.map((p) => ({ id: p.id, name: p.name })),
  ]
  const label =
    values.length === 0
      ? 'Choose profiles'
      : values.length === 1
        ? (allOptions.find((o) => o.id === values[0])?.name ?? values[0])
        : `${values.length} selected`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 px-3 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 flex items-center justify-between gap-3"
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {TRAINER_ARCHITECTURES.length > 0 && (
              <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Built-in</div>
            )}
            {TRAINER_ARCHITECTURES.map((option) => {
              const checked = values.includes(option)
              return (
                <label key={option} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-sm ${checked ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onChange([...values, option]); else onChange(values.filter((item) => item !== option)) }} className="accent-indigo-600" />
                  <span>{option}</span>
                </label>
              )
            })}
            {userProfiles.length > 0 && (
              <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 mt-1">Custom</div>
            )}
            {userProfiles.map((profile) => {
              const checked = values.includes(profile.id)
              return (
                <label key={profile.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-sm ${checked ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => { if (e.target.checked) onChange([...values, profile.id]); else onChange(values.filter((item) => item !== profile.id)) }} className="accent-indigo-600" />
                  <span>{profile.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


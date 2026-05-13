import { useState } from 'react'
import {
  AppSettings,
  DEFAULT_PACK_CHECKLIST_TEMPLATE,
  METADATA_SUGGEST_FIELD_OPTIONS,
  METADATA_SUGGEST_LOOKUP_VALUES,
  MetadataSuggestRule,
  MetadataSuggestMatchIn,
  MetadataSuggestMatchType,
  cloneChecklistTemplate,
} from '../types/settings'
import { MetadataSuggestRuleLibraryModal } from './MetadataSuggestRuleLibraryModal'
import { FilenameRecipeBuilderModal } from './FilenameRecipeBuilderModal'
import {
  cloneMetadataSuggestRule,
  isMetadataSuggestRuleLibraryCandidate,
  isMetadataSuggestRuleComplete,
  metadataSuggestRuleSignature,
} from '../utils/metadataSuggestRuleLibrary'

const PACK_DARK_ACCENT_PRESETS = [
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
  const [saved, setSaved] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [checklistTemplateOpen, setChecklistTemplateOpen] = useState(false)
  const [packCatalogOpen, setPackCatalogOpen] = useState(false)
  const [metadataSuggestOpen, setMetadataSuggestOpen] = useState(false)
  const [showRuleLibraryPicker, setShowRuleLibraryPicker] = useState(false)
  const [showRecipeBuilder, setShowRecipeBuilder] = useState(false)
  const [folderWatchesOpen, setFolderWatchesOpen] = useState(false)

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

  // Theme applies immediately without requiring Save
  const handleThemeChange = (theme: 'dark' | 'light') => {
    const updated = { ...draft, theme }
    setDraft(updated)
    onSave(updated)
    setSaved(false)
  }

  const handleSave = () => {
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

  const formatWatchPath = (path: string) => {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.length <= 4 ? normalized : `.../${parts.slice(-4).join('/')}`
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Defaults are applied when opening files that have empty fields.
          </p>
        </div>
        <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
        >
          Close
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 text-white"
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

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl space-y-8">

          {/* Appearance */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">🎨</span>
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

          {/* Capture Defaults */}
          <Section
            icon="🎚️"
            title="Capture Defaults"
            enabled={draft.enableCaptureDefaults}
            onToggle={(v) => update('enableCaptureDefaults', v)}
            description="Applied to files where the field is empty or null on open."
          >
            <SettingsField label="Default Modeled By" hint="Applied if file has no modeled_by value">
              <input
                type="text"
                value={draft.defaultModeledBy}
                onChange={(e) => update('defaultModeledBy', e.target.value)}
                disabled={!draft.enableCaptureDefaults}
                placeholder="e.g. Core Tone Captures"
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </SettingsField>
            <SettingsField label="Default Input Level (dBu)" hint="Applied if file has no input_level_dbu value">
              <input
                type="number"
                value={draft.defaultInputLevel}
                onChange={(e) => update('defaultInputLevel', e.target.value)}
                disabled={!draft.enableCaptureDefaults}
                placeholder="e.g. 12.5"
                step={0.5}
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </SettingsField>
            <SettingsField label="Default Output Level (dBu)" hint="Applied if file has no output_level_dbu value">
              <input
                type="number"
                value={draft.defaultOutputLevel}
                onChange={(e) => update('defaultOutputLevel', e.target.value)}
                disabled={!draft.enableCaptureDefaults}
                placeholder="e.g. -20"
                step={0.5}
                className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </SettingsField>
          </Section>

          {/* Behavior */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">⚙️</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Behavior</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Populate name from filename"
                description="When a file has no name, automatically set it to the filename (without .nam extension)."
                checked={draft.populateNameFromFilename}
                onChange={(v) => update('populateNameFromFilename', v)}
              />

              <CheckboxField
                label="Auto-detect tone type from filename"
                description={
                  <>
                    Scans the filename for tone keywords and sets Tone Type if empty.
                    When multiple keywords match, the <em>rightmost</em> one wins — so
                    &ldquo;Clean Crunch DI&rdquo; → <strong>Crunch</strong>.
                    Keywords: clean · crunch · lead/highgain/hi-gain · fuzz · overdrive/od/edge/drive · distortion/dist.
                  </>
                }
                checked={draft.autoDetectToneType}
                onChange={(v) => update('autoDetectToneType', v)}
              />

              <SettingsField label="Amp Suffix" hint="Filename endings that identify a capture as Amp type — comma separated">
                <div className="space-y-1">
                  <input
                    type="text"
                    value={draft.ampSuffix}
                    onChange={(e) => update('ampSuffix', e.target.value)}
                    placeholder="e.g. DI, DIR, DIRECT"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Leave blank to disable. Case-insensitive, spaces ignored.
                  </p>
                </div>
              </SettingsField>

              <CheckboxField
                label="Default to Cab if no amp suffix match"
                description="When a file has no gear type and the filename doesn't match the amp suffix, set it to Cab. Leave off to keep gear type blank."
                checked={draft.defaultToCab}
                onChange={(v) => update('defaultToCab', v)}
              />

              <SettingsField label="File Rename Template" hint="Used by the Rename button in the metadata editor">
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={draft.renameTemplate}
                    onChange={(e) => update('renameTemplate', e.target.value)}
                    placeholder="{name}  or  {gear_make} {gear_model} - {name}"
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Tokens: {'{name}'} {'{gear_make}'} {'{gear_model}'} {'{gear_type}'} {'{tone_type}'} {'{modeled_by}'}
                  </p>
                </div>
              </SettingsField>

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

          {/* Startup */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">🚀</span>
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

          {/* Library */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">📚</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Library</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="space-y-4">
              <CheckboxField
                label="Show NAM Lab metadata fields"
                description="Show and edit extended capture details (mics, cabinet, amp channel, settings, comments) in the metadata editor."
                checked={draft.showNamLabFields}
                onChange={(v) => update('showNamLabFields', v)}
              />
              <CheckboxField
                label="Show folder images"
                description="When a folder is selected with no captures chosen, display image files from that folder (and parent folders) in the right panel."
                checked={draft.showFolderImages}
                onChange={(v) => update('showFolderImages', v)}
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
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Comma-separated. When a row's last word matches one of these (case-insensitive), the app strips it and looks for captures whose name starts with the remainder. e.g. a "Friedman BE100 DI" row matches "Friedman BE100 Crunch" captures.
                  </p>
                </div>
              </SettingsField>
              <SettingsField label="Hidden Folders" hint="Folder names to exclude when scanning — subfolders are also excluded">
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

          {/* Pack Info Catalog */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">📦</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Pack Info Catalog</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Your personal gear library. Items saved here appear in the "From catalog" picker when editing a Pack Info sheet, so you never retype your standard rig.
            </p>
            <button
              onClick={() => setPackCatalogOpen((v) => !v)}
              className="mb-3 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <span>{packCatalogOpen ? 'Hide catalog items' : 'Edit catalog items'}</span>
              <span className="text-[10px] text-gray-400">{draft.packGearCatalog.length}</span>
            </button>
            {packCatalogOpen && (
            <div className="space-y-5">
              {(['equipment', 'pedals', 'glossary'] as const).map((cat) => {
                const items = draft.packGearCatalog.filter((i) => i.category === cat)
                const others = draft.packGearCatalog.filter((i) => i.category !== cat)
                const label = cat === 'glossary' ? 'Glossary' : cat === 'equipment' ? 'Equipment' : 'Pedals'
                const ph0 = cat === 'glossary' ? 'DI' : cat === 'equipment' ? 'Amp' : 'Boost'
                const ph1 = cat === 'glossary' ? 'Direct Inject — no cabinet' : cat === 'equipment' ? 'Friedman BE-100 Deluxe V2' : 'Klon Centaur (unity gain)'
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

          {/* Pack Export Logos */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">🖼️</span>
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
                        Choose…
                      </button>
                      {val && (
                        <button
                          onClick={() => update(key, '')}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove logo"
                        >
                          ✕ Clear
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Pack Checklist Template */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">✓</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Pack Checklist Template</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Default release steps used when a new Pack Checklist is created for a folder with Pack Info. Keep this collapsed if you rarely change it.
            </p>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setChecklistTemplateOpen((v) => !v)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <span>{checklistTemplateOpen ? 'Hide template steps' : 'Edit template steps'}</span>
                <span className="text-[10px] text-gray-400">{draft.packChecklistTemplate.length}</span>
              </button>
              <button
                onClick={() => update('packChecklistTemplate', cloneChecklistTemplate(DEFAULT_PACK_CHECKLIST_TEMPLATE))}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                title="Replace the checklist template with the current NAM Lab defaults"
              >
                Reset to current defaults
              </button>
            </div>
            {checklistTemplateOpen && (
              <div className="space-y-1.5 rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-900/30">
                {draft.packChecklistTemplate.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-1.5">
                    <div className="flex flex-col flex-shrink-0">
                      <button
                        onClick={() => {
                          if (i === 0) return
                          const next = [...draft.packChecklistTemplate]
                          ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                          update('packChecklistTemplate', next)
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
                          if (i === draft.packChecklistTemplate.length - 1) return
                          const next = [...draft.packChecklistTemplate]
                          ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
                          update('packChecklistTemplate', next)
                        }}
                        disabled={i === draft.packChecklistTemplate.length - 1}
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
                        const next = draft.packChecklistTemplate.map((step, idx) =>
                          idx === i ? { ...step, label: e.target.value } : step
                        )
                        update('packChecklistTemplate', next)
                      }}
                      placeholder="Checklist step"
                      className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => update('packChecklistTemplate', draft.packChecklistTemplate.filter((_, idx) => idx !== i))}
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
                  onClick={() => update('packChecklistTemplate', [...draft.packChecklistTemplate, { id: `step-${Date.now()}`, label: '' }])}
                  className="pt-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
                >
                  + Add checklist step
                </button>
              </div>
            )}
          </div>

          {/* Current Amp Info */}
          <Section
            icon="🔊"
            title="Current Amp Info"
            enabled={draft.enableAmpInfo}
            onToggle={(v) => update('enableAmpInfo', v)}
            description="Sets a default Manufacturer and Model on any file that has those fields empty when opened. Best used when working on a batch of captures for a single amp — e.g. tagging an entire session before sharing. Disable this when browsing a large shared library, or you may unintentionally stamp your amp info onto captures from other artists."
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

          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Tags</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Metadata Suggestions</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Folder right-click -&gt; <strong>Suggest metadata…</strong> previews token-based suggestions for blank fields only. Built-in hints currently cover tone type detection from filename and DI/direct naming -&gt; amp gear type. Add your own global rules below for things like maker/model/cabinet naming. Folder-scoped rules can be edited from the folder tree and will override matching global token meanings inside that subtree.
            </p>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setMetadataSuggestOpen((v) => !v)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <span>{metadataSuggestOpen ? 'Hide suggestion rules' : 'Edit suggestion rules'}</span>
                  <span className="text-[10px] text-gray-400">{draft.metadataSuggestRules.filter((rule) => rule.enabled).length}</span>
                </button>
              <button
                onClick={() => setShowRuleLibraryPicker(true)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              >
                Add from library…
                <span className="text-[10px] text-violet-500/80">{draft.metadataSuggestRuleLibrary.length}</span>
              </button>
              <button
                onClick={() => setShowRecipeBuilder(true)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
              >
                Build from example…
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
                            <option value="">Pick value…</option>
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

          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">Watch</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Folder Watches</h3>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Destination folders in NAM Lab can watch a source folder and automatically copy in new top-level <code>.nam</code> files.
            </p>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setFolderWatchesOpen((v) => !v)}
                className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <span>{folderWatchesOpen ? 'Hide folder watches' : 'Show folder watches'}</span>
                <span className="text-[10px] text-gray-400">{draft.folderWatchRules.filter((rule) => rule.enabled).length}</span>
              </button>
            </div>
            {folderWatchesOpen && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-900/30">
                {draft.folderWatchRules.filter((rule) => rule.enabled).length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-500">No folder watches configured yet.</p>
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

        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
        {/* Updates row */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleCheckForUpdates}
            disabled={updateState.status === 'checking'}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex-shrink-0"
          >
            {updateState.status === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>
          {updateState.status === 'idle' && (
            <span className="text-xs text-gray-500 dark:text-gray-600">v{import.meta.env.VITE_APP_VERSION}</span>
          )}
          {updateState.status === 'up-to-date' && (
            <span className="text-xs text-green-600 dark:text-green-400">✓ You're up to date (v{updateState.version})</span>
          )}
          {updateState.status === 'available' && (
            <span className="text-xs text-amber-500 dark:text-amber-400">
              v{updateState.version} is available —{' '}
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
        {/* NAM Standalone row */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
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
            Browse…
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
              title="Open the startup log folder — useful for reporting issues"
            >
              Open Log
            </button>
            <div className="text-xs text-gray-500 dark:text-gray-600">NAM Lab</div>
          </div>
        </div>
      </div>
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
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{description}</p>
      </div>
    </label>
  )
}

function SettingsField({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
        {hint && <span className="ml-2 text-gray-500 dark:text-gray-500 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

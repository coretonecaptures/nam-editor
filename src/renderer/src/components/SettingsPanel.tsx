import { useState } from 'react'
import { AppSettings } from '../types/settings'

interface SettingsPanelProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onSave, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings })
  const [saved, setSaved] = useState(false)

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
    onSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={draft.ampSuffix}
                    onChange={(e) => update('ampSuffix', e.target.value)}
                    placeholder="e.g. DI, DIR, DIRECT"
                    className="w-52 px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
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
                    label="Skip Save All confirmation"
                    description="Don't ask before saving all unsaved files via right-click folder actions. The toolbar Save All always confirms — it affects all loaded folders and cannot be skipped."
                    checked={draft.skipSaveAllConfirmation}
                    onChange={(v) => update('skipSaveAllConfirmation', v)}
                  />
                  <CheckboxField
                    label="Skip Batch Edit confirmation"
                    description="Don't ask before applying batch edits."
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

        </div>
      </div>

      {/* About footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
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
      <div className={`space-y-4 transition-opacity ${enabled ? 'opacity-100' : 'opacity-40'}`}>
        {children}
      </div>
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

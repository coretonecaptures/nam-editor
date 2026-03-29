import { useState } from 'react'
import { AppSettings } from '../types/settings'

interface SettingsPanelProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
}

export function SettingsPanel({ settings, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings })
  const [saved, setSaved] = useState(false)

  const update = (key: keyof AppSettings, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = () => {
    onSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Settings</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Defaults are applied when opening files that have empty fields.
          </p>
        </div>
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

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl space-y-8">

          {/* Capture Defaults */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm">🎚️</span>
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Capture Defaults</h3>
              <div className="flex-1 h-px bg-gray-800" />
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Applied to files where the field is empty or null on open.
            </p>
            <div className="space-y-4">
              <SettingsField label="Default Modeled By" hint="Applied if file has no modeled_by value">
                <input
                  type="text"
                  value={draft.defaultModeledBy}
                  onChange={(e) => update('defaultModeledBy', e.target.value)}
                  placeholder="e.g. Core Tone Captures"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                />
              </SettingsField>
              <SettingsField label="Default Input Level (dBu)" hint="Applied if file has no input_level_dbu value">
                <input
                  type="number"
                  value={draft.defaultInputLevel}
                  onChange={(e) => update('defaultInputLevel', e.target.value)}
                  placeholder="e.g. 12.5"
                  step={0.5}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                />
              </SettingsField>
            </div>
          </div>

          {/* Current Amp Info */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm">🔊</span>
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Current Amp Info</h3>
              <div className="flex-1 h-px bg-gray-800" />
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Applied to files where Manufacturer and/or Model are empty on open.
            </p>
            <div className="space-y-4">
              <SettingsField label="Manufacturer" hint="Applied if file has no gear_make value">
                <input
                  type="text"
                  value={draft.defaultManufacturer}
                  onChange={(e) => update('defaultManufacturer', e.target.value)}
                  placeholder="e.g. Friedman"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                />
              </SettingsField>
              <SettingsField label="Model" hint="Applied if file has no gear_model value">
                <input
                  type="text"
                  value={draft.defaultModel}
                  onChange={(e) => update('defaultModel', e.target.value)}
                  placeholder="e.g. BE100 Deluxe"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                />
              </SettingsField>
            </div>
          </div>

          {/* Gear type auto-detect note */}
          <div className="px-4 py-3 bg-gray-800/50 rounded-lg border border-gray-800 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-400">Automatic Gear Type Detection</p>
            <p>When a file has no gear type set:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Filename ends in <span className="text-gray-300 font-mono">DI</span> → sets Gear Type to <span className="text-gray-300">Amp</span></li>
              <li>Otherwise → sets Gear Type to <span className="text-gray-300">Cab</span></li>
            </ul>
          </div>

        </div>
      </div>
    </div>
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
      <label className="block text-xs font-medium text-gray-400 mb-1.5">
        {label}
        {hint && <span className="ml-2 text-gray-600 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

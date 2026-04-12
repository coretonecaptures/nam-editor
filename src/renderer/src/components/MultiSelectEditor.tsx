import { useState, useMemo } from 'react'
import { NamFile, NamMetadata, GEAR_TYPES, TONE_TYPES } from '../types/nam'
import { ComboInput } from './ComboInput'

interface MultiSelectEditorProps {
  files: NamFile[]
  onApply: (filePaths: string[], fields: Partial<NamMetadata>, options?: { revertToFilename?: boolean }) => void
  skipConfirmation?: boolean
  gearMakeSuggestions?: string[]
  gearModelSuggestions?: string[]
}

type FieldDef = {
  key: keyof NamMetadata
  label: string
  type: 'text' | 'number' | 'select'
  options?: readonly string[]
  placeholder?: string
}

const FIELDS: FieldDef[] = [
  { key: 'modeled_by',       label: 'Modeled By',        type: 'text',   placeholder: 'e.g. Core Tone Captures' },
  { key: 'gear_type',        label: 'Gear Type',          type: 'select', options: GEAR_TYPES },
  { key: 'tone_type',        label: 'Tone Type',          type: 'select', options: TONE_TYPES },
  { key: 'gear_make',        label: 'Manufacturer',       type: 'text',   placeholder: 'e.g. Friedman' },
  { key: 'gear_model',       label: 'Model',              type: 'text',   placeholder: 'e.g. BE100 Deluxe' },
  { key: 'input_level_dbu',    label: 'Reamp Send (dBu)',   type: 'number', placeholder: 'e.g. 12.5' },
  { key: 'output_level_dbu',   label: 'Reamp Return (dBu)', type: 'number', placeholder: 'e.g. 12.5' },
  { key: 'nb_trained_epochs',  label: 'Trained Epochs',     type: 'number', placeholder: 'e.g. 1000' },
]

const NL_FIELDS: FieldDef[] = [
  { key: 'nl_mics',          label: 'Microphone(s)',      type: 'text', placeholder: 'e.g. SM57' },
  { key: 'nl_amp_channel',   label: 'Amp Channel',        type: 'text', placeholder: 'e.g. Lead' },
  { key: 'nl_cabinet',       label: 'Cabinet',            type: 'text', placeholder: 'e.g. Marshall 1960A' },
  { key: 'nl_cabinet_config',label: 'Cabinet Config',     type: 'text', placeholder: 'e.g. 4x12' },
  { key: 'nl_amp_settings',  label: 'Amp Settings',       type: 'text', placeholder: 'e.g. Gain 7, Bass 5' },
  { key: 'nl_boost_pedal',   label: 'Boost Pedal',        type: 'text', placeholder: 'e.g. Klon Centaur' },
  { key: 'nl_pedal_settings',label: 'Pedal Settings',     type: 'text', placeholder: 'e.g. TS9 — Drive 5' },
  { key: 'nl_amp_switches',  label: 'Amp Switches',       type: 'text', placeholder: 'e.g. Bright on, Fat off' },
  { key: 'nl_comments',      label: 'Comments',           type: 'text', placeholder: 'Any notes…' },
]

const ALL_FIELDS = [...FIELDS, ...NL_FIELDS]

function getShared(files: NamFile[], key: keyof NamMetadata): { same: boolean; value: string | number | null } {
  const vals = files.map((f) => f.metadata[key] ?? null)
  const first = vals[0]
  const same = vals.every((v) => v === first)
  return { same, value: same ? (first as string | number | null) : null }
}

export function MultiSelectEditor({ files, onApply, skipConfirmation, gearMakeSuggestions = [], gearModelSuggestions = [] }: MultiSelectEditorProps) {
  // Compute shared values once per file set
  const shared = useMemo(
    () => Object.fromEntries(ALL_FIELDS.map((f) => [f.key, getShared(files, f.key)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files.map((f) => f.filePath).join(','), files.map((f) => JSON.stringify(f.metadata)).join('|')]
  )

  // Edits: start from shared values (pre-fill where all agree)
  const [edits, setEdits] = useState<Record<string, string | number | null>>(() =>
    Object.fromEntries(ALL_FIELDS.map((f) => [f.key, shared[f.key].value ?? '']))
  )
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const [revertToFilename, setRevertToFilename] = useState(false)

  const update = (key: string, value: string | number | null) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
    setChanged((prev) => new Set(prev).add(key))
  }

  const canApply = changed.size > 0 || revertToFilename

  const handleApply = () => {
    if (!canApply) return

    if (!skipConfirmation) {
      const parts: string[] = []
      if (revertToFilename) parts.push('Revert Name to filename')
      if (changed.size > 0) {
        const fieldNames = [...changed].map((k) => FIELDS.find((f) => f.key === k)?.label ?? k).join(', ')
        parts.push(`${changed.size} field${changed.size !== 1 ? 's' : ''}: ${fieldNames}`)
      }
      const confirmed = window.confirm(
        `Apply to ${files.length} selected file${files.length !== 1 ? 's' : ''}:\n  · ${parts.join('\n  · ')}\n\nThis will write changes directly to the .nam files on disk.`
      )
      if (!confirmed) return
    }

    const fields: Partial<NamMetadata> = {}
    for (const key of changed) {
      const val = edits[key]
      ;(fields as Record<string, unknown>)[key] = val === '' ? null : val
    }
    onApply(files.map((f) => f.filePath), fields, { revertToFilename })
    setChanged(new Set())
    setRevertToFilename(false)
  }

  const inputBase = 'w-full px-3 py-1.5 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 transition-colors'
  const inputChanged = 'border-amber-500/60 bg-amber-50 dark:bg-amber-900/10'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-indigo-400">{files.length}</span>
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {files.length} files selected
            </h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 ml-10">
            Edit fields below — <span className="text-amber-400">amber</span> = changed · <span className="text-indigo-400">indigo badge</span> = all files share this value
          </p>
        </div>
        <button
          onClick={handleApply}
          disabled={!canApply}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          Apply to {files.length} files
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl space-y-3">

          {/* Revert to filename option */}
          <div className="flex items-center gap-3 pb-3 mb-1 border-b border-gray-200 dark:border-gray-800">
            <input
              type="checkbox"
              id="ms-revert-filename"
              checked={revertToFilename}
              onChange={() => setRevertToFilename((v) => !v)}
              className="w-4 h-4 rounded border-gray-400 dark:border-gray-600 bg-gray-200 dark:bg-gray-800 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer flex-shrink-0"
            />
            <label htmlFor="ms-revert-filename" className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <span className="font-medium">Revert Capture Name to filename</span>
              <span className="text-gray-400 dark:text-gray-600"> — sets each file's name to its own filename</span>
            </label>
          </div>

          {renderMsFields(FIELDS, shared, edits, changed, update, inputBase, inputChanged, gearMakeSuggestions, gearModelSuggestions)}

          {/* Capture Details section */}
          <div className="flex items-center gap-2 pt-4 pb-1">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Capture Details</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          </div>
          {renderMsFields(NL_FIELDS, shared, edits, changed, update, inputBase, inputChanged, [], [])}
        </div>
      </div>
    </div>
  )
}

function renderMsFields(
  fieldList: FieldDef[],
  shared: Record<string, { same: boolean; value: string | number | null }>,
  edits: Record<string, string | number | null>,
  changed: Set<string>,
  update: (key: string, value: string | number | null) => void,
  inputBase: string,
  inputChanged: string,
  gearMakeSuggestions: string[],
  gearModelSuggestions: string[]
) {
  return fieldList.map(({ key, label, type, options, placeholder }) => {
    const { same } = shared[key] ?? { same: false }
    const isChanged = changed.has(key)
    const val = edits[key]
    return (
      <div key={key} className="flex items-center gap-3">
        <div className="w-36 flex-shrink-0">
          <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
          {same && !isChanged && (
            <span className="ml-1.5 text-xs px-1 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">shared</span>
          )}
        </div>
        <div className="flex-1">
          {type === 'select' && options ? (
            <select
              value={(val as string) ?? ''}
              onChange={(e) => update(key, e.target.value)}
              className={`${inputBase} appearance-none cursor-pointer ${isChanged ? inputChanged : ''}`}
            >
              {['', ...options].map((o) => (
                <option key={o} value={o} className="bg-gray-200 dark:bg-gray-800">
                  {o === '' ? (same ? '— not set —' : '— varies —') : o}
                </option>
              ))}
            </select>
          ) : type === 'number' ? (
            <input
              type="number"
              value={val ?? ''}
              onChange={(e) => update(key, e.target.value === '' ? null : parseFloat(e.target.value))}
              placeholder={same ? (placeholder ?? '') : '— varies —'}
              step={0.5}
              className={`${inputBase} ${isChanged ? inputChanged : ''}`}
            />
          ) : (
            <ComboInput
              value={(val as string) ?? ''}
              onChange={(v) => update(key, v)}
              suggestions={key === 'gear_make' ? gearMakeSuggestions : key === 'gear_model' ? gearModelSuggestions : []}
              placeholder={same ? (placeholder ?? '') : '— varies —'}
              className={`${inputBase} ${isChanged ? inputChanged : ''}`}
            />
          )}
        </div>
      </div>
    )
  })
}

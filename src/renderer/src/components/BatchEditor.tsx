import { useState } from 'react'
import { NamMetadata, GEAR_TYPES, TONE_TYPES } from '../types/nam'

interface BatchEditorProps {
  selectedCount: number
  onApply: (metadata: Partial<NamMetadata>) => void
}

export function BatchEditor({ selectedCount, onApply }: BatchEditorProps) {
  const [fields, setFields] = useState<Partial<NamMetadata>>({})
  const [enabled, setEnabled] = useState<Set<keyof NamMetadata>>(new Set())

  const toggle = (key: keyof NamMetadata) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const update = (key: keyof NamMetadata, value: unknown) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  const handleApply = () => {
    const toApply: Partial<NamMetadata> = {}
    for (const key of enabled) {
      ;(toApply as Record<string, unknown>)[key] = (fields as Record<string, unknown>)[key] ?? null
    }
    onApply(toApply)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Batch Edit</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Apply changes to {selectedCount} file{selectedCount !== 1 ? 's' : ''}.{' '}
            <span className="text-amber-400">Check fields to include them.</span>
          </p>
        </div>
        <button
          onClick={handleApply}
          disabled={enabled.size === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 text-white"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          Apply to {selectedCount} file{selectedCount !== 1 ? 's' : ''}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs text-gray-600 mb-4">
            Only checked fields will be written. Empty values will set the field to null in the file.
          </p>

          {batchFields.map(({ key, label, type, options, placeholder }) => (
            <div key={key} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={enabled.has(key)}
                onChange={() => toggle(key)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer flex-shrink-0"
              />
              <label className="w-32 text-sm text-gray-400 flex-shrink-0">{label}</label>
              <div className="flex-1">
                {type === 'select' && options ? (
                  <select
                    disabled={!enabled.has(key)}
                    value={(fields[key] as string) ?? ''}
                    onChange={(e) => update(key, e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {['', ...options].map((o) => (
                      <option key={o} value={o} className="bg-gray-800">
                        {o === '' ? '— not set —' : o}
                      </option>
                    ))}
                  </select>
                ) : type === 'number' ? (
                  <input
                    type="number"
                    disabled={!enabled.has(key)}
                    value={(fields[key] as number) ?? ''}
                    onChange={(e) => update(key, e.target.value === '' ? null : parseFloat(e.target.value))}
                    placeholder={placeholder}
                    step={0.5}
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  />
                ) : (
                  <input
                    type="text"
                    disabled={!enabled.has(key)}
                    value={(fields[key] as string) ?? ''}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const batchFields: Array<{
  key: keyof NamMetadata
  label: string
  type: 'text' | 'number' | 'select'
  options?: readonly string[]
  placeholder?: string
}> = [
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Capture name' },
  { key: 'modeled_by', label: 'Modeled By', type: 'text', placeholder: 'Creator name' },
  { key: 'gear_type', label: 'Gear Type', type: 'select', options: GEAR_TYPES },
  { key: 'gear_make', label: 'Manufacturer', type: 'text', placeholder: 'e.g. Friedman' },
  { key: 'gear_model', label: 'Model', type: 'text', placeholder: 'e.g. BE100 Deluxe' },
  { key: 'tone_type', label: 'Tone Type', type: 'select', options: TONE_TYPES },
  { key: 'input_level_dbu', label: 'Input (dBu)', type: 'number', placeholder: 'e.g. 12.5' },
  { key: 'output_level_dbu', label: 'Output (dBu)', type: 'number', placeholder: 'e.g. 12.5' }
]

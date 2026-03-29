import { NamFile, NamMetadata, GEAR_TYPES, TONE_TYPES } from '../types/nam'

interface MetadataEditorProps {
  file: NamFile
  onChange: (metadata: NamMetadata) => void
  onSave: () => void
}

export function MetadataEditor({ file, onChange, onSave }: MetadataEditorProps) {
  const m = file.metadata

  const update = (key: keyof NamMetadata, value: unknown) => {
    onChange({ ...m, [key]: value === '' ? null : value })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      onSave()
    }
  }

  const dateStr = m.date
    ? `${m.date.year}-${String(m.date.month).padStart(2, '0')}-${String(m.date.day).padStart(2, '0')}`
    : ''

  return (
    <div className="flex flex-col h-full overflow-hidden" onKeyDown={handleKeyDown}>
      {/* File header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-100 truncate max-w-lg">
            {m.name || file.fileName}
          </h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-gray-500">{file.filePath}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-600">v{file.version}</span>
            <span className="text-xs text-gray-600">·</span>
            <span className="text-xs text-gray-600">{file.architecture}</span>
            {m.loudness != null && (
              <>
                <span className="text-xs text-gray-600">·</span>
                <span className="text-xs text-gray-600">loudness: {m.loudness.toFixed(2)} dBFS</span>
              </>
            )}
            {m.training && (m.training as Record<string, unknown>).validation_esr != null && (
              <>
                <span className="text-xs text-gray-600">·</span>
                <span className="text-xs text-gray-600">
                  ESR: {((m.training as Record<string, unknown>).validation_esr as number).toFixed(6)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {file.isDirty && (
            <span className="text-xs text-amber-400 font-medium">Unsaved</span>
          )}
          <button
            onClick={onSave}
            disabled={!file.isDirty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl space-y-6">

          {/* Identity section */}
          <Section title="Identity" icon="🎸">
            <Field label="Capture Name" hint="Display name shown in plugins">
              <TextInput
                value={m.name ?? ''}
                onChange={(v) => update('name', v)}
                placeholder="e.g. BE100 Deluxe - Crunch Ch."
              />
            </Field>
            <Field label="Modeled By" hint="Creator / capture artist">
              <TextInput
                value={m.modeled_by ?? ''}
                onChange={(v) => update('modeled_by', v)}
                placeholder="e.g. Core Tone Captures"
              />
            </Field>
          </Section>

          {/* Gear section */}
          <Section title="Gear" icon="🔊">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Gear Type">
                <Select
                  value={m.gear_type ?? ''}
                  options={['', ...GEAR_TYPES]}
                  onChange={(v) => update('gear_type', v)}
                />
              </Field>
              <Field label="Tone Type">
                <Select
                  value={m.tone_type ?? ''}
                  options={['', ...TONE_TYPES]}
                  onChange={(v) => update('tone_type', v)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Manufacturer">
                <TextInput
                  value={m.gear_make ?? ''}
                  onChange={(v) => update('gear_make', v)}
                  placeholder="e.g. Friedman"
                />
              </Field>
              <Field label="Model">
                <TextInput
                  value={m.gear_model ?? ''}
                  onChange={(v) => update('gear_model', v)}
                  placeholder="e.g. BE100 Deluxe"
                />
              </Field>
            </div>
          </Section>

          {/* Levels section */}
          <Section title="Levels" icon="📊">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Input Level (dBu)" hint="Signal level at capture input">
                <NumberInput
                  value={m.input_level_dbu ?? ''}
                  onChange={(v) => update('input_level_dbu', v)}
                  placeholder="e.g. 12.5"
                  step={0.5}
                />
              </Field>
              <Field label="Output Level (dBu)" hint="Signal level at capture output">
                <NumberInput
                  value={m.output_level_dbu ?? ''}
                  onChange={(v) => update('output_level_dbu', v)}
                  placeholder="e.g. 12.5"
                  step={0.5}
                />
              </Field>
            </div>
          </Section>

          {/* Read-only stats */}
          <Section title="Capture Stats" icon="📈">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Architecture" value={file.architecture} />
              <StatCard label="NAM Version" value={file.version} />
              {m.loudness != null && (
                <StatCard label="Integrated Loudness" value={`${m.loudness.toFixed(2)} dBFS`} />
              )}
              {m.gain != null && (
                <StatCard label="Gain Factor" value={m.gain.toFixed(4)} />
              )}
              {(m.training as Record<string, unknown>)?.validation_esr != null && (
                <StatCard
                  label="Validation ESR"
                  value={((m.training as Record<string, unknown>).validation_esr as number).toFixed(6)}
                  good={((m.training as Record<string, unknown>).validation_esr as number) < 0.01}
                />
              )}
              {(() => {
                const t = m.training as Record<string, unknown> | undefined
                const epochs =
                  t?.epoch ?? t?.num_epochs ?? t?.epochs ??
                  (t?.settings as Record<string, unknown> | undefined)?.epochs ??
                  (t?.settings as Record<string, unknown> | undefined)?.num_epochs
                return epochs != null ? (
                  <StatCard label="Epochs" value={String(epochs)} />
                ) : null
              })()}
              {dateStr && <StatCard label="Captured On" value={dateStr} />}
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}

// ---- UI primitives ----

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{title}</h3>
        <div className="flex-1 h-px bg-gray-800" />
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({
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

function TextInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
    />
  )
}

function NumberInput({
  value,
  onChange,
  placeholder,
  step
}: {
  value: string | number
  onChange: (v: number | null) => void
  placeholder?: string
  step?: number
}) {
  return (
    <input
      type="number"
      value={value === null || value === undefined ? '' : value}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === '' ? null : parseFloat(v))
      }}
      placeholder={placeholder}
      step={step}
      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
    />
  )
}

function Select({
  value,
  options,
  onChange
}: {
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-gray-800">
          {o === '' ? '— not set —' : o}
        </option>
      ))}
    </select>
  )
}

function StatCard({
  label,
  value,
  good
}: {
  label: string
  value: string | number
  good?: boolean
}) {
  return (
    <div className="px-3 py-2.5 bg-gray-800/50 rounded-lg border border-gray-800">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-medium ${good === true ? 'text-green-400' : good === false ? 'text-amber-400' : 'text-gray-300'}`}>
        {value}
      </div>
    </div>
  )
}

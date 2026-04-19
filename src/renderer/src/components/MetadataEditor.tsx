import { useState, useRef, useLayoutEffect, useEffect } from 'react'

// Survives component remounts (caused by key={filePath} in App.tsx)
let sharedScrollTop = 0
import { NamFile, NamMetadata, GEAR_TYPES, TONE_TYPES } from '../types/nam'
import { gearImages } from '../assets/gear'
import { detectPreset } from '../utils/detectPreset'
import { ComboInput } from './ComboInput'

interface MetadataEditorProps {
  file: NamFile
  onChange: (metadata: NamMetadata) => void
  onSave: () => void
  onRevert: () => void
  onRevealInFinder: () => void
  onReapplyDefaults?: () => void
  hasActiveDefaults?: boolean
  renameTemplate?: string
  onRenameFile?: (filePath: string, newBaseName: string) => Promise<void>
  onSaveAndAdvance?: () => void
  gearMakeSuggestions?: string[]
  gearModelSuggestions?: string[]
  showNamLabFields?: boolean
}

type NlKey = 'nl_mics' | 'nl_amp_channel' | 'nl_cabinet' | 'nl_cabinet_config' |
             'nl_amp_settings' | 'nl_boost_pedal' | 'nl_pedal_settings' | 'nl_amp_switches' | 'nl_comments'

// Fields relevant to each gear type. nl_comments always shown regardless.
const NL_RELEVANT: Record<string, NlKey[]> = {
  amp:          ['nl_amp_channel', 'nl_amp_settings', 'nl_amp_switches', 'nl_comments'],
  pedal:        ['nl_boost_pedal', 'nl_pedal_settings', 'nl_comments'],
  pedal_amp:    ['nl_amp_channel', 'nl_amp_settings', 'nl_amp_switches', 'nl_boost_pedal', 'nl_pedal_settings', 'nl_comments'],
  amp_cab:      ['nl_mics', 'nl_amp_channel', 'nl_cabinet', 'nl_cabinet_config', 'nl_amp_settings', 'nl_amp_switches', 'nl_comments'],
  amp_pedal_cab:['nl_mics', 'nl_amp_channel', 'nl_cabinet', 'nl_cabinet_config', 'nl_amp_settings', 'nl_amp_switches', 'nl_boost_pedal', 'nl_pedal_settings', 'nl_comments'],
  preamp:       ['nl_amp_channel', 'nl_amp_settings', 'nl_amp_switches', 'nl_comments'],
  studio:       ['nl_comments'],
}

const NL_ALL: NlKey[] = [
  'nl_mics', 'nl_amp_channel', 'nl_cabinet', 'nl_cabinet_config',
  'nl_amp_settings', 'nl_boost_pedal', 'nl_pedal_settings', 'nl_amp_switches', 'nl_comments',
]

function buildRenamePreview(template: string, meta: NamMetadata, fileName: string): string {
  const result = template
    .replace(/\{name\}/g, meta.name || fileName)
    .replace(/\{gear_make\}/g, meta.gear_make || '')
    .replace(/\{gear_model\}/g, meta.gear_model || '')
    .replace(/\{gear_type\}/g, meta.gear_type || '')
    .replace(/\{tone_type\}/g, meta.tone_type || '')
    .replace(/\{modeled_by\}/g, meta.modeled_by || '')
    // Sanitize characters invalid in filenames
    .replace(/[/\\:*?"<>|]/g, '_')
    // Collapse multiple spaces/underscores and trim
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s._]+|[\s._]+$/g, '')
  return result || fileName
}

export function MetadataEditor({ file, onChange, onSave, onRevert, onRevealInFinder, onReapplyDefaults, hasActiveDefaults, renameTemplate, onRenameFile, onSaveAndAdvance, gearMakeSuggestions = [], gearModelSuggestions = [], showNamLabFields = true }: MetadataEditorProps) {
  const m = file.metadata
  const orig = file.originalMetadata
  const [nlShowAll, setNlShowAll] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameEditValue, setNameEditValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = sharedScrollTop
  }, [file.filePath])

  const update = (key: keyof NamMetadata, value: unknown) => {
    onChange({ ...m, [key]: value === '' ? null : value })
  }

  // Returns true if this field was auto-filled by settings rules at load time
  const isAutoFilled = (key: keyof NamMetadata): boolean =>
    file.autoFilledFields.includes(key)

  // Returns true if this field was manually changed (differs from disk, but not auto-filled)
  const isManuallyChanged = (key: keyof NamMetadata): boolean => {
    const cur = m[key] ?? null
    const was = orig[key] ?? null
    return cur !== was && !isAutoFilled(key)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      onSave()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onSaveAndAdvance?.()
    }
  }

  const commitNameEdit = () => {
    update('name', nameEditValue)
    setIsEditingName(false)
  }

  const startNameEdit = () => {
    setNameEditValue(m.name ?? '')
    setIsEditingName(true)
    setTimeout(() => { nameInputRef.current?.select() }, 20)
  }

  const dateStr = m.date
    ? `${m.date.year}-${String(m.date.month).padStart(2, '0')}-${String(m.date.day).padStart(2, '0')}`
    : ''

  return (
    <div className="flex flex-col h-full overflow-hidden" onKeyDown={handleKeyDown}>
      {/* File header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <div className="min-w-0">
            {isEditingName ? (
              <input
                ref={nameInputRef}
                value={nameEditValue}
                onChange={(e) => setNameEditValue(e.target.value)}
                onBlur={commitNameEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitNameEdit() }
                  if (e.key === 'Escape') { setIsEditingName(false) }
                  e.stopPropagation()
                }}
                className="text-base font-semibold text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 outline-none w-full max-w-lg"
              />
            ) : (
              <h2
                className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate max-w-lg cursor-text select-none"
                onDoubleClick={startNameEdit}
                title="Double-click to edit capture name"
              >
                {m.name || file.fileName}
              </h2>
            )}
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={onRevealInFinder}
                className="text-xs text-gray-500 dark:text-gray-500 hover:text-indigo-400 transition-colors truncate max-w-lg text-left"
                title="Reveal in Finder / Explorer"
              >
                {file.filePath}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-400 dark:text-gray-600">v{file.version}</span>
              <span className="text-xs text-gray-400 dark:text-gray-600">·</span>
              <span className="text-xs text-gray-400 dark:text-gray-600">{file.architecture}</span>
              {m.loudness != null && (
                <>
                  <span className="text-xs text-gray-400 dark:text-gray-600">·</span>
                  <span className="text-xs text-gray-400 dark:text-gray-600">loudness: {m.loudness.toFixed(2)} dBFS</span>
                </>
              )}
              {!!m.training && (m.training as Record<string, unknown>).validation_esr != null && (
                <>
                  <span className="text-xs text-gray-400 dark:text-gray-600">·</span>
                  <span className="text-xs text-gray-400 dark:text-gray-600">
                    ESR: {((m.training as Record<string, unknown>).validation_esr as number).toFixed(6)}
                  </span>
                </>
              )}
            </div>
          </div>
          {m.gear_type && gearImages[m.gear_type] && (
            <GearImage gearType={m.gear_type} size="header" />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {file.isDirty && (
            <span className="text-xs text-amber-400 font-medium">Unsaved</span>
          )}
          {onRenameFile && renameTemplate && (
            <button
              onClick={() => {
                const newBaseName = buildRenamePreview(renameTemplate, m, file.fileName)
                const confirmed = window.confirm(
                  `Rename file?\n\nFrom: ${file.fileName}.nam\nTo:   ${newBaseName}.nam`
                )
                if (confirmed) onRenameFile(file.filePath, newBaseName)
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-300 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 whitespace-nowrap"
              title={`Rename to: ${buildRenamePreview(renameTemplate, m, file.fileName)}.nam`}
            >
              Rename
            </button>
          )}
          {hasActiveDefaults && onReapplyDefaults && (
            <button
              onClick={onReapplyDefaults}
              className="flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap"
              title="Re-apply auto-fill rules from Settings to empty fields"
            >
              ↺ Defaults
            </button>
          )}
          <button
            onClick={onRevert}
            disabled={!file.isDirty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-gray-300 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            title="Discard changes and revert to saved values"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Revert
          </button>
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5" onScroll={(e) => { sharedScrollTop = (e.currentTarget as HTMLDivElement).scrollTop }}>
        <div className="max-w-2xl space-y-6">

          {/* Identity section */}
          <Section title="Identity" icon={
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {/* Dog tag / ID label */}
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 2h6a1 1 0 011 1v1a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v2" />
              <rect x="4" y="7" width="16" height="14" rx="2" strokeWidth={1.5} />
              <line x1="8" y1="12" x2="16" y2="12" strokeWidth={1.5} strokeLinecap="round" />
              <line x1="8" y1="15" x2="13" y2="15" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          }>
            <Field label="Capture Name" hint="Display name shown in plugins" autoFilled={isAutoFilled('name')}>
              <div className="flex items-center gap-2">
                <TextInput
                  value={m.name ?? ''}
                  onChange={(v) => update('name', v)}
                  placeholder="e.g. BE100 Deluxe - Crunch Ch."
                  changed={isManuallyChanged('name')}
                  autoFilled={isAutoFilled('name')}
                />
                <button
                  type="button"
                  onClick={() => update('name', file.fileName.replace(/\.nam$/i, ''))}
                  title="Revert to filename"
                  className="flex-shrink-0 px-2 py-2 rounded-lg text-xs font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap"
                >
                  ↺ filename
                </button>
              </div>
            </Field>
            <Field label="Modeled By" hint="Creator / capture artist" autoFilled={isAutoFilled('modeled_by')}>
              <TextInput
                value={m.modeled_by ?? ''}
                onChange={(v) => update('modeled_by', v)}
                placeholder="e.g. Core Tone Captures"
                changed={isManuallyChanged('modeled_by')}
                autoFilled={isAutoFilled('modeled_by')}
              />
            </Field>
          </Section>

          {/* Gear section */}
          <Section title="Gear" icon={
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {/* Amp head */}
              <rect x="2" y="4" width="20" height="6" rx="1" strokeWidth={1.5} />
              <circle cx="7" cy="7" r="1" strokeWidth={1.5} />
              <circle cx="12" cy="7" r="1" strokeWidth={1.5} />
              <circle cx="17" cy="7" r="1" strokeWidth={1.5} />
              <rect x="2" y="10" width="20" height="10" rx="1" strokeWidth={1.5} />
              <rect x="5" y="13" width="14" height="4" rx="0.5" strokeWidth={1.5} />
              <line x1="9" y1="13" x2="9" y2="17" strokeWidth={1} />
              <line x1="13" y1="13" x2="13" y2="17" strokeWidth={1} />
            </svg>
          }>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Gear Type" autoFilled={isAutoFilled('gear_type')}>
                <Select
                  value={m.gear_type ?? ''}
                  options={['', ...GEAR_TYPES]}
                  onChange={(v) => update('gear_type', v)}
                  changed={isManuallyChanged('gear_type')}
                  autoFilled={isAutoFilled('gear_type')}
                />
              </Field>
              <Field label="Tone Type" autoFilled={isAutoFilled('tone_type')}>
                <Select
                  value={m.tone_type ?? ''}
                  options={['', ...TONE_TYPES]}
                  onChange={(v) => update('tone_type', v)}
                  changed={isManuallyChanged('tone_type')}
                  autoFilled={isAutoFilled('tone_type')}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Manufacturer" autoFilled={isAutoFilled('gear_make')}>
                <ComboInput
                  value={m.gear_make ?? ''}
                  onChange={(v) => update('gear_make', v)}
                  suggestions={gearMakeSuggestions}
                  placeholder="e.g. Friedman"
                  className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none transition-colors ${inputClass(isManuallyChanged('gear_make'), isAutoFilled('gear_make'))}`}
                />
              </Field>
              <Field label="Model" autoFilled={isAutoFilled('gear_model')}>
                <ComboInput
                  value={m.gear_model ?? ''}
                  onChange={(v) => update('gear_model', v)}
                  suggestions={gearModelSuggestions}
                  placeholder="e.g. BE100 Deluxe"
                  className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none transition-colors ${inputClass(isManuallyChanged('gear_model'), isAutoFilled('gear_model'))}`}
                />
              </Field>
            </div>
          </Section>

          {/* Levels section */}
          <Section title="Levels" icon="📊">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reamp Send Level (dBu)" autoFilled={isAutoFilled('input_level_dbu')}>
                <NumberInput
                  value={m.input_level_dbu ?? ''}
                  onChange={(v) => update('input_level_dbu', v)}
                  placeholder="e.g. 12.5"
                  step={0.5}
                  changed={isManuallyChanged('input_level_dbu')}
                  autoFilled={isAutoFilled('input_level_dbu')}
                />
              </Field>
              <Field label="Reamp Return Level (dBu)" autoFilled={isAutoFilled('output_level_dbu')}>
                <NumberInput
                  value={m.output_level_dbu ?? ''}
                  onChange={(v) => update('output_level_dbu', v)}
                  placeholder="e.g. 12.5"
                  step={0.5}
                  changed={isManuallyChanged('output_level_dbu')}
                  autoFilled={isAutoFilled('output_level_dbu')}
                />
              </Field>
            </div>
          </Section>

          {/* Training section */}
          <Section title="Training" icon={
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18" />
            </svg>
          }>
            <Field label="Trained Epochs" hint="Number of training epochs (backfill if known)">
              <NumberInput
                value={m.nb_trained_epochs ?? ''}
                onChange={(v) => update('nb_trained_epochs', v)}
                placeholder="e.g. 1000"
                step={1}
                changed={isManuallyChanged('nb_trained_epochs')}
                autoFilled={false}
              />
            </Field>
          </Section>

          {/* Read-only stats */}
          <Section title="Capture Stats" icon="📈">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Architecture" value={file.architecture} />
              <StatCard label="NAM Version" value={file.version} />
              {(() => {
                const layers = (file.config as Record<string, unknown> | undefined)?.layers
                const channels = (Array.isArray(layers) && layers.length > 0)
                  ? (layers[0] as Record<string, unknown>)?.channels as number | undefined
                  : undefined
                if (channels == null) return null
                return <StatCard label="Model Size" value={`${channels} channels`} />
              })()}
              {detectPreset(file.config) != null && (
                <StatCard label="Detected Preset" value={detectPreset(file.config)!} />
              )}
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
                const data = t?.data as Record<string, unknown> | undefined
                const checks = data?.checks as Record<string, unknown> | undefined
                if (checks?.passed == null) return null
                const passed = checks.passed as boolean
                const ignored = (t?.settings as Record<string, unknown> | undefined)?.ignore_checks === true
                return (
                  <StatCard
                    label="Checks Passed"
                    value={passed ? 'Yes' : ignored ? 'No (bypassed)' : 'No'}
                    good={passed ? true : false}
                  />
                )
              })()}
              {(() => {
                const t = m.training as Record<string, unknown> | undefined
                const cal = ((t?.data as Record<string, unknown> | undefined)?.latency as Record<string, unknown> | undefined)?.calibration as Record<string, unknown> | undefined
                if (cal?.recommended == null) return null
                return <StatCard label="Calibrated Latency" value={`${cal.recommended} samples`} />
              })()}
              {(() => {
                const nb = ((m.training as Record<string, unknown> | undefined)?.nam_bot as Record<string, unknown> | undefined)
                if (nb?.preset_name != null) return <StatCard label="NAM-BOT Preset" value={String(nb.preset_name)} />
                return null
              })()}
              {dateStr && <StatCard label="Captured On" value={dateStr} />}
            </div>
          </Section>

          {/* Star rating — always visible */}
          <div className="flex items-center gap-3 py-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-28 flex-shrink-0">Rating</span>
            <div className="flex items-center gap-0.5">
              {[1,2,3,4,5].map((star) => {
                const filled = (m.nl_rating ?? 0) >= star
                const isChanged = isManuallyChanged('nl_rating')
                return (
                  <button
                    key={star}
                    onClick={() => update('nl_rating', m.nl_rating === star ? null : star)}
                    className="p-0.5 transition-colors hover:scale-110"
                    title={m.nl_rating === star ? 'Clear rating' : `Rate ${star}`}
                  >
                    <svg
                      className={`w-4 h-4 transition-colors ${filled ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600 hover:text-amber-300'} ${isChanged ? 'drop-shadow-sm' : ''}`}
                      fill={filled ? 'currentColor' : 'none'}
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={filled ? 0 : 1.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                )
              })}
              {(m.nl_rating ?? 0) > 0 && (
                <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">{m.nl_rating}/5</span>
              )}
            </div>
          </div>

          {/* Capture Details section (NAM Lab extended fields) */}
          {showNamLabFields && (() => {
            const gearType = m.gear_type ?? ''
            // When gear_type is unset, show all fields so nothing is hidden
            const relevantKeys: Set<NlKey> = new Set(
              gearType && NL_RELEVANT[gearType] ? NL_RELEVANT[gearType] : NL_ALL
            )
            const visibleKeys: Set<NlKey> = nlShowAll ? new Set(NL_ALL) : relevantKeys
            const hasGearType = !!gearType && !!NL_RELEVANT[gearType]

            const show = (k: NlKey) => visibleKeys.has(k)
            const dimmed = (k: NlKey) => nlShowAll && !relevantKeys.has(k)

            const fieldClass = (key: NlKey) =>
              dimmed(key) ? 'opacity-40' : ''

            return (
              <div>
                {/* Section header with toggle */}
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex-shrink-0">Capture Details</h3>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                  {hasGearType && (
                    <div className="flex flex-shrink-0 rounded-md overflow-hidden border border-gray-300 dark:border-gray-700 text-xs">
                      <button
                        onClick={() => setNlShowAll(false)}
                        className={`px-2.5 py-1 transition-colors ${!nlShowAll ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                      >
                        Relevant
                      </button>
                      <button
                        onClick={() => setNlShowAll(true)}
                        className={`px-2.5 py-1 border-l border-gray-300 dark:border-gray-700 transition-colors ${nlShowAll ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                      >
                        All
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {(show('nl_mics') || show('nl_amp_channel')) && (
                    <div className={`grid gap-4 ${show('nl_mics') && show('nl_amp_channel') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {show('nl_mics') && (
                        <div className={fieldClass('nl_mics')}>
                          <Field label="Microphone(s)" hint="e.g. SM57 + Royer 121">
                            <TextInput value={m.nl_mics ?? ''} onChange={(v) => update('nl_mics', v)} placeholder="e.g. SM57" changed={isManuallyChanged('nl_mics')} />
                          </Field>
                        </div>
                      )}
                      {show('nl_amp_channel') && (
                        <div className={fieldClass('nl_amp_channel')}>
                          <Field label="Amp Channel" hint="e.g. Crunch, Lead 2">
                            <TextInput value={m.nl_amp_channel ?? ''} onChange={(v) => update('nl_amp_channel', v)} placeholder="e.g. Lead" changed={isManuallyChanged('nl_amp_channel')} />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}

                  {(show('nl_cabinet') || show('nl_cabinet_config')) && (
                    <div className={`grid gap-4 ${show('nl_cabinet') && show('nl_cabinet_config') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {show('nl_cabinet') && (
                        <div className={fieldClass('nl_cabinet')}>
                          <Field label="Cabinet" hint="e.g. Marshall 1960A">
                            <TextInput value={m.nl_cabinet ?? ''} onChange={(v) => update('nl_cabinet', v)} placeholder="e.g. Marshall 1960A" changed={isManuallyChanged('nl_cabinet')} />
                          </Field>
                        </div>
                      )}
                      {show('nl_cabinet_config') && (
                        <div className={fieldClass('nl_cabinet_config')}>
                          <Field label="Cabinet Config" hint="e.g. 4x12, 2x12">
                            <TextInput value={m.nl_cabinet_config ?? ''} onChange={(v) => update('nl_cabinet_config', v)} placeholder="e.g. 4x12" changed={isManuallyChanged('nl_cabinet_config')} />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}

                  {show('nl_amp_settings') && (
                    <div className={fieldClass('nl_amp_settings')}>
                      <Field label="Amp Settings" hint="Knob positions, e.g. Gain 7, Bass 5, Mid 4, Treb 6">
                        <TextInput value={m.nl_amp_settings ?? ''} onChange={(v) => update('nl_amp_settings', v)} placeholder="e.g. Gain 7, Bass 5, Mid 4, Treb 6" changed={isManuallyChanged('nl_amp_settings')} />
                      </Field>
                    </div>
                  )}

                  {show('nl_amp_switches') && (
                    <div className={fieldClass('nl_amp_switches')}>
                      <Field label="Amp Switches" hint="e.g. Bright on, Fat off">
                        <TextInput value={m.nl_amp_switches ?? ''} onChange={(v) => update('nl_amp_switches', v)} placeholder="e.g. Bright on, Fat off" changed={isManuallyChanged('nl_amp_switches')} />
                      </Field>
                    </div>
                  )}

                  {show('nl_boost_pedal') && (
                    <div className={fieldClass('nl_boost_pedal')}>
                      <Field label="Boost Pedal(s)" hint="Pedal(s) used as a boost into the amp">
                        <TextInput value={m.nl_boost_pedal ?? ''} onChange={(v) => update('nl_boost_pedal', v)} placeholder="e.g. Klon Centaur - Blues Breaker" changed={isManuallyChanged('nl_boost_pedal')} />
                      </Field>
                    </div>
                  )}

                  {show('nl_pedal_settings') && (
                    <div className={fieldClass('nl_pedal_settings')}>
                      <Field label="Pedal Settings" hint="Boost pedal + any other pedals in chain">
                        <TextInput value={m.nl_pedal_settings ?? ''} onChange={(v) => update('nl_pedal_settings', v)} placeholder="e.g. Klon — Gain 10, Vol 9 · TS9 — Drive 5, Tone 12" changed={isManuallyChanged('nl_pedal_settings')} />
                      </Field>
                    </div>
                  )}

                  {show('nl_comments') && (
                    <Field label="Comments">
                      <textarea
                        value={m.nl_comments ?? ''}
                        onChange={(e) => update('nl_comments', e.target.value)}
                        placeholder="Any additional notes about this capture…"
                        rows={3}
                        maxLength={500}
                        className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none transition-colors resize-none ${inputClass(isManuallyChanged('nl_comments'))}`}
                      />
                    </Field>
                  )}

                  {!hasGearType && (
                    <p className="text-xs text-gray-400 dark:text-gray-600 italic">
                      Set Gear Type above to filter to relevant fields.
                    </p>
                  )}
                </div>
              </div>
            )
          })()}

        </div>
      </div>
    </div>
  )
}

// ---- UI primitives ----

function GearImage({ gearType, size = 'body' }: { gearType: string; size?: 'header' | 'body' }) {
  const imgs = gearImages[gearType]
  if (!imgs) return null
  const isDark = document.documentElement.classList.contains('dark')
  const src = isDark ? imgs.dark : (imgs.light ?? imgs.dark)
  const sizeClass = size === 'header' ? 'h-16 w-auto' : 'h-24 w-auto'
  return (
    <img src={src} alt={gearType} className={`${sizeClass} object-contain opacity-70 flex-shrink-0`} />
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{title}</h3>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  autoFilled,
  children
}: {
  label: string
  hint?: string
  autoFilled?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
        {hint && <span className="text-gray-400 dark:text-gray-600 font-normal">{hint}</span>}
        {autoFilled && (
          <span className="ml-auto text-xs text-amber-400 font-normal flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            auto-filled
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

const changedInputClass  = 'border-amber-500/60 bg-amber-50 dark:bg-amber-900/10 focus:border-amber-400'
const normalInputClass   = 'border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50'
const autoFilledInputClass = 'border-indigo-500/50 bg-indigo-50 dark:bg-indigo-900/10 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/50'

function inputClass(changed?: boolean, autoFilled?: boolean) {
  if (changed) return changedInputClass
  if (autoFilled) return autoFilledInputClass
  return normalInputClass
}

function TextInput({
  value,
  onChange,
  placeholder,
  changed,
  autoFilled
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  changed?: boolean
  autoFilled?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none transition-colors ${inputClass(changed, autoFilled)}`}
    />
  )
}

function NumberInput({
  value,
  onChange,
  placeholder,
  step,
  changed,
  autoFilled
}: {
  value: string | number
  onChange: (v: number | null) => void
  placeholder?: string
  step?: number
  changed?: boolean
  autoFilled?: boolean
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
      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none transition-colors ${inputClass(changed, autoFilled)}`}
    />
  )
}

function Select({
  value,
  options,
  onChange,
  changed,
  autoFilled
}: {
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  changed?: boolean
  autoFilled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none transition-colors appearance-none cursor-pointer ${inputClass(changed, autoFilled)}`}
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-gray-200 dark:bg-gray-800">
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
    <div className="px-3 py-2.5 bg-gray-100/80 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-medium ${good === true ? 'text-green-400' : good === false ? 'text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}>
        {value}
      </div>
    </div>
  )
}

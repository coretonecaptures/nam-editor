import { useEffect, useState } from 'react'
import { formatSampleRate } from '../../../../shared/wavFormat'

/**
 * Docked, always-on item detail — replaces the right panel the moment exactly one IR is selected,
 * the same way NAM mode's `MetadataEditor` takes over its own third panel for a selected `.nam`
 * file (App.tsx: `selectedFiles.length === 1 ? <MetadataEditor .../> : ...`). Before this, the
 * only way to see or edit an IR's metadata was a right-click "Edit Metadata…" modal covering 4 of
 * the ~30 fields IR Lab itself can produce for a capture — reported directly ("i do see right
 * click edit and add metadata, but it's a popup and very limited fields") and scoped in
 * docs/ir-metadata-full-parity-proposal-2026-09-13.md as gaps G1 (field coverage) and G2 (docked,
 * not modal). This panel is the fix for both at once.
 *
 * Field coverage mirrors `itemDetail.ts`'s `ItemDetail` shape 1:1 — every column confirmed against
 * IR Lab's own `src/core/Domain.h` (its private, separate source repo), not guessed. Fields IR Lab only
 * ever records automatically (capture_type, preset_kind, reverb_capture_mode,
 * reverb_source_signal_type) or measures from the WAV itself (is_reverb/is_stereo/is_true_stereo)
 * are shown read-only, matching how MetadataEditor treats NAM's own auto-set fields (loudness/
 * gain/latency) as locked-by-default rather than plain text inputs.
 *
 * Text fields batch behind one Save button (same idiom `IrEditMetadataModal` already used, kept
 * for consistency rather than switching to autosave-on-blur for some fields and not others).
 * Numeric fields (mic distance/axis-angle, reverb wet%/pre-delay) save immediately on blur via a
 * separate IPC channel (`irLibrarySetItemNumericField`) — seeing this file's own comment on why
 * they can't share the string writer (REAL vs TEXT columns).
 */

type EditableField =
  | 'manufacturer' | 'cabinet' | 'speaker' | 'microphone' | 'position'
  | 'speaker_position' | 'modeled_microphone'
  | 'mic_a_type' | 'mic_a_polar_pattern' | 'mic_a_target_zone' | 'mic_a_distance_unit' | 'mic_a_signal_chain_override' | 'mic_a_notes'
  | 'mic_b_type' | 'mic_b_polar_pattern' | 'mic_b_target_zone' | 'mic_b_distance_unit' | 'mic_b_signal_chain_override' | 'mic_b_notes'
  | 'reverb_unit_make' | 'reverb_unit_model' | 'reverb_preset_name' | 'reverb_space_type'

type NumericField = 'mic_a_distance' | 'mic_a_axis_angle_deg' | 'mic_b_distance' | 'mic_b_axis_angle_deg' | 'reverb_recommended_wet_percent' | 'reverb_recommended_pre_delay_ms'

type Detail = NonNullable<Awaited<ReturnType<typeof window.api.irLibraryGetItemDetail>>>

interface RowSummary {
  id: string
  display_name: string
  relative_path: string
  abs_path: string
  rating: number | null
  is_favorite: number
  sample_rate: number | null
  bit_depth: number | null
  channels: number | null
  duration_seconds: number | null
  audio_format: string | null
  file_size: number | null
}

function sourceLabel(source: string | null): string {
  switch (source) {
    case 'ir_lab_native': return 'IR Lab'
    case 'ir_lab_embedded': return 'embedded WAV metadata'
    case 'vendor_documentation': return 'vendor documentation'
    case 'vendor_parser': return 'vendor parser'
    case 'filename_inferred': return 'filename guess'
    case 'user_entered': return 'you'
    default: return 'unset'
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-nm-text-3">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-nm-text-3">{label}</span>
      <span className="text-nm-text font-mono truncate max-w-[60%]" title={value}>{value}</span>
    </div>
  )
}

export function IrItemDetailPanel({
  row,
  onSaved,
  onTogglePanel
}: {
  row: RowSummary
  onSaved: () => void
  onTogglePanel?: () => void
}): React.ReactElement {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Partial<Record<EditableField, string>>>({})
  const [notesDraft, setNotesDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  const [promoting, setPromoting] = useState<string | null>(null)
  const [showMicB, setShowMicB] = useState(false)
  const [showReverb, setShowReverb] = useState(false)
  const [embedAllowed, setEmbedAllowed] = useState(false)
  const [embedding, setEmbedding] = useState(false)
  const [embedMessage, setEmbedMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.irLibraryEmbedMetadataAllowed().then(setEmbedAllowed)
  }, [])

  const embedInFile = async (): Promise<void> => {
    setEmbedding(true)
    setEmbedMessage(null)
    try {
      const { allowed, results } = await window.api.irLibraryEmbedItemsMetadata([row.id])
      if (!allowed) {
        setEmbedMessage('Turned off in Settings — enable it under Player → IR Catalog Metadata first.')
        return
      }
      const result = results[0]
      if (!result?.success) {
        setEmbedMessage(result?.error ?? 'Could not embed metadata into this file.')
        return
      }
      setEmbedMessage(result.truncatedDescription ? 'Embedded — the combined text was too long and got truncated to fit.' : 'Embedded into the file.')
    } finally {
      setEmbedding(false)
    }
  }

  const load = (): void => {
    setLoading(true)
    window.api.irLibraryGetItemDetail(row.id).then((d) => {
      setDetail(d)
      setLoading(false)
      if (d) {
        const nextDraft: Partial<Record<EditableField, string>> = {}
        for (const key of Object.keys(d.fields) as EditableField[]) {
          nextDraft[key] = d.fields[key]?.value ?? ''
        }
        setDraft(nextDraft)
        setNotesDraft(d.notes ?? '')
        setShowMicB(!!(d.fields.mic_b_type?.value || d.fields.mic_b_polar_pattern?.value || d.micBDistance))
        setShowReverb(d.isReverb || !!(d.fields.reverb_unit_make?.value || d.fields.reverb_preset_name?.value))
      }
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  if (loading || !detail) {
    return <div className="h-full flex items-center justify-center text-xs text-nm-text-3">Loading…</div>
  }

  const isDirty =
    notesDraft.trim() !== (detail.notes ?? '') ||
    (Object.keys(draft) as EditableField[]).some((k) => (draft[k] ?? '').trim() !== (detail.fields[k]?.value ?? ''))

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const failures: string[] = []
      if (notesDraft.trim() !== (detail.notes ?? '')) {
        const result = await window.api.irLibrarySetItemMetadata(row.id, 'notes', notesDraft)
        if (!result.success && notesDraft.trim()) failures.push('Notes')
      }
      for (const key of Object.keys(draft) as EditableField[]) {
        const value = (draft[key] ?? '').trim()
        if (value === (detail.fields[key]?.value ?? '')) continue
        if (!value) continue // blanking a field goes through Clear, not Save — matches IrEditMetadataModal
        const result = await window.api.irLibrarySetItemMetadata(row.id, key, value)
        if (!result.success) failures.push(key)
      }
      if (failures.length > 0) {
        setError(`Could not save: ${failures.join(', ')}.`)
      }
      onSaved()
      load()
    } finally {
      setSaving(false)
    }
  }

  const clearField = async (field: EditableField): Promise<void> => {
    setClearing(field)
    try {
      await window.api.irLibraryClearItemMetadata(row.id, field)
      onSaved()
      load()
    } finally {
      setClearing(null)
    }
  }

  const pushToFolder = async (field: EditableField): Promise<void> => {
    setPromoting(field)
    try {
      await window.api.irLibraryPromoteItemFieldToFolder(row.id, field)
      onSaved()
    } finally {
      setPromoting(null)
    }
  }

  const setNumeric = async (field: NumericField, raw: string): Promise<void> => {
    const trimmed = raw.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && !Number.isFinite(value)) return
    await window.api.irLibrarySetItemNumericField(row.id, field, value)
    load()
  }

  const TextField = ({ field, label, placeholder }: { field: EditableField; label: string; placeholder?: string }): React.ReactElement => {
    const meta = detail.fields[field]
    const hasValue = !!meta?.value
    const dirty = (draft[field] ?? '').trim() !== (meta?.value ?? '')
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-nm-text-3 flex items-center justify-between gap-2">
          <span>{label}</span>
          {hasValue && <span className="truncate">from {sourceLabel(meta?.source ?? null)}</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <input
            value={draft[field] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
            placeholder={placeholder}
            disabled={saving}
            className={`flex-1 min-w-0 px-2 py-1 text-xs rounded border bg-field-bg text-nm-text ${dirty ? 'border-nm-accent' : 'border-field-bd'}`}
          />
          {hasValue && (
            <>
              <button
                onClick={() => void pushToFolder(field)}
                disabled={saving || dirty || promoting === field}
                title="Apply this value to the whole folder"
                className="text-[11px] text-nm-text-3 hover:text-nm-accent disabled:opacity-50 flex-shrink-0"
              >
                {promoting === field ? '…' : 'Push'}
              </button>
              <button
                onClick={() => void clearField(field)}
                disabled={saving || clearing === field}
                title="Clear this override"
                className="text-[11px] text-nm-text-3 hover:text-red-500 disabled:opacity-50 flex-shrink-0"
              >
                {clearing === field ? '…' : 'Clear'}
              </button>
            </>
          )}
        </div>
      </label>
    )
  }

  const NumberField = ({ field, label, value, placeholder, unit }: { field: NumericField; label: string; value: number | null; placeholder?: string; unit?: string }): React.ReactElement => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-nm-text-3">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          defaultValue={value ?? ''}
          key={value ?? 'empty'}
          onBlur={(e) => void setNumeric(field, e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
        />
        {unit && <span className="text-[11px] text-nm-text-3 flex-shrink-0">{unit}</span>}
      </div>
    </label>
  )

  const technical = [
    row.sample_rate ? formatSampleRate(row.sample_rate) : null,
    row.bit_depth ? `${row.bit_depth}-bit` : null,
    row.channels === 1 ? 'mono' : row.channels === 2 ? 'stereo' : row.channels ? `${row.channels}ch` : null,
    row.duration_seconds ? `${row.duration_seconds.toFixed(2)}s` : null,
    formatBytes(row.file_size)
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-nm-border-s flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-nm-text truncate" title={row.display_name}>
              {row.display_name.replace(/\.wav$/i, '')}
            </div>
            <button
              onClick={() => window.api.revealFile(row.abs_path)}
              className="text-[11px] text-nm-text-3 hover:text-nm-accent truncate block max-w-full text-left"
              title={row.abs_path}
            >
              {row.relative_path}
            </button>
            {technical && <div className="text-[11px] text-nm-text-3 font-mono mt-0.5">{technical}</div>}
          </div>
          {onTogglePanel && (
            <button onClick={onTogglePanel} title="Collapse panel" className="p-1 rounded text-nm-text-3 hover:text-nm-text hover:bg-hov flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => {
              const filled = (detail.rating ?? 0) >= star
              return (
                <button
                  key={star}
                  onClick={() => void window.api.irLibrarySetRating(row.id, detail.rating === star ? 0 : star).then(load).then(onSaved)}
                  className="p-0.5 hover:scale-110 transition-transform"
                  title={detail.rating === star ? 'Clear rating' : `Rate ${star}`}
                >
                  <svg className={`w-3.5 h-3.5 ${filled ? 'text-amber-400' : 'text-nm-text-3 hover:text-amber-300'}`} fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={filled ? 0 : 1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </button>
              )
            })}
          </div>
          <button
            onClick={() => void window.api.irLibrarySetFavorite(row.id, !detail.isFavorite).then(load).then(onSaved)}
            title={detail.isFavorite ? 'Remove favorite' : 'Add favorite'}
            className={`p-0.5 ${detail.isFavorite ? 'text-nm-accent' : 'text-nm-text-3 hover:text-nm-accent'}`}
          >
            <svg className="w-3.5 h-3.5" fill={detail.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        <Section title="Identity">
          <TextField field="manufacturer" label="Manufacturer" placeholder="e.g. Marshall" />
          <TextField field="cabinet" label="Cabinet" placeholder="e.g. 1960A 4x12" />
          <TextField field="speaker" label="Speaker" placeholder="e.g. Celestion V30" />
          <TextField field="microphone" label="Microphone" placeholder="e.g. Shure SM57" />
          <TextField field="position" label="Position" placeholder="e.g. cap edge, 1 inch" />
        </Section>

        <Section title="Capture facts">
          <ReadOnlyRow label="Capture type" value={detail.fields.capture_type?.value ?? null} />
          <ReadOnlyRow label="Preset kind" value={detail.fields.preset_kind?.value ?? null} />
          <ReadOnlyRow label="Reverb" value={detail.isReverb ? 'Yes' : null} />
          <ReadOnlyRow label="Stereo" value={detail.isStereo ? (detail.isTrueStereo ? 'True stereo' : 'Yes') : null} />
          <TextField field="speaker_position" label="Speaker position" placeholder="which driver in a multi-speaker cab" />
          <TextField field="modeled_microphone" label="Modeled microphone" placeholder="e.g. Townsend Sphere virtual mic" />
        </Section>

        <Section title="Mic A">
          <TextField field="mic_a_type" label="Type" placeholder="Dynamic / Ribbon / Condenser / Other" />
          <TextField field="mic_a_polar_pattern" label="Polar pattern" placeholder="Cardioid / Omni / …" />
          <TextField field="mic_a_target_zone" label="Target zone" placeholder="Cap Center / Cone Edge / …" />
          <div className="grid grid-cols-2 gap-2">
            <NumberField field="mic_a_distance" label="Distance" value={detail.micADistance} placeholder="0.0" unit={detail.fields.mic_a_distance_unit?.value ?? 'in'} />
            <NumberField field="mic_a_axis_angle_deg" label="Axis angle" value={detail.micAAxisAngleDeg} placeholder="0" unit="deg" />
          </div>
          <TextField field="mic_a_distance_unit" label="Distance unit" placeholder="in or cm" />
          <TextField field="mic_a_signal_chain_override" label="Signal chain override" placeholder="blank = uses the project's chain" />
          <TextField field="mic_a_notes" label="Notes" />
        </Section>

        <button
          onClick={() => setShowMicB((v) => !v)}
          className="text-[11px] text-nm-text-3 hover:text-nm-accent flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showMicB ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
          Mic B {showMicB ? '' : '(blend mic — most captures don\'t have one)'}
        </button>
        {showMicB && (
          <Section title="Mic B">
            <TextField field="mic_b_type" label="Type" placeholder="Dynamic / Ribbon / Condenser / Other" />
            <TextField field="mic_b_polar_pattern" label="Polar pattern" placeholder="Cardioid / Omni / …" />
            <TextField field="mic_b_target_zone" label="Target zone" placeholder="Cap Center / Cone Edge / …" />
            <div className="grid grid-cols-2 gap-2">
              <NumberField field="mic_b_distance" label="Distance" value={detail.micBDistance} placeholder="0.0" unit={detail.fields.mic_b_distance_unit?.value ?? 'in'} />
              <NumberField field="mic_b_axis_angle_deg" label="Axis angle" value={detail.micBAxisAngleDeg} placeholder="0" unit="deg" />
            </div>
            <TextField field="mic_b_distance_unit" label="Distance unit" placeholder="in or cm" />
            <TextField field="mic_b_signal_chain_override" label="Signal chain override" />
            <TextField field="mic_b_notes" label="Notes" />
          </Section>
        )}

        <button
          onClick={() => setShowReverb((v) => !v)}
          className="text-[11px] text-nm-text-3 hover:text-nm-accent flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showReverb ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
          Reverb details {showReverb ? '' : '(only meaningful for a reverb capture)'}
        </button>
        {showReverb && (
          <Section title="Reverb">
            <div className="text-[10px] text-nm-text-3 -mt-1.5">
              Unit/preset/space and the two recommended values are operator-entered — IR Lab itself has no editor for
              these yet, so this is currently the only place to set them.
            </div>
            <TextField field="reverb_unit_make" label="Unit make" placeholder="e.g. Lexicon" />
            <TextField field="reverb_unit_model" label="Unit model" placeholder="e.g. PCM70" />
            <TextField field="reverb_preset_name" label="Preset name" placeholder="e.g. Random Hall 3" />
            <TextField field="reverb_space_type" label="Space type" placeholder="e.g. Hall" />
            <div className="grid grid-cols-2 gap-2">
              <NumberField field="reverb_recommended_wet_percent" label="Recommended wet" value={detail.reverbRecommendedWetPercent} placeholder="e.g. 25" unit="%" />
              <NumberField field="reverb_recommended_pre_delay_ms" label="Recommended pre-delay" value={detail.reverbRecommendedPreDelayMs} placeholder="e.g. 20" unit="ms" />
            </div>
            <ReadOnlyRow label="Capture mode" value={detail.fields.reverb_capture_mode?.value ?? null} />
            <ReadOnlyRow label="Source signal" value={detail.fields.reverb_source_signal_type?.value ?? null} />
            <ReadOnlyRow label="Measured decay" value={detail.reverbDecaySeconds ? `${detail.reverbDecaySeconds.toFixed(2)}s` : null} />
          </Section>
        )}

        <Section title="Notes">
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="Free-form notes for this IR"
            className={`w-full px-2 py-1.5 text-xs rounded border bg-field-bg text-nm-text resize-none ${notesDraft.trim() !== (detail.notes ?? '') ? 'border-nm-accent' : 'border-field-bd'}`}
          />
        </Section>

        <Section title="File">
          {embedAllowed ? (
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => void embedInFile()}
                disabled={embedding || isDirty}
                title={isDirty ? 'Save your edits first, so the embedded copy matches what\'s shown here' : 'Write cabinet/speaker/microphone/position/notes into the WAV file itself'}
                className="self-start px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
              >
                {embedding ? 'Embedding…' : 'Embed in File…'}
              </button>
              <p className="text-[10px] text-nm-text-3">
                Writes manufacturer-independent fields (cabinet/speaker/microphone/position/notes) into the WAV&apos;s
                own bext chunk, so they travel with the file outside this app&apos;s catalog.
              </p>
              {embedMessage && <p className="text-[11px] text-nm-text-2">{embedMessage}</p>}
            </div>
          ) : (
            <p className="text-[11px] text-nm-text-3">
              Embedding metadata into the file is off. Enable it in Settings → Player → IR Catalog Metadata if you
              need this IR&apos;s metadata to travel with it outside this app&apos;s catalog.
            </p>
          )}
        </Section>
      </div>

      {error && <div className="px-4 py-2 text-[11px] text-red-500 border-t border-nm-border-s flex-shrink-0">{error}</div>}

      <div className="px-4 py-2.5 border-t border-nm-border-s flex justify-end gap-2 flex-shrink-0">
        <button
          onClick={() => {
            setDraft(Object.fromEntries((Object.keys(detail.fields) as EditableField[]).map((k) => [k, detail.fields[k]?.value ?? ''])))
            setNotesDraft(detail.notes ?? '')
          }}
          disabled={saving || !isDirty}
          className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40"
        >
          Revert
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || !isDirty}
          className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

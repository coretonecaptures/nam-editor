import { useEffect, useState } from 'react'

/**
 * Docked multi-select metadata editor — the IR-mode counterpart to NAM mode's
 * `MultiSelectEditor.tsx`. Supersedes `IrBatchMetadataEditModal`'s 7-field checkbox modal: full
 * field parity with `IrItemDetailPanel`, per-field shared/varies detection (indigo "shared" badge)
 * and changed-value highlighting (amber border), Revert, and a confirmed Apply — occupying the same
 * docked panel slot `IrItemDetailPanel` owns for a single selection, the same way NAM's own
 * `MultiSelectEditor` occupies `MetadataEditor`'s slot once more than one file is selected.
 *
 * Unlike NAM (whose `files` prop already carries full in-memory metadata for every loaded file),
 * IR's row cache only carries the handful of columns the list shows — so this component fetches
 * full `ItemDetail` for every selected id itself on mount/selection-change, then computes
 * shared/varies the same way NAM's `getShared()` does.
 *
 * IR also has no single "patch many fields at once" IPC the way NAM's `onApply(filePaths, fields)`
 * is backed by `patchMetadataFields()` — writes are per-item, per-field
 * (`irLibrarySetItemMetadata` / `irLibrarySetItemNumericField`). Apply loops itemIds × changed
 * fields the same way `IrBatchMetadataEditModal` already did, just driven by real edits instead of
 * manual per-field checkboxes.
 */

type Detail = NonNullable<Awaited<ReturnType<typeof window.api.irLibraryGetItemDetail>>>

type StringField =
  | 'manufacturer' | 'cabinet' | 'speaker' | 'microphone' | 'position'
  | 'speaker_position' | 'modeled_microphone'
  | 'mic_a_type' | 'mic_a_polar_pattern' | 'mic_a_target_zone' | 'mic_a_distance_unit' | 'mic_a_signal_chain_override' | 'mic_a_notes'
  | 'mic_b_type' | 'mic_b_polar_pattern' | 'mic_b_target_zone' | 'mic_b_distance_unit' | 'mic_b_signal_chain_override' | 'mic_b_notes'
  | 'reverb_unit_make' | 'reverb_unit_model' | 'reverb_preset_name' | 'reverb_space_type'

type NumericField = 'mic_a_distance' | 'mic_a_axis_angle_deg' | 'mic_b_distance' | 'mic_b_axis_angle_deg' | 'reverb_recommended_wet_percent' | 'reverb_recommended_pre_delay_ms'

const NUMERIC_DETAIL_KEY: Record<NumericField, keyof Detail> = {
  mic_a_distance: 'micADistance',
  mic_a_axis_angle_deg: 'micAAxisAngleDeg',
  mic_b_distance: 'micBDistance',
  mic_b_axis_angle_deg: 'micBAxisAngleDeg',
  reverb_recommended_wet_percent: 'reverbRecommendedWetPercent',
  reverb_recommended_pre_delay_ms: 'reverbRecommendedPreDelayMs'
}

type FieldDef =
  | { key: StringField; label: string; type: 'text'; placeholder?: string }
  | { key: NumericField; label: string; type: 'number'; placeholder?: string; unit?: string }
  | { key: 'notes'; label: string; type: 'notes' }

const IDENTITY_FIELDS: FieldDef[] = [
  { key: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'e.g. Marshall' },
  { key: 'cabinet', label: 'Cabinet', type: 'text', placeholder: 'e.g. 1960A 4x12' },
  { key: 'speaker', label: 'Speaker', type: 'text', placeholder: 'e.g. Celestion V30' },
  { key: 'microphone', label: 'Microphone', type: 'text', placeholder: 'e.g. Shure SM57' },
  { key: 'position', label: 'Position', type: 'text', placeholder: 'e.g. cap edge, 1 inch' }
]

const CAPTURE_FIELDS: FieldDef[] = [
  { key: 'speaker_position', label: 'Speaker position', type: 'text', placeholder: 'which driver in a multi-speaker cab' },
  { key: 'modeled_microphone', label: 'Modeled microphone', type: 'text', placeholder: 'e.g. Townsend Sphere virtual mic' }
]

const MIC_A_FIELDS: FieldDef[] = [
  { key: 'mic_a_type', label: 'Type', type: 'text', placeholder: 'Dynamic / Ribbon / Condenser / Other' },
  { key: 'mic_a_polar_pattern', label: 'Polar pattern', type: 'text', placeholder: 'Cardioid / Omni / …' },
  { key: 'mic_a_target_zone', label: 'Target zone', type: 'text', placeholder: 'Cap Center / Cone Edge / …' },
  { key: 'mic_a_distance', label: 'Distance', type: 'number', placeholder: '0.0' },
  { key: 'mic_a_axis_angle_deg', label: 'Axis angle', type: 'number', placeholder: '0', unit: 'deg' },
  { key: 'mic_a_distance_unit', label: 'Distance unit', type: 'text', placeholder: 'in or cm' },
  { key: 'mic_a_signal_chain_override', label: 'Signal chain override', type: 'text', placeholder: "blank = uses the project's chain" },
  { key: 'mic_a_notes', label: 'Notes', type: 'text' }
]

const MIC_B_FIELDS: FieldDef[] = [
  { key: 'mic_b_type', label: 'Type', type: 'text', placeholder: 'Dynamic / Ribbon / Condenser / Other' },
  { key: 'mic_b_polar_pattern', label: 'Polar pattern', type: 'text', placeholder: 'Cardioid / Omni / …' },
  { key: 'mic_b_target_zone', label: 'Target zone', type: 'text', placeholder: 'Cap Center / Cone Edge / …' },
  { key: 'mic_b_distance', label: 'Distance', type: 'number', placeholder: '0.0' },
  { key: 'mic_b_axis_angle_deg', label: 'Axis angle', type: 'number', placeholder: '0', unit: 'deg' },
  { key: 'mic_b_distance_unit', label: 'Distance unit', type: 'text', placeholder: 'in or cm' },
  { key: 'mic_b_signal_chain_override', label: 'Signal chain override', type: 'text' },
  { key: 'mic_b_notes', label: 'Notes', type: 'text' }
]

const REVERB_FIELDS: FieldDef[] = [
  { key: 'reverb_unit_make', label: 'Unit make', type: 'text', placeholder: 'e.g. Lexicon' },
  { key: 'reverb_unit_model', label: 'Unit model', type: 'text', placeholder: 'e.g. PCM70' },
  { key: 'reverb_preset_name', label: 'Preset name', type: 'text', placeholder: 'e.g. Random Hall 3' },
  { key: 'reverb_space_type', label: 'Space type', type: 'text', placeholder: 'e.g. Hall' },
  { key: 'reverb_recommended_wet_percent', label: 'Recommended wet', type: 'number', placeholder: 'e.g. 25', unit: '%' },
  { key: 'reverb_recommended_pre_delay_ms', label: 'Recommended pre-delay', type: 'number', placeholder: 'e.g. 20', unit: 'ms' }
]

const NOTES_FIELD: FieldDef = { key: 'notes', label: 'Notes', type: 'notes' }

const ALL_FIELDS: FieldDef[] = [...IDENTITY_FIELDS, ...CAPTURE_FIELDS, ...MIC_A_FIELDS, ...MIC_B_FIELDS, ...REVERB_FIELDS, NOTES_FIELD]

function fieldValue(detail: Detail, field: FieldDef): string {
  if (field.type === 'notes') return detail.notes ?? ''
  if (field.type === 'number') return detail[NUMERIC_DETAIL_KEY[field.key]] != null ? String(detail[NUMERIC_DETAIL_KEY[field.key]]) : ''
  return detail.fields[field.key]?.value ?? ''
}

function getShared(details: Detail[], field: FieldDef): { same: boolean; value: string } {
  const vals = details.map((d) => fieldValue(d, field))
  const first = vals[0] ?? ''
  const same = vals.every((v) => v === first)
  return { same, value: same ? first : '' }
}

export function IrMultiSelectEditor({
  itemIds,
  onSaved,
  skipConfirmation,
  embedBusy,
  embedMessage,
  onEmbed
}: {
  itemIds: string[]
  onSaved: () => void
  skipConfirmation?: boolean
  embedBusy?: boolean
  embedMessage?: string | null
  onEmbed?: () => void
}): React.ReactElement {
  const [details, setDetails] = useState<Detail[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const [showMicB, setShowMicB] = useState(false)
  const [showReverb, setShowReverb] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => {
    setDetails(null)
    setResultMessage(null)
    setProgress(null)
    let cancelled = false
    Promise.all(itemIds.map((id) => window.api.irLibraryGetItemDetail(id))).then((fetched) => {
      if (cancelled) return
      const loaded = fetched.filter((d): d is Detail => d != null)
      setDetails(loaded)
      const shared = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, getShared(loaded, f).value]))
      setEdits(shared)
      setChanged(new Set())
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIds.join(',')])

  if (!details) {
    return <div className="h-full flex items-center justify-center text-xs text-nm-text-3">Loading…</div>
  }

  const shared = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, getShared(details, f)])) as Record<string, { same: boolean; value: string }>

  const update = (key: string, value: string): void => {
    setEdits((prev) => ({ ...prev, [key]: value }))
    setChanged((prev) => new Set(prev).add(key))
  }

  const hasTypedEdits = changed.size > 0
  const canApply = hasTypedEdits && !busy

  const handleRevert = (): void => {
    setEdits(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, shared[f.key].value])))
    setChanged(new Set())
  }

  const apply = async (): Promise<void> => {
    if (!canApply) return

    if (!skipConfirmation) {
      const fieldNames = [...changed].map((k) => ALL_FIELDS.find((f) => f.key === k)?.label ?? k).join(', ')
      const confirmed = window.confirm(
        `Apply to ${itemIds.length} selected item${itemIds.length !== 1 ? 's' : ''}:\n  · ${changed.size} field${changed.size !== 1 ? 's' : ''}: ${fieldNames}\n\nThis will write changes directly to the IR catalog and, where enabled, the files' own metadata.\n\n(This warning can be toggled off in Settings → Behavior)`
      )
      if (!confirmed) return
    }

    setBusy(true)
    setResultMessage(null)
    const changedFields = ALL_FIELDS.filter((f) => changed.has(f.key))
    const total = changedFields.length * itemIds.length
    setProgress({ done: 0, total })
    let succeeded = 0
    let failed = 0
    for (const itemId of itemIds) {
      for (const field of changedFields) {
        const raw = (edits[field.key] ?? '').trim()
        let result: { success: boolean }
        if (field.type === 'number') {
          const value = raw === '' ? null : Number(raw)
          result = value !== null && !Number.isFinite(value) ? { success: false } : await window.api.irLibrarySetItemNumericField(itemId, field.key, value)
        } else {
          result = await window.api.irLibrarySetItemMetadata(itemId, field.key, raw)
        }
        if (result.success) succeeded++
        else failed++
        setProgress((prev) => (prev ? { done: prev.done + 1, total: prev.total } : prev))
      }
    }
    setBusy(false)
    setResultMessage(failed === 0 ? `Updated ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}.` : `${succeeded} writes succeeded, ${failed} failed.`)
    setChanged(new Set())
    onSaved()
  }

  const Field = ({ field }: { field: FieldDef }): React.ReactElement => {
    const { same } = shared[field.key]
    const isChanged = changed.has(field.key)
    const val = edits[field.key] ?? ''
    const inputCls = `flex-1 min-w-0 px-2 py-1 text-xs rounded border bg-field-bg text-nm-text ${isChanged ? 'border-amber-500/60 bg-amber-50 dark:bg-amber-900/10' : 'border-field-bd'}`
    return (
      <div className="flex items-center gap-3">
        <div className="w-40 flex-shrink-0 flex items-center gap-1.5">
          <span className="text-[11px] text-nm-text-3">{field.label}</span>
          {same && !isChanged && val !== '' && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">shared</span>
          )}
        </div>
        {field.type === 'notes' ? (
          <textarea
            value={val}
            onChange={(e) => update(field.key, e.target.value)}
            rows={2}
            placeholder={same ? 'Free-form notes for these IRs' : '— varies —'}
            className={`${inputCls} resize-none`}
          />
        ) : (
          <div className="flex-1 flex items-center gap-1.5">
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              value={val}
              onChange={(e) => update(field.key, e.target.value)}
              placeholder={same ? field.placeholder ?? '' : '— varies —'}
              disabled={busy}
              className={inputCls}
            />
            {field.type === 'number' && field.unit && <span className="text-[11px] text-nm-text-3 flex-shrink-0">{field.unit}</span>}
          </div>
        )}
      </div>
    )
  }

  const Section = ({ title, fields }: { title: string; fields: FieldDef[] }): React.ReactElement => (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-nm-text-3">{title}</div>
      <div className="space-y-2">
        {fields.map((f) => (
          <Field key={f.key} field={f} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-nm-border-s flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-nm-text">{itemIds.length} items selected</div>
            <div className="text-[11px] text-nm-text-3 mt-0.5">
              <span className="text-amber-500 dark:text-amber-400">amber</span> = changed · <span className="text-indigo-500 dark:text-indigo-400">indigo</span> = all items share this value
            </div>
          </div>
          {onEmbed && (
            <button
              onClick={onEmbed}
              disabled={embedBusy}
              title="Write cabinet/speaker/microphone/position/notes into each selected WAV's own bext chunk"
              className="flex-shrink-0 px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
            >
              {embedBusy ? 'Embedding…' : 'Embed in File…'}
            </button>
          )}
        </div>
        {embedMessage && <div className="text-[11px] text-nm-text-3 mt-1.5">{embedMessage}</div>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        <Section title="Identity" fields={IDENTITY_FIELDS} />
        <Section title="Capture facts" fields={CAPTURE_FIELDS} />
        <Section title="Mic A" fields={MIC_A_FIELDS} />

        <button
          onClick={() => setShowMicB((v) => !v)}
          className="text-[11px] text-nm-text-3 hover:text-nm-accent flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showMicB ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
          Mic B {showMicB ? '' : '(blend mic — most captures don\'t have one)'}
        </button>
        {showMicB && <Section title="Mic B" fields={MIC_B_FIELDS} />}

        <button
          onClick={() => setShowReverb((v) => !v)}
          className="text-[11px] text-nm-text-3 hover:text-nm-accent flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showReverb ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
          Reverb details {showReverb ? '' : '(only meaningful for a reverb capture)'}
        </button>
        {showReverb && <Section title="Reverb" fields={REVERB_FIELDS} />}

        <Section title="Notes" fields={[NOTES_FIELD]} />
      </div>

      {resultMessage && <div className="px-4 py-2 text-[11px] text-nm-text-2 border-t border-nm-border-s flex-shrink-0">{resultMessage}</div>}
      {progress && <div className="px-4 py-2 text-[11px] text-nm-text-3 border-t border-nm-border-s flex-shrink-0">Writing {progress.done} / {progress.total}…</div>}

      <div className="px-4 py-2.5 border-t border-nm-border-s flex justify-end gap-2 flex-shrink-0">
        {hasTypedEdits && (
          <button onClick={handleRevert} disabled={busy} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            Revert
          </button>
        )}
        <button
          onClick={() => void apply()}
          disabled={!canApply}
          className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Applying…' : `Apply to ${itemIds.length} items`}
        </button>
      </div>
    </div>
  )
}

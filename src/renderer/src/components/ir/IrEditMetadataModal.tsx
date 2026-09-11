import { useState } from 'react'

/**
 * Per-item metadata editor (parity backlog item 7) — the biggest single gap the audit found.
 * Metadata could be set on a folder and inherited down, but a single IR whose mic a vendor parser
 * got wrong had no way to be corrected. Every write here lands at the 'user_entered' confidence
 * tier (fieldConfidence.ts), which nothing automated ever overwrites — the write rules already
 * existed, only this UI was missing.
 */

const FIELDS: Array<{ key: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone'; label: string }> = [
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'cabinet', label: 'Cabinet' },
  { key: 'speaker', label: 'Speaker' },
  { key: 'microphone', label: 'Microphone' }
]

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

interface Row {
  id: string
  manufacturer: string | null
  manufacturer_source: string | null
  cabinet: string | null
  cabinet_source: string | null
  speaker: string | null
  speaker_source: string | null
  microphone: string | null
  microphone_source: string | null
}

export function IrEditMetadataModal({
  row,
  displayName,
  onClose,
  onSaved
}: {
  row: Row
  displayName: string
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<Record<string, string>>({
    manufacturer: row.manufacturer ?? '',
    cabinet: row.cabinet ?? '',
    speaker: row.speaker ?? '',
    microphone: row.microphone ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  // The parent's row cache refetches after onSaved(), but THIS modal keeps the `row` prop it
  // opened with — React doesn't push a fresh object into an already-open modal. Tracked locally
  // so the source label doesn't keep claiming a source that was just cleared until the modal is
  // reopened; the real resolved value (inherited or blank) shows the next time it's opened.
  const [clearedFields, setClearedFields] = useState<Set<string>>(new Set())
  const [promoting, setPromoting] = useState<string | null>(null)
  const [promoteMessage, setPromoteMessage] = useState<string | null>(null)

  const pushToFolder = async (field: string): Promise<void> => {
    setPromoting(field)
    setPromoteMessage(null)
    try {
      const result = await window.api.irLibraryPromoteItemFieldToFolder(row.id, field)
      if (result.success) {
        setPromoteMessage(
          result.itemsCleared > 0
            ? `Applied to the folder — ${result.itemsCleared} other item${result.itemsCleared === 1 ? '' : 's'} already matched and had its own override cleared as redundant.`
            : 'Applied to the folder.'
        )
        onSaved()
      } else {
        setPromoteMessage('Could not apply this to the folder.')
      }
    } finally {
      setPromoting(null)
    }
  }

  const clearField = async (field: string): Promise<void> => {
    setClearing(field)
    try {
      const result = await window.api.irLibraryClearItemMetadata(row.id, field)
      if (result.success) {
        setDraft((d) => ({ ...d, [field]: '' }))
        setClearedFields((s) => new Set(s).add(field))
        onSaved() // refetches the row so the field re-resolves to its inherited value, if any
      }
    } finally {
      setClearing(null)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const changed = FIELDS.filter((f) => draft[f.key].trim() !== (row[f.key] ?? ''))
      const failures: string[] = []
      for (const f of changed) {
        const result = await window.api.irLibrarySetItemMetadata(row.id, f.key, draft[f.key])
        if (!result.success) failures.push(f.label)
      }
      if (failures.length > 0) {
        setError(`Could not save: ${failures.join(', ')}.`)
        return
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !saving && onClose()}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[380px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Edit metadata</div>
          <div className="text-xs text-nm-text-3 mt-0.5 truncate">{displayName}</div>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {FIELDS.map((f) => {
            const sourceKey = `${f.key}_source` as keyof Row
            const source = row[sourceKey] as string | null
            const cleared = clearedFields.has(f.key)
            const hasOriginalValue = !!row[f.key]
            const hasUnsavedChange = draft[f.key].trim() !== (row[f.key] ?? '')
            return (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-nm-text-3 flex items-center justify-between gap-2">
                  <span>{f.label}</span>
                  <span className="text-nm-text-3 truncate">
                    {cleared ? 'cleared — reopen to see the inherited value' : `currently from ${sourceLabel(source)}`}
                  </span>
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    value={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    disabled={saving}
                    className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                  />
                  {hasOriginalValue && !cleared && (
                    <>
                      <button
                        onClick={() => void pushToFolder(f.key)}
                        disabled={saving || hasUnsavedChange || promoting === f.key}
                        title={hasUnsavedChange ? 'Save this field first' : 'Apply this value to the whole folder — items that already match get their own now-redundant override cleared'}
                        className="text-[11px] text-nm-text-3 hover:text-nm-accent disabled:opacity-50 flex-shrink-0"
                      >
                        {promoting === f.key ? '…' : 'Push to folder'}
                      </button>
                      <button
                        onClick={() => void clearField(f.key)}
                        disabled={saving || clearing === f.key}
                        title="Clear this override and fall back to whatever the folder or a parser would otherwise give it"
                        className="text-[11px] text-nm-text-3 hover:text-red-500 disabled:opacity-50 flex-shrink-0"
                      >
                        {clearing === f.key ? '…' : 'Clear'}
                      </button>
                    </>
                  )}
                </div>
              </label>
            )
          })}
        </div>

        {promoteMessage && <div className="px-4 pb-2 text-[11px] text-nm-text-2">{promoteMessage}</div>}
        {error && <div className="px-4 pb-2 text-[11px] text-red-500">{error}</div>}

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

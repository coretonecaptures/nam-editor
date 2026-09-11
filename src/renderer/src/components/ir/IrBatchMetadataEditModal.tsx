import { useState } from 'react'

/**
 * Multi-select batch metadata edit (parity backlog item 9). Ports NAM mode's BatchEditor.tsx
 * idiom exactly: a checkbox per field enables it for the batch, the text input next to it is
 * disabled until checked — "type it, check it to apply" rather than showing each item's existing
 * (possibly mixed) value and trying to represent a shared vs. differing state. Only checked fields
 * get written, to every selected item, always at the 'user_entered' tier.
 */

const FIELDS: Array<{ key: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone'; label: string; placeholder: string }> = [
  { key: 'manufacturer', label: 'Manufacturer', placeholder: 'e.g. Marshall' },
  { key: 'cabinet', label: 'Cabinet', placeholder: 'e.g. 1960A' },
  { key: 'speaker', label: 'Speaker', placeholder: 'e.g. Celestion V30' },
  { key: 'microphone', label: 'Microphone', placeholder: 'e.g. Shure SM57' }
]

export function IrBatchMetadataEditModal({
  itemIds,
  onClose,
  onSaved
}: {
  itemIds: string[]
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const toggle = (key: string): void => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    const activeFields = FIELDS.filter((f) => enabled.has(f.key) && values[f.key]?.trim())
    if (activeFields.length === 0) return
    setBusy(true)
    const totalWrites = activeFields.length * itemIds.length
    setProgress({ done: 0, total: totalWrites })
    let succeeded = 0
    let failed = 0
    for (const itemId of itemIds) {
      for (const f of activeFields) {
        const result = await window.api.irLibrarySetItemMetadata(itemId, f.key, values[f.key])
        if (result.success) succeeded++
        else failed++
        setProgress((prev) => (prev ? { done: prev.done + 1, total: prev.total } : prev))
      }
    }
    setBusy(false)
    setResultMessage(failed === 0 ? `Updated ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}.` : `${succeeded} writes succeeded, ${failed} failed.`)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !busy && onClose()}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[380px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Edit metadata</div>
          <div className="text-xs text-nm-text-3 mt-0.5">
            {itemIds.length} items selected — only checked fields below will be written
          </div>
        </div>

        <div className="px-4 py-3 flex flex-col gap-2.5">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabled.has(f.key)}
                onChange={() => toggle(f.key)}
                disabled={busy}
                className="w-3.5 h-3.5 rounded border-field-bd text-nm-accent focus:ring-0 flex-shrink-0"
              />
              <span className="text-xs text-nm-text-2 w-24 flex-shrink-0">{f.label}</span>
              <input
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                disabled={!enabled.has(f.key) || busy}
                placeholder={f.placeholder}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text disabled:opacity-40"
              />
            </label>
          ))}
        </div>

        {resultMessage && <div className="px-4 pb-2 text-[11px] text-nm-text-2">{resultMessage}</div>}
        {progress && <div className="px-4 pb-2 text-[11px] text-nm-text-3">Writing {progress.done} / {progress.total}…</div>}

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            {resultMessage ? 'Close' : 'Cancel'}
          </button>
          {!resultMessage && (
            <button
              onClick={() => void apply()}
              disabled={busy || enabled.size === 0}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Applying…' : `Apply to ${itemIds.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

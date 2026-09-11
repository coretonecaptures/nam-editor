import { useState } from 'react'
import { GEAR_TYPES, TONE_TYPES } from '../../types/nam'

/**
 * "Set project defaults" (parity backlog item 14) — every capture in a project typically shares
 * an amp, cab and modeller; this fills that in once instead of per capture. Only fills a capture
 * whose own field is genuinely untouched (SQL NULL) — see `applyProjectDefaults`'s own doc comment
 * in `namCaptureEnrichment.ts` for why a per-capture override (including a deliberate blank) is
 * never overwritten, matching this file's established "seed once, then sticky" model rather than
 * IR mode's live folder-inheritance one.
 */
export function IrProjectDefaultsModal({
  collectionId,
  projectName,
  onClose,
  onApplied
}: {
  collectionId: string
  projectName: string
  onClose: () => void
  onApplied: () => void
}): React.ReactElement {
  const [modeledBy, setModeledBy] = useState('')
  const [gearMake, setGearMake] = useState('')
  const [gearModel, setGearModel] = useState('')
  const [gearType, setGearType] = useState('')
  const [toneType, setToneType] = useState('')
  const [busy, setBusy] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const apply = async (): Promise<void> => {
    const patch: Record<string, string> = {}
    if (modeledBy.trim()) patch.modeledBy = modeledBy.trim()
    if (gearMake.trim()) patch.gearMake = gearMake.trim()
    if (gearModel.trim()) patch.gearModel = gearModel.trim()
    if (gearType) patch.gearType = gearType
    if (toneType) patch.toneType = toneType
    if (Object.keys(patch).length === 0) return

    setBusy(true)
    try {
      const result = await window.api.irLibraryApplyProjectDefaults(collectionId, patch)
      setResultMessage(
        result.itemsFilled > 0
          ? `Filled ${result.itemsFilled} field${result.itemsFilled === 1 ? '' : 's'} across this project's captures.`
          : 'Nothing to fill — every capture already has its own value for the fields you set.'
      )
      onApplied()
    } finally {
      setBusy(false)
    }
  }

  const hasAnyInput = !!(modeledBy.trim() || gearMake.trim() || gearModel.trim() || gearType || toneType)

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !busy && onClose()}>
      <div className="bg-panel border border-nm-border rounded-xl w-[380px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Set project defaults</div>
          <div className="text-xs text-nm-text-3 mt-0.5 truncate">{projectName}</div>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          <p className="text-[11px] text-nm-text-3">
            Fills only captures that don't already have their own value for a field. A capture already set — or
            deliberately cleared — is left untouched.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-nm-text-2">Modeled by</span>
            <input value={modeledBy} onChange={(e) => setModeledBy(e.target.value)} disabled={busy} className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-nm-text-2">Amp make</span>
            <input value={gearMake} onChange={(e) => setGearMake(e.target.value)} disabled={busy} className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-nm-text-2">Amp model</span>
            <input value={gearModel} onChange={(e) => setGearModel(e.target.value)} disabled={busy} className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-nm-text-2">Gear type</span>
            <select value={gearType} onChange={(e) => setGearType(e.target.value)} disabled={busy} className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text">
              <option value="">—</option>
              {GEAR_TYPES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-nm-text-2">Tone type</span>
            <select value={toneType} onChange={(e) => setToneType(e.target.value)} disabled={busy} className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text">
              <option value="">—</option>
              {TONE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>

        {resultMessage && <div className="px-4 pb-2 text-[11px] text-nm-text-2">{resultMessage}</div>}

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            {resultMessage ? 'Close' : 'Cancel'}
          </button>
          {!resultMessage && (
            <button
              onClick={() => void apply()}
              disabled={busy || !hasAnyInput}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Applying…' : 'Apply'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

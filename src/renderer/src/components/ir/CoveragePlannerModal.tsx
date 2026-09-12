import { useEffect, useState } from 'react'
import { describeIrLabAvailability, type IrLabStatus } from './irLabStatusMessage'

/**
 * The coverage planner (audit idea 1 / backlog step 10) — "your other four cabs all have an R121
 * as well, this one doesn't." Same modal chrome as IrDuplicatesModal.tsx (another "surface a
 * computed report over the catalog" view) rather than inventing new conventions.
 */
interface CoverageCombo {
  microphone: string
  position: string
}
interface CoverageGap extends CoverageCombo {
  presentInOtherRigCount: number
}
interface CoverageRig {
  cabinet: string
  speaker: string
  combosPresent: CoverageCombo[]
  gaps: CoverageGap[]
  targetProjectId: string | null
  targetProjectName: string | null
}

export function CoveragePlannerModal({
  libraryRootId,
  scopeLabel,
  onClose
}: {
  libraryRootId: number | null
  scopeLabel: string
  onClose: () => void
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [rigs, setRigs] = useState<CoverageRig[]>([])
  const [connectorAvailable, setConnectorAvailable] = useState(false)
  const [irLabStatus, setIrLabStatus] = useState<IrLabStatus | null>(null)
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.irLibraryGetCoverageMatrix(libraryRootId).then((result) => {
      if (cancelled) return
      setRigs(result)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [libraryRootId])

  useEffect(() => {
    window.api.irLabConnectorAvailable().then(setConnectorAvailable)
    window.api.irLibraryGetIrLabStatus().then(setIrLabStatus)
  }, [])

  const rigsWithGaps = rigs.filter((r) => r.gaps.length > 0)

  const captureGap = async (rig: CoverageRig, gap: CoverageGap): Promise<void> => {
    if (!rig.targetProjectId) return
    const key = `${rig.cabinet}|${rig.speaker}|${gap.microphone}|${gap.position}`
    setSendingKey(key)
    setSendResult(null)
    try {
      const result = await window.api.irLibrarySendProjectToIrLab(rig.targetProjectId, 'Cab IR')
      setSendResult({
        key,
        message: result.success
          ? 'Opened in IR Lab, ready to capture — pick the mic/position shown here once there.'
          : result.reason ?? 'Failed to open in IR Lab.'
      })
    } finally {
      setSendingKey(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[720px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-nm-border flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <div className="text-sm font-semibold text-nm-text">Coverage Planner</div>
            <div className="text-xs text-nm-text-3 mt-0.5">{scopeLabel}</div>
          </div>
          <button onClick={onClose} className="text-nm-text-3 hover:text-nm-text flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-nm-border-s flex-shrink-0 text-xs text-nm-text-2">
          {loading
            ? 'Comparing mic/position coverage across every cabinet+speaker rig…'
            : `${rigsWithGaps.length} of ${rigs.length} rig${rigs.length === 1 ? '' : 's'} missing a mic/position combo two or more other rigs already have.`}
          {!loading && (
            <div className="mt-1 text-nm-text-3">
              Matching is exact (trimmed, case-insensitive) — cabinet/speaker/mic names typed
              differently across captures won't be recognized as the same thing.
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && <div className="text-xs text-nm-text-3 py-6 text-center">Scanning…</div>}

          {!loading && rigsWithGaps.length === 0 && (
            <div className="text-xs text-nm-text-3 py-6 text-center">
              No gaps found — every rig with a linked mic/position already has what the rest of the
              library has.
            </div>
          )}

          <div className="flex flex-col gap-4">
            {rigsWithGaps.map((rig) => (
              <div key={`${rig.cabinet}|${rig.speaker}`} className="border border-nm-border-s rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-panel-2 text-[11px] text-nm-text-2">
                  <span className="font-semibold text-nm-text">{rig.cabinet}</span> · {rig.speaker}
                  <span className="text-nm-text-3">
                    {' '}
                    — has {rig.combosPresent.map((c) => `${c.microphone} @ ${c.position}`).join(', ') || 'nothing linked yet'}
                  </span>
                </div>
                <div className="divide-y divide-nm-border-s">
                  {rig.gaps.map((gap) => {
                    const key = `${rig.cabinet}|${rig.speaker}|${gap.microphone}|${gap.position}`
                    const availability = describeIrLabAvailability(connectorAvailable, irLabStatus, 'Capture this')
                    return (
                      <div key={key} className="px-3 py-2 flex items-center gap-2 text-xs">
                        <span className="flex-1 min-w-0 truncate text-nm-text">
                          Missing <strong>{gap.microphone} @ {gap.position}</strong>
                        </span>
                        <span className="text-nm-text-3 flex-shrink-0">
                          {gap.presentInOtherRigCount} other rig{gap.presentInOtherRigCount === 1 ? '' : 's'} have this
                        </span>
                        {rig.targetProjectId ? (
                          <button
                            onClick={() => void captureGap(rig, gap)}
                            disabled={!connectorAvailable || sendingKey === key}
                            title={availability.tooltip}
                            className="px-2.5 py-1 text-[11px] rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-40 flex-shrink-0"
                          >
                            {sendingKey === key ? 'Opening…' : 'Capture this in IR Lab →'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-nm-text-3 flex-shrink-0" title="This rig's cabinet/speaker came from a folder default, not a linked IR Lab project — nothing to jump to yet.">
                            no linked IR Lab project
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                {sendResult && rig.gaps.some((g) => `${rig.cabinet}|${rig.speaker}|${g.microphone}|${g.position}` === sendResult.key) && (
                  <div className="px-3 py-1.5 text-[11px] text-nm-text-2 bg-panel-2 border-t border-nm-border-s">
                    {sendResult.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

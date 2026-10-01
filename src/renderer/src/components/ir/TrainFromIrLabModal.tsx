import { useEffect, useMemo, useState } from 'react'
import type { NamCaptureRow, NamCaptureNameConflict, NamLabTrainIntent } from '../../types/namProjects'

/**
 * IR Lab's "Train in NAM Lab" (namlab://train?...) lands here — a review step, never an automatic
 * run. Every capture IR Lab asked for is listed; anything that looks like a retrain is flagged and
 * starts UNticked so it only trains if the user deliberately ticks it:
 *   - the capture's own nam-lab-result.json says it is trained, or
 *   - its model NAME matches a past successful run, a .nam already in the output folder (training
 *     again would write "<name> (1).nam"), or another capture in this batch.
 * Matches IrProjectDefaultsModal's shell (fixed backdrop, bg-panel card, header/body/footer).
 */

export interface TrainReviewRequest {
  projectName: string
  captures: NamCaptureRow[]
  /** Capture ids IR Lab sent that this catalog doesn't have (deleted, or not scanned yet). */
  missingIds: string[]
}

/** The captures an intent names, resolved against the project's catalogued captures. */
export function resolveTrainIntentCaptures(
  intent: Pick<NamLabTrainIntent, 'scope' | 'captureIds'>,
  captures: NamCaptureRow[]
): { captures: NamCaptureRow[]; missingIds: string[] } {
  if (intent.scope === 'untrained') return { captures: captures.filter((c) => !c.trained), missingIds: [] }
  const byId = new Map(captures.filter((c) => c.captureId).map((c) => [c.captureId as string, c]))
  const found: NamCaptureRow[] = []
  const missingIds: string[] = []
  for (const id of intent.captureIds) {
    const c = byId.get(id)
    if (c) found.push(c)
    else missingIds.push(id)
  }
  return { captures: found, missingIds }
}

export function hasTrainingFiles(c: NamCaptureRow): boolean {
  return !!c.excitationPath && !!c.recordingPath
}

/** Clean captures start ticked; anything trained before (by result file or by name) does not. */
export function defaultTicked(c: NamCaptureRow, conflict: NamCaptureNameConflict | undefined): boolean {
  return hasTrainingFiles(c) && !c.trained && !conflict
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function TrainFromIrLabModal({
  request,
  outputRoot,
  architectureLabel,
  epochs,
  busy,
  onChooseOutput,
  onSubmit,
  onClose
}: {
  request: TrainReviewRequest
  outputRoot: string
  architectureLabel: string
  epochs: number
  busy: boolean
  onChooseOutput: () => void
  onSubmit: (captures: NamCaptureRow[], mode: 'stage' | 'runNext') => void
  onClose: () => void
}): React.ReactElement {
  const [conflicts, setConflicts] = useState<Map<string, NamCaptureNameConflict>>(new Map())
  const [checking, setChecking] = useState(true)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  // Once the user has touched a checkbox, a later conflict re-check (output folder changed) must
  // not silently re-tick or un-tick their choices.
  const [touched, setTouched] = useState(false)

  const captures = request.captures
  useEffect(() => {
    let cancelled = false
    setChecking(true)
    const items = captures
      .filter((c) => c.recordingPath)
      .map((c) => ({ captureId: c.captureId ?? c.itemId, captureName: c.captureName, recordingPath: c.recordingPath as string }))
    window.api
      .checkNamCaptureNameConflicts({ finalModelRoot: outputRoot, captures: items })
      .then((list) => {
        if (cancelled) return
        const map = new Map(list.map((c) => [c.captureId, c]))
        setConflicts(map)
        if (!touched) {
          setTicked(new Set(captures.filter((c) => defaultTicked(c, map.get(c.captureId ?? c.itemId))).map((c) => c.itemId)))
        }
      })
      .catch(() => {
        if (!cancelled && !touched) setTicked(new Set(captures.filter((c) => defaultTicked(c, undefined)).map((c) => c.itemId)))
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
    // `touched` is read, not reacted to: a tick must not re-run the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures, outputRoot])

  const flaggedCount = useMemo(
    () => captures.filter((c) => c.trained || conflicts.has(c.captureId ?? c.itemId)).length,
    [captures, conflicts]
  )
  const selected = captures.filter((c) => ticked.has(c.itemId))

  const toggle = (c: NamCaptureRow): void => {
    setTouched(true)
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(c.itemId)) next.delete(c.itemId)
      else next.add(c.itemId)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !busy && onClose()}>
      <div className="bg-panel border border-nm-border rounded-xl w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Train from IR Lab</div>
          <div className="text-xs text-nm-text-3 mt-0.5 truncate">
            {request.projectName} · {captures.length} capture{captures.length === 1 ? '' : 's'}
            {flaggedCount > 0 && ` · ${flaggedCount} look${flaggedCount === 1 ? 's' : ''} trained already`}
          </div>
        </div>

        <div className="px-4 py-3 flex flex-col gap-2 overflow-y-auto min-h-0">
          {flaggedCount > 0 && (
            <p className="text-[11px] text-amber-400">
              Flagged captures are unticked. Tick one only if you really want to retrain it — the new model is saved
              beside the old one as “Name (1).nam”, it doesn’t replace it.
            </p>
          )}
          {request.missingIds.length > 0 && (
            <p className="text-[11px] text-nm-text-3">
              {request.missingIds.length} capture{request.missingIds.length === 1 ? '' : 's'} IR Lab sent aren’t in this
              library (deleted, or not scanned yet) and were skipped.
            </p>
          )}
          {captures.length === 0 && (
            <p className="text-xs text-nm-text-2 py-4 text-center">Nothing to train — every capture in this project is trained.</p>
          )}
          {captures.map((c) => {
            const conflict = conflicts.get(c.captureId ?? c.itemId)
            const files = hasTrainingFiles(c)
            const reasons: string[] = []
            if (c.trained) {
              reasons.push(
                `Trained ${fmtDate(c.result?.trainedAt)}${c.result?.outputModelPath ? ` → ${fileName(c.result.outputModelPath)}` : ''}`
              )
            }
            if (conflict?.historyMatch && !(c.trained && c.result?.outputModelPath === conflict.historyMatch.finalModelPath)) {
              reasons.push(
                `A model named “${conflict.modelName}” was trained ${fmtDate(conflict.historyMatch.timestamp)} (${fileName(conflict.historyMatch.finalModelPath)})`
              )
            }
            if (conflict?.existingFilePath) reasons.push(`${fileName(conflict.existingFilePath)} already exists in the output folder`)
            if (conflict?.duplicateInBatch) reasons.push('Same model name as another capture in this batch')
            if (!files) reasons.push('Missing its WAV files — can’t train')
            return (
              <label
                key={c.itemId}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border ${reasons.length ? 'border-amber-500/40' : 'border-nm-border-s'} ${files ? 'cursor-pointer hover:bg-hov' : 'opacity-60'}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={ticked.has(c.itemId)}
                  disabled={!files || busy}
                  onChange={() => toggle(c)}
                />
                <span className="flex flex-col min-w-0">
                  <span className="text-xs text-nm-text truncate">{c.captureName}</span>
                  {reasons.map((r) => (
                    <span key={r} className={`text-[11px] ${files ? 'text-amber-400' : 'text-nm-text-3'} truncate`} title={r}>
                      {r}
                    </span>
                  ))}
                </span>
              </label>
            )
          })}
        </div>

        <div className="px-4 py-2 border-t border-nm-border-s flex items-center gap-2 text-[11px] text-nm-text-3">
          <span className="truncate">
            {architectureLabel} · {epochs} epochs · {outputRoot ? <span title={outputRoot}>{fileName(outputRoot)}</span> : 'no output folder'}
          </span>
          <button onClick={onChooseOutput} disabled={busy} className="ml-auto shrink-0 text-nm-accent hover:underline disabled:opacity-50">
            {outputRoot ? 'Change folder…' : 'Choose output folder…'}
          </button>
        </div>

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(selected, 'stage')}
            disabled={busy || checking || !outputRoot || selected.length === 0}
            title="Adds them to the Batches page, waiting for Start"
            className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text hover:bg-hov disabled:opacity-50"
          >
            Stage {selected.length || ''}
          </button>
          <button
            onClick={() => onSubmit(selected, 'runNext')}
            disabled={busy || checking || !outputRoot || selected.length === 0}
            className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Queueing…' : `Train ${selected.length || ''} next`}
          </button>
        </div>
      </div>
    </div>
  )
}

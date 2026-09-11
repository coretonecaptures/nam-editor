import { useState } from 'react'

/**
 * Library Cleanup / Build Library for IR (parity backlog item 12) — preview-first restructuring
 * of a folder's contents into a new shape, built from resolved facts. See
 * `main/irCatalog/libraryCleanup.ts`'s own header for the scope trims against NAM mode's
 * `LibraryCleanupModal.tsx` this deliberately makes (free-text token template instead of a fixed
 * layout enum, no saved-ignore-list, no CSV export).
 */

type Stage = 'template' | 'preview' | 'result'

const TOKEN_HINT = '{manufacturer} {cabinet} {speaker} {microphone} {rate} {depth}'
const PREVIEW_ROWS = 60

export function IrLibraryCleanupModal({
  libraryRootId,
  folderId,
  scopeLabel,
  onClose,
  onDone
}: {
  libraryRootId: number | null
  folderId: number | null
  scopeLabel: string
  onClose: () => void
  onDone: () => void
}): React.ReactElement {
  const [stage, setStage] = useState<Stage>('template')
  const [template, setTemplate] = useState('{manufacturer}/{cabinet}')
  const [mode, setMode] = useState<'move' | 'copy'>('move')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{
    rows: Array<{ itemId: string; currentRelativePath: string; newRelativePath: string | null; needsReview: boolean; missingTokens: string[] }>
    readyCount: number
    needsReviewCount: number
    unchangedCount: number
  } | null>(null)
  const [result, setResult] = useState<{ moved: number; copied: number; failed: Array<{ itemId: string; error: string }> } | null>(null)

  const buildPreview = async (): Promise<void> => {
    if (!template.trim()) return
    setLoading(true)
    try {
      const p = await window.api.irLibraryPreviewLibraryCleanup({ libraryRootId, folderId, structureTemplate: template.trim() })
      setPreview(p)
      setStage('preview')
    } finally {
      setLoading(false)
    }
  }

  const run = async (): Promise<void> => {
    if (!preview) return
    setLoading(true)
    try {
      const r = await window.api.irLibraryRunLibraryCleanup({ libraryRootId, folderId }, preview.rows, mode)
      setResult(r)
      setStage('result')
      onDone()
    } finally {
      setLoading(false)
    }
  }

  const actionableRows = preview?.rows.filter((r) => !r.needsReview && r.newRelativePath) ?? []
  const reviewRows = preview?.rows.filter((r) => r.needsReview) ?? []

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !loading && onClose()}>
      <div className="bg-panel border border-nm-border rounded-xl w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-nm-border flex-shrink-0">
          <div className="text-sm font-semibold text-nm-text">Library Cleanup / Build Library</div>
          <div className="text-xs text-nm-text-3 mt-0.5">{scopeLabel}</div>
        </div>

        {stage === 'template' && (
          <div className="px-5 py-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-nm-text-2">New folder structure</span>
              <input
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="px-2 py-1.5 text-sm rounded border border-field-bd bg-field-bg text-nm-text font-mono"
              />
              <span className="text-[11px] text-nm-text-3">{TOKEN_HINT} — a segment with no tokens (e.g. "Sorted") is a literal folder name.</span>
            </label>
            <div className="flex items-center gap-4">
              <span className="text-xs text-nm-text-2">Action</span>
              <label className="flex items-center gap-1.5 text-xs text-nm-text">
                <input type="radio" checked={mode === 'move'} onChange={() => setMode('move')} /> Move
              </label>
              <label className="flex items-center gap-1.5 text-xs text-nm-text">
                <input type="radio" checked={mode === 'copy'} onChange={() => setMode('copy')} /> Copy (leaves originals in place)
              </label>
            </div>
          </div>
        )}

        {stage === 'preview' && preview && (
          <>
            <div className="px-5 py-3 border-b border-nm-border-s flex-shrink-0 flex items-center gap-4 flex-wrap text-xs">
              <span className="nam-chip chip-pedal">
                <span className="nam-dot" />
                {preview.readyCount} ready
              </span>
              {preview.needsReviewCount > 0 && (
                <span className="nam-chip chip-ir-missing">
                  <span className="nam-dot" />
                  {preview.needsReviewCount} need review — left in place
                </span>
              )}
              {preview.unchangedCount > 0 && <span className="text-nm-text-3">{preview.unchangedCount} already there</span>}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 font-mono text-xs">
              {actionableRows.slice(0, PREVIEW_ROWS).map((r) => (
                <div key={r.itemId} className="flex items-center gap-2 py-0.5 text-nm-text">
                  <span className="flex-1 min-w-0 truncate text-nm-text-3">{r.currentRelativePath}</span>
                  <span className="text-nm-text-3 flex-shrink-0">→</span>
                  <span className="flex-1 min-w-0 truncate">{r.newRelativePath}</span>
                </div>
              ))}
              {actionableRows.length > PREVIEW_ROWS && <div className="text-nm-text-3 pt-1">…and {actionableRows.length - PREVIEW_ROWS} more</div>}
              {reviewRows.length > 0 && (
                <div className="mt-3 pt-3 border-t border-nm-border-s">
                  <div className="text-[11px] text-nm-text-3 mb-1">Needs review (missing: manufacturer/cabinet/speaker/microphone) — will be left alone:</div>
                  {reviewRows.slice(0, 10).map((r) => (
                    <div key={r.itemId} className="text-nm-text-3 truncate py-0.5">
                      {r.currentRelativePath} — missing {r.missingTokens.join(', ')}
                    </div>
                  ))}
                  {reviewRows.length > 10 && <div className="text-nm-text-3">…and {reviewRows.length - 10} more</div>}
                </div>
              )}
            </div>
          </>
        )}

        {stage === 'result' && result && (
          <div className="px-5 py-4 flex flex-col gap-2 text-sm text-nm-text">
            <div>{mode === 'move' ? `Moved ${result.moved} item${result.moved === 1 ? '' : 's'}.` : `Copied ${result.copied} item${result.copied === 1 ? '' : 's'}.`}</div>
            {result.failed.length > 0 && (
              <div className="text-xs text-red-500">
                {result.failed.length} failed — most likely a name collision at the destination. Nothing else was affected.
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-nm-border-s flex-shrink-0 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            {stage === 'result' ? 'Close' : 'Cancel'}
          </button>
          {stage === 'template' && (
            <button
              onClick={() => void buildPreview()}
              disabled={loading || !template.trim()}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Building preview…' : 'Preview'}
            </button>
          )}
          {stage === 'preview' && (
            <>
              <button onClick={() => setStage('template')} disabled={loading} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
                Back
              </button>
              <button
                onClick={() => void run()}
                disabled={loading || actionableRows.length === 0}
                className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Running…' : `${mode === 'move' ? 'Move' : 'Copy'} ${actionableRows.length}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

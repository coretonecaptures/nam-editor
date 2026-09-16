import { useEffect, useMemo, useState } from 'react'

/**
 * Batch rename with a template (parity backlog item 6). Ports the INTERACTION from NAM mode's
 * BatchRenameModal.tsx (mode selector, live preview of old->new, collision detection before
 * anything runs) — not the file. NAM's token vocabulary (`{gear_make}`, `{tone_type}`, …) is the
 * wrong one here; IR's own resolved facts are manufacturer/cabinet/speaker/microphone/rate/depth,
 * already on every row this app fetches.
 *
 * Scope: the folder passed in, via the SAME folder+subtree resolution every other IR browse query
 * uses (`resolveFolderScopeIds` in queryLibrary.ts) — not a multi-select (IR mode's list doesn't
 * have one yet, see the parity backlog's note on item 4). Capped at MAX_ITEMS fetched so an
 * accidental whole-library scope can't try to preview/rename hundreds of thousands of rows.
 */

const MAX_ITEMS = 2000
const PREVIEW_ROWS = 40

interface CandidateRow {
  id: string
  relative_path: string
  display_name: string
  manufacturer: string | null
  cabinet: string | null
  speaker: string | null
  microphone: string | null
  sample_rate: number | null
  bit_depth: number | null
  missing_since: string | null
}

const TOKEN_HINT = '{name} {manufacturer} {cabinet} {speaker} {microphone} {rate} {depth} {index}'

function applyTemplate(template: string, row: CandidateRow, index: number, totalDigits: number): string {
  const baseName = row.display_name.replace(/\.wav$/i, '')
  return template
    .replace(/\{name\}/g, baseName)
    .replace(/\{manufacturer\}/g, row.manufacturer || '')
    .replace(/\{cabinet\}/g, row.cabinet || '')
    .replace(/\{speaker\}/g, row.speaker || '')
    .replace(/\{microphone\}/g, row.microphone || '')
    .replace(/\{rate\}/g, row.sample_rate ? `${(row.sample_rate / 1000).toFixed(row.sample_rate % 1000 ? 1 : 0)}k` : '')
    .replace(/\{depth\}/g, row.bit_depth ? `${row.bit_depth}-bit` : '')
    .replace(/\{index\}/g, String(index + 1).padStart(totalDigits, '0'))
    .trim()
}

export function IrBatchRenameModal({
  libraryRootId,
  folderId,
  scopeLabel,
  onClose,
  onRenamed
}: {
  libraryRootId: number | null
  folderId: number
  scopeLabel: string
  onClose: () => void
  onRenamed: () => void
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CandidateRow[]>([])
  const [total, setTotal] = useState(0)
  const [template, setTemplate] = useState('{manufacturer} {cabinet} {microphone} {index}')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.irLibraryQuery({ libraryRootId, folderId, offset: 0, limit: MAX_ITEMS }).then((res) => {
      if (cancelled) return
      setRows(res.rows.filter((r) => !r.missing_since))
      setTotal(res.total)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [libraryRootId, folderId])

  const digits = String(rows.length).length
  const previews = useMemo(
    () =>
      rows.map((row, i) => ({
        row,
        oldName: row.display_name.replace(/\.wav$/i, ''),
        newName: applyTemplate(template, row, i, digits)
      })),
    [rows, template, digits]
  )

  const dirOf = (relativePath: string): string => {
    const idx = relativePath.lastIndexOf('/')
    return idx === -1 ? '' : relativePath.slice(0, idx)
  }

  const collisionKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of previews) {
      const key = `${dirOf(p.row.relative_path)}::${p.newName.toLowerCase()}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [previews])

  const changedCount = previews.filter((p) => p.newName && p.newName !== p.oldName).length
  const hasCollisions = collisionKeys.size > 0

  const apply = async (): Promise<void> => {
    const toRename = previews.filter((p) => p.newName && p.newName !== p.oldName)
    if (toRename.length === 0 || hasCollisions) return
    setBusy(true)
    setProgress({ done: 0, total: toRename.length })
    // renameItemsBatch (fileOps.ts) does every disk rename first, then one DB transaction for the
    // catalog updates — a failure anywhere rolls the WHOLE batch back to exactly where it started,
    // rather than the old loop-of-independent-calls behavior that could leave some files renamed
    // and others not. Progress here is just a visual pulse while the single IPC round-trip runs;
    // there's no real per-item progress to report since it's one atomic call underneath.
    const results = await window.api.irLibraryRenameItemsBatch(toRename.map((p) => ({ itemId: p.row.id, newBaseName: p.newName })))
    setProgress({ done: toRename.length, total: toRename.length })
    const succeeded = results.filter((r) => r.success).length
    const failed = results.length - succeeded
    setBusy(false)
    setResultMessage(
      failed === 0
        ? `Renamed ${succeeded} item${succeeded === 1 ? '' : 's'}.`
        : `Rolled back — ${failed} item${failed === 1 ? '' : 's'} couldn't be renamed (likely a name collision fileOps.ts caught that this preview didn't, e.g. a file added since the batch loaded): ${results.find((r) => !r.success)?.error ?? ''}`
    )
    onRenamed()
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !busy && onClose()}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[620px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-nm-border flex-shrink-0">
          <div className="text-sm font-semibold text-nm-text">Batch rename</div>
          <div className="text-xs text-nm-text-3 mt-0.5">{scopeLabel}</div>
        </div>

        <div className="px-5 py-3 border-b border-nm-border-s flex-shrink-0 flex flex-col gap-2">
          <input
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={busy}
            className="w-full px-2 py-1.5 text-sm rounded border border-field-bd bg-field-bg text-nm-text font-mono"
          />
          <span className="text-[11px] text-nm-text-3">{TOKEN_HINT} — blank tokens are dropped, not left as gaps.</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-xs text-nm-text-3 py-6 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-nm-text-3 py-6 text-center">Nothing renameable in this scope (missing files are excluded).</div>
          ) : (
            <>
              {total > MAX_ITEMS && (
                <div className="text-[11px] text-amber-500 mb-2">
                  Showing the first {MAX_ITEMS.toLocaleString()} of {total.toLocaleString()} — narrow the folder or search first to cover the rest.
                </div>
              )}
              <div className="flex flex-col gap-0.5 font-mono text-xs">
                {previews.slice(0, PREVIEW_ROWS).map((p) => {
                  const collides = collisionKeys.has(`${dirOf(p.row.relative_path)}::${p.newName.toLowerCase()}`)
                  const unchanged = !p.newName || p.newName === p.oldName
                  return (
                    <div key={p.row.id} className={`flex items-center gap-2 py-0.5 ${collides ? 'text-red-500' : unchanged ? 'text-nm-text-3' : 'text-nm-text'}`}>
                      <span className="flex-1 min-w-0 truncate">{p.oldName}</span>
                      <span className="text-nm-text-3 flex-shrink-0">→</span>
                      <span className="flex-1 min-w-0 truncate">{p.newName || '(empty — skipped)'}</span>
                      {collides && <span className="text-[10px] flex-shrink-0">collision</span>}
                    </div>
                  )
                })}
                {previews.length > PREVIEW_ROWS && (
                  <div className="text-nm-text-3 pt-1">…and {previews.length - PREVIEW_ROWS} more</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-nm-border-s flex-shrink-0 flex flex-col gap-2">
          {hasCollisions && (
            <div className="text-[11px] text-red-500">
              {collisionKeys.size} name collision{collisionKeys.size === 1 ? '' : 's'} in this batch — fix the template before applying.
            </div>
          )}
          {resultMessage && <div className="text-[11px] text-nm-text-2">{resultMessage}</div>}
          {progress && <div className="text-[11px] text-nm-text-3">Renaming {progress.done} / {progress.total}…</div>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-nm-text-3">{changedCount} of {rows.length} will change</span>
            <div className="flex gap-2">
              <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
                {resultMessage ? 'Close' : 'Cancel'}
              </button>
              {!resultMessage && (
                <button
                  onClick={() => void apply()}
                  disabled={busy || changedCount === 0 || hasCollisions}
                  className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Renaming…' : `Rename ${changedCount}`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

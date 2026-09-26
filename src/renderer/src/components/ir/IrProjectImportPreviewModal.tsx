import { useEffect, useState } from 'react'

/**
 * Project Import Preview + Repair (ir-library-gpt-audit-2026-09-25's P0 "project import is
 * scan-led, not project-led") — same preview-then-apply discipline as `IrApplySuggestionsModal`/
 * `IrSpreadsheetImportModal`, applied to `enrichLabProjects`'s own write path instead of a manual
 * metadata edit. Shows, per capture, every field session.json would change before Apply actually
 * runs `enrichLabProjects` (scoped to just this one folder — see `labProjectImportPreview.ts`'s own
 * header for why Apply reuses that function rather than a second, frozen-diff writer).
 *
 * Scoped to one project folder at a time, not a library-wide dashboard — opened from the folder
 * tree's own "Preview Project Import…" context menu entry (`IrFolderTree.tsx`), which only offers
 * it on a folder already flagged `isLabProject`.
 */
export function IrProjectImportPreviewModal({
  folderId,
  libraryRootId,
  folderName,
  onClose,
  onApplied
}: {
  folderId: number
  libraryRootId: number
  folderName: string
  onClose: () => void
  onApplied: () => void
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof window.api.irLibraryPreviewProjectImport>>>(null)
  const [applying, setApplying] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.irLibraryPreviewProjectImport(folderId).then((p) => {
      if (cancelled) return
      setPreview(p)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [folderId])

  const apply = async (): Promise<void> => {
    setApplying(true)
    try {
      const stats = await window.api.irLibraryApplyProjectImport(folderId, libraryRootId)
      setResultMessage(`Updated ${stats.itemsEnriched} capture${stats.itemsEnriched === 1 ? '' : 's'}.`)
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  const capturesWithChanges = preview?.captures.filter((c) => c.changes.length > 0) ?? []

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !applying && onClose()}>
      <div className="bg-panel border border-nm-border rounded-xl w-[620px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Preview Project Import</div>
          <div className="text-xs text-nm-text-3 mt-0.5">{preview?.projectName ?? folderName}</div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="text-xs text-nm-text-3">Reading project…</div>
          ) : !preview ? (
            <div className="text-xs text-nm-text-3">This folder is no longer an IR Lab Project — nothing to preview.</div>
          ) : resultMessage ? (
            <div className="text-xs text-nm-text-2">{resultMessage}</div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-nm-text-3">
                {preview.changedFieldCount} field change{preview.changedFieldCount === 1 ? '' : 's'} across {capturesWithChanges.length} capture
                {capturesWithChanges.length === 1 ? '' : 's'}
                {preview.missingCaptureNames.length > 0 &&
                  ` — ${preview.missingCaptureNames.length} capture${preview.missingCaptureNames.length === 1 ? '' : 's'} in this project ${
                    preview.missingCaptureNames.length === 1 ? "isn't" : "aren't"
                  } in the catalog yet (moved, deleted, or never scanned).`}
              </div>

              {capturesWithChanges.length === 0 ? (
                <div className="text-xs text-nm-text-3">Nothing to update — the catalog already matches session.json for every capture.</div>
              ) : (
                capturesWithChanges.map((capture) => (
                  <div key={capture.itemId} className="rounded border border-field-bd p-2">
                    <div className="text-xs font-medium text-nm-text truncate">{capture.displayName}</div>
                    <div className="mt-1 space-y-1">
                      {capture.changes.map((change) => (
                        <div key={change.field} className="text-[11px] text-nm-text-2">
                          <span className="text-nm-text">{change.label}</span>{' '}
                          {change.currentValue && <span className="line-through opacity-60">{change.currentValue}</span>}
                          {change.currentValue && ' → '}
                          <span className={change.blockedByUserEdit ? 'font-mono text-nm-text-3 line-through' : 'font-mono text-nm-accent'}>
                            {change.newValue}
                          </span>
                          {change.blockedByUserEdit && <span className="text-nm-text-3"> (kept — manually entered)</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={applying} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            {resultMessage ? 'Close' : 'Cancel'}
          </button>
          {!resultMessage && preview && preview.changedFieldCount > 0 && (
            <button
              onClick={() => void apply()}
              disabled={applying}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {applying ? 'Applying…' : `Apply ${preview.changedFieldCount} change${preview.changedFieldCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

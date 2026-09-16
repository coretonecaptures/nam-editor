import { useState } from 'react'
import * as XLSX from 'xlsx'

/**
 * Spreadsheet import for bulk IR metadata (parity backlog item 19) — round-trips item 18's own
 * export: pick the edited .xlsx/.csv, preview exactly what would change per row, then apply.
 * Never writes anything until the user has seen the diff and clicked Apply — same two-step
 * preview/run split `IrLibraryCleanupModal.tsx` already uses for the same reason (a metadata edit
 * landing in the gap between preview and apply can't silently change what gets written, since
 * apply operates on the exact diff rows the preview produced, not a fresh recompute).
 *
 * Matches rows by the export's own "Path" column — see spreadsheetImport.ts's header for why that
 * needs no new id column to round-trip reliably.
 */

interface DiffField {
  field: string
  label: string
  oldValue: string
  newValue: string
}

interface DiffRow {
  absPath: string
  itemId: string | null
  displayName: string | null
  changes: DiffField[]
  notFound: boolean
}

export function IrSpreadsheetImportModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }): React.ReactElement {
  const [diffRows, setDiffRows] = useState<DiffRow[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const pickFile = async (): Promise<void> => {
    setError(null)
    const filePath = await window.api.openImportFile()
    if (!filePath) return
    setLoading(true)
    try {
      const binary = await window.api.readFileBinary(filePath)
      if (binary.error || !binary.data) {
        setError(`Could not read file: ${binary.error ?? 'unknown error'}`)
        return
      }
      const wb = XLSX.read(binary.data, { type: 'base64' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
      const importRows = rows
        .map((r) => ({
          absPath: String(r['Path'] ?? '').trim(),
          manufacturer: String(r['Manufacturer'] ?? ''),
          cabinet: String(r['Cabinet'] ?? ''),
          speaker: String(r['Speaker'] ?? ''),
          microphone: String(r['Microphone'] ?? '')
        }))
        .filter((r) => r.absPath)
      if (importRows.length === 0) {
        setError('No rows with a "Path" column found — this doesn\'t look like an exported IR catalog sheet.')
        return
      }
      const preview = await window.api.irLibraryPreviewSpreadsheetImport(importRows)
      setDiffRows(preview)
      setFileName(filePath.split(/[/\\]/).pop() ?? filePath)
    } catch (err) {
      setError(`Failed to parse spreadsheet: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const changedRows = diffRows?.filter((r) => r.changes.length > 0) ?? []
  const notFoundRows = diffRows?.filter((r) => r.notFound) ?? []
  const totalChanges = changedRows.reduce((sum, r) => sum + r.changes.length, 0)

  const apply = async (): Promise<void> => {
    if (!diffRows) return
    setApplying(true)
    try {
      const result = await window.api.irLibraryApplySpreadsheetImport(changedRows)
      setResultMessage(
        result.failed === 0
          ? `Applied ${result.applied} field change${result.applied === 1 ? '' : 's'} across ${changedRows.length} item${changedRows.length === 1 ? '' : 's'}.`
          : `Applied ${result.applied}, ${result.failed} refused (likely already a manual override elsewhere).`
      )
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !applying && onClose()}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Import metadata from spreadsheet</div>
          <div className="text-xs text-nm-text-3 mt-0.5">
            Pick a .xlsx/.csv exported from this catalog (or shaped like one — a "Path" column plus
            Manufacturer/Cabinet/Speaker/Microphone), edit it, and import it back.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!diffRows ? (
            <button
              onClick={() => void pickFile()}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Reading…' : 'Choose Spreadsheet…'}
            </button>
          ) : resultMessage ? (
            <div className="text-xs text-nm-text-2">{resultMessage}</div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-nm-text-3">
                {fileName} — {totalChanges} field change{totalChanges === 1 ? '' : 's'} across {changedRows.length} item
                {changedRows.length === 1 ? '' : 's'}
                {notFoundRows.length > 0 && `, ${notFoundRows.length} row${notFoundRows.length === 1 ? '' : 's'} not matched to any item`}.
              </div>
              {changedRows.length === 0 && notFoundRows.length === 0 && (
                <div className="text-xs text-nm-text-3">No differences — the sheet already matches the catalog.</div>
              )}
              {changedRows.map((row) => (
                <div key={row.absPath} className="rounded border border-field-bd p-2">
                  <div className="text-xs font-medium text-nm-text truncate" title={row.absPath}>
                    {row.displayName}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {row.changes.map((c) => (
                      <div key={c.field} className="text-[11px] text-nm-text-3 flex items-center gap-1.5">
                        <span className="w-20 flex-shrink-0">{c.label}</span>
                        <span className="line-through opacity-60">{c.oldValue || '(blank)'}</span>
                        <span>→</span>
                        <span className="text-nm-text">{c.newValue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {notFoundRows.length > 0 && (
                <details className="text-[11px] text-nm-text-3">
                  <summary className="cursor-pointer hover:text-nm-text">
                    {notFoundRows.length} row{notFoundRows.length === 1 ? '' : 's'} not found in the catalog
                  </summary>
                  <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                    {notFoundRows.map((r) => (
                      <div key={r.absPath} className="truncate" title={r.absPath}>
                        {r.absPath}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {error && <div className="mt-2 text-[11px] text-red-500">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={applying} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            {resultMessage ? 'Close' : 'Cancel'}
          </button>
          {diffRows && !resultMessage && changedRows.length > 0 && (
            <button
              onClick={() => void apply()}
              disabled={applying}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {applying ? 'Applying…' : `Apply ${totalChanges} change${totalChanges === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

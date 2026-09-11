import { useMemo, useState } from 'react'
import type { NamCaptureRow, NamProjectDetail } from '../../types/namProjects'

/**
 * "Build pack from project" (parity backlog item 16) — a completed NAM Project is exactly a
 * pack's worth of trained models, and NAM Lab already has the whole release pipeline (Pack Info,
 * checklists, delivery targets, PDF/spreadsheet export). There was no path from one to the other.
 *
 * Deliberately thin: writes `nam-pack.json` (via the existing, already-generic
 * `window.api.writePackInfo` — no new IPC channel needed at all) into the folder the trained
 * `.nam` files already live in, seeded from the project's own metadata, and opens a simple export
 * sheet through the existing `window.api.exportPackSheet`. Does NOT move or copy any model files —
 * a pack, in this app, is folder metadata layered onto files that are already there; moving
 * hundreds of MB of trained models around is real backlog-item-12-shaped work this item doesn't
 * need to duplicate. Does NOT open NAM mode's full visual PackInfoEditor either — that lives
 * inside App.tsx's own folder-tree navigation, in a completely separate React tree from NAM
 * Projects mode (AppRoot.tsx's own header comment: each shell owns its whole viewport, no shared
 * state). Switching to NAM mode and browsing to the written folder picks up the seeded
 * nam-pack.json exactly as if it had been filled in by hand there.
 */

function commonParentDir(paths: string[]): string | null {
  if (paths.length === 0) return null
  const normalized = paths.map((p) => p.replace(/\\/g, '/').split('/'))
  const dirs = normalized.map((segments) => segments.slice(0, -1)) // drop the filename
  let common = dirs[0]
  for (const segments of dirs.slice(1)) {
    const next: string[] = []
    for (let i = 0; i < Math.min(common.length, segments.length); i++) {
      if (common[i] !== segments[i]) break
      next.push(common[i])
    }
    common = next
    if (common.length === 0) return null
  }
  return common.join('/')
}

function buildExportSheetHtml(detail: NamProjectDetail, trained: NamCaptureRow[]): string {
  const rows = trained
    .map(
      (c) =>
        `<tr><td>${c.captureName}</td><td>${c.result?.architecture ?? ''}</td><td>${
          c.result?.validationEsr != null ? c.result.validationEsr.toFixed(5) : ''
        }</td></tr>`
    )
    .join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${detail.name} — Pack Sheet</title>
<style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}</style>
</head><body>
<h1>${detail.name}</h1>
${detail.description ? `<p>${detail.description}</p>` : ''}
<table><thead><tr><th>Capture</th><th>Architecture</th><th>Validation ESR</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>`
}

export function IrBuildPackModal({ detail, onClose }: { detail: NamProjectDetail; onClose: () => void }): React.ReactElement {
  const trained = useMemo(() => detail.captures.filter((c) => c.trained && c.result?.outputModelPath), [detail.captures])
  const detectedFolder = useMemo(
    () => commonParentDir(trained.map((c) => c.result!.outputModelPath as string)),
    [trained]
  )
  const [folder, setFolder] = useState<string | null>(detectedFolder)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const pickFolder = async (): Promise<void> => {
    const picked = await window.api.openFolder()
    if (picked) setFolder(picked)
  }

  const writePackInfo = async (): Promise<void> => {
    if (!folder) return
    setBusy(true)
    try {
      const existing = await window.api.readPackInfo(folder)
      const base = (existing.data as Record<string, unknown>) ?? {}
      const packInfo = {
        ...base,
        title: (base.title as string) || detail.name,
        description: (base.description as string) || detail.description || '',
        about: (base.about as string) || detail.projectNotes || ''
      }
      const result = await window.api.writePackInfo(folder, packInfo)
      setMessage(result.success ? `Pack Info written to "${folder}".` : result.error ?? 'Failed to write Pack Info.')
    } finally {
      setBusy(false)
    }
  }

  const exportSheet = async (): Promise<void> => {
    const html = buildExportSheetHtml(detail, trained)
    const result = await window.api.exportPackSheet(html)
    if (!result.success) setMessage(result.error ?? 'Failed to export the sheet.')
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !busy && onClose()}>
      <div className="bg-panel border border-nm-border rounded-xl w-[460px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Build pack from project</div>
          <div className="text-xs text-nm-text-3 mt-0.5 truncate">{detail.name}</div>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {trained.length === 0 ? (
            <p className="text-xs text-nm-text-3">No trained models in this project yet — train at least one capture first.</p>
          ) : (
            <p className="text-xs text-nm-text-2">
              {trained.length} trained model{trained.length === 1 ? '' : 's'} found.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-nm-text-2">Pack folder</span>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={folder ?? ''}
                placeholder={detectedFolder ? undefined : 'Trained models are in different folders — choose one'}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text truncate"
              />
              <button onClick={() => void pickFolder()} className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0">
                Choose…
              </button>
            </div>
          </label>

          <p className="text-[11px] text-nm-text-3">
            Writes Pack Info seeded from this project (title, description, notes) into that folder — nothing here moves or
            copies the trained files themselves. Open the folder in NAM mode afterward to fill in the rest (equipment,
            checklist, delivery targets) or refine what was seeded.
          </p>
        </div>

        {message && <div className="px-4 pb-2 text-[11px] text-nm-text-2">{message}</div>}

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            Close
          </button>
          <button
            onClick={() => void exportSheet()}
            disabled={busy || trained.length === 0}
            className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
          >
            Export Sheet
          </button>
          <button
            onClick={() => void writePackInfo()}
            disabled={busy || !folder}
            className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Writing…' : 'Write Pack Info'}
          </button>
        </div>
      </div>
    </div>
  )
}

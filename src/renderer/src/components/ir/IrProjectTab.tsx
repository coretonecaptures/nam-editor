import { useEffect, useState } from 'react'

type ProjectDetail = {
  id: string
  name: string
  createdAt: string | null
  items: Array<{
    itemId: string
    displayName: string
    captureId: string | null
    cabinet: string | null
    speaker: string | null
    microphone: string | null
    position: string | null
    captureType: string | null
    sampleRate: number | null
    isStereo: boolean
    isTrueStereo: boolean
    variants: Array<{ id: string; name: string; isCurrent: boolean; isArchived: boolean; createdAt: string | null }>
  }>
}

function Field({ label, value }: { label: string; value: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-panel-2 text-[11px] text-nm-text-2">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
      {label}: {value}
    </span>
  )
}

/**
 * Project tab (plan section 8c/§6) — shown only when the selected folder is a detected IR Lab
 * Project (labProjectEnrichment.ts). The value-add over what's already visible in the row
 * list/badges is variant/edit-revision history, which nothing else in the UI surfaces.
 */
export function IrProjectTab({ folderId }: { folderId: number | null }): React.ReactElement {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)

  useEffect(() => {
    if (folderId == null) {
      setDetail(null)
      return
    }
    let cancelled = false
    window.api.irLibraryGetProjectDetailForFolder(folderId).then((d) => {
      if (!cancelled) setDetail(d)
    })
    return () => {
      cancelled = true
    }
  }, [folderId])

  if (folderId == null) {
    return <div className="p-3 text-xs text-nm-text-3">Select a folder to view its Project details.</div>
  }
  if (!detail) {
    return <div className="p-3 text-xs text-nm-text-3">Loading…</div>
  }

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto h-full">
      <div>
        <div className="text-sm font-medium text-nm-text truncate">{detail.name}</div>
        <div className="text-xs text-nm-text-3">
          IR Lab Project · {detail.items.length} capture{detail.items.length === 1 ? '' : 's'}
          {detail.createdAt ? ` · created ${new Date(detail.createdAt).toLocaleDateString()}` : ''}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {detail.items.map((item) => {
          const currentVariant = item.variants.find((v) => v.isCurrent)
          const archivedCount = item.variants.filter((v) => v.isArchived).length
          return (
            <div key={item.itemId} className="rounded border border-nm-border-s p-2 flex flex-col gap-1.5">
              <div className="text-xs font-medium text-nm-text truncate">{item.displayName}</div>
              <div className="flex flex-wrap items-center gap-1">
                <Field label="Cabinet" value={item.cabinet} />
                <Field label="Speaker" value={item.speaker} />
                <Field label="Mic" value={item.microphone} />
                <Field label="Position" value={item.position} />
                <Field label="Type" value={item.captureType} />
              </div>
              <div className="text-[11px] text-nm-text-3">
                {item.sampleRate ? `${item.sampleRate.toLocaleString()} Hz` : null}
                {item.isTrueStereo ? ' · true stereo' : item.isStereo ? ' · stereo' : ' · mono'}
              </div>
              {item.variants.length > 0 && (
                <div className="text-[11px] text-nm-text-3">
                  {item.variants.length} variant{item.variants.length === 1 ? '' : 's'}
                  {currentVariant ? ` · current: ${currentVariant.name}` : ''}
                  {archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
                </div>
              )}
            </div>
          )
        })}
        {detail.items.length === 0 && <div className="text-xs text-nm-text-3">No captures matched yet.</div>}
      </div>
    </div>
  )
}

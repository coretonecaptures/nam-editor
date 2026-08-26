import { useEffect, useState } from 'react'

interface ProjectDetailMic {
  type: string | null
  polarPattern: string | null
  targetZone: string | null
  distance: number | null
  distanceUnit: string | null
  axisAngleDeg: number | null
  signalChainOverride: string | null
  notes: string | null
}

type ProjectDetail = {
  id: string
  name: string
  createdAt: string | null
  cabinet: string | null
  speaker: string | null
  amplifier: string | null
  room: string | null
  signalChain: string | null
  description: string | null
  projectNotes: string | null
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
    speakerPosition: string | null
    modeledMicrophone: string | null
    presetKind: string | null
    micA: ProjectDetailMic
    micB: ProjectDetailMic
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

/** A mic slot's structured detail — only rendered when the slot actually has SOMETHING filled in.
 * Every mic_b_* column exists even on a single-mic capture (nothing distinguishes "never touched"
 * from "explicitly blank" at the schema level, see labProjectEnrichment.ts's own comment on why
 * the doc's suggested real-blend check isn't available to a disk-only reader), so gating on "any
 * field present" is the best signal this component has for "is there a Mic B here worth showing."
 */
function MicDetail({ label, mic }: { label: string; mic: ProjectDetailMic }): React.ReactElement | null {
  const hasAnything = mic.type || mic.polarPattern || mic.targetZone || mic.distance != null || mic.notes
  if (!hasAnything) return null
  const distance = mic.distance != null ? `${mic.distance.toFixed(2)}${mic.distanceUnit ?? ''}` : null
  return (
    <div className="flex flex-col gap-1 pl-2 border-l-2 border-nm-border-s">
      <div className="text-[11px] font-medium text-nm-text-2">{label}</div>
      <div className="flex flex-wrap items-center gap-1">
        <Field label="Type" value={mic.type} />
        <Field label="Pattern" value={mic.polarPattern} />
        <Field label="Zone" value={mic.targetZone} />
        <Field label="Distance" value={distance} />
        <Field label="Angle" value={mic.axisAngleDeg != null ? `${mic.axisAngleDeg}°` : null} />
        <Field label="Chain" value={mic.signalChainOverride} />
      </div>
      {mic.notes && <div className="text-[11px] text-nm-text-3 italic">{mic.notes}</div>}
    </div>
  )
}

/**
 * Project tab (plan section 8c/§6) — shown only when the selected folder is a detected IR Lab
 * Project (labProjectEnrichment.ts). Surfaces both the project-level "Project Details" fields
 * (2026-08-26 — cabinet/speaker/amplifier/room/signalChain/description/notes, entered once for
 * the whole rig) and each capture's own metadata, including variant/edit-revision history and the
 * same day's per-capture additions (speaker position, modeled mic, preset kind, structured Mic
 * A/B detail) — none of which anything else in the UI surfaces.
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

  const hasProjectDetails = detail.cabinet || detail.speaker || detail.amplifier || detail.room || detail.signalChain || detail.description

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto h-full">
      <div>
        <div className="text-sm font-medium text-nm-text truncate">{detail.name}</div>
        <div className="text-xs text-nm-text-3">
          IR Lab Project · {detail.items.length} capture{detail.items.length === 1 ? '' : 's'}
          {detail.createdAt ? ` · created ${new Date(detail.createdAt).toLocaleDateString()}` : ''}
        </div>
      </div>

      {/* "Project Details" (2026-08-26) — the rig-wide defaults every capture below falls back to
          when its own cabinet/speaker is blank (queryLibrary.ts's own 3-way COALESCE does the same
          fallback for the browse list; shown here explicitly since this is where they're set). */}
      {hasProjectDetails && (
        <div className="rounded border border-nm-border-s p-2 flex flex-col gap-1.5 bg-panel-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-nm-text-3">Rig / Project Details</div>
          <div className="flex flex-wrap items-center gap-1">
            <Field label="Cabinet" value={detail.cabinet} />
            <Field label="Speaker" value={detail.speaker} />
            <Field label="Amp" value={detail.amplifier} />
            <Field label="Room" value={detail.room} />
            <Field label="Chain" value={detail.signalChain} />
          </div>
          {detail.description && <div className="text-xs text-nm-text-2">{detail.description}</div>}
          {detail.projectNotes && <div className="text-[11px] text-nm-text-3 italic">{detail.projectNotes}</div>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {detail.items.map((item) => {
          const currentVariant = item.variants.find((v) => v.isCurrent)
          const archivedCount = item.variants.filter((v) => v.isArchived).length
          // Display-time fallback to the project's own value, same rule queryLibrary.ts's browse
          // SELECT applies — a blank capture-level cabinet/speaker isn't "unknown," it means "same
          // as the project."
          const effectiveCabinet = item.cabinet ?? detail.cabinet
          const effectiveSpeaker = item.speaker ?? detail.speaker
          return (
            <div key={item.itemId} className="rounded border border-nm-border-s p-2 flex flex-col gap-1.5">
              <div className="text-xs font-medium text-nm-text truncate">{item.displayName}</div>
              <div className="flex flex-wrap items-center gap-1">
                <Field label="Cabinet" value={effectiveCabinet} />
                <Field label="Speaker" value={effectiveSpeaker} />
                <Field label="Mic" value={item.microphone} />
                <Field label="Position" value={item.position} />
                <Field label="Speaker Pos" value={item.speakerPosition} />
                <Field label="Modeled Mic" value={item.modeledMicrophone} />
                <Field label="Preset" value={item.presetKind} />
                <Field label="Type" value={item.captureType} />
              </div>
              <div className="text-[11px] text-nm-text-3">
                {item.sampleRate ? `${item.sampleRate.toLocaleString()} Hz` : null}
                {item.isTrueStereo ? ' · true stereo' : item.isStereo ? ' · stereo' : ' · mono'}
              </div>
              <MicDetail label="Mic A" mic={item.micA} />
              <MicDetail label="Mic B" mic={item.micB} />
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

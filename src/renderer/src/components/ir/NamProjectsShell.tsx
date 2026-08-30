import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu } from '../ContextMenu'
import { TRAINER_ARCHITECTURES, BUILT_IN_CAPTURE_PROFILES } from '../../types/trainer'
import type { NamProjectSummary, NamProjectDetail, NamCaptureRow } from '../../types/namProjects'
import type { TrainerHistoryEntry } from '../../types/trainer'
import { goToTrainingBatches } from '../../appNav'

/** Friendly label for an architecture id ("standard" -> "Standard"), matching the Trainer tab. */
const ARCH_LABEL: Record<string, string> = Object.fromEntries(
  BUILT_IN_CAPTURE_PROFILES.map((p) => [p.id, p.name])
)

/**
 * "NAM Projects" mode — the third top-level workspace (docs/nam-capture-import-plan-2026-08-29.md
 * §1). Read-only view over IR Lab NAM Capture projects already in the shared catalog (they enter
 * it through IR mode's "Add Library Folder", same as any other folder), plus the write action:
 * select captures (a whole project, a right-clicked one, or a multi-select) and stage them as a
 * training batch, which lands you on the trainer's Batches page with the jobs sitting ready.
 * Trained/untrained comes straight from each capture folder's nam-lab-result.json.
 *
 * Its own shell, not a fork of IrModeShell — IrItemRow is welded to IR-only columns and there's
 * no audition half. The three-region skeleton, Tailwind tokens, col-resize divider, filter
 * boxes, status chips, and blue-dot / nam-chip idioms all match the other two modes.
 */

const OUTPUT_ROOT_KEY = 'nam-lab-nam-projects-output-root'
const ARCH_KEY = 'nam-lab-nam-projects-architecture'
const EPOCHS_KEY = 'nam-lab-nam-projects-epochs'

type StatusFilter = 'all' | 'untrained' | 'trained' | 'synthetic'

function TrainedBadge({ trained }: { trained: boolean }): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] flex-shrink-0 ${
        trained ? 'text-emerald-600 dark:text-emerald-400' : 'text-nm-text-3'
      }`}
      title={trained ? 'A model has been trained from this capture' : 'No model trained yet'}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${trained ? 'bg-emerald-500' : 'bg-nm-text-3/50'}`} />
      {trained ? 'Trained' : 'Untrained'}
    </span>
  )
}

function CaptureRow({
  capture,
  selected,
  onToggleSelect,
  onContextMenu
}: {
  capture: NamCaptureRow
  selected: boolean
  onToggleSelect: () => void
  onContextMenu: (c: NamCaptureRow, x: number, y: number) => void
}): React.ReactElement {
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(capture, e.clientX, e.clientY)
      }}
      className={`flex items-center gap-2 px-3 py-2 border-b border-nm-border-s text-xs ${
        selected ? 'bg-active-bg' : 'hover:bg-hov'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="truncate text-sm leading-tight text-nm-text">{capture.captureName}</div>
        <div className="flex items-center gap-2 text-[11px] text-nm-text-3">
          {capture.captureScope && <span>{capture.captureScope}</span>}
          {capture.sampleRate != null && (
            <span>{(capture.sampleRate / 1000).toFixed(capture.sampleRate % 1000 ? 1 : 0)}k</span>
          )}
          {capture.measuredLatencySamples != null && <span>{capture.measuredLatencySamples} smp latency</span>}
          {capture.synthetic && (
            <span
              className="nam-chip opacity-60 flex-shrink-0"
              title={
                capture.syntheticSourceIrName
                  ? `Synthetic — generated from ${capture.syntheticSourceIrName}, not a real capture`
                  : 'Synthetic — not a real capture'
              }
            >
              <span className="nam-dot" />
              synthetic
            </span>
          )}
        </div>
      </div>
      {capture.trained && capture.result?.validationEsr != null && (
        <span className="text-[11px] text-nm-text-3 flex-shrink-0" title="Validation ESR of the trained model">
          ESR {capture.result.validationEsr.toFixed(4)}
        </span>
      )}
      <TrainedBadge trained={capture.trained} />
    </div>
  )
}

function ProjectRailRow({
  project,
  selected,
  onSelect,
  onContextMenu
}: {
  project: NamProjectSummary
  selected: boolean
  onSelect: () => void
  onContextMenu: (p: NamProjectSummary, x: number, y: number) => void
}): React.ReactElement {
  const allTrained = project.captureCount > 0 && project.trainedCount === project.captureCount
  return (
    <button
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(project, e.clientX, e.clientY)
      }}
      className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs rounded ${
        selected ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov text-nm-text'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${allTrained ? 'bg-emerald-500' : 'bg-blue-500'}`}
        title={allTrained ? 'Every capture trained' : 'Has untrained captures'}
      />
      <span className="truncate flex-1">{project.name}</span>
      <span className={`flex-shrink-0 ${selected ? 'text-nm-accent' : 'text-nm-text-3'}`}>
        {project.trainedCount}/{project.captureCount}
      </span>
    </button>
  )
}

function DetailField({ label, value }: { label: string; value: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-nm-text-3">{label}</span>
      <span className="text-xs text-nm-text">{value}</span>
    </div>
  )
}

function StatusChip({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] rounded-full border ${
        active
          ? 'bg-nm-accent text-accent-fg border-nm-accent'
          : 'border-field-bd text-nm-text-2 hover:bg-hov'
      }`}
    >
      {label}
    </button>
  )
}

/** A capture is batch-eligible if it isn't trained yet and both WAV paths resolved. Synthetic
 * captures only count when includeSynthetic is on. */
function isQueueEligible(c: NamCaptureRow, includeSynthetic: boolean): boolean {
  return !c.trained && (includeSynthetic || !c.synthetic) && !!c.excitationPath && !!c.recordingPath
}

export function NamProjectsShell(): React.ReactElement {
  const [projects, setProjects] = useState<NamProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NamProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captureMenu, setCaptureMenu] = useState<{ capture: NamCaptureRow; x: number; y: number } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ project: NamProjectSummary; x: number; y: number } | null>(null)

  const [projectFilter, setProjectFilter] = useState('')
  const [captureFilter, setCaptureFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedCaptureIds, setSelectedCaptureIds] = useState<Set<string>>(new Set())

  const [railWidth, setRailWidth] = useState(240)
  const dragging = useRef(false)
  // Which nam-capture-import history entries we've already reacted to — so a finished training
  // run refreshes the trained badges without a manual rescan, but only once per job.
  const seenFinishedJobs = useRef<Set<string>>(new Set())

  const [architecture, setArchitecture] = useState<string>(() => {
    try {
      return localStorage.getItem(ARCH_KEY) || 'standard'
    } catch {
      return 'standard'
    }
  })
  const [epochs, setEpochs] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(EPOCHS_KEY)) || 1000
    } catch {
      return 1000
    }
  })
  const [outputRoot, setOutputRoot] = useState<string>(() => {
    try {
      return localStorage.getItem(OUTPUT_ROOT_KEY) || ''
    } catch {
      return ''
    }
  })
  const [includeSynthetic, setIncludeSynthetic] = useState(false)
  const [queueing, setQueueing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(ARCH_KEY, architecture)
    } catch {
      /* non-fatal */
    }
  }, [architecture])
  useEffect(() => {
    try {
      localStorage.setItem(EPOCHS_KEY, String(epochs))
    } catch {
      /* non-fatal */
    }
  }, [epochs])
  useEffect(() => {
    try {
      if (outputRoot) localStorage.setItem(OUTPUT_ROOT_KEY, outputRoot)
    } catch {
      /* non-fatal */
    }
  }, [outputRoot])

  const refreshProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.irLibraryListNamProjects()
      setProjects(list)
      setSelectedId((prev) => (prev && list.some((p) => p.collectionId === prev) ? prev : list[0]?.collectionId ?? null))
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  const refreshDetail = useCallback(async (collectionId: string) => {
    try {
      setDetail(await window.api.irLibraryGetNamProjectDetail(collectionId))
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    setSelectedCaptureIds(new Set())
    if (selectedId) void refreshDetail(selectedId)
    else setDetail(null)
  }, [selectedId, refreshDetail])

  // When a NAM-capture training run finishes, the main process has written nam-lab-result.json
  // into the capture folder; getNamProjectDetail re-reads that sidecar every call, so a plain
  // refetch flips the trained badges — no rescan needed. History arrives on its own channel
  // (trainer:update's payload carries an empty history array).
  useEffect(() => {
    const off = window.api.onTrainerHistory((history: TrainerHistoryEntry[]) => {
      const fresh = history.filter(
        (h) =>
          h.sourceMode === 'nam-capture-import' &&
          h.status === 'success' &&
          !seenFinishedJobs.current.has(h.historyId)
      )
      if (fresh.length === 0) return
      for (const h of fresh) seenFinishedJobs.current.add(h.historyId)
      void refreshProjects()
      if (selectedId) void refreshDetail(selectedId)
    })
    return off
  }, [selectedId, refreshProjects, refreshDetail])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      setRailWidth(Math.min(420, Math.max(180, e.clientX)))
    }
    const up = (): void => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const rescanAll = useCallback(async () => {
    setError(null)
    setMessage(null)
    setScanning(true)
    try {
      const roots = await window.api.irLibraryListRoots()
      for (const root of roots) await window.api.irLibraryScan(root.path, root.label)
      await refreshProjects()
      if (selectedId) await refreshDetail(selectedId)
    } catch (err) {
      setError(String(err))
    } finally {
      setScanning(false)
    }
  }, [refreshProjects, refreshDetail, selectedId])

  const handleAddFolder = useCallback(async () => {
    const folder = await window.api.openFolder()
    if (!folder) return
    setError(null)
    setMessage(null)
    setScanning(true)
    try {
      await window.api.irLibraryScan(folder, null)
      await refreshProjects()
      if (selectedId) await refreshDetail(selectedId)
    } catch (err) {
      setError(String(err))
    } finally {
      setScanning(false)
    }
  }, [refreshProjects, refreshDetail, selectedId])

  const handleChooseOutput = useCallback(async () => {
    const folder = await window.api.openFolder()
    if (folder) setOutputRoot(folder)
  }, [])

  // --- filtering ---
  const visibleProjects = useMemo(() => {
    const q = projectFilter.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  }, [projects, projectFilter])

  const visibleCaptures = useMemo(() => {
    if (!detail) return []
    const q = captureFilter.trim().toLowerCase()
    return detail.captures.filter((c) => {
      if (q && !c.captureName.toLowerCase().includes(q)) return false
      if (statusFilter === 'trained') return c.trained
      if (statusFilter === 'untrained') return !c.trained
      if (statusFilter === 'synthetic') return c.synthetic
      return true
    })
  }, [detail, captureFilter, statusFilter])

  const toggleCapture = useCallback((itemId: string) => {
    setSelectedCaptureIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const selectAllVisible = useCallback(() => {
    setSelectedCaptureIds((prev) => {
      const next = new Set(prev)
      const allSelected = visibleCaptures.every((c) => next.has(c.itemId))
      for (const c of visibleCaptures) {
        if (allSelected) next.delete(c.itemId)
        else next.add(c.itemId)
      }
      return next
    })
  }, [visibleCaptures])

  const selectedCaptures = useMemo(
    () => (detail ? detail.captures.filter((c) => selectedCaptureIds.has(c.itemId)) : []),
    [detail, selectedCaptureIds]
  )

  // --- batch creation ---
  const stageBatch = useCallback(
    async (captures: NamCaptureRow[], labelSuffix: string) => {
      if (!detail || captures.length === 0) return
      if (!outputRoot) {
        setError('Choose a model output folder first (right panel).')
        return
      }
      const eligible = captures.filter((c) => isQueueEligible(c, true)) // include-synthetic gate handled per call site
      if (eligible.length === 0) {
        setError('Those captures are all trained already, or missing their WAV files.')
        return
      }
      setQueueing(true)
      setError(null)
      setMessage(null)
      try {
        const res = await window.api.enqueueNamCaptureImport({
          captures: eligible.map((c) => ({
            excitationPath: c.excitationPath as string,
            recordingPath: c.recordingPath as string,
            captureId: c.captureId ?? c.itemId,
            captureName: c.captureName,
            captureFolderPath: c.captureFolderPath as string,
            projectName: detail.name,
            synthetic: c.synthetic
          })),
          finalModelRoot: outputRoot,
          architecture,
          epochs,
          includeSynthetic: true, // eligible list already reflects the caller's intent
          staged: true,
          submissionLabel: `${detail.name} — ${labelSuffix}`
        })
        if (res.success) {
          setMessage(`Staged ${res.built ?? eligible.length} job${(res.built ?? 1) === 1 ? '' : 's'} — opening the Batches page…`)
          goToTrainingBatches()
        } else {
          setError(res.error ?? 'Could not stage the batch.')
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setQueueing(false)
      }
    },
    [detail, outputRoot, architecture, epochs]
  )

  const projectEligible = useMemo(
    () => (detail ? detail.captures.filter((c) => isQueueEligible(c, includeSynthetic)) : []),
    [detail, includeSynthetic]
  )

  const revealCaptureFolder = useCallback((capture: NamCaptureRow) => {
    setCaptureMenu(null)
    if (capture.captureFolderPath) window.api.revealFile(capture.captureFolderPath)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-app-bg text-nm-text overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-nm-border flex-shrink-0">
        <h1 className="text-sm font-semibold text-nm-text-2">NAM Projects</h1>
        <button
          onClick={handleAddFolder}
          disabled={scanning}
          className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
        >
          {scanning ? 'Scanning…' : 'Add Folder'}
        </button>
        <button
          onClick={rescanAll}
          disabled={scanning}
          className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50"
        >
          Rescan all
        </button>
        {projects.length > 0 && (
          <span className="text-xs text-nm-text-3 flex-shrink-0">
            {projects.length} project{projects.length === 1 ? '' : 's'} ·{' '}
            {projects.reduce((n, p) => n + p.trainedCount, 0)}/{projects.reduce((n, p) => n + p.captureCount, 0)} captures trained
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex-shrink-0">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-nm-text-3 hover:text-nm-text">
            ×
          </button>
        </div>
      )}
      {message && (
        <div className="flex items-center justify-between px-4 py-1 text-xs text-nm-text-2 bg-active-bg flex-shrink-0">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-nm-text-3 hover:text-nm-text">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-nm-text-3">Loading NAM projects…</div>
      ) : projects.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 text-nm-text-2">
          <p className="text-sm">No NAM Capture projects in the catalog yet.</p>
          <p className="text-xs text-nm-text-3 max-w-[380px]">
            Add a folder that contains IR Lab NAM Capture projects (each capture is a folder with an{' '}
            <code>excitation.wav</code>, <code>recording.wav</code> and <code>nam-capture.json</code>).
          </p>
          <button
            onClick={handleAddFolder}
            className="px-3 py-1.5 text-sm rounded bg-nm-accent hover:opacity-90 text-accent-fg"
          >
            Add Folder
          </button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div
            style={{ width: railWidth }}
            className="flex-shrink-0 flex flex-col min-h-0 border-r border-nm-border-s"
          >
            <div className="px-2 py-1.5 border-b border-nm-border-s flex-shrink-0">
              <input
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                placeholder="Filter projects…"
                className="w-full text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
              {visibleProjects.map((p) => (
                <ProjectRailRow
                  key={p.collectionId}
                  project={p}
                  selected={p.collectionId === selectedId}
                  onSelect={() => setSelectedId(p.collectionId)}
                  onContextMenu={(project, x, y) => setProjectMenu({ project, x, y })}
                />
              ))}
              {visibleProjects.length === 0 && (
                <div className="px-2 py-2 text-[11px] text-nm-text-3">No projects match.</div>
              )}
            </div>
          </div>
          <div
            onMouseDown={() => {
              dragging.current = true
            }}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-nm-accent/40 active:bg-nm-accent/60 transition-colors"
          />

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {detail && (
              <>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-nm-border flex-shrink-0">
                  <span className="text-sm font-medium text-nm-text truncate">{detail.name}</span>
                  <span className="text-xs text-nm-text-3">
                    {detail.captureCount} capture{detail.captureCount === 1 ? '' : 's'}
                    {detail.syntheticCount > 0 && ` · ${detail.syntheticCount} synthetic`}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-nm-border-s flex-shrink-0">
                  <input
                    value={captureFilter}
                    onChange={(e) => setCaptureFilter(e.target.value)}
                    placeholder="Filter captures…"
                    className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded border border-field-bd bg-field-bg"
                  />
                  {(['all', 'untrained', 'trained', 'synthetic'] as const).map((s) => (
                    <StatusChip
                      key={s}
                      label={s[0].toUpperCase() + s.slice(1)}
                      active={statusFilter === s}
                      onClick={() => setStatusFilter(s)}
                    />
                  ))}
                </div>
                {visibleCaptures.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-1 border-b border-nm-border-s flex-shrink-0 text-[11px] text-nm-text-3">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={visibleCaptures.every((c) => selectedCaptureIds.has(c.itemId))}
                        onChange={selectAllVisible}
                      />
                      Select all shown
                    </label>
                  </div>
                )}
              </>
            )}
            <div className="flex-1 overflow-y-auto">
              {visibleCaptures.map((c) => (
                <CaptureRow
                  key={c.itemId}
                  capture={c}
                  selected={selectedCaptureIds.has(c.itemId)}
                  onToggleSelect={() => toggleCapture(c.itemId)}
                  onContextMenu={(capture, x, y) => setCaptureMenu({ capture, x, y })}
                />
              ))}
              {detail && visibleCaptures.length === 0 && (
                <div className="px-4 py-4 text-xs text-nm-text-3">No captures match this filter.</div>
              )}
            </div>

            {selectedCaptures.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 border-t border-nm-border bg-panel-2 flex-shrink-0">
                <span className="text-xs text-nm-text-2">
                  {selectedCaptures.length} selected
                  {selectedCaptures.filter((c) => isQueueEligible(c, true)).length !== selectedCaptures.length &&
                    ` (${selectedCaptures.filter((c) => isQueueEligible(c, true)).length} trainable)`}
                </span>
                <button
                  onClick={() => stageBatch(selectedCaptures, `${selectedCaptures.length} selected`)}
                  disabled={queueing}
                  className="px-3 py-1 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
                >
                  {queueing ? 'Staging…' : 'Create training batch'}
                </button>
                <button
                  onClick={() => setSelectedCaptureIds(new Set())}
                  className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="w-[320px] flex-shrink-0 border-l border-nm-border overflow-y-auto p-4 flex flex-col gap-4">
            {detail && (
              <>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-nm-text-2">Project details</span>
                  <DetailField label="Cabinet" value={detail.cabinet} />
                  <DetailField label="Speaker" value={detail.speaker} />
                  <DetailField label="Room" value={detail.room} />
                  <DetailField label="Signal chain" value={detail.signalChain} />
                  <DetailField label="Description" value={detail.description} />
                  <DetailField label="Notes" value={detail.projectNotes} />
                  {!detail.cabinet &&
                    !detail.speaker &&
                    !detail.room &&
                    !detail.signalChain &&
                    !detail.description &&
                    !detail.projectNotes && (
                      <span className="text-xs text-nm-text-3">
                        No project details supplied by IR Lab (optional — nothing depends on them).
                      </span>
                    )}
                </div>

                <div className="border-t border-nm-border-s pt-3 flex flex-col gap-2.5">
                  <span className="text-xs font-semibold text-nm-text-2">Training batch</span>

                  <label className="flex flex-col gap-1 text-[11px] text-nm-text-3">
                    Architecture
                    <select
                      value={architecture}
                      onChange={(e) => setArchitecture(e.target.value)}
                      className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                    >
                      {TRAINER_ARCHITECTURES.map((a) => (
                        <option key={a} value={a}>
                          {ARCH_LABEL[a] ?? a}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-[11px] text-nm-text-3">
                    Epochs
                    <input
                      type="number"
                      min={1}
                      value={epochs}
                      onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))}
                      className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                    />
                  </label>

                  <div className="flex flex-col gap-1 text-[11px] text-nm-text-3">
                    Model output folder
                    <button
                      onClick={handleChooseOutput}
                      title={outputRoot || 'Choose a folder for the trained .nam files'}
                      className="px-2 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov text-left truncate"
                    >
                      {outputRoot || 'Choose folder…'}
                    </button>
                  </div>

                  {detail.syntheticCount > 0 && (
                    <label className="flex items-center gap-2 text-[11px] text-nm-text-2">
                      <input
                        type="checkbox"
                        checked={includeSynthetic}
                        onChange={(e) => setIncludeSynthetic(e.target.checked)}
                      />
                      Include {detail.syntheticCount} synthetic capture{detail.syntheticCount === 1 ? '' : 's'}
                    </label>
                  )}

                  <button
                    onClick={() => stageBatch(projectEligible, `${projectEligible.length} untrained`)}
                    disabled={queueing || projectEligible.length === 0}
                    className="px-3 py-1.5 text-xs rounded bg-nm-accent hover:opacity-90 disabled:opacity-50 text-accent-fg"
                  >
                    {queueing
                      ? 'Staging…'
                      : projectEligible.length === 0
                        ? 'Nothing to stage'
                        : `Stage batch — ${projectEligible.length} untrained capture${projectEligible.length === 1 ? '' : 's'}`}
                  </button>
                  <span className="text-[11px] text-nm-text-3">
                    Stages the jobs and opens the trainer&apos;s Batches page — nothing runs until you hit Start there.
                    Already-trained captures are skipped; trained <code>.nam</code> files land in the folder above and each
                    badge flips on completion.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {captureMenu && (
        <ContextMenu
          x={captureMenu.x}
          y={captureMenu.y}
          onClose={() => setCaptureMenu(null)}
          items={[
            {
              label: 'Create training batch from this capture',
              onClick: () => {
                const c = captureMenu.capture
                setCaptureMenu(null)
                void stageBatch([c], c.captureName)
              }
            },
            {
              label: selectedCaptureIds.has(captureMenu.capture.itemId) ? 'Remove from selection' : 'Add to selection',
              onClick: () => {
                toggleCapture(captureMenu.capture.itemId)
                setCaptureMenu(null)
              }
            },
            {
              label: 'Reveal in Explorer',
              onClick: () => revealCaptureFolder(captureMenu.capture)
            },
            {
              label: 'Rescan all',
              onClick: () => {
                setCaptureMenu(null)
                void rescanAll()
              }
            }
          ]}
        />
      )}

      {projectMenu && (
        <ContextMenu
          x={projectMenu.x}
          y={projectMenu.y}
          onClose={() => setProjectMenu(null)}
          items={[
            {
              label: 'Create training batch from project',
              onClick: () => {
                const p = projectMenu.project
                setProjectMenu(null)
                setSelectedId(p.collectionId)
                // detail may not be loaded for this project yet — fetch, then stage its untrained set.
                void (async () => {
                  const d = await window.api.irLibraryGetNamProjectDetail(p.collectionId)
                  if (!d) {
                    setError('Could not load that project.')
                    return
                  }
                  const eligible = d.captures.filter((c) => isQueueEligible(c, includeSynthetic))
                  if (eligible.length === 0) {
                    setError(`"${d.name}" has no untrainable captures (all trained, or WAVs missing).`)
                    return
                  }
                  if (!outputRoot) {
                    setError('Choose a model output folder first (right panel).')
                    return
                  }
                  setQueueing(true)
                  try {
                    const res = await window.api.enqueueNamCaptureImport({
                      captures: eligible.map((c) => ({
                        excitationPath: c.excitationPath as string,
                        recordingPath: c.recordingPath as string,
                        captureId: c.captureId ?? c.itemId,
                        captureName: c.captureName,
                        captureFolderPath: c.captureFolderPath as string,
                        projectName: d.name,
                        synthetic: c.synthetic
                      })),
                      finalModelRoot: outputRoot,
                      architecture,
                      epochs,
                      includeSynthetic: true,
                      staged: true,
                      submissionLabel: `${d.name} — ${eligible.length} untrained`
                    })
                    if (res.success) {
                      setMessage(`Staged ${res.built ?? eligible.length} job${(res.built ?? 1) === 1 ? '' : 's'} — opening the Batches page…`)
                      goToTrainingBatches()
                    } else {
                      setError(res.error ?? 'Could not stage the batch.')
                    }
                  } catch (err) {
                    setError(String(err))
                  } finally {
                    setQueueing(false)
                  }
                })()
              }
            },
            {
              label: 'Reveal in Explorer',
              onClick: () => {
                const p = projectMenu.project
                setProjectMenu(null)
                void (async () => {
                  const d = await window.api.irLibraryGetNamProjectDetail(p.collectionId)
                  const folder = d?.captures.find((c) => c.captureFolderPath)?.captureFolderPath
                  if (folder) window.api.revealFile(folder)
                })()
              }
            },
            {
              label: 'Rescan all',
              onClick: () => {
                setProjectMenu(null)
                void rescanAll()
              }
            }
          ]}
        />
      )}
    </div>
  )
}

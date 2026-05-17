import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { AppSettings } from '../types/settings'
import {
  IDLE_TRAINER_STATE,
  TRAINER_ARCHITECTURES,
  TRAINER_PRESETS,
  type TrainerArchitecture,
  type TrainerQueueJob,
  type TrainerStateSnapshot,
} from '../types/trainer'

interface Props {
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => void
  onClose?: () => void
}

const ARCHITECTURE_LABELS: Record<TrainerArchitecture, string> = {
  standard: 'Standard',
  complex: 'Complex',
  lite: 'Lite',
  feather: 'Feather',
  nano: 'Nano',
  revystd: 'REVySTD',
  revyhi: 'REVyHI',
  revxstd: 'REVxSTD',
}

const CUSTOM_PRESET_ID = 'custom'

function architectureEpochNote(architecture: TrainerArchitecture): string | null {
  if (architecture === 'complex') return 'Official trainer uses its recommended Complex learning settings.'
  if (architecture === 'revyhi') return 'Official trainer forces the author-recommended REVyHI defaults, including 1500 epochs.'
  if (architecture === 'revxstd') return 'Official trainer forces the author-recommended REVxSTD defaults, including 1000 epochs.'
  return null
}

function effectiveEpochTotal(architecture: TrainerArchitecture | '', configured: number | null): number | null {
  if (architecture === 'revyhi') return 1500
  if (architecture === 'revxstd') return 1000
  return configured
}

function formatThresholdEsr(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : ''
}

function getEsrTone(esr: number | null): { text: string; classes: string } {
  if (typeof esr !== 'number') {
    return { text: '-', classes: 'text-gray-800 dark:text-gray-200' }
  }
  if (esr < 0.01) {
    return { text: esr.toFixed(6), classes: 'text-emerald-700 dark:text-emerald-300' }
  }
  if (esr < 0.05) {
    return { text: esr.toFixed(6), classes: 'text-amber-700 dark:text-amber-300' }
  }
  return { text: esr.toFixed(6), classes: 'text-red-700 dark:text-red-300' }
}

function showNativeTextContextMenu(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()?.toString().trim() ?? ''
  const target = event.target as HTMLElement | null
  const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]')
  if (!selection && !isEditable) return
  event.preventDefault()
  void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
}

export function TrainingPanel({ settings, onSaveSettings, onClose }: Props) {
  const [inputPath, setInputPath] = useState(settings.namTrainingInputWav || '')
  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [trainPath, setTrainPath] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string>(CUSTOM_PRESET_ID)
  const [architectures, setArchitectures] = useState<TrainerArchitecture[]>(['standard'])
  const [epochs, setEpochs] = useState('1000')
  const [latency, setLatency] = useState('')
  const [thresholdEsr, setThresholdEsr] = useState('')
  const [savePlot, setSavePlot] = useState(true)
  const [ignoreChecks, setIgnoreChecks] = useState(false)
  const [launchError, setLaunchError] = useState('')
  const [queueActionError, setQueueActionError] = useState('')
  const [trainerState, setTrainerState] = useState<TrainerStateSnapshot>(IDLE_TRAINER_STATE)
  const [queueContextMenu, setQueueContextMenu] = useState<{ job: TrainerQueueJob; x: number; y: number } | null>(null)
  const rawLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (settings.namTrainingInputWav && !inputPath) setInputPath(settings.namTrainingInputWav)
  }, [settings.namTrainingInputWav, inputPath])

  useEffect(() => {
    let disposed = false
    void window.api.getTrainerState().then((state) => {
      if (!disposed) setTrainerState(state)
    })
    const off = window.api.onTrainerUpdate((state) => setTrainerState(state))
    return () => {
      disposed = true
      off()
    }
  }, [])

  useEffect(() => {
    const node = rawLogRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [trainerState.logs.length])

  useEffect(() => {
    if (!queueContextMenu) return
    const close = () => setQueueContextMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [queueContextMenu])

  const isRunning = trainerState.status === 'starting' || trainerState.status === 'running'
  const activeJob = trainerState.activeJobId ? trainerState.queue.find((job) => job.jobId === trainerState.activeJobId) ?? null : null
  const epochNote = architectures.length === 1 ? architectureEpochNote(architectures[0]) : null
  const progressEpochTotal = effectiveEpochTotal(
    (trainerState.architecture || architectures[0] || 'standard') as TrainerArchitecture | '',
    trainerState.progressEpochTotal ?? trainerState.epochs
  )
  const validationEsrTone = getEsrTone(trainerState.validationEsr)

  const resolvedModelName = useMemo(() => {
    const first = outputPaths[0] ?? ''
    const base = first.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '').trim() || 'model'
    return base
  }, [outputPaths])

  const canQueue =
    !!settings.namPythonPath.trim() &&
    !!inputPath.trim() &&
    outputPaths.length > 0 &&
    architectures.length > 0 &&
    !!trainPath.trim() &&
    Number.isFinite(Number(epochs)) &&
    Number(epochs) > 0

  const handleBrowseInput = async () => {
    const path = await window.api.openAudioFile()
    if (!path) return
    setInputPath(path)
    if (path !== settings.namTrainingInputWav) {
      onSaveSettings({ ...settings, namTrainingInputWav: path })
    }
  }

  const handleBrowseOutputs = async () => {
    const paths = await window.api.openAudioFiles()
    if (!paths || paths.length === 0) return
    setOutputPaths(paths)
    if (!trainPath) {
      const normalized = paths[0].replace(/\\/g, '/')
      setTrainPath(normalized.split('/').slice(0, -1).join('/'))
    }
  }

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    if (presetId === CUSTOM_PRESET_ID) return
    const preset = TRAINER_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    setArchitectures([preset.architecture])
    if (!epochs.trim()) setEpochs(String(preset.epochs))
    if (!thresholdEsr.trim() && preset.thresholdEsr != null) setThresholdEsr(formatThresholdEsr(preset.thresholdEsr))
  }

  const handleQueue = async () => {
    setLaunchError('')
    const parsedEpochs = Number.parseInt(epochs, 10)
    const parsedLatency = latency.trim() === '' ? null : Number.parseInt(latency.trim(), 10)
    const parsedThresholdEsr = thresholdEsr.trim() === '' ? null : Number.parseFloat(thresholdEsr.trim())
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) {
      setLaunchError('Epochs must be a positive whole number.')
      return
    }
    if (latency.trim() !== '' && (!Number.isFinite(parsedLatency) || parsedLatency! < 0)) {
      setLaunchError('Latency must be blank or a non-negative integer sample offset.')
      return
    }
    if (thresholdEsr.trim() !== '' && (!Number.isFinite(parsedThresholdEsr) || parsedThresholdEsr! <= 0)) {
      setLaunchError('Target ESR must be blank or a positive number.')
      return
    }

    const result = await window.api.enqueueTrainerRuns(
      outputPaths.flatMap((outputPath) =>
        architectures.map((architecture) => ({
          pythonPath: settings.namPythonPath.trim(),
          inputPath: inputPath.trim(),
          outputPath: outputPath.trim(),
          trainPath: trainPath.trim(),
          architecture,
          epochs: parsedEpochs,
          latency: parsedLatency,
          thresholdEsr: parsedThresholdEsr,
          savePlot,
          silent: true,
          ignoreChecks,
        }))
      )
    )
    if (!result.success) {
      setLaunchError(result.error ?? 'Training jobs could not be queued.')
      return
    }
    setLaunchError('')
    setQueueActionError('')
  }

  const queuedCount = trainerState.queue.filter((job) => job.status === 'queued').length
  const successCount = trainerState.queue.filter((job) => job.status === 'success').length
  const failedCount = trainerState.queue.filter((job) => job.status === 'error').length

  const handleRemoveJob = async (job: TrainerQueueJob) => {
    const result = await window.api.removeTrainerJob(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not remove that training queue item.')
    } else {
      setQueueActionError('')
    }
  }

  const handleMoveJob = async (job: TrainerQueueJob, direction: 'up' | 'down') => {
    const result = await window.api.moveTrainerJob(job.jobId, direction)
    if (!result.success) {
      setQueueActionError(result.error ?? `Could not move that training queue item ${direction}.`)
    } else {
      setQueueActionError('')
    }
  }

  const handleMakeNext = async (job: TrainerQueueJob) => {
    const result = await window.api.makeTrainerJobNext(job.jobId)
    if (!result.success) {
      setQueueActionError(result.error ?? 'Could not move that training queue item to the front.')
    } else {
      setQueueActionError('')
    }
  }

  const handleShowQueueItemInFolder = (job: TrainerQueueJob) => {
    if (job.outputModelPath) {
      window.api.revealFile(job.outputModelPath)
    }
    setQueueContextMenu(null)
  }

  return (
    <div className="h-full overflow-y-auto" onContextMenu={showNativeTextContextMenu}>
      <div className="max-w-5xl mx-auto px-6 py-5 space-y-5">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-violet-100">Experimental Local Training</div>
              <p className="mt-1 text-xs text-violet-200/85">
                Queue one input DI with multiple reamped WAVs. NAM Lab runs them serially, keeps a local queue, and promotes the final
                .nam back to your chosen destination folder beside the ESR plot.
              </p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-violet-950/40 hover:bg-violet-900/60 text-violet-100 border border-violet-400/20"
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-4">
            <Field label="Input Audio" hint="Trainer input / DI file">
              <PathPicker
                value={inputPath}
                placeholder="Select the trainer input WAV"
                onChange={setInputPath}
                onBrowse={handleBrowseInput}
              />
            </Field>

            <Field label="Output Audio" hint="Select one or more reamped WAVs to queue">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => { void handleBrowseOutputs() }}
                    className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    Choose WAVs...
                  </button>
                  {outputPaths.length > 0 && (
                    <button
                      onClick={() => setOutputPaths([])}
                      className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 min-h-[88px] max-h-[180px] overflow-y-auto font-mono">
                  {outputPaths.length === 0 ? (
                    <span className="italic text-gray-400 dark:text-gray-500">No output WAVs selected yet.</span>
                  ) : (
                    <div className="space-y-1">
                      {outputPaths.map((path) => (
                        <div key={path} className="break-all">{path}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Field>

            <Field label="Train Destination" hint="Final .nam and graph will be promoted here">
              <PathPicker
                value={trainPath}
                placeholder="Select a destination folder"
                onChange={setTrainPath}
                onBrowse={async () => {
                  const path = await window.api.openFolder(trainPath || undefined)
                  if (path) setTrainPath(path)
                }}
                browseLabel="Folder..."
              />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(110px,0.6fr)_minmax(110px,0.6fr)_minmax(120px,0.7fr)] gap-4">
              <Field label="Preset">
                <select
                  value={selectedPresetId}
                  onChange={(e) => applyPreset(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value={CUSTOM_PRESET_ID}>Custom</option>
                  {TRAINER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Architecture(s)">
                <ArchitectureMultiSelect
                  values={architectures}
                  onChange={(next) => {
                    setArchitectures(next)
                    setSelectedPresetId(CUSTOM_PRESET_ID)
                  }}
                />
              </Field>

              <Field label="Epochs">
                <input
                  value={epochs}
                  onChange={(e) => setEpochs(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              </Field>

              <Field label="Latency">
                <input
                  value={latency}
                  onChange={(e) => setLatency(e.target.value)}
                  placeholder="Auto"
                  title="Leave blank to let NAM auto-detect the sample offset between the DI and the captured output."
                  className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              </Field>

              <Field label="Target ESR">
                <input
                  value={thresholdEsr}
                  onChange={(e) => setThresholdEsr(e.target.value)}
                  placeholder="Optional"
                  title="Optional early-stop target. NAM training will stop once validation ESR reaches or beats this value."
                  className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              </Field>
            </div>

            {epochNote && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {epochNote}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ToggleRow label="Save ESR plot" checked={savePlot} onChange={setSavePlot} />
              <ToggleRow label="Ignore checks" checked={ignoreChecks} onChange={setIgnoreChecks} />
            </div>

            <details className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                Training details
              </summary>
              <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-3 text-xs text-gray-600 dark:text-gray-400 space-y-1 select-text">
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Selected WAVs:</span> <code>{outputPaths.length}</code></div>
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Selected architectures:</span> <code>{architectures.length}</code></div>
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Target ESR:</span> <code>{thresholdEsr.trim() || 'Off'}</code></div>
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Example output model name:</span> <code>{resolvedModelName}</code></div>
                <div><span className="font-medium text-gray-700 dark:text-gray-300">Example final file:</span> <code>{trainPath ? `${trainPath.replace(/\\/g, '/')}/Standard/${resolvedModelName}.nam` : `Standard/${resolvedModelName}.nam`}</code></div>
                <div className="text-[11px] text-gray-500 dark:text-gray-500">
                  The official trainer still creates Lightning logs and checkpoint artifacts underneath this folder. NAM Lab promotes the final
                  .nam back to the folder you picked so it sits beside the graph.
                </div>
              </div>
            </details>

            {launchError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {launchError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleQueue}
                disabled={!canQueue}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              >
                {(() => {
                  const totalJobs = outputPaths.length * architectures.length
                  return totalJobs === 1 ? 'Queue capture' : `Queue ${totalJobs} captures`
                })()}
              </button>
              <button
                onClick={async () => {
                  const result = await window.api.cancelTrainerRun()
                  if (!result.success) setLaunchError(result.error ?? 'Could not cancel the active training run.')
                }}
                disabled={!isRunning}
                title="Hard-stop the current training run. NAM Lab will avoid promoting the final .nam when this is used."
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-red-700 dark:text-red-300"
              >
                Emergency stop
              </button>
              <button
                onClick={async () => { await window.api.setTrainerPauseAfterCurrent(!trainerState.pauseAfterCurrent) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${trainerState.pauseAfterCurrent ? 'bg-amber-500/20 text-amber-200' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
              >
                {trainerState.pauseAfterCurrent ? 'Pause after current: On' : 'Pause after current'}
              </button>
              <button
                onClick={async () => { await window.api.setTrainerPauseAfterCurrent(false) }}
                disabled={!trainerState.pauseAfterCurrent || queuedCount === 0 || isRunning}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
              >
                Resume queue
              </button>
              <button
                onClick={async () => { await window.api.retryFailedTrainerRuns() }}
                disabled={!trainerState.queue.some((job) => job.status === 'error')}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
              >
                Retry failed
              </button>
              <button
                onClick={async () => { await window.api.removeQueuedTrainerRuns() }}
                disabled={!trainerState.queue.some((job) => job.status === 'queued')}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
              >
                Remove queued
              </button>
              <button
                onClick={async () => { await window.api.clearFinishedTrainerRuns() }}
                disabled={!trainerState.queue.some((job) => ['success', 'error', 'canceled'].includes(job.status))}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
              >
                Clear finished
              </button>
              {!!trainerState.outputModelPath && (trainerState.status === 'success' || trainerState.status === 'error' || trainerState.status === 'canceled') && (
                <button
                  onClick={() => window.api.revealFile(trainerState.outputModelPath || trainPath)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                >
                  Reveal output
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Run Status</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    {activeJob
                      ? `${trainerState.status.toUpperCase()} - ${ARCHITECTURE_LABELS[activeJob.architecture]}`
                      : trainerState.queue.length > 0
                        ? `${queuedCount} queued - ${successCount} succeeded - ${failedCount} failed`
                        : 'No active training run'}
                  </div>
                </div>
                <StatusPill status={trainerState.status} />
              </div>
              {!!trainerState.startedAt && (
                <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-500 space-y-0.5">
                  <div>Started: {new Date(trainerState.startedAt).toLocaleString()}</div>
                  {trainerState.finishedAt && <div>Finished: {new Date(trainerState.finishedAt).toLocaleString()}</div>}
                  {typeof trainerState.validationEsr === 'number' && (
                    <div>
                      Validation ESR:{' '}
                      <span className={`font-semibold ${validationEsrTone.classes}`}>
                        {validationEsrTone.text}
                      </span>
                    </div>
                  )}
                  {typeof trainerState.thresholdEsr === 'number' && (
                    <div>Target ESR: {trainerState.thresholdEsr}</div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/60 px-3 py-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Phase</span>
                    <span className="text-gray-600 dark:text-gray-400">{trainerState.progressPhase || (trainerState.status === 'idle' ? 'Waiting to start' : 'Starting')}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-300 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, trainerState.progressPercent ?? (trainerState.status === 'success' ? 100 : 0)))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-500 dark:text-gray-500">
                    <span>
                      {trainerState.progressEpochCurrent && progressEpochTotal
                        ? `Epoch ${trainerState.progressEpochCurrent} / ${progressEpochTotal}`
                        : trainerState.progressEpochCurrent
                          ? `Epoch ${trainerState.progressEpochCurrent}`
                          : 'Epoch progress will appear once training starts'}
                    </span>
                    <span>
                      {typeof trainerState.progressPercent === 'number'
                        ? `${trainerState.progressPercent.toFixed(1)}%`
                        : trainerState.status === 'success'
                          ? '100%'
                          : '-'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-[11px]">
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Batches</div>
                    <div className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                      {trainerState.progressBatchCurrent && trainerState.progressBatchTotal
                        ? `${trainerState.progressBatchCurrent} / ${trainerState.progressBatchTotal}`
                        : '-'}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Rate</div>
                    <div className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                      {typeof trainerState.progressRate === 'number' ? `${trainerState.progressRate.toFixed(2)} it/s` : '-'}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Validation ESR</div>
                    <div className={`mt-1 font-medium ${validationEsrTone.classes}`}>
                      {validationEsrTone.text}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Final output</div>
                    <div className="mt-1 font-mono text-gray-800 dark:text-gray-200 break-all">
                      {trainerState.outputModelPath || 'Will land in the train destination root'}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                    <div className="text-gray-500 dark:text-gray-500">Checkpoint export</div>
                    <div className="mt-1 font-mono text-gray-800 dark:text-gray-200 break-all">
                      {trainerState.checkpointModelPath || 'Lightning checkpoint copy will appear here after training starts'}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-500">Latest trainer line</div>
                  <div className="mt-1 text-xs font-mono text-gray-800 dark:text-gray-200 break-words">
                    {trainerState.progressLatestLine || 'No structured progress line yet.'}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300">
                  Queue
                </div>
                {!!queueActionError && (
                  <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-700 dark:text-red-300">
                    {queueActionError}
                  </div>
                )}
                <div>
                  {trainerState.queue.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-500">Queued jobs will show up here.</div>
                  ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-800">
                      {trainerState.queue.map((job) => (
                        <QueueRow
                          key={job.jobId}
                          job={job}
                          isActive={job.jobId === trainerState.activeJobId}
                          onRemove={handleRemoveJob}
                          onMove={handleMoveJob}
                          onMakeNext={handleMakeNext}
                          onContextMenu={(context) => setQueueContextMenu(context)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {queueContextMenu && (
                <div
                  className="fixed z-50 min-w-[180px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
                  style={{ left: queueContextMenu.x, top: queueContextMenu.y }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleShowQueueItemInFolder(queueContextMenu.job)}
                    disabled={queueContextMenu.job.status !== 'success' || !queueContextMenu.job.outputModelPath}
                    className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Show in folder
                  </button>
                </div>
              )}

              <details open className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-950 text-gray-100">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-200">
                  Raw trainer log
                </summary>
                <div ref={rawLogRef} className="border-t border-gray-800 p-3 h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] font-mono">
                  {trainerState.logs.length === 0 ? (
                    <span className="text-gray-500">Training logs will appear here.</span>
                  ) : (
                    trainerState.logs.join('\n')
                  )}
                </div>
              </details>

              {!!trainerState.error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {trainerState.error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
        {hint && <span className="ml-2 text-gray-500 dark:text-gray-500 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function ArchitectureMultiSelect({ values, onChange }: { values: TrainerArchitecture[]; onChange: (next: TrainerArchitecture[]) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const label =
    values.length === 0
      ? 'Choose formats'
      : values.length === 1
        ? ARCHITECTURE_LABELS[values[0]]
        : `${values.length} formats selected`

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 px-3 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 flex items-center justify-between gap-3"
      >
        <span className="truncate">{label}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {TRAINER_ARCHITECTURES.map((option) => {
              const checked = values.includes(option)
              return (
                <label
                  key={option}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-sm ${
                    checked
                      ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange([...values, option])
                      } else {
                        const next = values.filter((item) => item !== option)
                        if (next.length > 0) onChange(next)
                      }
                    }}
                    className="accent-indigo-600"
                  />
                  <span>{ARCHITECTURE_LABELS[option]}</span>
                </label>
              )
            })}
          </div>
          <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2 text-[11px] text-gray-500 dark:text-gray-500">
            Outputs go to per-format subfolders like <code>Standard\...</code> and <code>REVxSTD\...</code>.
          </div>
        </div>
      )}
    </div>
  )
}

function PathPicker({
  value,
  placeholder,
  onChange,
  onBrowse,
  browseLabel = 'Browse...',
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBrowse: () => void | Promise<void>
  browseLabel?: string
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
      />
      <button
        onClick={() => { void onBrowse() }}
        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
      >
        {browseLabel}
      </button>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-indigo-600"
      />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  )
}

function StatusPill({ status }: { status: TrainerStateSnapshot['status'] }) {
  const classes =
    status === 'success'
      ? 'bg-green-500/15 text-green-300 border-green-500/30'
      : status === 'error'
        ? 'bg-red-500/15 text-red-300 border-red-500/30'
        : status === 'canceled'
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          : status === 'running' || status === 'starting'
            ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
            : 'bg-gray-500/15 text-gray-300 border-gray-500/30'
  return (
    <span className={`px-2 py-1 rounded-full border text-[11px] font-medium ${classes}`}>
      {status === 'idle' ? 'Idle' : status === 'starting' ? 'Starting' : status === 'running' ? 'Running' : status === 'success' ? 'Success' : status === 'error' ? 'Failed' : 'Canceled'}
    </span>
  )
}

function QueueRow({
  job,
  isActive,
  onRemove,
  onMove,
  onMakeNext,
  onContextMenu,
}: {
  job: TrainerQueueJob
  isActive: boolean
  onRemove: (job: TrainerQueueJob) => void | Promise<void>
  onMove: (job: TrainerQueueJob, direction: 'up' | 'down') => void | Promise<void>
  onMakeNext: (job: TrainerQueueJob) => void | Promise<void>
  onContextMenu: (context: { job: TrainerQueueJob; x: number; y: number }) => void
}) {
  const esrTone = getEsrTone(job.validationEsr)
  const isQueued = job.status === 'queued'
  const statusClasses =
    job.status === 'success'
      ? 'text-emerald-700 dark:text-emerald-300'
      : job.status === 'error'
        ? 'text-red-700 dark:text-red-300'
        : job.status === 'canceled'
          ? 'text-amber-700 dark:text-amber-300'
          : job.status === 'running' || job.status === 'starting'
            ? 'text-indigo-700 dark:text-indigo-300'
            : 'text-gray-700 dark:text-gray-300'

  return (
    <div
      className={`px-3 py-2 text-xs ${isActive ? 'bg-indigo-500/10' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu({ job, x: event.clientX, y: event.clientY })
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => { void onMove(job, 'up') }}
            disabled={!isQueued}
            title="Move up"
            className="w-5 h-5 rounded border border-gray-300 dark:border-gray-700 text-[10px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ▲
          </button>
          <button
            onClick={() => { void onMove(job, 'down') }}
            disabled={!isQueued}
            title="Move down"
            className="w-5 h-5 rounded border border-gray-300 dark:border-gray-700 text-[10px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ▼
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                {job.outputPath.replace(/\\/g, '/').split('/').pop()}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-500">
                <span>{ARCHITECTURE_LABELS[job.architecture]}</span>
                <span>Attempt {job.attempts}</span>
                {typeof job.progressPercent === 'number' && <span>{job.progressPercent.toFixed(1)}%</span>}
                {typeof job.validationEsr === 'number' && <span className={esrTone.classes}>ESR {esrTone.text}</span>}
                {typeof job.thresholdEsr === 'number' && <span>Target {job.thresholdEsr}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`font-semibold whitespace-nowrap ${statusClasses}`}>
                {job.status.toUpperCase()}
              </div>
              {isQueued && (
                <button
                  onClick={() => { void onMakeNext(job) }}
                  className="px-2 py-1 rounded-md border border-indigo-300 dark:border-indigo-700 text-[11px] text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 whitespace-nowrap"
                >
                  Next
                </button>
              )}
              {job.status === 'success' && !!job.outputModelPath && (
                <button
                  onClick={() => window.api.revealFile(job.outputModelPath)}
                  className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-[11px] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
                >
                  Show
                </button>
              )}
              {!isActive && (
                <button
                  onClick={() => { void onRemove(job) }}
                  title="Remove from queue"
                  className="w-6 h-6 rounded-md border border-red-300 dark:border-red-800 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {!!job.error && (
        <div className="mt-1 text-[11px] text-red-700 dark:text-red-300 break-words">
          {job.error}
        </div>
      )}
    </div>
  )
}

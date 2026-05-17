import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '../types/settings'
import {
  IDLE_TRAINER_STATE,
  TRAINER_ARCHITECTURES,
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

export function TrainingPanel({ settings, onSaveSettings, onClose }: Props) {
  const [inputPath, setInputPath] = useState(settings.namTrainingInputWav || '')
  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [trainPath, setTrainPath] = useState('')
  const [architectures, setArchitectures] = useState<TrainerArchitecture[]>(['standard'])
  const [epochs, setEpochs] = useState('1000')
  const [latency, setLatency] = useState('')
  const [savePlot, setSavePlot] = useState(true)
  const [silent, setSilent] = useState(false)
  const [ignoreChecks, setIgnoreChecks] = useState(false)
  const [launchError, setLaunchError] = useState('')
  const [trainerState, setTrainerState] = useState<TrainerStateSnapshot>(IDLE_TRAINER_STATE)
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

  const handleQueue = async () => {
    setLaunchError('')
    const parsedEpochs = Number.parseInt(epochs, 10)
    const parsedLatency = latency.trim() === '' ? null : Number.parseInt(latency.trim(), 10)
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) {
      setLaunchError('Epochs must be a positive whole number.')
      return
    }
    if (latency.trim() !== '' && (!Number.isFinite(parsedLatency) || parsedLatency! < 0)) {
      setLaunchError('Latency must be blank or a non-negative integer sample offset.')
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
          savePlot,
          silent,
          ignoreChecks,
        }))
      )
    )
    if (!result.success) {
      setLaunchError(result.error ?? 'Training jobs could not be queued.')
      return
    }
    setLaunchError('')
  }

  const queuedCount = trainerState.queue.filter((job) => job.status === 'queued').length
  const successCount = trainerState.queue.filter((job) => job.status === 'success').length
  const failedCount = trainerState.queue.filter((job) => job.status === 'error').length

  return (
    <div className="h-full overflow-y-auto">
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
            <Field label="NAM Python executable" hint="Configured in Settings">
              <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 font-mono break-all">
                {settings.namPythonPath || <span className="italic text-gray-400 dark:text-gray-500">Not configured yet</span>}
              </div>
            </Field>

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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Architecture(s)">
                <ArchitectureMultiSelect
                  values={architectures}
                  onChange={setArchitectures}
                />
              </Field>

              <Field label="Epochs">
                <input
                  value={epochs}
                  onChange={(e) => setEpochs(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              </Field>

              <Field label="Latency" hint="Leave blank to let NAM auto-detect">
                <input
                  value={latency}
                  onChange={(e) => setLatency(e.target.value)}
                  placeholder="Auto"
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
              <ToggleRow label="Silent run (suppress plots)" checked={silent} onChange={setSilent} />
              <ToggleRow label="Ignore checks" checked={ignoreChecks} onChange={setIgnoreChecks} />
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 px-3 py-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Selected WAVs:</span> <code>{outputPaths.length}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Selected architectures:</span> <code>{architectures.length}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Example output model name:</span> <code>{resolvedModelName}</code></div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Example final file:</span> <code>{trainPath ? `${trainPath.replace(/\\/g, '/')}/Standard/${resolvedModelName}.nam` : `Standard/${resolvedModelName}.nam`}</code></div>
              <div className="text-[11px] text-gray-500 dark:text-gray-500">
                The official trainer still creates Lightning logs and checkpoint artifacts underneath this folder. NAM Lab promotes the final
                .nam back to the folder you picked so it sits beside the graph.
              </div>
            </div>

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
                  return totalJobs === 1 ? 'Queue job' : `Queue ${totalJobs} jobs`
                })()}
              </button>
              <button
                onClick={async () => {
                  const result = await window.api.cancelTrainerRun()
                  if (!result.success) setLaunchError(result.error ?? 'Could not cancel the active training run.')
                }}
                disabled={!isRunning}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
              >
                Cancel current
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
                <div className="max-h-[320px] overflow-y-auto">
                  {trainerState.queue.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-500">Queued jobs will show up here.</div>
                  ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-800">
                      {trainerState.queue.map((job) => (
                        <QueueRow key={job.jobId} job={job} isActive={job.jobId === trainerState.activeJobId} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

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

function QueueRow({ job, isActive }: { job: TrainerQueueJob; isActive: boolean }) {
  const esrTone = getEsrTone(job.validationEsr)
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
    <div className={`px-3 py-2 text-xs ${isActive ? 'bg-indigo-500/10' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-800 dark:text-gray-200 break-all">
            {job.outputPath.replace(/\\/g, '/').split('/').pop()}
          </div>
          <div className="mt-0.5 text-gray-500 dark:text-gray-500 break-all">
            {job.modelName}
          </div>
        </div>
        <div className={`font-semibold whitespace-nowrap ${statusClasses}`}>
          {job.status.toUpperCase()}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-500">
        <span>{ARCHITECTURE_LABELS[job.architecture]}</span>
        <span>Attempt {job.attempts}</span>
        {typeof job.progressPercent === 'number' && <span>{job.progressPercent.toFixed(1)}%</span>}
        {typeof job.validationEsr === 'number' && <span className={esrTone.classes}>ESR {esrTone.text}</span>}
      </div>
      {!!job.error && (
        <div className="mt-1 text-[11px] text-red-700 dark:text-red-300 break-words">
          {job.error}
        </div>
      )}
    </div>
  )
}

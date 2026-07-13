import type { AppSettings } from '../types/settings'
import type { TrainerStateSnapshot } from '../types/trainer'

interface Props {
  settings: AppSettings
  trainerState: TrainerStateSnapshot
  rootFolder: string
  onClose: () => void
  onOpenSettings: (tab: string) => void
  onOpenTraining: (mode?: 'files' | 'folder' | 'queue' | 'history' | 'presets') => void
}

interface Step {
  title: string
  description: string
  done: boolean
  action?: { label: string; onClick: () => void }
}

export function TrainingSetupGuide({ settings, trainerState, rootFolder, onClose, onOpenSettings, onOpenTraining }: Props) {
  const hasWatchProfile = settings.trainingWatchProfiles.some((p) => p.enabled && p.watchFolder?.trim())
  const hasPythonPath = !!settings.namPythonPath?.trim()

  const steps: Step[] = [
    {
      title: 'Set up Python environment',
      description: 'NAM Lab needs Python with neural-amp-modeler installed (0.13.0+ recommended for current A1 + A2 workflows). Point Settings -> Training to the python executable inside your NAM conda or venv environment.',
      done: hasPythonPath,
      action: { label: 'Open Settings -> Training', onClick: () => { onClose(); onOpenSettings('training') } },
    },
    {
      title: 'Create a training preset',
      description: 'Presets save your preferred architecture + epoch combination for reuse. Open Training -> Presets and add at least one preset before setting up a watch folder.',
      done: (settings.trainingPresets?.length ?? 0) > 0,
      action: { label: 'Open Training -> Presets', onClick: () => { onClose(); onOpenTraining('presets') } },
    },
    {
      title: 'Configure output path',
      description: 'Set a NAM output path formula so trained .nam files land in the right place automatically. Use tokens like {folder}, {architecture}, and {filename}.',
      done: !!settings.trainingOutputFormula?.trim(),
      action: { label: 'Open Settings -> Training', onClick: () => { onClose(); onOpenSettings('training') } },
    },
    {
      title: 'Add a WAV watch folder',
      description: 'In the Training panel, add a Watch Folder pointing to where your DI recording files land. Link it to a preset - NAM Lab will auto-train each new WAV it finds there.',
      done: hasWatchProfile,
      action: { label: 'Open Training', onClick: () => { onClose(); onOpenTraining('files') } },
    },
    {
      title: 'Load your library folder',
      description: 'Open your finished .nam library folder in the folder tree (left panel). Once loaded, NAM Lab will pick up new captures as they arrive from training.',
      done: !!rootFolder?.trim(),
    },
  ]

  const doneCount = steps.filter((s) => s.done).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Training Routing Setup</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{doneCount} of {steps.length} steps complete</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-gray-500 dark:text-gray-400">
            <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">WAV folder</span>
            <span>{'->'}</span>
            <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">Training</span>
            <span>{'->'}</span>
            <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">.nam output</span>
            <span>{'->'}</span>
            <span className="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">Library</span>
          </div>
        </div>

        <div className="px-5 py-3 bg-sky-50 dark:bg-sky-900/15 border-b border-sky-200 dark:border-sky-900/40 space-y-2">
          <div className="text-xs text-sky-800 dark:text-sky-200 leading-relaxed">
            Use the official NAM docs for setup. Start with install, then the full trainer page, and use packed training for A2-specific details.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { void window.api.openExternal('https://neural-amp-modeler.readthedocs.io/en/latest/installation.html') }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              Official Install Guide
            </button>
            <button
              onClick={() => { void window.api.openExternal('https://neural-amp-modeler.readthedocs.io/en/latest/tutorials/full.html') }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              Full Trainer Docs
            </button>
            <button
              onClick={() => { void window.api.openExternal('https://neural-amp-modeler.readthedocs.io/en/latest/tutorials/packed-training.html') }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors"
            >
              Packed / A2 Docs
            </button>
          </div>
          <div className="text-[11px] text-sky-900/80 dark:text-sky-100/80 leading-relaxed">
            Common Python locations: `C:\Users\YourName\miniconda3\envs\nam\python.exe`, `C:\Users\YourName\anaconda3\envs\nam\python.exe`, `C:\Users\YourName\.conda\envs\nam\python.exe`, or project venvs like `C:\path\to\project\.venv\Scripts\python.exe`.
            {!hasPythonPath && ' If NAM already works in a terminal, run `python -c "import sys; print(sys.executable)"` there and paste that path into Settings -> Training.'}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {steps.map((step, i) => (
            <div key={i} className={`flex gap-3 px-5 py-4 ${i < steps.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : ''}`}>
              <div className="flex-shrink-0 mt-0.5">
                {step.done ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500">{i + 1}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${step.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
                  {step.title}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{step.description}</div>
                {!step.done && step.action && (
                  <button
                    onClick={step.action.onClick}
                    className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    {step.action.label}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {doneCount === steps.length && (
          <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 font-medium text-center">
            All steps complete - your training pipeline is ready.
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Close
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-600">Start watchers from the Training panel once setup is complete.</span>
        </div>
      </div>
    </div>
  )
}


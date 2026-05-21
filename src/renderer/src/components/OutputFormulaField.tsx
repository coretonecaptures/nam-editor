import { useMemo, useState } from 'react'
import { resolveOutputFormulaWithSteps } from '../utils/resolveOutputFormula'

interface OutputFormulaFieldProps {
  value: string
  onChange: (v: string) => void
  /** Example staging path to populate the resolution table — uses a demo path if absent */
  exampleStagingPath?: string
  /** Architecture name shown in the example table */
  exampleArchitecture?: string
  /** When true, shows "leave blank to inherit global formula" hint */
  isPresetOverride?: boolean
  /** The resolved global formula (shown as placeholder when isPresetOverride) */
  globalFormula?: string
  /** Formula inserted by the "Use suggestion" button — defaults to NAM formula */
  suggestionFormula?: string
}

const DEMO_STAGING = 'F:/NAM To Process/Jose/V2/WAV/DI'
const DEMO_ARCH = 'REVxSTD'
const MIN_STAGING_DEPTH = 4 // need at least 4 segments for ../../ to be meaningful

export function OutputFormulaField({
  value,
  onChange,
  exampleStagingPath,
  exampleArchitecture,
  suggestionFormula = '../../NAM/{architecture}/{folder}',
  isPresetOverride = false,
  globalFormula = '',
}: OutputFormulaFieldProps) {
  const [guideOpen, setGuideOpen] = useState(false)

  const providedPath = (exampleStagingPath?.trim() || '').replace(/\\/g, '/')
  const pathDepth = providedPath ? providedPath.split('/').filter(Boolean).length : 0
  const stagingPath = pathDepth >= MIN_STAGING_DEPTH ? providedPath : DEMO_STAGING
  const isDemoPath = stagingPath === DEMO_STAGING
  const archName = exampleArchitecture?.trim() || DEMO_ARCH
  const formulaToPreview = value.trim() || globalFormula.trim() || '../../NAM/{architecture}/{folder}'

  const resolution = useMemo(
    () => resolveOutputFormulaWithSteps(formulaToPreview, stagingPath, archName),
    [formulaToPreview, stagingPath, archName]
  )

  const effectiveFormula = value.trim() || (isPresetOverride ? globalFormula.trim() : '')

  return (
    <div className="space-y-2">
      {/* Input row */}
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
          }}
          placeholder={
            isPresetOverride
              ? globalFormula.trim()
                ? `${globalFormula.trim()} (global)`
                : 'Enter formula or leave blank to use fixed path'
              : 'e.g. ../../NAM/{architecture}/{folder}'
          }
          className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
        />
        {!value.trim() && (
          <button
            onClick={() => onChange(suggestionFormula)}
            className="text-[10px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors whitespace-nowrap flex-shrink-0 border border-indigo-300 dark:border-indigo-700 rounded px-1.5 py-0.5"
            title="Insert suggested formula"
          >
            Use suggestion
          </button>
        )}
        {value.trim() && (
          <button
            onClick={() => onChange('')}
            className="text-[10px] text-gray-400 hover:text-red-500 transition-colors whitespace-nowrap flex-shrink-0"
            title="Clear formula"
          >
            Clear
          </button>
        )}
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className={`flex items-center gap-1 text-[11px] font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
            guideOpen
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-gray-400 dark:text-gray-500 hover:text-indigo-500'
          }`}
        >
          <svg className={`w-3 h-3 transition-transform ${guideOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          Guide
        </button>
      </div>

      {/* Guide panel */}
      {guideOpen && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-900/10 overflow-hidden text-xs">

          {/* Token reference */}
          <div className="px-3 pt-3 pb-2 border-b border-indigo-200/60 dark:border-indigo-800/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-2">
              Available tokens
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-[10px] text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                  <th className="text-left py-1 pr-3 font-semibold w-32">Token</th>
                  <th className="text-left py-1 pr-3 font-semibold">What it means</th>
                  <th className="text-left py-1 font-semibold">
                    Example{isDemoPath ? ' (demo)' : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    token: '{folder}',
                    desc: 'Leaf folder name of your staging path',
                    example: stagingPath.replace(/\\/g, '/').split('/').pop() ?? 'DI',
                  },
                  {
                    token: '{parent}',
                    desc: 'Folder one level above the leaf',
                    example: (() => {
                      const p = stagingPath.replace(/\\/g, '/').split('/')
                      return p[p.length - 2] ?? 'WAV'
                    })(),
                  },
                  {
                    token: '{architecture}',
                    desc: 'Capture profile name being trained',
                    example: archName,
                  },
                  {
                    token: '../',
                    desc: 'Go up one directory level',
                    example: '—',
                  },
                ].map((row) => (
                  <tr key={row.token} className="border-t border-indigo-100 dark:border-indigo-900/40">
                    <td className="py-1 pr-3 font-mono text-indigo-700 dark:text-indigo-300 font-medium">{row.token}</td>
                    <td className="py-1 pr-3 text-gray-600 dark:text-gray-400">{row.desc}</td>
                    <td className="py-1 font-mono text-gray-500 dark:text-gray-500">{row.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-indigo-600 dark:text-indigo-400">
              Leave the formula blank to use a fixed output path per run (existing behavior).
              {isPresetOverride && ' Leave blank here to inherit the global formula.'}
            </p>
          </div>

          {/* Step-by-step resolution table */}
          <div className="px-3 py-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                Step-by-step resolution
              </div>
              {isDemoPath && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-500 dark:text-indigo-400 font-medium">
                  demo path
                </span>
              )}
              {!isDemoPath && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">
                  your path
                </span>
              )}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-500 mb-2 font-mono">
              Formula: <span className="text-indigo-600 dark:text-indigo-400">{formulaToPreview}</span>
            </div>

            {resolution ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide border-b border-indigo-100 dark:border-indigo-900/40">
                    <th className="text-left py-1 pr-3 font-semibold w-28">Step</th>
                    <th className="text-left py-1 font-semibold">Path at this point</th>
                  </tr>
                </thead>
                <tbody>
                  {resolution.steps.map((step, i) => (
                    <tr
                      key={i}
                      className={`border-b border-indigo-100/60 dark:border-indigo-900/30 ${
                        i === resolution.steps.length - 1
                          ? 'bg-emerald-50/60 dark:bg-emerald-900/10'
                          : ''
                      }`}
                    >
                      <td className={`py-1.5 pr-3 font-mono text-[11px] font-medium whitespace-nowrap ${
                        step.segment === 'start'
                          ? 'text-gray-400 dark:text-gray-600'
                          : step.segment === '../'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-indigo-600 dark:text-indigo-400'
                      }`}>
                        {step.segment === 'start' ? 'staging' : step.label}
                      </td>
                      <td className={`py-1.5 font-mono text-[11px] break-all ${
                        i === resolution.steps.length - 1
                          ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}>
                        {step.resolved}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-[11px] text-gray-400 dark:text-gray-600 italic">
                Enter a formula above to see the resolution.
              </div>
            )}

            {resolution && (
              <div className="mt-2.5 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono font-medium break-all">
                  {resolution.result}
                </span>
              </div>
            )}
          </div>

          {/* Multi-arch note */}
          {!isPresetOverride && (
            <div className="px-3 py-2 border-t border-indigo-100 dark:border-indigo-800/40 bg-indigo-50 dark:bg-indigo-900/20 text-[11px] text-indigo-600 dark:text-indigo-400">
              When running multiple architectures, each job resolves <code className="font-mono">{'{architecture}'}</code> independently —
              so REVxSTD and Standard trained together each land in their own subfolder automatically.
            </div>
          )}
        </div>
      )}

      {/* Compact live preview (shown when guide is closed and formula is set) */}
      {!guideOpen && effectiveFormula && resolution && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-500">
          <svg className="w-3 h-3 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
          </svg>
          <span className="font-mono text-emerald-600 dark:text-emerald-500 break-all">{resolution.result}</span>
          {isDemoPath && <span className="text-gray-400 dark:text-gray-600 italic">(demo)</span>}
        </div>
      )}
    </div>
  )
}

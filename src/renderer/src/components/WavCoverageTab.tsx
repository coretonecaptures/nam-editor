import { useEffect, useRef, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NamFile } from '../types/nam'

interface Props {
  folderPath: string
  namFiles: NamFile[]
  comparisonFolder: string | null
  onSetComparisonFolder: (path: string | null) => void
  canTrain?: boolean
  onTrainWavs?: (wavPaths: string[]) => void
}

interface MatchRow {
  wavName: string
  namFile: NamFile | null
}

function basename(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase()
}

export function WavCoverageTab({ folderPath, namFiles, comparisonFolder, onSetComparisonFolder, canTrain, onTrainWavs }: Props) {
  const [wavNames, setWavNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMatched, setShowMatched] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [ctxMenu])

  useEffect(() => {
    if (!comparisonFolder) { setWavNames([]); return }
    setLoading(true)
    setError(null)
    void window.api.listWavFiles(comparisonFolder).then((names) => {
      setWavNames(names)
      setLoading(false)
    }).catch(() => {
      setError('Could not read WAV folder.')
      setLoading(false)
    })
  }, [comparisonFolder])

  const namBasenames = useMemo(() =>
    new Map(namFiles.map((f) => [basename(f.fileName), f])),
    [namFiles]
  )

  const rows = useMemo((): MatchRow[] =>
    wavNames.map((w) => ({ wavName: w, namFile: namBasenames.get(basename(w)) ?? null })),
    [wavNames, namBasenames]
  )

  const missing = rows.filter((r) => !r.namFile)
  const matched = rows.filter((r) => r.namFile)
  const extraNams = useMemo(() => {
    if (!comparisonFolder || wavNames.length === 0) return []
    const wavSet = new Set(wavNames.map((w) => basename(w)))
    return namFiles.filter((f) => !wavSet.has(basename(f.fileName)))
  }, [namFiles, wavNames, comparisonFolder])

  const pickFolder = async () => {
    const picked = await window.api.openFolder(comparisonFolder ?? folderPath ?? undefined)
    if (picked) onSetComparisonFolder(picked)
  }

  const clearFolder = () => onSetComparisonFolder(null)

  if (!comparisonFolder) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-500/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">No WAV folder selected</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">Pick a staging / source WAV folder to check which captures have been trained and which are still missing.</p>
        </div>
        <button
          onClick={pickFolder}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
          Choose WAV Folder&hellip;
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Folder picker header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <svg className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
          <button
            onClick={pickFolder}
            className="text-xs font-mono text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate transition-colors text-left"
            title={comparisonFolder}
          >
            {comparisonFolder}
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={pickFolder}
            className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-700"
          >
            Change&hellip;
          </button>
          <button
            onClick={clearFolder}
            className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors border border-gray-200 dark:border-gray-700"
            title="Clear comparison folder"
          >
            Clear
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">Scanning WAV folder&hellip;</div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-xs text-red-500">{error}</div>
      ) : wavNames.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">No WAV files found in that folder.</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* Summary stat boxes */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-500/[0.06] px-3 py-2.5 text-center">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 leading-none">{matched.length}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Trained</div>
            </div>
            <div
              className={`rounded-xl border px-3 py-2.5 text-center ${missing.length > 0 ? 'border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-500/[0.06]' : 'border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-800/40'}`}
            >
              <div className={`text-2xl font-bold leading-none ${missing.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>{missing.length}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Missing</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-800/40 px-3 py-2.5 text-center">
              <div className="text-2xl font-bold text-gray-700 dark:text-gray-300 leading-none">{wavNames.length}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Total WAVs</div>
            </div>
          </div>

          {/* Missing section */}
          {missing.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <h3 className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-1.5 flex-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Missing NAM ({missing.length})
                </h3>
                {canTrain && onTrainWavs && (
                  <button
                    onClick={() => onTrainWavs(missing.map((r) => `${comparisonFolder}/${r.wavName}`))}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors flex-shrink-0"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                    Train All
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-red-200 dark:border-red-700/30 overflow-hidden">
                {missing.map((row, i) => (
                  <div
                    key={row.wavName}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs ${i % 2 === 0 ? 'bg-white dark:bg-gray-900/20' : 'bg-red-50/40 dark:bg-red-500/[0.03]'}`}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 160), y: e.clientY, text: row.wavName }) }}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400 dark:bg-red-500 flex-shrink-0" />
                    <span className="font-mono text-gray-700 dark:text-gray-300 truncate">{row.wavName}</span>
                    <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => void window.api.revealFile(`${comparisonFolder}/${row.wavName}`)}
                        className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors border border-gray-200 dark:border-gray-600"
                        title="Show in Explorer"
                      >
                        Show
                      </button>
                      {canTrain && onTrainWavs && (
                        <button
                          onClick={() => onTrainWavs([`${comparisonFolder}/${row.wavName}`])}
                          className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                        >
                          Train
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matched section (collapsible) */}
          {matched.length > 0 && (
            <div>
              <button
                onClick={() => setShowMatched((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2 hover:opacity-80 transition-opacity"
              >
                <svg
                  className={`w-3 h-3 transition-transform duration-150 ${showMatched ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                Trained ({matched.length})
              </button>
              {showMatched && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-700/30 overflow-hidden">
                  {matched.map((row, i) => (
                    <div
                      key={row.wavName}
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${i % 2 === 0 ? 'bg-white dark:bg-gray-900/20' : 'bg-emerald-50/40 dark:bg-emerald-500/[0.03]'}`}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 160), y: e.clientY, text: row.wavName }) }}
                    >
                      <svg className="w-3 h-3 text-emerald-500 dark:text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="font-mono text-gray-700 dark:text-gray-300 truncate">{row.wavName}</span>
                      <span className="ml-auto text-gray-400 dark:text-gray-500 truncate flex-shrink-0 max-w-[40%]">{row.namFile!.fileName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Extra NAMs (no source WAV) */}
          {extraNams.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                No Source WAV ({extraNams.length})
              </h3>
              <div className="rounded-lg border border-amber-200 dark:border-amber-700/30 overflow-hidden">
                {extraNams.map((f, i) => (
                  <div key={f.filePath} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${i % 2 === 0 ? 'bg-white dark:bg-gray-900/20' : 'bg-amber-50/40 dark:bg-amber-500/[0.03]'}`}>
                    <span className="w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500 flex-shrink-0" />
                    <span className="font-mono text-gray-700 dark:text-gray-300 truncate">{f.fileName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ctxMenu && createPortal(
            <div
              ref={ctxMenuRef}
              className="fixed z-50 min-w-[140px] rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 text-sm"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            >
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors"
                onClick={() => { void navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null) }}
              >
                Copy filename
              </button>
            </div>,
            document.body
          )}

          {missing.length === 0 && matched.length > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-700/30 bg-emerald-50 dark:bg-emerald-500/[0.06] px-4 py-3 text-center">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">All WAVs trained</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">Every WAV in the source folder has a matching NAM file.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

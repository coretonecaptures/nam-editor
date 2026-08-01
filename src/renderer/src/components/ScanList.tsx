/**
 * Scan list — the Tone Map's other view of the same captures.
 *
 * The map is spatial; this is sequential. Both show whatever the Tone Map's facets currently
 * select, so switching between them never changes *what* you are looking at, only how. That is
 * why this owns no scope of its own — a second set of filters would immediately disagree with the
 * map's.
 *
 * Order runs cleanest to most aggressive by tone type, gain only breaking ties. It deliberately
 * is not gain-first: measured across a real library, 79% of captures fall inside 0.55–0.85, so a
 * gain sort would put neighbours ~0.0001 apart and the sweep would be arbitrary.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NamFile } from '../types/nam'
import { orderScanFiles } from '../utils/scanOrder'
import { AUDITION_CLIP_SECONDS } from '../hooks/useAudition'
import { estimateRenderMs, formatDuration, prefetchWindow } from '../utils/scanQueue'
import { getCaptureBestEsr, getEsrTone } from '../utils/esr'
import {
  SCAN_COLUMNS,
  scanColumnValue,
  scanGridTemplate,
  visibleScanColumns,
  type ScanColumnId
} from '../utils/scanColumns'
import type { AuditionApi } from '../hooks/useAudition'

interface ScanListProps {
  /** Already scoped by the Tone Map's facets. */
  files: NamFile[]
  audition: AuditionApi
  /** Hold to hear, or keep playing after release. */
  latched: boolean
  onOpenInPlayer: (file: NamFile) => void
  nowPlayingPath?: string | null
}

export function ScanList({
  files,
  audition,
  latched,
  onOpenInPlayer,
  nowPlayingPath
}: ScanListProps): React.JSX.Element {
  const ordered = useMemo(() => orderScanFiles(files), [files])
  const cursorRef = useRef(0)

  // Columns are chosen from the measured panel width rather than a viewport breakpoint: this list
  // lives in a panel the user drags, so the viewport says nothing about how much room it has.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  const columns = useMemo(() => visibleScanColumns(width), [width])
  const gridTemplate = useMemo(() => scanGridTemplate(columns), [columns])

  // Warm around wherever the pointer is, biased ahead — a list is swept in one direction, which
  // is a far better prediction than the map can make from a free-moving cursor.
  const warm = (index: number): void => {
    cursorRef.current = index
    audition.prefetch(prefetchWindow(index, ordered.length).map((i) => ordered[i]))
  }

  useEffect(() => {
    if (ordered.length > 0) warm(0)
    // Re-warm when the scope changes, not on every audition state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered])

  // Releasing outside a row must still stop, or audio sticks on when the pointer slips off.
  useEffect(() => {
    if (latched) return
    const onUp = (): void => audition.stop()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [latched, audition])

  if (ordered.length === 0) {
    return (
      <div ref={rootRef}>
        <p className="p-4 text-[12px] text-gray-500 dark:text-gray-400">
          Nothing matches those filters.
        </p>
      </div>
    )
  }

  const readyCount = ordered.reduce((n, f) => n + (audition.ready.has(f.filePath) ? 1 : 0), 0)

  return (
    <div ref={rootRef} className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
        <span>
          <strong className="text-gray-700 dark:text-gray-200">{ordered.length.toLocaleString()}</strong> in scope
        </span>
        <span>{readyCount} rendered</span>
        <span className="ml-auto">
          all of them ≈ {formatDuration(estimateRenderMs(ordered.length, AUDITION_CLIP_SECONDS))}
        </span>
      </div>
      {/* Column headings. With several columns of free text, unlabelled cells are a guessing
          game — "4x12 · V30" and "SM57, R121" are not self-describing at a glance. */}
      {columns.length > 0 && (
        <div
          className="grid items-center gap-2 pl-[22px] pr-3 py-1 text-[9px] uppercase tracking-[.12em] text-gray-400 dark:text-gray-600 border-b border-gray-200 dark:border-gray-800"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span>Capture</span>
          {columns.map((id) => {
            const spec = SCAN_COLUMNS.find((c) => c.id === id)
            return (
              <span key={id} className={spec?.numeric ? 'text-right' : ''}>
                {spec?.label}
              </span>
            )
          })}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {ordered.map((file, i) => {
        const isPlaying = audition.playingPath === file.filePath
        const isReady = audition.ready.has(file.filePath)
        return (
          <div
            key={file.filePath}
            onMouseEnter={() => warm(i)}
            onMouseDown={() => {
              warm(i)
              audition.play(file)
            }}
            onMouseUp={() => {
              if (!latched) audition.stop()
            }}
            onDoubleClick={() => onOpenInPlayer(file)}
            title="Press and hold to listen · double-click to open in the player"
            className={`flex items-center gap-2 h-[34px] px-3 cursor-pointer select-none border-b border-gray-100 dark:border-gray-800 transition-colors ${
              isPlaying ? 'bg-[var(--active)]' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
            }`}
            style={isPlaying ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
          >
            <span
              className={`flex-none w-1.5 h-1.5 rounded-full ${
                isReady ? 'bg-[var(--accent)]' : 'bg-gray-300 dark:bg-gray-700'
              }`}
              title={isReady ? 'Rendered and ready' : 'Not rendered yet'}
            />
            <div className="flex-1 min-w-0 grid items-center gap-2" style={{ gridTemplateColumns: gridTemplate }}>
              <span className="truncate text-[12px] text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                <span className="truncate">{file.metadata.name || file.fileName}</span>
                {nowPlayingPath === file.filePath && (
                  <span className="flex-none text-[9px] font-mono text-[var(--accent)]">in player</span>
                )}
              </span>
              {columns.map((id) => (
                <ScanCell key={id} id={id} file={file} />
              ))}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}

/**
 * One metadata cell.
 *
 * ESR is its own case rather than a string from scanColumnValue: it is the one column with a
 * meaning attached to its value, and the existing thresholds already colour it green/amber/red,
 * which is most of why it is worth a column at all.
 */
function ScanCell({ id, file }: { id: ScanColumnId; file: NamFile }): React.JSX.Element {
  if (id === 'esr') {
    const best = getCaptureBestEsr(file.metadata as Record<string, unknown>)
    const tone = getEsrTone(best.value, best.kind, 4)
    return (
      <span
        className={`truncate text-right text-[10px] font-mono ${tone.classes}`}
        title={best.value === null ? 'No validation ESR' : `${best.label}: ${best.value}`}
      >
        {tone.text}
      </span>
    )
  }

  const value = scanColumnValue(file, id)
  // An empty cell is rendered as a dash rather than nothing, so a row with sparse metadata still
  // reads as a row of columns instead of drifting text.
  return (
    <span
      className={`truncate text-[10.5px] ${value ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-700'}`}
      title={value || undefined}
    >
      {value || '—'}
    </span>
  )
}

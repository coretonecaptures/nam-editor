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
import { useEffect, useMemo, useRef } from 'react'
import type { NamFile } from '../types/nam'
import { orderScanFiles } from '../utils/scanOrder'
import { AUDITION_CLIP_SECONDS } from '../hooks/useAudition'
import { estimateRenderMs, formatDuration, prefetchWindow } from '../utils/scanQueue'
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
      <p className="p-4 text-[12px] text-gray-500 dark:text-gray-400">
        Nothing matches those filters.
      </p>
    )
  }

  const readyCount = ordered.reduce((n, f) => n + (audition.ready.has(f.filePath) ? 1 : 0), 0)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
        <span>
          <strong className="text-gray-700 dark:text-gray-200">{ordered.length.toLocaleString()}</strong> in scope
        </span>
        <span>{readyCount} rendered</span>
        <span className="ml-auto">
          all of them ≈ {formatDuration(estimateRenderMs(ordered.length, AUDITION_CLIP_SECONDS))}
        </span>
      </div>
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
            <span className="flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">
              {file.metadata.name || file.fileName}
            </span>
            {file.metadata.gear_make && (
              <span className="flex-none text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[140px]">
                {file.metadata.gear_make}
              </span>
            )}
            {file.metadata.tone_type && (
              <span className="flex-none text-[9.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {file.metadata.tone_type.replace(/_/g, ' ')}
              </span>
            )}
            {nowPlayingPath === file.filePath && (
              <span className="flex-none text-[9px] font-mono text-[var(--accent)]">in player</span>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

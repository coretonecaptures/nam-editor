/**
 * Tone Map — a full-window browser for the whole capture library.
 *
 * Amp rows ordered cleanest→heaviest (measured, see `utils/ampHeaviness.ts`) against a continuous
 * measured-saturation X axis. Every mark is a real capture: hover names it, click plays it. It is a
 * browser, not a morpher — nothing is interpolated, so everything you hear is a file on disk.
 *
 * DRILL-DOWN is the core loop. The library is far too dense to show as individual dots (2,553
 * captures over ~18 rows), so rows start as heat bands. Narrowing — by amp, by capture maker, by
 * both, by model — is what resolves a band into individual, clickable dots. So filtering isn't a
 * side feature here; it's how you actually get to a capture, and the payoff is visible.
 *
 * Hosted full-window rather than in the right panel because `playerFile` is checked BEFORE
 * `showDashboard` in App's panel chain — in the right panel, the first click-to-play would replace
 * the map with the player and break the loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NamFile } from '../types/nam'
import { rankAmpsByHeaviness, rankModelsByHeaviness, type AmpRow } from '../utils/ampHeaviness'
import { UNTAGGED_KEY, groupByCreator, isJunkMake, normalizeMakeKey } from '../utils/gearMake'
import {
  TONE_GRID_ROW_HEIGHT,
  ToneGrid,
  toneGridCellKey,
  toneGridHeight,
  type ToneGridCell,
  type ToneGridMark
} from './dashboard/ToneGrid'
import { paddedDomain } from './dashboard/scales'

const TONE_COLORS: Record<string, string> = {
  clean: '#38bdf8',
  crunch: '#22c55e',
  overdrive: '#eab308',
  distortion: '#f97316',
  hi_gain: '#ef4444',
  fuzz: '#a855f7',
  other: '#94a3b8'
}
const UNTYPED_COLOR = '#64748b'

const TONE_LABELS: Record<string, string> = {
  clean: 'Clean',
  crunch: 'Crunch',
  overdrive: 'Overdrive',
  distortion: 'Distortion',
  hi_gain: 'Hi Gain',
  fuzz: 'Fuzz',
  other: 'Other'
}

/** Tone types ordered by drive, matching the saturation reading of the X axis. */
const TONE_ORDER = ['clean', 'crunch', 'overdrive', 'distortion', 'hi_gain', 'fuzz', 'other']

function toneColor(tone: string | null | undefined): string {
  if (!tone) return UNTYPED_COLOR
  return TONE_COLORS[tone] ?? UNTYPED_COLOR
}

function captureLabel(file: NamFile): string {
  return file.metadata.name || file.fileName
}

function Chip({
  active,
  onClick,
  children,
  title,
  tone = 'default'
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
  tone?: 'default' | 'accent'
}) {
  const base =
    'h-6 px-2 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0'
  const style = active
    ? 'bg-teal-500 text-white'
    : tone === 'accent'
      ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300 hover:bg-teal-500/25'
      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
  return (
    <button onClick={onClick} title={title} className={`${base} ${style}`}>
      {children}
    </button>
  )
}

/** A multi-select facet list. Long lists collapse behind a "more" toggle. */
function Facet({
  title,
  options,
  selected,
  onToggle,
  onClear,
  initialVisible = 8
}: {
  title: string
  options: Array<{ key: string; label: string; count: number }>
  selected: Set<string>
  onToggle: (key: string) => void
  onClear: () => void
  initialVisible?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((o) => o.label.toLowerCase().includes(needle))
  }, [options, query])

  const visible = expanded ? matching : matching.slice(0, initialVisible)
  if (options.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400 dark:text-gray-500">
          {title}
        </span>
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
          >
            clear
          </button>
        )}
      </div>

      {options.length > 12 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="w-full h-6 px-2 rounded text-[11px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:border-teal-500"
        />
      )}

      <div className="flex flex-col gap-0.5">
        {visible.map((option) => {
          const isOn = selected.has(option.key)
          return (
            <button
              key={option.key}
              onClick={() => onToggle(option.key)}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left transition-colors ${
                isOn ? 'bg-teal-500/15' : 'hover:bg-gray-100 dark:hover:bg-gray-800/60'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-sm border flex-shrink-0 ${
                  isOn ? 'bg-teal-500 border-teal-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              <span
                className={`flex-1 min-w-0 truncate text-[11px] ${
                  isOn
                    ? 'text-teal-700 dark:text-teal-300 font-medium'
                    : 'text-gray-600 dark:text-gray-300'
                }`}
                title={option.label}
              >
                {option.label}
              </span>
              <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0">
                {option.count}
              </span>
            </button>
          )
        })}
      </div>

      {matching.length > initialVisible && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline"
        >
          {expanded ? 'Show fewer' : `${matching.length - initialVisible} more…`}
        </button>
      )}
    </div>
  )
}

export interface ToneMapViewProps {
  /** Whole library. */
  files: NamFile[]
  /** Folder-scoped subset (App's visibleFiles), for the scope toggle. */
  scopedFiles: NamFile[]
  /** Name of the folder scopedFiles came from, for the toggle label. */
  scopeLabel?: string | null
  /** Play a capture — must set BOTH playerFile and the selection in App. */
  onPlay: (file: NamFile) => void
  /** Currently previewed capture, so the map can mark and offer drill-downs from it. */
  nowPlaying?: NamFile | null
  onClose?: () => void
}

export function ToneMapView({
  files,
  scopedFiles,
  scopeLabel,
  onPlay,
  nowPlaying = null,
  onClose
}: ToneMapViewProps) {
  const [scope, setScope] = useState<'library' | 'folder'>('library')
  const [makeKeys, setMakeKeys] = useState<Set<string>>(new Set())
  const [creatorKeys, setCreatorKeys] = useState<Set<string>>(new Set())
  const [toneKeys, setToneKeys] = useState<Set<string>>(new Set())
  const [showUntagged, setShowUntagged] = useState(true)
  /** When set, rows become that amp's models instead of makes — one level of zoom in. */
  const [expandedMake, setExpandedMake] = useState<string | null>(null)
  const [hover, setHover] = useState<{ mark: ToneGridMark; x: number; y: number } | null>(null)
  /** Hovered heat cell, so it can be highlighted and described. */
  const [hoverCell, setHoverCell] = useState<{ cell: ToneGridCell; x: number; y: number } | null>(
    null
  )
  /**
   * Zoom window on the saturation axis — a VIEW, not a filter.
   *
   * This is deliberate: an earlier version narrowed the filter set instead, which re-ranked the
   * rows and changed every count, so zooming in and back out lost your place. As a view, the rows,
   * the counts and the facets all stay put; only what's on screen changes. Panning is the same
   * window slid along.
   */
  const [zoom, setZoom] = useState<[number, number] | null>(null)

  const plotRef = useRef<HTMLDivElement | null>(null)
  const [plotWidth, setPlotWidth] = useState(900)

  useEffect(() => {
    const element = plotRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setPlotWidth(Math.max(360, entries[0]?.contentRect.width ?? 900))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const baseFiles = scope === 'library' ? files : scopedFiles

  /** Captures that report a measured gain — the only ones the map can position. */
  const positionable = useMemo(
    () =>
      baseFiles.filter(
        (f) => typeof f.metadata.gain === 'number' && Number.isFinite(f.metadata.gain)
      ),
    [baseFiles]
  )
  const excludedCount = baseFiles.length - positionable.length

  const creatorGroups = useMemo(() => groupByCreator(positionable), [positionable])

  const filtered = useMemo(() => {
    return positionable.filter((f) => {
      const makeKey = isJunkMake(f.metadata.gear_make)
        ? UNTAGGED_KEY
        : normalizeMakeKey(f.metadata.gear_make)
      if (!showUntagged && makeKey === UNTAGGED_KEY) return false
      if (makeKeys.size > 0 && (makeKey === null || !makeKeys.has(makeKey))) return false

      if (creatorKeys.size > 0) {
        const creatorKey = isJunkMake(f.metadata.modeled_by)
          ? UNTAGGED_KEY
          : normalizeMakeKey(f.metadata.modeled_by)
        if (creatorKey === null || !creatorKeys.has(creatorKey)) return false
      }

      if (toneKeys.size > 0) {
        const tone = f.metadata.tone_type ?? 'other'
        if (!toneKeys.has(tone)) return false
      }

      return true
    })
  }, [positionable, makeKeys, creatorKeys, toneKeys, showUntagged])

  /**
   * Rows are makes, or one amp's models when drilled in.
   *
   * Drilling in is what turns a dense heat band into individual dots, so it doubles as the zoom.
   */
  const rows: AmpRow[] = useMemo(() => {
    if (expandedMake === null) return rankAmpsByHeaviness(filtered)
    const inMake = filtered.filter((f) => {
      const key = isJunkMake(f.metadata.gear_make)
        ? UNTAGGED_KEY
        : normalizeMakeKey(f.metadata.gear_make)
      return key === expandedMake
    })
    return rankModelsByHeaviness(inMake)
  }, [filtered, expandedMake])

  /** Which row each capture belongs to, matching how `rows` was built. */
  const rowKeyOf = useCallback(
    (file: NamFile) => {
      const raw = expandedMake === null ? file.metadata.gear_make : file.metadata.gear_model
      return isJunkMake(raw) ? UNTAGGED_KEY : normalizeMakeKey(raw)
    },
    [expandedMake]
  )

  const marks = useMemo<ToneGridMark[]>(() => {
    const rowKeys = new Set(rows.map((r) => r.key))
    const out: ToneGridMark[] = []
    for (const file of filtered) {
      const rowKey = rowKeyOf(file)
      if (rowKey === null || !rowKeys.has(rowKey)) continue
      out.push({
        id: file.filePath,
        rowKey,
        x: file.metadata.gain as number,
        color: toneColor(file.metadata.tone_type),
        label: captureLabel(file)
      })
    }
    return out
  }, [filtered, rows, rowKeyOf])

  // Normally the domain spans the whole positionable set, so the axis doesn't rescale under you as
  // you filter — a capture appearing to move when it hasn't is disorienting. The exception is an
  // explicit saturation window: there, rescaling IS the point, since spreading a narrow range over
  // the full width is what separates overlapping captures into individual dots.
  /** The full extent of the data — the outer bound zoom can never exceed. */
  const fullDomain = useMemo<[number, number]>(
    () => paddedDomain(positionable.map((f) => f.metadata.gain as number)),
    [positionable]
  )

  const xDomain = useMemo<[number, number]>(() => zoom ?? fullDomain, [zoom, fullDomain])

  const zoomFactor = useMemo(() => {
    const full = fullDomain[1] - fullDomain[0]
    const view = xDomain[1] - xDomain[0]
    return view > 0 ? full / view : 1
  }, [fullDomain, xDomain])

  /** Clamp a proposed window to the data extent, preserving its width where possible. */
  const clampWindow = useCallback(
    (lo: number, hi: number): [number, number] | null => {
      const fullSpan = fullDomain[1] - fullDomain[0]
      // Never zoom past ~500x, and never below a hair of the span — beyond that the axis ticks
      // collapse and panning becomes uncontrollable.
      const minSpan = fullSpan / 500
      let span = Math.min(Math.max(hi - lo, minSpan), fullSpan)
      let start = lo + (hi - lo) / 2 - span / 2

      if (start < fullDomain[0]) start = fullDomain[0]
      if (start + span > fullDomain[1]) start = fullDomain[1] - span
      // Fully zoomed out is expressed as null, so the axis and the breadcrumb agree there is no
      // zoom rather than showing a window identical to the full range.
      if (span >= fullSpan - 1e-9) return null
      return [start, start + span]
    },
    [fullDomain]
  )

  /** Zoom about a point, keeping the value under the cursor fixed. */
  const zoomAt = useCallback(
    (anchorValue: number, scale: number) => {
      const [lo, hi] = xDomain
      const span = hi - lo
      const nextSpan = span / scale
      // Keep the anchor at the same fractional position so the axis grows out from the cursor.
      const frac = span > 0 ? (anchorValue - lo) / span : 0.5
      const nextLo = anchorValue - frac * nextSpan
      setZoom(clampWindow(nextLo, nextLo + nextSpan))
    },
    [xDomain, clampWindow]
  )

  /** Slide the window without changing its width. */
  const panBy = useCallback(
    (deltaValue: number) => {
      const [lo, hi] = xDomain
      setZoom(clampWindow(lo + deltaValue, hi + deltaValue))
    },
    [xDomain, clampWindow]
  )

  const byPath = useMemo(() => {
    const map = new Map<string, NamFile>()
    for (const f of filtered) map.set(f.filePath, f)
    return map
  }, [filtered])

  const makeOptions = useMemo(() => {
    const ranked = rankAmpsByHeaviness(positionable)
    return ranked
      .filter((r) => showUntagged || !r.junk)
      .map((r) => ({ key: r.key, label: r.label, count: r.files.length }))
      .sort((a, b) => b.count - a.count)
  }, [positionable, showUntagged])

  const creatorOptions = useMemo(
    () =>
      [...creatorGroups.values()]
        .map((g) => ({ key: g.key, label: g.label, count: g.files.length }))
        .sort((a, b) => b.count - a.count),
    [creatorGroups]
  )

  const toneOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of positionable) {
      const tone = f.metadata.tone_type ?? 'other'
      counts.set(tone, (counts.get(tone) ?? 0) + 1)
    }
    return TONE_ORDER.filter((t) => counts.has(t)).map((t) => ({
      key: t,
      label: TONE_LABELS[t] ?? t,
      count: counts.get(t) ?? 0
    }))
  }, [positionable])

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const resetAll = () => {
    setMakeKeys(new Set())
    setCreatorKeys(new Set())
    setToneKeys(new Set())
    setExpandedMake(null)
    setShowUntagged(true)
    setZoom(null)
  }

  const hasNarrowing =
    makeKeys.size > 0 ||
    creatorKeys.size > 0 ||
    toneKeys.size > 0 ||
    expandedMake !== null ||
    zoom !== null

  // ── Drill-down offers, derived from the capture currently playing ───────────────
  const nowPlayingMakeKey = nowPlaying
    ? isJunkMake(nowPlaying.metadata.gear_make)
      ? UNTAGGED_KEY
      : normalizeMakeKey(nowPlaying.metadata.gear_make)
    : null
  const nowPlayingCreatorKey = nowPlaying
    ? isJunkMake(nowPlaying.metadata.modeled_by)
      ? UNTAGGED_KEY
      : normalizeMakeKey(nowPlaying.metadata.modeled_by)
    : null

  const makeLabelOf = (key: string | null) =>
    key === null ? null : (makeOptions.find((o) => o.key === key)?.label ?? null)
  const creatorLabelOf = (key: string | null) =>
    key === null ? null : (creatorOptions.find((o) => o.key === key)?.label ?? null)

  const drillMake = makeLabelOf(nowPlayingMakeKey)
  const drillCreator = creatorLabelOf(nowPlayingCreatorKey)

  const handleSelect = useCallback(
    (mark: ToneGridMark) => {
      const file = byPath.get(mark.id)
      if (file) onPlay(file)
    },
    [byPath, onPlay]
  )

  /**
   * Clicking a heat cell zooms into it.
   *
   * A single capture in a cell can be played straight away — there's nothing to disambiguate. For
   * several, narrow to that row and that saturation slice; the axis rescales to the slice, which is
   * what pulls the overlapping captures apart into individual dots.
   */
  const handleDrillCell = useCallback(
    (cell: ToneGridCell) => {
      if (cell.ids.length === 1) {
        const only = byPath.get(cell.ids[0])
        if (only) {
          onPlay(only)
          return
        }
      }
      // ZOOM to the cell rather than filtering to it. Filtering re-ranked the rows and changed
      // every count, so coming back out landed you somewhere else; zooming keeps every row, every
      // count and every facet exactly where they were.
      //
      // Widen a hair so the captures at the very edges aren't sitting on the axis, and so a cell
      // whose marks share one value still produces a usable window.
      const pad = Math.max((cell.xMax - cell.xMin) * 0.25, 0.004)
      setZoom(clampWindow(cell.xMin - pad, cell.xMax + pad))
      setHoverCell(null)
    },
    [byPath, onPlay, clampWindow]
  )

  /** Clicking a row label isolates that amp — the coarse version of the same zoom. */
  const handleSelectRow = useCallback(
    (rowKey: string) => {
      if (expandedMake === null) setMakeKeys(new Set([rowKey]))
      // Isolating an amp is a filter, so drop the zoom — otherwise you'd be looking at one amp
      // through a window set for a different one.
      setZoom(null)
    },
    [expandedMake]
  )

  /** Plot geometry must match ToneGrid's own padding for cursor->value maths to line up. */
  const PLOT_PAD_L = 132
  const PLOT_PAD_R = 16

  const valueAtClientX = useCallback(
    (clientX: number): number | null => {
      const element = plotRef.current
      if (!element) return null
      const box = element.getBoundingClientRect()
      const plotW = box.width - PLOT_PAD_L - PLOT_PAD_R
      if (plotW <= 0) return null
      const frac = (clientX - box.left - PLOT_PAD_L) / plotW
      return xDomain[0] + Math.max(0, Math.min(1, frac)) * (xDomain[1] - xDomain[0])
    },
    [xDomain]
  )

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      // Only take over the wheel when actually zooming, so the page can still scroll otherwise.
      if (event.deltaY === 0) return
      event.preventDefault()
      const anchorValue = valueAtClientX(event.clientX)
      if (anchorValue === null) return
      zoomAt(anchorValue, event.deltaY < 0 ? 1.18 : 1 / 1.18)
    },
    [valueAtClientX, zoomAt]
  )

  const dragRef = useRef<{ clientX: number; moved: boolean } | null>(null)

  const handlePanStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // Only drag-pan while zoomed; otherwise there is nowhere to go and it would just swallow
    // clicks meant for the marks.
    dragRef.current = { clientX: event.clientX, moved: false }
  }, [])

  const handlePanMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || zoom === null) return
      const element = plotRef.current
      if (!element) return
      const dxPx = event.clientX - drag.clientX
      if (Math.abs(dxPx) < 2) return
      drag.moved = true
      drag.clientX = event.clientX
      const plotW = element.getBoundingClientRect().width - PLOT_PAD_L - PLOT_PAD_R
      if (plotW <= 0) return
      panBy(-(dxPx / plotW) * (xDomain[1] - xDomain[0]))
    },
    [zoom, panBy, xDomain]
  )

  const handlePanEnd = useCallback(() => {
    dragRef.current = null
  }, [])

  const gridHeight = toneGridHeight(rows.length, TONE_GRID_ROW_HEIGHT)

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-medium text-teal-500 dark:text-teal-400 uppercase tracking-wide">
            Tone Map
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {marks.length.toLocaleString()} of {positionable.length.toLocaleString()} shown
            {excludedCount > 0 && (
              <span className="text-amber-600 dark:text-amber-500">
                {' '}
                · {excludedCount.toLocaleString()} excluded (no measured gain)
              </span>
            )}
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 flex-shrink-0">
          {(['library', 'folder'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              disabled={value === 'folder' && scopedFiles.length === 0}
              className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 ${
                scope === value
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title={
                value === 'library'
                  ? 'Every capture in the library'
                  : `Only the folder you are browsing${scopeLabel ? `: ${scopeLabel}` : ''}`
              }
            >
              {value === 'library' ? 'Whole library' : 'This folder'}
            </button>
          ))}
        </div>

        {hasNarrowing && (
          <button
            onClick={resetAll}
            className="h-7 px-2.5 rounded-md text-[11px] font-medium border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
            title="Clear all narrowing and zoom back out"
          >
            Zoom out
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            title="Close Tone Map"
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Now playing + drill-down offers */}
      {nowPlaying && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 flex-shrink-0 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wide text-teal-500 dark:text-teal-400 flex-shrink-0">
            Now playing
          </span>
          <span className="text-xs font-medium truncate max-w-[22rem] flex-shrink-0" title={captureLabel(nowPlaying)}>
            {captureLabel(nowPlaying)}
          </span>

          <span className="text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0 ml-1">
            Narrow to
          </span>
          {drillMake && nowPlayingMakeKey && (
            <Chip
              tone="accent"
              onClick={() => setMakeKeys(new Set([nowPlayingMakeKey]))}
              title={`Show only ${drillMake} captures`}
            >
              {drillMake}
            </Chip>
          )}
          {drillCreator && nowPlayingCreatorKey && (
            <Chip
              tone="accent"
              onClick={() => setCreatorKeys(new Set([nowPlayingCreatorKey]))}
              title={`Show only captures made by ${drillCreator}`}
            >
              {drillCreator}
            </Chip>
          )}
          {drillMake && drillCreator && nowPlayingMakeKey && nowPlayingCreatorKey && (
            <Chip
              tone="accent"
              onClick={() => {
                setMakeKeys(new Set([nowPlayingMakeKey]))
                setCreatorKeys(new Set([nowPlayingCreatorKey]))
              }}
              title={`Show only ${drillMake} captures made by ${drillCreator}`}
            >
              {drillMake} + {drillCreator}
            </Chip>
          )}
          {nowPlayingMakeKey && expandedMake === null && (
            <Chip
              tone="accent"
              onClick={() => {
                setMakeKeys(new Set([nowPlayingMakeKey]))
                setExpandedMake(nowPlayingMakeKey)
              }}
              title="Break this amp into its individual models"
            >
              its models
            </Chip>
          )}
          {nowPlaying.metadata.tone_type && (
            <Chip
              tone="accent"
              onClick={() => setToneKeys(new Set([nowPlaying.metadata.tone_type as string]))}
              title="Show only this tone type"
            >
              {TONE_LABELS[nowPlaying.metadata.tone_type] ?? nowPlaying.metadata.tone_type}
            </Chip>
          )}
        </div>
      )}

      {/* Active narrowing breadcrumb */}
      {hasNarrowing && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 flex-shrink-0">
            Showing
          </span>
          {expandedMake !== null && (
            <Chip active onClick={() => setExpandedMake(null)} title="Back to amp rows">
              models of {makeLabelOf(expandedMake) ?? 'amp'} ✕
            </Chip>
          )}
          {[...makeKeys].map((key) => (
            <Chip key={key} active onClick={() => toggleIn(setMakeKeys)(key)}>
              {makeLabelOf(key) ?? key} ✕
            </Chip>
          ))}
          {[...creatorKeys].map((key) => (
            <Chip key={key} active onClick={() => toggleIn(setCreatorKeys)(key)}>
              {creatorLabelOf(key) ?? key} ✕
            </Chip>
          ))}
          {[...toneKeys].map((key) => (
            <Chip key={key} active onClick={() => toggleIn(setToneKeys)(key)}>
              {TONE_LABELS[key] ?? key} ✕
            </Chip>
          ))}
          {zoom !== null && (
            <Chip active onClick={() => setZoom(null)} title="Zoom out to the full range">
              zoomed {zoom[0].toFixed(2)}–{zoom[1].toFixed(2)} ✕
            </Chip>
          )}
        </div>
      )}

      {/* Body: facet rail + plot */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-[210px] flex-shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto p-3 space-y-4">
          <Facet
            title="Amp"
            options={makeOptions}
            selected={makeKeys}
            onToggle={toggleIn(setMakeKeys)}
            onClear={() => {
              setMakeKeys(new Set())
              setExpandedMake(null)
            }}
          />
          <Facet
            title="Capture maker"
            options={creatorOptions}
            selected={creatorKeys}
            onToggle={toggleIn(setCreatorKeys)}
            onClear={() => setCreatorKeys(new Set())}
          />
          <Facet
            title="Tone type"
            options={toneOptions}
            selected={toneKeys}
            onToggle={toggleIn(setToneKeys)}
            onClear={() => setToneKeys(new Set())}
          />
          <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={showUntagged}
              onChange={(e) => setShowUntagged(e.target.checked)}
              className="w-3 h-3 rounded accent-teal-500"
            />
            <span className="text-[11px] text-gray-600 dark:text-gray-300">
              Show untagged amps
            </span>
          </label>
        </div>

        <div className="flex-1 min-w-0 overflow-auto p-4">
          {rows.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400 dark:text-gray-600">
                {positionable.length === 0
                  ? 'No captures report a measured gain value yet.'
                  : 'Nothing matches those filters.'}
              </p>
            </div>
          ) : (
            <div
              ref={plotRef}
              onWheel={handleWheel}
              onMouseDown={handlePanStart}
              onMouseMove={handlePanMove}
              onMouseUp={handlePanEnd}
              onMouseLeave={handlePanEnd}
              className={`relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 ${
                zoom !== null ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
              // Placeholder backdrop: cool/clean on the left, hot/saturated on the right, so the
              // artwork reinforces the axis. Swap for real art without touching the plot code.
              style={{
                background:
                  'linear-gradient(100deg,#0d2b33 0%,#12212b 30%,#241a12 62%,#2b1113 100%)'
              }}
            >
              <ToneGrid
                rows={rows}
                marks={marks}
                xDomain={xDomain}
                xLabel="measured saturation (NAM 0–1) — cleanest to most saturated"
                width={plotWidth}
                height={gridHeight}
                selectedId={nowPlaying?.filePath ?? null}
                hoveredId={hover?.mark.id ?? null}
                hoveredCellKey={hoverCell ? toneGridCellKey(hoverCell.cell) : null}
                onHoverChange={(mark, x, y, cell) => {
                  setHover(mark ? { mark, x, y } : null)
                  setHoverCell(cell ? { cell, x, y } : null)
                }}
                onSelect={handleSelect}
                onDrillCell={handleDrillCell}
                onSelectRow={handleSelectRow}
              />
            </div>
          )}

          {/* Zoom scrollbar. Only meaningful once zoomed, so it appears then rather than sitting
              at full width doing nothing. The thumb is the visible slice of the whole range —
              drag it to pan, which is the same window slid along. */}
          {rows.length > 0 && zoom !== null && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => setZoom(null)}
                title="Zoom out to the full range"
                className="h-6 px-2 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
              >
                Fit
              </button>

              <div
                className="relative flex-1 h-2.5 rounded-full bg-gray-200 dark:bg-gray-800 cursor-pointer"
                onMouseDown={(event) => {
                  // Click the track to centre the window there; drag the thumb to pan.
                  const box = event.currentTarget.getBoundingClientRect()
                  const frac = (event.clientX - box.left) / box.width
                  const span = xDomain[1] - xDomain[0]
                  const centre = fullDomain[0] + frac * (fullDomain[1] - fullDomain[0])
                  setZoom(clampWindow(centre - span / 2, centre + span / 2))

                  const onMove = (moveEvent: MouseEvent) => {
                    const f = (moveEvent.clientX - box.left) / box.width
                    const c = fullDomain[0] + f * (fullDomain[1] - fullDomain[0])
                    setZoom(clampWindow(c - span / 2, c + span / 2))
                  }
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove)
                    window.removeEventListener('mouseup', onUp)
                  }
                  window.addEventListener('mousemove', onMove)
                  window.addEventListener('mouseup', onUp)
                }}
              >
                <div
                  className="absolute top-0 bottom-0 rounded-full bg-teal-500/70"
                  style={{
                    left: `${((xDomain[0] - fullDomain[0]) / (fullDomain[1] - fullDomain[0])) * 100}%`,
                    // Floor the width so a deep zoom still leaves something grabbable.
                    width: `${Math.max(4, ((xDomain[1] - xDomain[0]) / (fullDomain[1] - fullDomain[0])) * 100)}%`
                  }}
                />
              </div>

              <span className="font-mono tabular-nums text-[10px] text-gray-400 dark:text-gray-500 w-12 text-right flex-shrink-0">
                {zoomFactor.toFixed(1)}×
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3">
            {toneOptions.map((option) => (
              <span key={option.key} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: toneColor(option.key) }}
                />
                <span className="text-[10px] text-gray-500 dark:text-gray-400">{option.label}</span>
              </span>
            ))}
            <span className="text-[10px] text-gray-400 dark:text-gray-600 ml-2">
              rows marked * have under 3 measured captures · click a heat band to zoom into it,
              scroll to zoom anywhere, drag to pan
            </span>
          </div>
        </div>
      </div>

      {/* Hover tooltip — one element, positioned in client space. */}
      {hover && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md bg-gray-900 dark:bg-gray-800 text-white text-[11px] shadow-lg max-w-[20rem]"
          style={{
            left: Math.min(hover.x + 12, window.innerWidth - 260),
            top: Math.max(8, hover.y - 34)
          }}
        >
          <div className="font-medium truncate">{hover.mark.label}</div>
          <div className="text-[10px] text-gray-300 dark:text-gray-400">
            saturation {hover.mark.x.toFixed(2)} · click to play
          </div>
        </div>
      )}

      {/* Heat cells get their own tooltip — otherwise a dense row gives no feedback at all and
          looks unclickable, which is exactly how it behaved before. */}
      {!hover && hoverCell && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md bg-gray-900 dark:bg-gray-800 text-white text-[11px] shadow-lg"
          style={{
            left: Math.min(hoverCell.x + 12, window.innerWidth - 240),
            top: Math.max(8, hoverCell.y - 34)
          }}
        >
          <div className="font-medium">
            {hoverCell.cell.count} capture{hoverCell.cell.count === 1 ? '' : 's'}
          </div>
          <div className="text-[10px] text-gray-300 dark:text-gray-400">
            saturation {hoverCell.cell.xMin.toFixed(2)}–{hoverCell.cell.xMax.toFixed(2)} ·{' '}
            {hoverCell.cell.count === 1 ? 'click to play' : 'click to zoom in'}
          </div>
        </div>
      )}
    </div>
  )
}

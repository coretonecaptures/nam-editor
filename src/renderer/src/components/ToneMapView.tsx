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
  TONE_GRID_CHROME_HEIGHT,
  TONE_GRID_ROW_HEIGHT,
  ToneGrid,
  toneGridCellKey,
  toneGridHeight,
  type ToneGridCell,
  type ToneGridMark
} from './dashboard/ToneGrid'
import { paddedDomain } from './dashboard/scales'
import { captureNeedsCabIr } from '../utils/playerAudio'
import { ScanList } from './ScanList'
import { useAudition } from '../hooks/useAudition'
import {
  loadDiPrefs,
  resolveActiveDiClip,
  resolveActiveIr,
  saveDiPrefs,
  saveIrPath,
  type DiCategoryLike
} from '../utils/diSelection'

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

/** Room left below the plot for the zoom scrollbar, the hint line and the page's own padding. */
const PLOT_BOTTOM_GUTTER = 104
/**
 * Upper bound on a dragged row height.
 *
 * Generous enough that a library with only a few amps can still be dragged to fill the window —
 * the dots stop growing at their own cap, so beyond this a row is mostly empty space.
 */
export const MAX_ROW_HEIGHT = 220
/** Share of the free vertical space the map takes by default; drag the grip for more. */
const DEFAULT_HEIGHT_FRACTION = 0.5
/** How long the cursor must rest on a dot before it is rendered or played. */
const HOVER_SETTLE_MS = 160

/**
 * Gear type matters for listening, not just for tidiness.
 *
 * A capture of an amp on its own is raw power-amp signal and needs a cabinet IR to sound like
 * anything; a capture that already contains a cab must not get one. Auditioning a mixed set means
 * half get a cab and half do not, so they are not comparable — hence a facet for it.
 */
const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp only (needs cab)',
  preamp: 'Preamp (needs cab)',
  pedal: 'Pedal (needs cab)',
  pedal_amp: 'Pedal + Amp (needs cab)',
  amp_cab: 'Amp + Cab',
  amp_pedal_cab: 'Amp + Pedal + Cab',
  studio: 'Studio'
}
const GEAR_ORDER = ['amp_cab', 'amp_pedal_cab', 'studio', 'amp', 'preamp', 'pedal', 'pedal_amp']
const GEAR_UNTAGGED = 'untagged'

/**
 * Row height that fills half the free vertical space, bounded both ways.
 *
 * Half rather than all of it: filling the window made a six-amp library look like the whole app
 * was one chart, with nothing left on screen below. The lower clamp is what makes "unless there
 * are a lot of amps" fall out on its own — once there are enough rows that half the space can't
 * give each 26px, the height stops shrinking and the plot grows past half and scrolls instead.
 */
export function autoRowHeightFor(rowCount: number, availableHeight: number): number {
  if (rowCount <= 0 || availableHeight <= 0) return TONE_GRID_ROW_HEIGHT
  const usable = availableHeight * DEFAULT_HEIGHT_FRACTION - TONE_GRID_CHROME_HEIGHT
  return Math.min(Math.max(usable / rowCount, TONE_GRID_ROW_HEIGHT), MAX_ROW_HEIGHT)
}

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
  /** DI library root — auditioning needs a clip to play captures through. */
  diLibraryPath?: string | null
  /** IR library root + mix, so auditions apply the same cab the player would. */
  irLibraryPath?: string | null
  irMix?: number
  onClose?: () => void
}

export function ToneMapView({
  files,
  scopedFiles,
  scopeLabel,
  onPlay,
  nowPlaying = null,
  diLibraryPath = null,
  irLibraryPath = null,
  irMix = 1,
  onClose
}: ToneMapViewProps) {
  const [scope, setScope] = useState<'library' | 'folder'>('library')
  const [makeKeys, setMakeKeys] = useState<Set<string>>(new Set())
  const [creatorKeys, setCreatorKeys] = useState<Set<string>>(new Set())
  const [toneKeys, setToneKeys] = useState<Set<string>>(new Set())
  const [gearKeys, setGearKeys] = useState<Set<string>>(new Set())
  const [showUntagged, setShowUntagged] = useState(true)
  /**
   * Captures with no `tone_type` at all.
   *
   * Defaults to shown, like the untagged-amps toggle: ~15% of a real library has no tone type, and
   * silently dropping that many would misrepresent the library. The header count reflects the
   * choice either way, so hiding them is never invisible.
   */
  const [showUntaggedTone, setShowUntaggedTone] = useState(true)
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

  /** Map is spatial, list is sequential - same captures, same facets, different reading. */
  const [view, setView] = useState<'map' | 'list'>('map')
  /**
   * What a dot does.
   *  open  - click opens it in the full player (the original behaviour, unchanged)
   *  click - click plays it right here, without taking over the right panel
   *  hover - it plays as you move across the map
   * Hover is the most immediate but also the most likely to stutter, since moving anywhere is
   * legal and prefetch can only guess from the cursor.
   */
  const [dotAction, setDotAction] = useState<'open' | 'click' | 'hover'>('open')
  const [latched, setLatched] = useState(false)
  const [diPath, setDiPath] = useState<string | null>(null)
  const [irPath, setIrPath] = useState<string | null>(null)
  const [diCategories, setDiCategories] = useState<DiCategoryLike[]>([])
  const [irCategories, setIrCategories] = useState<DiCategoryLike[]>([])
  const audition = useAudition(diPath, { irPath, irMix })

  const plotRef = useRef<HTMLDivElement | null>(null)
  const [plotWidth, setPlotWidth] = useState(900)
  /** Vertical space between the top of the plot and the bottom of the window. */
  const [availableHeight, setAvailableHeight] = useState(0)
  /** Non-null once the user drags the grip, which stops rows following the window. */
  const [rowHeightOverride, setRowHeightOverride] = useState<number | null>(null)

  /**
   * Callback ref, not a plain one: the plot unmounts when you switch to the list view, so a
   * `[]`-deps effect would keep observing the OLD detached node when you switch back. A detached
   * element measures 0, which clamped to the 360px floor and squashed the plot into a strip.
   */
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null)
  const attachPlot = useCallback((node: HTMLDivElement | null) => {
    plotRef.current = node
    setPlotEl(node)
  }, [])

  useEffect(() => {
    if (!plotEl || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const width = plotEl.getBoundingClientRect().width
      // Ignore zero-width reports (hidden or mid-layout) rather than clamping them to the floor.
      if (width > 0) setPlotWidth(Math.max(360, width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(plotEl)
    return () => observer.disconnect()
  }, [plotEl])


  // "This folder" is only meaningful when the browsed view really is a subset. With no folder
  // selected it named nothing and picked the same captures as "Whole library".
  const canScopeToFolder = scopedFiles.length > 0 && scopedFiles.length < files.length
  /** Any mode where captures actually make sound. */
  const listening = view === 'list' || dotAction !== 'open'


  /**
   * Hover-play waits for the cursor to settle.
   *
   * Without this, dragging across the plot fired play() for every dot passed over. Each call
   * supersedes the last, so the renders all get discarded — but they still occupy the worker
   * pool, so the capture you actually stopped on queued behind dozens of dead ones and took
   * seconds to sound, or appeared not to play at all.
   */
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  // Escape stops whatever is sounding, wherever focus happens to be.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      audition.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [audition])
  const baseFiles = scope === 'library' || !canScopeToFolder ? files : scopedFiles

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

      if (!showUntaggedTone && !f.metadata.tone_type) return false

      if (toneKeys.size > 0) {
        const tone = f.metadata.tone_type ?? 'other'
        if (!toneKeys.has(tone)) return false
      }

      if (gearKeys.size > 0) {
        if (!gearKeys.has(f.metadata.gear_type ?? GEAR_UNTAGGED)) return false
      }

      return true
    })
  }, [positionable, makeKeys, creatorKeys, toneKeys, gearKeys, showUntagged, showUntaggedTone])

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

  /** How many captures the tone-type toggle governs, so the checkbox states its own cost. */
  const untaggedToneCount = useMemo(
    () => positionable.reduce((n, f) => n + (f.metadata.tone_type ? 0 : 1), 0),
    [positionable]
  )

  const gearOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of positionable) {
      const key = f.metadata.gear_type ?? GEAR_UNTAGGED
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const known = GEAR_ORDER.filter((g) => counts.has(g)).map((g) => ({
      key: g,
      label: GEAR_LABELS[g] ?? g,
      count: counts.get(g) ?? 0
    }))
    // Anything unrecognised, plus untagged, after the known kinds rather than dropped.
    const rest = [...counts.keys()]
      .filter((k) => !GEAR_ORDER.includes(k))
      .map((k) => ({
        key: k,
        label: k === GEAR_UNTAGGED ? 'Untagged' : (GEAR_LABELS[k] ?? k),
        count: counts.get(k) ?? 0
      }))
    return [...known, ...rest]
  }, [positionable])

/**
   * How the chosen cab applies to what is actually in scope.
   *
   * The IR is skipped for captures that already contain one, so with a cab-inclusive scope the
   * picker looks broken — you choose a cab and nothing changes. Saying which way round it is
   * costs a line and removes the confusion.
   */
  const cabSplit = useMemo(() => {
    let needs = 0
    const needsKeys = new Set<string>()
    const hasKeys = new Set<string>()
    for (const f of filtered) {
      const key = f.metadata.gear_type ?? GEAR_UNTAGGED
      if (captureNeedsCabIr(f.metadata.gear_type)) {
        needs++
        needsKeys.add(key)
      } else {
        hasKeys.add(key)
      }
    }
    return { needs, has: filtered.length - needs, total: filtered.length, needsKeys, hasKeys }
  }, [filtered])

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
    setGearKeys(new Set())
    setExpandedMake(null)
    setShowUntagged(true)
    setShowUntaggedTone(true)
    setZoom(null)
  }

  const hasNarrowing =
    makeKeys.size > 0 ||
    creatorKeys.size > 0 ||
    toneKeys.size > 0 ||
    gearKeys.size > 0 ||
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

  /**
   * Hand a capture to the full player and get out of the way.
   *
   * The short audition clip must stop: it loops, so it would otherwise keep running underneath
   * the player's own longer clip, and you would hear both at once. A hover that has been queued
   * but not yet fired has to be cancelled too, or it starts a moment after the player opens.
   */
  const openInPlayer = useCallback(
    (file: NamFile) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      audition.stop()
      onPlay(file)
    },
    [audition, onPlay]
  )

  const handleSelect = useCallback(
    (mark: ToneGridMark) => {
      const file = byPath.get(mark.id)
      if (!file) return
      // In 'hover' mode the capture is already sounding, so a click promotes it to the full
      // player - otherwise clicking what you can already hear would appear to do nothing.
      if (dotAction === 'click') {
        // Clicking what is already sounding stops it. Without this the only way to end a clip was
        // to start a different one, so it looped indefinitely.
        if (audition.playingPath === file.filePath) audition.stop()
        else audition.play(file)
      } else openInPlayer(file)
    },
    [byPath, openInPlayer, dotAction, audition]
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
          // Same route as clicking a dot, so the looping audition is stopped here too.
          if (dotAction === 'click') audition.play(only)
          else openInPlayer(only)
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
    [byPath, openInPlayer, dotAction, audition, clampWindow]
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

  // Same clip the player auditions through, resolved from the shared prefs rather than passed
  // down - otherwise the map and the player could disagree about what a capture sounds like.
  useEffect(() => {
    let cancelled = false
    if (!diLibraryPath) {
      setDiPath(null)
      return
    }
    void (async () => {
      const result = await window.api.scanWavLibrary(diLibraryPath)
      if (cancelled) return
      setDiCategories(result.categories)
      setDiPath(resolveActiveDiClip(result.categories))
    })()
    return () => {
      cancelled = true
    }
  }, [diLibraryPath])

  // Same cab the player would apply. useAudition only uses it for captures that lack a cab of
  // their own, so this is safe to resolve unconditionally.
  useEffect(() => {
    let cancelled = false
    if (!irLibraryPath) {
      setIrPath(null)
      return
    }
    void (async () => {
      const result = await window.api.scanWavLibrary(irLibraryPath)
      if (cancelled) return
      setIrCategories(result.categories)
      setIrPath(resolveActiveIr(result.categories))
    })()
    return () => {
      cancelled = true
    }
  }, [irLibraryPath])

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

  // Measured from the plot's own top, so it stays correct however tall the header, facet rail and
  // breadcrumbs happen to be. The plot growing doesn't move its own top, so this can't feed back.
  useEffect(() => {
    const measure = (): void => {
      const element = plotRef.current
      if (!element) return
      const top = element.getBoundingClientRect().top
      setAvailableHeight(Math.max(0, window.innerHeight - top - PLOT_BOTTOM_GUTTER))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // Re-measure whenever chrome above the plot could have reflowed: a different row count, a
    // width change, or the zoom breadcrumb appearing.
  }, [rows.length, plotWidth, zoom])

  // Rows follow the window (see autoRowHeightFor) until the grip pins an explicit height. The
  // dots grow with them via toneGridDotRadius, so a taller row isn't the same specks spread out.
  const autoRowHeight = useMemo(
    () => autoRowHeightFor(rows.length, availableHeight),
    [rows.length, availableHeight]
  )

  const rowHeight = rowHeightOverride ?? autoRowHeight
  const gridHeight = toneGridHeight(rows.length, rowHeight)

  // Drag the grip to set row height explicitly. Listeners go on the window so the drag survives
  // the cursor leaving the narrow grip, which is otherwise very easy to do.
  const resizeRef = useRef<{ startY: number; startRowHeight: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      resizeRef.current = { startY: event.clientY, startRowHeight: rowHeight }
      setResizing(true)
    },
    [rowHeight]
  )

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: MouseEvent): void => {
      const drag = resizeRef.current
      if (!drag || rows.length === 0) return
      // Dragging down by N pixels should make the whole plot N pixels taller, so the grip tracks
      // the cursor rather than running away from it as the row count changes.
      const next = drag.startRowHeight + (event.clientY - drag.startY) / rows.length
      setRowHeightOverride(Math.min(Math.max(next, TONE_GRID_ROW_HEIGHT), MAX_ROW_HEIGHT))
    }
    const onUp = (): void => {
      resizeRef.current = null
      setResizing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing, rows.length])

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

        {/* Map vs list — same captures and same facets, read two different ways. */}
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 flex-shrink-0">
          {(['map', 'list'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setView(value)}
              className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                view === value
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title={value === 'map' ? 'Plot every capture' : 'Sweep them in order, by ear'}
            >
              {value === 'map' ? 'Map' : 'List'}
            </button>
          ))}
        </div>

        {/* What a dot does. Only meaningful on the map; the list is always hold-to-hear. */}
        {view === 'map' && (
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 flex-shrink-0">
            {(
              [
                ['open', 'Open', 'Click a dot to open it in the player'],
                ['click', 'Click to hear', 'Click a dot to play it here, without opening the player'],
                ['hover', 'Hover to hear', 'Captures play as you move across the map']
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                onClick={() => {
                  setDotAction(value)
                  audition.stop()
                }}
                disabled={value !== 'open' && !diPath}
                title={!diPath && value !== 'open' ? 'Set a DI clip in the player first' : hint}
                className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  dotAction === value
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {view === 'list' && (
          <button
            onClick={() => setLatched((v) => !v)}
            title={
              latched
                ? 'Latched — a capture keeps playing after you let go'
                : 'Hold to listen — audio stops when you release'
            }
            className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors flex-shrink-0 ${
              latched
                ? 'text-[#06201d] bg-[var(--accent)]'
                : 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800'
            }`}
          >
            {latched ? 'Latched' : 'Hold'}
          </button>
        )}

        {/* Only worth offering when the current view is actually narrower than the library —
            otherwise "This folder" named nothing and selected the same captures. */}
        {canScopeToFolder && (
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 flex-shrink-0">
            {(['library', 'folder'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                  scope === value
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
                title={
                  value === 'library'
                    ? `Every capture in the library (${files.length.toLocaleString()})`
                    : `Only what you are browsing (${scopedFiles.length.toLocaleString()})`
                }
              >
                {value === 'library'
                  ? 'Whole library'
                  : (scopeLabel ?? `Current view (${scopedFiles.length.toLocaleString()})`)}
              </button>
            ))}
          </div>
        )}

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
          <Facet
            title="Gear type"
            options={gearOptions}
            selected={gearKeys}
            onToggle={toggleIn(setGearKeys)}
            onClear={() => setGearKeys(new Set())}
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
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showUntaggedTone}
              onChange={(e) => setShowUntaggedTone(e.target.checked)}
              className="w-3 h-3 rounded accent-teal-500"
            />
            <span className="text-[11px] text-gray-600 dark:text-gray-300">
              Show captures with no tone type
              {untaggedToneCount > 0 && (
                <span className="text-gray-400 dark:text-gray-500"> ({untaggedToneCount.toLocaleString()})</span>
              )}
            </span>
          </label>
        </div>

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* What you are actually hearing through. Shown whenever a listening mode is on: the
              DI and cab are shared with the player, but "shared" must not mean "invisible" —
              otherwise captures are auditioned through settings you cannot see or change here. */}
          {/* Always shown, not only while listening: it is also how you find out what a listening
              mode WILL use, and the cab warning is the main way the gear-type mismatch surfaces. */}
          {(diCategories.length > 0 || irCategories.length > 0) && (
            <div
              className={`flex items-center gap-3 px-4 pt-3 text-[11px] flex-wrap ${
                listening ? '' : 'opacity-70'
              }`}
            >
              <span className="text-[9px] font-semibold uppercase tracking-[.14em] text-gray-400 dark:text-gray-500">
                {listening ? 'Listening through' : 'Will listen through'}
              </span>

              {/* Visible stop. Clicking the sounding dot again also stops it, but that is not
                  discoverable on its own, and a looping clip with no obvious way out is worse
                  than an extra button. */}
              {audition.playingPath !== null && (
                <button
                  onClick={() => {
                    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                    audition.stop()
                  }}
                  title="Stop (Esc) — or click the same capture again"
                  className="h-6 px-2 rounded-full text-[10px] font-semibold bg-[var(--accent)] text-[#06201d] hover:opacity-90 flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-sm bg-[#06201d]" />
                  Stop
                </button>
              )}

              <label className="flex items-center gap-1.5">
                <span className="text-gray-500 dark:text-gray-400">DI</span>
                <select
                  value={diPath ?? ''}
                  onChange={(e) => {
                    const path = e.target.value || null
                    setDiPath(path)
                    const owner = diCategories.find((c) => c.files.some((f) => f.path === path))
                    if (owner && path) {
                      const prefs = loadDiPrefs()
                      saveDiPrefs({
                        byCategory: { ...prefs.byCategory, [owner.name]: path },
                        activeCategory: owner.name
                      })
                    }
                  }}
                  disabled={diCategories.length === 0}
                  className="h-6 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 max-w-[190px] disabled:opacity-40"
                  title="The clip every capture is auditioned through. Shared with the player."
                >
                  {diCategories.length === 0 && <option value="">No DI library set</option>}
                  {diCategories.map((c) => (
                    <optgroup key={c.name} label={c.name}>
                      {c.files.map((f) => (
                        <option key={f.path} value={f.path}>
                          {f.name.replace(/\.wav$/i, '')}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-gray-500 dark:text-gray-400">Cab IR</span>
                <select
                  value={irPath ?? ''}
                  onChange={(e) => {
                    const path = e.target.value || null
                    setIrPath(path)
                    saveIrPath(path)
                  }}
                  disabled={irCategories.length === 0}
                  className="h-6 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 max-w-[190px] disabled:opacity-40"
                  title="Applied only to captures that do not already include a cab."
                >
                  <option value="">None (dry)</option>
                  {irCategories.map((c) => (
                    <optgroup key={c.name} label={c.name}>
                      {c.files.map((f) => (
                        <option key={f.path} value={f.path}>
                          {f.name.replace(/\.wav$/i, '')}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              {/* A mixed scope is not comparable by ear: the cab is applied to one half and
                  skipped for the other. Offer the split as one click rather than leaving the user
                  to find the Gear type facet and work out which values mean what. */}
              {cabSplit.needs > 0 && cabSplit.has > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-500">
                  mixed gear — not comparable:
                  <button
                    onClick={() => setGearKeys(new Set(cabSplit.needsKeys))}
                    className="h-5 px-1.5 rounded border border-amber-500/40 hover:bg-amber-500/10"
                    title="Only captures that need a cabinet IR"
                  >
                    amp only ({cabSplit.needs.toLocaleString()})
                  </button>
                  <button
                    onClick={() => setGearKeys(new Set(cabSplit.hasKeys))}
                    className="h-5 px-1.5 rounded border border-amber-500/40 hover:bg-amber-500/10"
                    title="Only captures that already include a cabinet"
                  >
                    with cab ({cabSplit.has.toLocaleString()})
                  </button>
                </span>
              )}

              {/* Which way round the cab applies for THIS scope, so the picker never looks broken. */}
              {cabSplit.total > 0 && (
                <span
                  className={`text-[10px] ${
                    irPath && cabSplit.needs === 0
                      ? 'text-amber-600 dark:text-amber-500'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {irPath && cabSplit.needs === 0
                    ? 'every capture in scope already has a cab — this IR is not applied to any of them'
                    : irPath && cabSplit.has > 0
                      ? `cab applied to ${cabSplit.needs.toLocaleString()} of ${cabSplit.total.toLocaleString()} · the other ${cabSplit.has.toLocaleString()} already have one. Filter by Gear type to compare like with like.`
                      : irPath
                        ? `cab applied to all ${cabSplit.total.toLocaleString()} in scope`
                        : cabSplit.needs > 0
                          ? `${cabSplit.needs.toLocaleString()} in scope have no cab — pick an IR or they will sound harsh`
                          : 'no cab needed — every capture in scope has one'}
                </span>
              )}
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                same settings as the player
              </span>
              {audition.error && (
                <span className="text-[10px] text-red-500">{audition.error}</span>
              )}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto p-4">
          {view === 'list' ? (
            <ScanList
              files={filtered}
              audition={audition}
              latched={latched}
              onOpenInPlayer={openInPlayer}
              nowPlayingPath={nowPlaying?.filePath ?? null}
            />
          ) : rows.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400 dark:text-gray-600">
                {positionable.length === 0
                  ? 'No captures report a measured gain value yet.'
                  : 'Nothing matches those filters.'}
              </p>
            </div>
          ) : (
            <div
              ref={attachPlot}
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
                  if (dotAction === 'open') return
                  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                  if (!mark) {
                    // Moving off the dots ends the sweep, so hover reads as scrubbing rather
                    // than as latching whatever you happened to pass over last.
                    if (dotAction === 'hover') audition.stop()
                    return
                  }
                  const file = byPath.get(mark.id)
                  if (!file) return
                  if (dotAction === 'hover' && audition.playingPath === file.filePath) return
                  // Only act once the cursor has settled. Warming on the way past would fill the
                  // pool with captures the user is merely travelling over.
                  hoverTimerRef.current = setTimeout(() => {
                    if (dotAction === 'hover') audition.play(file)
                    else audition.prefetch([file])
                  }, HOVER_SETTLE_MS)
                }}
                onSelect={handleSelect}
                onDrillCell={handleDrillCell}
                onSelectRow={handleSelectRow}
                rowHeight={rowHeight}
              />
            </div>
          )}

          {/* Row-height grip. Rows follow the window by default; dragging pins a height, and the
              reset only appears once pinned so there's nothing to explain until it applies. */}
          {rows.length > 0 && (
            <div className="mt-1 flex items-center justify-center gap-2">
              <div
                onMouseDown={handleResizeStart}
                title="Drag to change row height"
                className={`h-3 w-28 flex items-center justify-center rounded cursor-ns-resize transition-colors ${
                  resizing ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <div className="w-10 h-[3px] rounded-full bg-gray-300 dark:bg-gray-600" />
              </div>
              {rowHeightOverride !== null && (
                <button
                  onClick={() => setRowHeightOverride(null)}
                  className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
                  title="Go back to filling the window automatically"
                >
                  auto height
                </button>
              )}
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

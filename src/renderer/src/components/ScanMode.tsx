/**
 * Scan mode — audition a scoped set of captures by ear.
 *
 * The problem it solves: every facet the app offers is a *name*, and you cannot name a tone you
 * have not heard. Here you narrow to a set (a maker, a couple of amps, a tone type) and then sweep
 * it, hearing each capture, rather than reading your way to one.
 *
 * Two things make it feel instant despite each capture needing a WASM render first (~406 ms for a
 * 3 s clip, measured):
 *  - a pool of long-lived workers renders *ahead* of wherever the pointer is, so the clip is
 *    usually already done before you press;
 *  - every capture in a sweep uses the SAME short DI window, so the comparison is fair and the
 *    decoded input is shared across renders.
 *
 * Ordering deliberately does not use `metadata.gain` as its primary key — measured across a real
 * library, 79% of captures sit inside 0.55–0.85, so sorting by it is close to random. See
 * `utils/scanOrder.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NamFile } from '../types/nam'
import {
  applyDcBlocker,
  base64ToArrayBuffer,
  findLoudestWindowStart,
  normalizeRendered,
  readModelSampleRate
} from '../utils/playerAudio'
import {
  buildScanFacets,
  emptyScanScope,
  isScopeEmpty,
  orderScanFiles,
  scopeFiles,
  toggleScopeValue,
  type ScanFacetOption,
  type ScanScope
} from '../utils/scanOrder'
import { estimateRenderMs, formatDuration, planPrefetch } from '../utils/scanQueue'
import { ScanRenderPool } from '../utils/scanRenderPool'
import type { NamRenderRequest } from '../workers/namRender.worker'

/** Short on purpose: a 12 s clip costs ~1.5 s to render, which makes sweeping unusable. */
const SCAN_CLIP_SECONDS = 3
const POOL_SIZE = 4

interface ScanModeProps {
  /** Every capture currently loaded — the pool Scan narrows from. */
  libraryFiles: NamFile[]
  diPath: string | null
  /** Latch a capture into the main player (Preview mode) so it can be scrubbed and kept. */
  onOpenInPlayer: (file: NamFile) => void
  nowPlayingPath?: string | null
}

function Chip({
  option,
  active,
  onClick
}: {
  option: ScanFacetOption
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-none h-7 px-2.5 rounded-full text-[11.5px] whitespace-nowrap transition-colors ${
        active
          ? 'font-semibold text-[#06201d] bg-[var(--accent)]'
          : 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] hover:bg-gray-200 dark:hover:bg-[var(--hover)]'
      }`}
      title={`${option.label} — ${option.count} capture${option.count === 1 ? '' : 's'}`}
    >
      {option.label}
      <span className="ml-1.5 opacity-60">{option.count}</span>
    </button>
  )
}

function Facet({
  label,
  options,
  selected,
  onToggle,
  limit = 12
}: {
  label: string
  options: ScanFacetOption[]
  selected: Set<string>
  onToggle: (key: string) => void
  limit?: number
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (options.length === 0) return null
  // Keep selected chips visible even when they fall outside the top N, or deselecting something
  // would mean expanding the list to find it again.
  const head = options.slice(0, limit)
  const tail = options.slice(limit).filter((o) => selected.has(o.key))
  const shown = expanded ? options : [...head, ...tail]
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-semibold uppercase tracking-[.14em] text-gray-400 dark:text-gray-500">
          {label}
        </span>
        {options.length > limit && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
          >
            {expanded ? 'fewer' : `+${options.length - limit} more`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((o) => (
          <Chip key={o.key} option={o} active={selected.has(o.key)} onClick={() => onToggle(o.key)} />
        ))}
      </div>
    </div>
  )
}

export function ScanMode({
  libraryFiles,
  diPath,
  onOpenInPlayer,
  nowPlayingPath
}: ScanModeProps): React.JSX.Element {
  const [scope, setScope] = useState<ScanScope>(emptyScanScope)
  const [latched, setLatched] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [playingPath, setPlayingPath] = useState<string | null>(null)
  const [readyPaths, setReadyPaths] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [diReady, setDiReady] = useState(false)

  const facets = useMemo(() => buildScanFacets(libraryFiles), [libraryFiles])
  const ordered = useMemo(
    () => orderScanFiles(scopeFiles(libraryFiles, scope)),
    [libraryFiles, scope]
  )

  // ---- audio plumbing -------------------------------------------------------------------
  const ctxRef = useRef<AudioContext | null>(null)
  const poolRef = useRef<ScanRenderPool | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const cacheRef = useRef(new Map<string, AudioBuffer>())
  const inFlightRef = useRef(new Set<string>())
  /** DI window resampled per model rate — nearly every capture is 48k, so this is usually one entry. */
  const diByRateRef = useRef(new Map<number, Float32Array<ArrayBuffer>>())
  const rawDiRef = useRef<{ samples: Float32Array<ArrayBuffer>; rate: number } | null>(null)

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext()
    return ctxRef.current
  }, [])

  const getPool = useCallback((): ScanRenderPool => {
    if (!poolRef.current) {
      poolRef.current = new ScanRenderPool(
        () => new Worker(new URL('../workers/namRender.worker.ts', import.meta.url), { type: 'module' }),
        POOL_SIZE
      )
    }
    return poolRef.current
  }, [])

  // Decode the DI once and keep only its loudest few seconds. Every capture in a sweep hears the
  // same window, which is what makes captures comparable at all.
  useEffect(() => {
    let cancelled = false
    setDiReady(false)
    cacheRef.current.clear()
    diByRateRef.current.clear()
    rawDiRef.current = null
    setReadyPaths(new Set())
    if (!diPath) return
    void (async () => {
      try {
        const res = await window.api.readFileBinary(diPath)
        if (cancelled) return
        if (res.error || !res.data) throw new Error(res.error ?? 'no data')
        const decoded = await getCtx().decodeAudioData(base64ToArrayBuffer(res.data))
        if (cancelled) return
        const whole = new Float32Array(decoded.length)
        decoded.copyFromChannel(whole, 0, 0)
        const windowSamples = Math.min(whole.length, Math.floor(SCAN_CLIP_SECONDS * decoded.sampleRate))
        const start = findLoudestWindowStart(whole, windowSamples)
        rawDiRef.current = {
          samples: whole.slice(start, start + windowSamples),
          rate: decoded.sampleRate
        }
        setDiReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [diPath, getCtx])

  const inputForRate = useCallback(async (rate: number): Promise<Float32Array<ArrayBuffer>> => {
    const cached = diByRateRef.current.get(rate)
    if (cached) return cached
    const raw = rawDiRef.current
    if (!raw) throw new Error('No DI loaded')
    let out: Float32Array<ArrayBuffer>
    if (raw.rate === rate) {
      out = raw.samples
    } else {
      const length = Math.max(1, Math.round((raw.samples.length * rate) / raw.rate))
      const offline = new OfflineAudioContext(1, length, rate)
      const buf = offline.createBuffer(1, raw.samples.length, raw.rate)
      buf.copyToChannel(raw.samples, 0)
      const node = offline.createBufferSource()
      node.buffer = buf
      node.connect(offline.destination)
      node.start()
      const rendered = await offline.startRendering()
      out = new Float32Array(rendered.length)
      rendered.copyFromChannel(out, 0)
    }
    diByRateRef.current.set(rate, out)
    return out
  }, [])

  const renderCapture = useCallback(
    async (file: NamFile): Promise<AudioBuffer | null> => {
      const key = file.filePath
      if (cacheRef.current.has(key) || inFlightRef.current.has(key)) return cacheRef.current.get(key) ?? null
      inFlightRef.current.add(key)
      try {
        const modelRes = await window.api.readFileBinary(key)
        if (modelRes.error || !modelRes.data) throw new Error(modelRes.error ?? 'no data')
        const modelJson = new TextDecoder().decode(base64ToArrayBuffer(modelRes.data))
        const rate = readModelSampleRate(modelJson)
        const shared = await inputForRate(rate)
        // The worker transfers the input buffer, so each job needs its own copy.
        const input = new Float32Array(shared)
        const request: NamRenderRequest = { modelJson, input, sampleRate: rate }
        const result = await getPool().render(request)
        if (!result.ok) throw new Error(result.error)
        const processed = result.output
        applyDcBlocker(processed, rate)
        const normalized = normalizeRendered(processed, result.loudnessDb)
        const buffer = getCtx().createBuffer(1, normalized.length, rate)
        buffer.copyToChannel(normalized, 0)
        cacheRef.current.set(key, buffer)
        setReadyPaths((prev) => new Set(prev).add(key))
        return buffer
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        inFlightRef.current.delete(key)
      }
    },
    [getCtx, getPool, inputForRate]
  )

  // ---- prefetch -------------------------------------------------------------------------
  useEffect(() => {
    if (!diReady || ordered.length === 0) return
    const doneIdx = new Set<number>()
    const flightIdx = new Set<number>()
    ordered.forEach((f, i) => {
      if (cacheRef.current.has(f.filePath)) doneIdx.add(i)
      if (inFlightRef.current.has(f.filePath)) flightIdx.add(i)
    })
    const { start, evict } = planPrefetch(cursor, ordered.length, doneIdx, flightIdx, {
      concurrency: POOL_SIZE
    })
    for (const i of evict) {
      const path = ordered[i]?.filePath
      if (path && path !== playingPath) {
        cacheRef.current.delete(path)
        setReadyPaths((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    }
    for (const i of start) {
      const file = ordered[i]
      if (file) void renderCapture(file)
    }
  }, [cursor, ordered, diReady, readyPaths, renderCapture, playingPath])

  // ---- playback -------------------------------------------------------------------------
  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null
        sourceRef.current.stop()
      } catch {
        // Already stopped.
      }
      sourceRef.current = null
    }
    setPlayingPath(null)
  }, [])

  const play = useCallback(
    async (file: NamFile) => {
      const ctx = getCtx()
      void ctx.resume()
      stop()
      setPlayingPath(file.filePath)
      const buffer = cacheRef.current.get(file.filePath) ?? (await renderCapture(file))
      if (!buffer) return
      // The user may have moved on while this rendered; don't start audio for a stale row.
      setPlayingPath((current) => {
        if (current !== file.filePath) return current
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.loop = true // a held audition must not fall silent mid-listen
        source.connect(ctx.destination)
        source.start()
        sourceRef.current = source
        return current
      })
    },
    [getCtx, renderCapture, stop]
  )

  const handleDown = useCallback(
    (file: NamFile, index: number) => {
      setCursor(index)
      void play(file)
    },
    [play]
  )

  const handleUp = useCallback(() => {
    if (!latched) stop()
  }, [latched, stop])

  useEffect(() => {
    return () => {
      stop()
      poolRef.current?.dispose()
      poolRef.current = null
      void ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [stop])

  // Releasing outside the row must still stop, or audio sticks on when the pointer slips off.
  useEffect(() => {
    if (latched) return
    const onUp = (): void => stop()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [latched, stop])

  const estimate = estimateRenderMs(ordered.length, SCAN_CLIP_SECONDS, POOL_SIZE)
  const readyCount = ordered.reduce((n, f) => n + (readyPaths.has(f.filePath) ? 1 : 0), 0)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Scope */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-[var(--border-soft)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-semibold uppercase tracking-[.14em] text-gray-400 dark:text-gray-500">
            Scope
          </span>
          {!isScopeEmpty(scope) && (
            <button
              onClick={() => setScope(emptyScanScope())}
              className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
            >
              clear
            </button>
          )}
        </div>
        <Facet
          label="Maker"
          options={facets.creators}
          selected={scope.creators}
          onToggle={(k) => setScope((s) => toggleScopeValue(s, 'creators', k))}
          limit={6}
        />
        <Facet
          label="Amp"
          options={facets.makes}
          selected={scope.makes}
          onToggle={(k) => setScope((s) => toggleScopeValue(s, 'makes', k))}
          limit={10}
        />
        <Facet
          label="Tone"
          options={facets.tones}
          selected={scope.tones}
          onToggle={(k) => setScope((s) => toggleScopeValue(s, 'tones', k))}
          limit={8}
        />
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
          Selecting several amps is how you make a &ldquo;family&rdquo; — they combine with OR, and
          different rows combine with AND.
        </p>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 flex items-center gap-3 border-b border-gray-200 dark:border-[var(--border-soft)]">
        <span className="text-[11px] text-gray-600 dark:text-gray-300">
          <strong>{ordered.length.toLocaleString()}</strong> in scope
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {readyCount}/{ordered.length} ready · full sweep {formatDuration(estimate)}
        </span>
        <button
          onClick={() => setLatched((v) => !v)}
          title={
            latched
              ? 'Latched — a capture keeps playing after you let go'
              : 'Hold to listen — audio stops when you release'
          }
          className={`ml-auto flex-none h-7 px-3 rounded-full text-[11px] font-medium transition-colors ${
            latched
              ? 'text-[#06201d] bg-[var(--accent)]'
              : 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)]'
          }`}
        >
          {latched ? 'Latched' : 'Hold'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 text-[11px] text-red-600 dark:text-red-400 border-b border-gray-200 dark:border-[var(--border-soft)]">
          {error}
        </div>
      )}

      {/* Sweep list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!diPath ? (
          <p className="p-4 text-[12px] text-gray-500 dark:text-gray-400">
            Choose a DI clip in Preview mode first — Scan needs one to play captures through.
          </p>
        ) : ordered.length === 0 ? (
          <p className="p-4 text-[12px] text-gray-500 dark:text-gray-400">
            Nothing matches that scope.
          </p>
        ) : (
          ordered.map((file, i) => {
            const isPlaying = playingPath === file.filePath
            const isReady = readyPaths.has(file.filePath)
            return (
              <div
                key={file.filePath}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={() => handleDown(file, i)}
                onMouseUp={handleUp}
                onDoubleClick={() => onOpenInPlayer(file)}
                title="Press and hold to listen · double-click to open in the player"
                className={`flex items-center gap-2 h-[34px] px-3 cursor-pointer select-none border-b border-gray-100 dark:border-[#151b22] transition-colors ${
                  isPlaying
                    ? 'bg-[var(--active)]'
                    : 'hover:bg-gray-50 dark:hover:bg-[#151b22]'
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
          })
        )}
      </div>
    </div>
  )
}

/**
 * Audition captures on demand — shared by the Tone Map's list and map views.
 *
 * Each capture has to be rendered through the WASM model before it can be heard (~60 ms fixed
 * plus ~120 ms per audio-second, measured), so this keeps a pool of long-lived workers rendering
 * *ahead* of wherever attention is, and caches the results. Every capture is auditioned through
 * the same short DI window, which is what makes them comparable at all.
 *
 * ## Why audio must not start inside a state updater
 *
 * The first version started the AudioBufferSourceNode inside a `setState` updater so it could
 * check "is this still the capture the user wants?" against current state. React StrictMode calls
 * updater functions twice on purpose to surface impure ones — so every press started **two**
 * looping sources while only the second was stored, leaving the first orphaned and looping with
 * no handle to stop it. That is the "captures play over the top of each other" bug.
 *
 * The staleness check now lives in a ref-based generation counter instead: refs are not part of
 * render, so nothing is double-invoked, and starting audio stays an ordinary side effect.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NamFile } from '../types/nam'
import {
  applyDcBlocker,
  base64ToArrayBuffer,
  captureNeedsCabIr,
  findLoudestWindowStart,
  normalizeRendered,
  readModelSampleRate
} from '../utils/playerAudio'
import { applyCabinetIr } from '../utils/audioGraph'
import { ScanRenderPool } from '../utils/scanRenderPool'
import type { NamRenderRequest } from '../workers/namRender.worker'

/**
 * Length of the clip auditioned on hover.
 *
 * Bounded by render cost, which is linear in clip length: a 12 s clip takes ~1.5 s to render,
 * which makes hovering unusable. 3 s was under the length of a musical phrase, though — not long
 * enough to tell two captures apart — so this trades ~0.25 s more render for a clip you can
 * actually judge. Also sets cache memory: CACHE_CAPACITY clips at this length, mono float32.
 */
export const AUDITION_CLIP_SECONDS = 5
const POOL_SIZE = 4
/** Rendered clips kept in memory before the furthest from attention are dropped. */
const CACHE_CAPACITY = 64

export interface AuditionApi {
  /** Render if needed, then play looped. Safe to call rapidly; the last call wins. */
  play: (file: NamFile) => void
  stop: () => void
  /** Warm the cache for captures likely to be pressed next. */
  prefetch: (files: NamFile[]) => void
  /** Capture currently sounding, if any. */
  playingPath: string | null
  /** Paths already rendered, for a readiness indicator. */
  ready: ReadonlySet<string>
  /** True once a DI clip is decoded and captures can actually be heard. */
  diReady: boolean
  error: string
}

export interface AuditionOptions {
  /** Cabinet IR applied to captures that have no cab of their own. */
  irPath?: string | null
  irMix?: number
}

export function useAudition(diPath: string | null, options: AuditionOptions = {}): AuditionApi {
  const { irPath = null, irMix = 1 } = options
  const [playingPath, setPlayingPath] = useState<string | null>(null)
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [diReady, setDiReady] = useState(false)
  const [error, setError] = useState('')

  const ctxRef = useRef<AudioContext | null>(null)
  const poolRef = useRef<ScanRenderPool | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const cacheRef = useRef(new Map<string, AudioBuffer>())
  /**
   * Renders in progress, keyed by path — the PROMISE, not just the path.
   *
   * This used to be a Set and `renderCapture` returned null when a key was present, so pressing a
   * capture that prefetch had already started returned nothing and it silently never played.
   * Prefetch warms exactly what you are about to press, so that was most presses. Sharing the
   * promise means a second caller waits for the same render instead of being turned away.
   */
  const inFlightRef = useRef(new Map<string, Promise<AudioBuffer | null>>())
  const diByRateRef = useRef(new Map<number, Float32Array<ArrayBuffer>>())
  const rawDiRef = useRef<{ samples: Float32Array<ArrayBuffer>; rate: number } | null>(null)
  const irRef = useRef<{ samples: Float32Array; rate: number } | null>(null)
  /**
   * The in-progress IR decode.
   *
   * Renders must wait for it. Without this, anything rendered between choosing an IR and the file
   * finishing decoding was rendered DRY and then cached — so the first captures you auditioned
   * kept sounding un-cabbed even after the IR had loaded, which reads as "the IR isn't working".
   */
  const irLoadRef = useRef<Promise<void> | null>(null)
  /** Bumped on every play/stop; a render that finishes after a newer request is discarded. */
  const generationRef = useRef(0)

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext()
    return ctxRef.current
  }, [])

  const getPool = useCallback((): ScanRenderPool => {
    if (!poolRef.current) {
      poolRef.current = new ScanRenderPool(
        () =>
          new Worker(new URL('../workers/namRender.worker.ts', import.meta.url), { type: 'module' }),
        POOL_SIZE
      )
    }
    return poolRef.current
  }, [])

  // Decode the DI once and keep only its loudest few seconds.
  useEffect(() => {
    let cancelled = false
    setDiReady(false)
    setError('')
    cacheRef.current.clear()
    diByRateRef.current.clear()
    rawDiRef.current = null
    setReady(new Set())
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
        const windowSamples = Math.min(
          whole.length,
          Math.floor(AUDITION_CLIP_SECONDS * decoded.sampleRate)
        )
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

  // Decode the IR once too. Without it, amp-only captures audition as raw power-amp signal -
  // harsh and fizzy - because the speaker doing the heavy filtering in a real rig isn't modelled.
  useEffect(() => {
    let cancelled = false
    irRef.current = null
    // Everything cached was rendered through the previous cab (or none), so it is all stale.
    cacheRef.current.clear()
    setReady(new Set())
    if (!irPath) {
      irLoadRef.current = null
      return
    }
    const load = (async () => {
      try {
        const res = await window.api.readFileBinary(irPath)
        if (cancelled || res.error || !res.data) return
        const decoded = await getCtx().decodeAudioData(base64ToArrayBuffer(res.data))
        if (cancelled) return
        const mono = new Float32Array(decoded.length)
        decoded.copyFromChannel(mono, 0, 0)
        irRef.current = { samples: mono, rate: decoded.sampleRate }
      } catch {
        // An unreadable IR shouldn't stop captures being auditioned dry.
      }
    })()
    irLoadRef.current = load
    return () => {
      cancelled = true
    }
  }, [irPath, getCtx])

  const inputForRate = useCallback(async (rate: number): Promise<Float32Array<ArrayBuffer>> => {
    const cached = diByRateRef.current.get(rate)
    if (cached) return cached
    const raw = rawDiRef.current
    if (!raw) throw new Error('No DI clip loaded')
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
      const cached = cacheRef.current.get(key)
      if (cached) return cached
      const existing = inFlightRef.current.get(key)
      if (existing) return existing
      if (!rawDiRef.current) return null

      const job = (async (): Promise<AudioBuffer | null> => {
      try {
        const modelRes = await window.api.readFileBinary(key)
        if (modelRes.error || !modelRes.data) throw new Error(modelRes.error ?? 'no data')
        const modelJson = new TextDecoder().decode(base64ToArrayBuffer(modelRes.data))
        const rate = readModelSampleRate(modelJson)
        // Wait for the cab, or this render would be cached dry and keep sounding that way.
        if (irLoadRef.current) await irLoadRef.current
        const shared = await inputForRate(rate)
        // The worker transfers the input buffer, so each job needs its own copy.
        const request: NamRenderRequest = {
          modelJson,
          input: new Float32Array(shared),
          sampleRate: rate
        }
        const result = await getPool().render(request)
        if (!result.ok) throw new Error(result.error)

        // Same rule the player uses: a capture that already contains a cab must NOT get another,
        // or you hear two speakers in series.
        let processed: Float32Array = result.output
        let usedIr = false
        const ir = irRef.current
        if (ir && captureNeedsCabIr(file.metadata.gear_type)) {
          processed = await applyCabinetIr(processed, rate, ir.samples, ir.rate, irMix)
          usedIr = true
        }

        applyDcBlocker(processed, rate)
        // The model's own loudness figure describes the dry signal, so it no longer applies once
        // a cab has been convolved in - fall back to peak normalisation, as the player does.
        const normalized = normalizeRendered(processed, usedIr ? null : result.loudnessDb)
        const buffer = getCtx().createBuffer(1, normalized.length, rate)
        buffer.copyToChannel(normalized, 0)

        cacheRef.current.set(key, buffer)
        if (cacheRef.current.size > CACHE_CAPACITY) {
          // Map iterates in insertion order, so the oldest entry is the first key.
          const oldest = cacheRef.current.keys().next().value
          if (oldest && oldest !== key) cacheRef.current.delete(oldest)
        }
        setReady((prev) => {
          const next = new Set(prev)
          next.add(key)
          if (cacheRef.current.size <= CACHE_CAPACITY) return next
          return new Set(cacheRef.current.keys())
        })
        return buffer
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        inFlightRef.current.delete(key)
      }
      })()
      inFlightRef.current.set(key, job)
      return job
    },
    [getCtx, getPool, inputForRate, irMix]
  )

  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null
        sourceRef.current.stop()
      } catch {
        // Already stopped.
      }
      sourceRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    generationRef.current++
    stopSource()
    setPlayingPath(null)
  }, [stopSource])

  const play = useCallback(
    (file: NamFile) => {
      const generation = ++generationRef.current
      stopSource()
      setPlayingPath(file.filePath)
      const ctx = getCtx()
      void ctx.resume()

      const startWith = (buffer: AudioBuffer): void => {
        // A newer press (or a stop) happened while this rendered - discard silently.
        if (generationRef.current !== generation) return
        stopSource()
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.loop = true // a held audition must not fall silent mid-listen
        source.connect(ctx.destination)
        source.start()
        sourceRef.current = source
      }

      const cached = cacheRef.current.get(file.filePath)
      if (cached) {
        startWith(cached)
        return
      }
      void renderCapture(file).then((buffer) => {
        if (buffer) startWith(buffer)
        else if (generationRef.current === generation) setPlayingPath(null)
      })
    },
    [getCtx, renderCapture, stopSource]
  )

  const prefetch = useCallback(
    (files: NamFile[]) => {
      if (!rawDiRef.current) return
      const pool = getPool()
      // Don't queue more than the pool can chew through - a long queue would delay whatever the
      // user presses next behind speculative work they may never want.
      let budget = POOL_SIZE * 2 - pool.pending
      for (const file of files) {
        if (budget <= 0) break
        if (cacheRef.current.has(file.filePath) || inFlightRef.current.has(file.filePath)) continue
        budget--
        void renderCapture(file)
      }
    },
    [getPool, renderCapture]
  )

  useEffect(() => {
    return () => {
      generationRef.current++
      stopSource()
      poolRef.current?.dispose()
      poolRef.current = null
      void ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [stopSource])

  return { play, stop, prefetch, playingPath, ready, diReady, error }
}

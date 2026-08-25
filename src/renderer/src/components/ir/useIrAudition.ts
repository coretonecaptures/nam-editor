/**
 * Quick audition for IR mode — docs/ir-lab-manager-build-plan.md section 8.
 *
 * Deliberately NOT a port of hooks/useAudition.ts's render pipeline, per the plan's own
 * instruction: "Drop the NAM WASM model worklet entirely — this workflow is DI -> ConvolverNode
 * against the selected IR -> out." There is no model to render through here, so there's no
 * render-ahead WORKER POOL either (useAudition's POOL_SIZE=4 pool exists specifically to
 * parallelize ~60-180ms WASM renders off the main thread) — an offline convolution of a 5s DI
 * clip against a typical (sub-1s) IR is cheap enough to render on demand, on the main thread,
 * inside a promise. If real usage shows otherwise, add prefetch-ahead then; this is a stated
 * scope decision, not an oversight (docs/ir-lab-manager-build-plan.md section 12, Phase 4 notes).
 *
 * What IS reused, directly: playerAudio.ts's decode/normalize helpers and audioGraph.ts's
 * applyCabinetIr — the same convolution the player and useAudition both already run through, so
 * an IR auditioned here sounds like it will everywhere else in the app. Also reused: the
 * generation-counter staleness guard useAudition.ts's own header comment documents fixing a real
 * "captures play over each other" bug with — same risk exists here (rapid row-to-row navigation
 * racing renders), so the same fix applies.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyDcBlocker, base64ToArrayBuffer, findLoudestWindowStart, normalizeRendered } from '../../utils/playerAudio'
import { applyCabinetIr } from '../../utils/audioGraph'

const AUDITION_CLIP_SECONDS = 5
const CACHE_CAPACITY = 64
const DI_PATH_KEY = 'nam-lab-ir-mode-di-path'

export interface IrAuditionItem {
  id: string
  abs_path: string
}

export interface IrAuditionApi {
  play: (item: IrAuditionItem) => void
  stop: () => void
  playingId: string | null
  ready: ReadonlySet<string>
  diPath: string | null
  diReady: boolean
  pickDiClip: () => Promise<void>
  error: string
}

export function useIrAudition(): IrAuditionApi {
  const [diPath, setDiPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DI_PATH_KEY)
    } catch {
      return null
    }
  })
  const [diReady, setDiReady] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const cacheRef = useRef(new Map<string, AudioBuffer>())
  const inFlightRef = useRef(new Map<string, Promise<AudioBuffer | null>>())
  const diRef = useRef<{ samples: Float32Array; rate: number } | null>(null)
  const generationRef = useRef(0)

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext()
    return ctxRef.current
  }, [])

  // Decode the DI clip once per path change, keeping only its loudest window — same approach as
  // hooks/useAudition.ts, for the same reason (a representative few seconds, not the whole file).
  useEffect(() => {
    let cancelled = false
    setDiReady(false)
    setError('')
    cacheRef.current.clear()
    setReady(new Set())
    diRef.current = null
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
        const windowSamples = Math.min(whole.length, Math.floor(AUDITION_CLIP_SECONDS * decoded.sampleRate))
        const start = findLoudestWindowStart(whole, windowSamples)
        diRef.current = { samples: whole.slice(start, start + windowSamples), rate: decoded.sampleRate }
        setDiReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [diPath, getCtx])

  const pickDiClip = useCallback(async () => {
    const path = await window.api.openAudioFile()
    if (!path) return
    try {
      localStorage.setItem(DI_PATH_KEY, path)
    } catch {
      // Non-fatal — worst case the choice doesn't survive a restart.
    }
    setDiPath(path)
  }, [])

  const renderItem = useCallback(
    async (item: IrAuditionItem): Promise<AudioBuffer | null> => {
      const key = item.id
      const cached = cacheRef.current.get(key)
      if (cached) return cached
      const existing = inFlightRef.current.get(key)
      if (existing) return existing
      const di = diRef.current
      if (!di) return null

      const job = (async (): Promise<AudioBuffer | null> => {
        try {
          const irRes = await window.api.readFileBinary(item.abs_path)
          if (irRes.error || !irRes.data) throw new Error(irRes.error ?? 'no data')
          const decoded = await getCtx().decodeAudioData(base64ToArrayBuffer(irRes.data))
          const irSamples = new Float32Array(decoded.length)
          decoded.copyFromChannel(irSamples, 0, 0)

          // mix=1: fully wet on purpose — auditioning what this IR alone sounds like against a
          // DI is the point, not blending it with a dry signal the way the player's cab-mix does.
          const rendered = await applyCabinetIr(di.samples, di.rate, irSamples, decoded.sampleRate, 1)
          applyDcBlocker(rendered, di.rate)
          const normalized = normalizeRendered(rendered, null)

          const buffer = getCtx().createBuffer(1, normalized.length, di.rate)
          buffer.copyToChannel(normalized, 0)

          cacheRef.current.set(key, buffer)
          if (cacheRef.current.size > CACHE_CAPACITY) {
            const oldest = cacheRef.current.keys().next().value
            if (oldest && oldest !== key) cacheRef.current.delete(oldest)
          }
          setReady((prev) => {
            const next = new Set(prev)
            next.add(key)
            return next
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
    [getCtx]
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
    setPlayingId(null)
  }, [stopSource])

  const play = useCallback(
    (item: IrAuditionItem) => {
      const generation = ++generationRef.current
      stopSource()
      setPlayingId(item.id)
      const ctx = getCtx()
      void ctx.resume()

      const startWith = (buffer: AudioBuffer): void => {
        // Stale — a newer press (or a stop) happened while this rendered. Same guard as
        // useAudition.ts, and for the same reason: this must not run inside a state updater
        // (React StrictMode double-invokes those), so it's a ref check in an ordinary callback.
        if (generationRef.current !== generation) return
        stopSource()
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.loop = true
        source.connect(ctx.destination)
        source.start()
        sourceRef.current = source
      }

      const cached = cacheRef.current.get(item.id)
      if (cached) {
        startWith(cached)
        return
      }
      void renderItem(item).then((buffer) => {
        if (buffer) startWith(buffer)
        else if (generationRef.current === generation) setPlayingId(null)
      })
    },
    [getCtx, renderItem, stopSource]
  )

  useEffect(() => {
    return () => {
      generationRef.current++
      stopSource()
      void ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [stopSource])

  return { play, stop, playingId, ready, diPath, diReady, pickDiClip, error }
}

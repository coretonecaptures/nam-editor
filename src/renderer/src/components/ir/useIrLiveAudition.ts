/**
 * Live IR audition — replaces the earlier offline-render mechanism (formerly useIrAudition.ts,
 * deleted). That version rendered a DI file through the IR once and looped the result; asking for
 * a DI at all was wrong — NAM Lab's own "Live" mode (PlayerPanel.tsx's startLive()) never needs
 * one, since it monitors real mic/interface input continuously through LiveEngine. This hook does
 * the same thing IR mode was actually asked for: pick an amp capture once (same flow NAM Lab's
 * own Live mode uses — PlayerPanel.tsx:1175), start real-time monitoring through it via LiveEngine,
 * and let each IR's play button hot-swap the cabinet on the ALREADY-RUNNING engine via
 * `LiveEngine.setIr()` (liveEngine.ts:2348 wireIr()) — the exact mechanism NAM Lab's own player
 * already uses when you change cabs mid-session (PlayerPanel.tsx:1288-1304), not a new one.
 *
 * Deliberately minimal versus PlayerPanel's full Live mode: no gate/EQ/delay/reverb/chorus, no
 * device picker (system default input/output) — those are real gaps, not overlooked, kept out to
 * ship the core "click an IR, hear it live" loop first.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveEngine } from '../../utils/liveEngine'
import { base64ToArrayBuffer } from '../../utils/playerAudio'

const CAPTURE_PATH_KEY = 'nam-lab-ir-mode-live-capture-path'

export interface IrLiveAuditionItem {
  id: string
  abs_path: string
  display_name: string
}

export interface IrLiveAuditionApi {
  capturePath: string | null
  captureName: string | null
  pickCapture: () => Promise<void>
  running: boolean
  starting: boolean
  error: string
  outputMeter: number
  activeItemId: string | null
  activeItemName: string | null
  /** Starts monitoring (if not already running) and swaps to this IR — the one action a row's
   * play button takes, matching the ask ("auto pick the IR block to whatever you click play on"). */
  playItem: (item: IrLiveAuditionItem) => Promise<void>
  stop: () => Promise<void>
}

export function useIrLiveAudition(): IrLiveAuditionApi {
  const [capturePath, setCapturePathState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CAPTURE_PATH_KEY)
    } catch {
      return null
    }
  })
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [outputMeter, setOutputMeter] = useState(0)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [activeItemName, setActiveItemName] = useState<string | null>(null)

  const engineRef = useRef<LiveEngine | null>(null)
  const decodeCtxRef = useRef<AudioContext | null>(null)
  const meterRafRef = useRef<number | null>(null)
  const generationRef = useRef(0)

  const getDecodeCtx = useCallback((): AudioContext => {
    if (!decodeCtxRef.current || decodeCtxRef.current.state === 'closed') decodeCtxRef.current = new AudioContext()
    return decodeCtxRef.current
  }, [])

  const pickCapture = useCallback(async () => {
    const files = await window.api.openFiles()
    if (files.length === 0) return
    try {
      localStorage.setItem(CAPTURE_PATH_KEY, files[0])
    } catch {
      // Non-fatal — worst case the choice doesn't survive a restart.
    }
    setCapturePathState(files[0])
  }, [])

  const stopMeterLoop = useCallback(() => {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current)
      meterRafRef.current = null
    }
  }, [])

  const stop = useCallback(async () => {
    generationRef.current++
    stopMeterLoop()
    await engineRef.current?.stop()
    engineRef.current = null
    setRunning(false)
    setOutputMeter(0)
    setActiveItemId(null)
    setActiveItemName(null)
  }, [stopMeterLoop])

  const start = useCallback(async (): Promise<LiveEngine | null> => {
    if (!capturePath) {
      setError('Pick an amp capture first.')
      return null
    }
    const generation = ++generationRef.current
    setError('')
    setStarting(true)
    try {
      const modelResult = await window.api.readFileBinary(capturePath)
      if (modelResult.error || !modelResult.data) {
        throw new Error(`Could not read the capture: ${modelResult.error ?? 'no data'}`)
      }
      if (generationRef.current !== generation) return null
      const modelJson = new TextDecoder().decode(base64ToArrayBuffer(modelResult.data))

      const engine = new LiveEngine((message) => setError(message))
      await engine.start({ modelJson })
      if (generationRef.current !== generation) {
        await engine.stop()
        return null
      }
      engineRef.current = engine
      setRunning(true)

      const tick = (): void => {
        setOutputMeter(engine.readOutputPeak())
        meterRafRef.current = requestAnimationFrame(tick)
      }
      meterRafRef.current = requestAnimationFrame(tick)
      return engine
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      if (generationRef.current === generation) setStarting(false)
    }
  }, [capturePath])

  const playItem = useCallback(
    async (item: IrLiveAuditionItem) => {
      setError('')
      let engine = engineRef.current
      if (!engine) {
        engine = await start()
        if (!engine) return
      }
      try {
        const irRes = await window.api.readFileBinary(item.abs_path)
        if (irRes.error || !irRes.data) throw new Error(irRes.error ?? 'no data')
        const decoded = await getDecodeCtx().decodeAudioData(base64ToArrayBuffer(irRes.data))
        const mono = new Float32Array(decoded.length)
        decoded.copyFromChannel(mono, 0, 0)
        await engine.setIr({ samples: mono, sampleRate: decoded.sampleRate })
        setActiveItemId(item.id)
        setActiveItemName(item.display_name)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [start, getDecodeCtx]
  )

  useEffect(() => {
    return () => {
      generationRef.current++
      stopMeterLoop()
      void engineRef.current?.stop()
      engineRef.current = null
      void decodeCtxRef.current?.close()
      decodeCtxRef.current = null
    }
  }, [stopMeterLoop])

  const captureName = capturePath ? capturePath.split(/[\\/]/).pop() ?? capturePath : null

  return {
    capturePath,
    captureName,
    pickCapture,
    running,
    starting,
    error,
    outputMeter,
    activeItemId,
    activeItemName,
    playItem,
    stop
  }
}

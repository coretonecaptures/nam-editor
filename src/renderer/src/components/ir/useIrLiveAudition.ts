/**
 * Live IR audition — replaces the earlier offline-render mechanism (formerly useIrAudition.ts,
 * deleted). That version rendered a DI file through the IR once and looped the result; asking for
 * a DI at all was wrong — NAM Lab's own "Live" mode (PlayerPanel.tsx's startLive()) never needs
 * one, since it monitors real mic/interface input continuously through LiveEngine. This hook does
 * the same thing IR mode was actually asked for: pick an amp capture once (same flow NAM Lab's
 * own Live mode uses — PlayerPanel.tsx:1175), start real-time monitoring through it via LiveEngine,
 * and let each IR's play button hot-swap a cabinet slot on the ALREADY-RUNNING engine via
 * `LiveEngine.setIrSlot()` — the same rebuild-with-fade mechanism NAM Lab's own player already
 * uses when you change cabs mid-session (PlayerPanel.tsx:1288-1304), extended to two slots (A/B)
 * with a crossfade blend between them, per the "add a second IR slot" ask.
 *
 * Also carries an input/output device picker and simple on/off toggles for gate/EQ/delay/reverb/
 * chorus (each just flips `enabled` — or, for delay, its mix between 0 and a fixed default — at
 * LiveEngine's own default settings otherwise) — enough to close the "no FX at all" gap without
 * rebuilding PlayerPanel's full knob-by-knob rack. Fine-grained per-effect controls (delay time,
 * reverb tone, etc.) are a real, separate gap, not attempted here.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LiveEngine,
  listAudioInputs,
  listAudioOutputs,
  DEFAULT_GATE,
  DEFAULT_EQ,
  DEFAULT_DELAY,
  DEFAULT_REVERB,
  DEFAULT_CHORUS,
  type LiveDeviceInfo
} from '../../utils/liveEngine'
import { base64ToArrayBuffer } from '../../utils/playerAudio'
import { tryAcquireLiveEngine, releaseLiveEngine, describeLiveEngineOwner, getActiveLiveEngineOwner } from '../../utils/liveEngineOwner'

const CAPTURE_PATH_KEY = 'nam-lab-ir-mode-live-capture-path'
/** Non-zero mix used when the delay toggle is switched on — DelaySettings has no separate
 * `enabled` flag, mix itself IS the on/off (0 = off, matching PlayerPanel's own convention). */
const DELAY_ON_MIX = 0.25

export type IrLiveSlot = 'A' | 'B'

export interface IrLiveAuditionItem {
  id: string
  abs_path: string
  display_name: string
}

export interface IrLiveFx {
  gate: boolean
  eq: boolean
  delay: boolean
  reverb: boolean
  chorus: boolean
}

export interface IrLiveAuditionApi {
  capturePath: string | null
  captureName: string | null
  pickCapture: () => Promise<void>
  running: boolean
  starting: boolean
  error: string
  outputMeter: number
  /** What's currently loaded in each cabinet slot, or null if empty. */
  slotA: IrLiveAuditionItem | null
  slotB: IrLiveAuditionItem | null
  /** 0 = slot A only, 1 = slot B only, in between = crossfaded. */
  blend: number
  setBlend: (value: number) => void
  inputDevices: LiveDeviceInfo[]
  outputDevices: LiveDeviceInfo[]
  inputDeviceId: string | null
  outputDeviceId: string | null
  setInputDeviceId: (id: string | null) => void
  setOutputDeviceId: (id: string | null) => void
  fx: IrLiveFx
  toggleFx: (key: keyof IrLiveFx) => void
  /** Starts monitoring (if not already running) and loads this IR into the given slot — a row's
   * plain play button always targets slot A (matching the ask: "auto pick the IR block to
   * whatever you click play on"); the tray/context menu can target slot B for blending. */
  playItem: (item: IrLiveAuditionItem, slot?: IrLiveSlot) => Promise<void>
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
  const [slotA, setSlotA] = useState<IrLiveAuditionItem | null>(null)
  const [slotB, setSlotB] = useState<IrLiveAuditionItem | null>(null)
  const [blend, setBlendState] = useState(0)
  const [inputDevices, setInputDevices] = useState<LiveDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<LiveDeviceInfo[]>([])
  const [inputDeviceId, setInputDeviceIdState] = useState<string | null>(null)
  const [outputDeviceId, setOutputDeviceIdState] = useState<string | null>(null)
  const [fx, setFx] = useState<IrLiveFx>({ gate: false, eq: false, delay: false, reverb: false, chorus: false })

  const engineRef = useRef<LiveEngine | null>(null)
  const decodeCtxRef = useRef<AudioContext | null>(null)
  const meterRafRef = useRef<number | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [inputs, outputs] = await Promise.all([listAudioInputs(), listAudioOutputs()])
      if (cancelled) return
      setInputDevices(inputs)
      setOutputDevices(outputs)
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
    releaseLiveEngine('ir-mode')
    setRunning(false)
    setOutputMeter(0)
    setSlotA(null)
    setSlotB(null)
    setBlendState(0)
  }, [stopMeterLoop])

  const start = useCallback(async (): Promise<LiveEngine | null> => {
    if (!capturePath) {
      setError('Pick an amp capture first.')
      return null
    }
    // Cross-tree mutex (plan section 8b/2) — NAM mode and IR mode each own an independent
    // LiveEngine; refuse to open a second one (and a second mic stream) while the other mode is
    // already live, rather than silently contending for the same input device.
    if (!tryAcquireLiveEngine('ir-mode')) {
      setError(`Live monitoring is already running in ${describeLiveEngineOwner(getActiveLiveEngineOwner()!)} — stop it there first.`)
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
      await engine.start({
        modelJson,
        deviceId: inputDeviceId,
        outputDeviceId,
        gate: { ...DEFAULT_GATE, enabled: fx.gate },
        eq: { ...DEFAULT_EQ, enabled: fx.eq },
        delay: { ...DEFAULT_DELAY, mix: fx.delay ? DELAY_ON_MIX : 0 },
        reverb: { ...DEFAULT_REVERB, enabled: fx.reverb },
        chorus: { ...DEFAULT_CHORUS, enabled: fx.chorus }
      })
      if (generationRef.current !== generation) {
        await engine.stop()
        releaseLiveEngine('ir-mode')
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
      releaseLiveEngine('ir-mode')
      return null
    } finally {
      if (generationRef.current === generation) setStarting(false)
    }
  }, [capturePath, inputDeviceId, outputDeviceId, fx])

  /** Changing an input/output device needs a fresh getUserMedia stream — restart if already
   * running, matching how NAM mode's own device pickers behave (a live device switch isn't a
   * hot-swap the way a cabinet or an FX toggle is). */
  const restartIfRunning = useCallback(async () => {
    if (!engineRef.current) return
    const wasSlotA = slotA
    const wasSlotB = slotB
    const wasBlend = blend
    await stop()
    const engine = await start()
    if (!engine) return
    if (wasSlotA) {
      const irRes = await window.api.readFileBinary(wasSlotA.abs_path)
      if (irRes.data) {
        const decoded = await getDecodeCtx().decodeAudioData(base64ToArrayBuffer(irRes.data))
        const mono = new Float32Array(decoded.length)
        decoded.copyFromChannel(mono, 0, 0)
        await engine.setIrSlot('A', { samples: mono, sampleRate: decoded.sampleRate })
        setSlotA(wasSlotA)
      }
    }
    if (wasSlotB) {
      const irRes = await window.api.readFileBinary(wasSlotB.abs_path)
      if (irRes.data) {
        const decoded = await getDecodeCtx().decodeAudioData(base64ToArrayBuffer(irRes.data))
        const mono = new Float32Array(decoded.length)
        decoded.copyFromChannel(mono, 0, 0)
        await engine.setIrSlot('B', { samples: mono, sampleRate: decoded.sampleRate })
        setSlotB(wasSlotB)
      }
    }
    engine.setBlend(wasBlend)
    setBlendState(wasBlend)
  }, [stop, start, slotA, slotB, blend, getDecodeCtx])

  const setInputDeviceId = useCallback(
    (id: string | null) => {
      setInputDeviceIdState(id)
      void restartIfRunning()
    },
    // restartIfRunning intentionally omitted — it closes over the OLD inputDeviceId until the
    // next render, and this only needs to fire once per explicit device pick, not on every
    // dependency ripple restartIfRunning itself has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const setOutputDeviceId = useCallback(
    (id: string | null) => {
      setOutputDeviceIdState(id)
      void restartIfRunning()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const toggleFx = useCallback(
    (key: keyof IrLiveFx) => {
      setFx((prev) => {
        const next = { ...prev, [key]: !prev[key] }
        const engine = engineRef.current
        if (engine) {
          if (key === 'gate') engine.setGate({ enabled: next.gate })
          else if (key === 'eq') engine.setEq({ enabled: next.eq })
          else if (key === 'delay') engine.setDelay({ mix: next.delay ? DELAY_ON_MIX : 0 })
          else if (key === 'reverb') engine.setReverb({ enabled: next.reverb })
          else if (key === 'chorus') engine.setChorus({ enabled: next.chorus })
        }
        return next
      })
    },
    []
  )

  const playItem = useCallback(
    async (item: IrLiveAuditionItem, slot: IrLiveSlot = 'A') => {
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
        await engine.setIrSlot(slot, { samples: mono, sampleRate: decoded.sampleRate })
        if (slot === 'A') setSlotA(item)
        else setSlotB(item)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [start, getDecodeCtx]
  )

  const setBlend = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value))
    setBlendState(clamped)
    engineRef.current?.setBlend(clamped)
  }, [])

  useEffect(() => {
    return () => {
      generationRef.current++
      stopMeterLoop()
      void engineRef.current?.stop()
      engineRef.current = null
      releaseLiveEngine('ir-mode')
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
    slotA,
    slotB,
    blend,
    setBlend,
    inputDevices,
    outputDevices,
    inputDeviceId,
    outputDeviceId,
    setInputDeviceId,
    setOutputDeviceId,
    fx,
    toggleFx,
    playItem,
    stop
  }
}

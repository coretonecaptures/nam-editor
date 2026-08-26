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
 * FX state here is the SAME full settings objects (GateSettings/EqSettings/DelaySettings/
 * EchoLabSettings/ReverbSettings/ChorusSettings) LiveEngine and PlayerPanel.tsx already use, not
 * a simplified on/off version — this is what lets IrLiveTab.tsx render the ACTUAL Rack500/
 * RackDelay/RackEchoLab/RackReverbTest components PlayerPanel.tsx uses, unchanged, rather than
 * reinventing a second, thinner FX UI. Every `set*` here is a thin `{...prev, ...patch}` merge +
 * live-apply via `engine.set*(patch)` — the same partial-update contract those Rack components'
 * own `onChange` props already expect, so no adapter layer is needed between them and this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LiveEngine,
  listAudioInputs,
  listAudioOutputs,
  DEFAULT_GATE,
  DEFAULT_EQ,
  DEFAULT_DELAY,
  DEFAULT_ECHO_LAB,
  DEFAULT_REVERB,
  DEFAULT_CHORUS,
  type LiveDeviceInfo,
  type GateSettings,
  type EqSettings,
  type DelaySettings,
  type EchoLabSettings,
  type ReverbSettings,
  type ChorusSettings,
  type DelaySlotView
} from '../../utils/liveEngine'
import { base64ToArrayBuffer } from '../../utils/playerAudio'
import { tryAcquireLiveEngine, releaseLiveEngine, describeLiveEngineOwner, getActiveLiveEngineOwner } from '../../utils/liveEngineOwner'

const CAPTURE_PATH_KEY = 'nam-lab-ir-mode-live-capture-path'

export type IrLiveSlot = 'A' | 'B'

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
  gate: GateSettings
  setGate: (patch: Partial<GateSettings>) => void
  eq: EqSettings
  setEq: (patch: Partial<EqSettings>) => void
  delay: DelaySettings
  setDelay: (patch: Partial<DelaySettings>) => void
  echoLab: EchoLabSettings
  setEchoLab: (patch: Partial<EchoLabSettings>) => void
  delaySlotView: DelaySlotView
  setDelaySlotView: (view: DelaySlotView) => void
  reverb: ReverbSettings
  setReverb: (patch: Partial<ReverbSettings>) => void
  chorus: ChorusSettings
  setChorus: (patch: Partial<ChorusSettings>) => void
  fxPower: boolean
  setFxPower: (value: boolean) => void
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

  const [gate, setGateState] = useState<GateSettings>(DEFAULT_GATE)
  const [eq, setEqState] = useState<EqSettings>(DEFAULT_EQ)
  const [delay, setDelayState] = useState<DelaySettings>(DEFAULT_DELAY)
  const [echoLab, setEchoLabState] = useState<EchoLabSettings>(DEFAULT_ECHO_LAB)
  const [delaySlotView, setDelaySlotView] = useState<DelaySlotView>('echo-lab')
  const [reverb, setReverbState] = useState<ReverbSettings>(DEFAULT_REVERB)
  const [chorus, setChorusState] = useState<ChorusSettings>(DEFAULT_CHORUS)
  const [fxPower, setFxPowerState] = useState(true)

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
        gate: fxPower ? gate : { ...gate, enabled: false },
        eq: fxPower ? eq : { ...eq, enabled: false },
        delay,
        echoLab,
        reverb,
        chorus: fxPower ? chorus : { ...chorus, enabled: false }
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
    // fxPower/gate/eq/chorus are read at start() time only (deliberately) — while running, FX
    // changes apply live via the per-setting effects below, not by restarting the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturePath, inputDeviceId, outputDeviceId])

  /** Changing an input/output device needs a fresh getUserMedia stream — restart if already
   * running, matching how NAM mode's own device pickers behave (a live device switch isn't a
   * hot-swap the way a cabinet or an FX setting is). */
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
    // restartIfRunning intentionally omitted — see useIrLiveAudition.ts's earlier note (kept
    // identical behavior across this rewrite): this should fire once per explicit device pick.
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

  // FX settings apply live to a running engine, same pattern PlayerPanel.tsx uses for each of
  // these — a state update plus an effect that pushes the new value into LiveEngine, no restart.
  const setGate = useCallback((patch: Partial<GateSettings>) => setGateState((g) => ({ ...g, ...patch })), [])
  const setEq = useCallback((patch: Partial<EqSettings>) => setEqState((e) => ({ ...e, ...patch })), [])
  const setDelay = useCallback((patch: Partial<DelaySettings>) => setDelayState((d) => ({ ...d, ...patch })), [])
  const setEchoLab = useCallback((patch: Partial<EchoLabSettings>) => setEchoLabState((e) => ({ ...e, ...patch })), [])
  const setReverb = useCallback((patch: Partial<ReverbSettings>) => setReverbState((r) => ({ ...r, ...patch })), [])
  const setChorus = useCallback((patch: Partial<ChorusSettings>) => setChorusState((c) => ({ ...c, ...patch })), [])
  const setFxPower = useCallback((value: boolean) => setFxPowerState(value), [])

  useEffect(() => {
    if (running) engineRef.current?.setGate(fxPower ? gate : { ...gate, enabled: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, fxPower, running])
  useEffect(() => {
    if (running) engineRef.current?.setEq(fxPower ? eq : { ...eq, enabled: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq, fxPower, running])
  useEffect(() => {
    if (running) engineRef.current?.setDelay(delay)
  }, [delay, running])
  useEffect(() => {
    if (running) engineRef.current?.setEchoLab(echoLab)
  }, [echoLab, running])
  useEffect(() => {
    if (running) engineRef.current?.setReverb(reverb)
  }, [reverb, running])
  useEffect(() => {
    if (running) engineRef.current?.setChorus(fxPower ? chorus : { ...chorus, enabled: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chorus, fxPower, running])

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
    gate,
    setGate,
    eq,
    setEq,
    delay,
    setDelay,
    echoLab,
    setEchoLab,
    delaySlotView,
    setDelaySlotView,
    reverb,
    setReverb,
    chorus,
    setChorus,
    fxPower,
    setFxPower,
    playItem,
    stop
  }
}

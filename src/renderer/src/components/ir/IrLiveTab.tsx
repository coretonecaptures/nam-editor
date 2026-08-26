import playUnlit from '../../assets/transport/play-unlit.png'
import playLit from '../../assets/transport/play-lit.png'
import stopUnlit from '../../assets/transport/stop-unlit.png'
import stopLit from '../../assets/transport/stop-lit.png'
import { RackColumn } from '../RackColumn'
import { RackCrop, RACK_CROP } from '../RackCrop'
import { Rack500 } from '../Rack500'
import { RackDelay } from '../RackDelay'
import { RackEchoLab } from '../RackEchoLab'
import { RackReverbTest } from '../RackReverbTest'
import type { IrLiveAuditionApi } from './useIrLiveAudition'

const CAP_SIZE = 56

/**
 * Live tab (docs/ir-lab-manager-build-plan.md section 8b) — the IR (and two-slot blend) is the
 * focal point at the top; below it is the REAL FX rack NAM Lab's own PlayerPanel Live mode uses —
 * `Rack500`/`RackDelay`/`RackEchoLab`/`RackReverbTest`, the exact same components, imported
 * directly, not a second reimplementation of gate/EQ/delay/reverb UI. Those components were
 * already decoupled from PlayerPanel's own state (plain `settings` + `onChange(patch)` props, no
 * `NamFile` dependency) — reusing them here needed zero changes to PlayerPanel.tsx itself.
 *
 * Not reused (real, current gaps, not oversights): PlayerPanel's floating-window pop-outs for
 * Delay/Echo Lab/Reverb, its named-preset menus (delay/reverb/chorus presets — IR mode has none
 * yet), and per-effect convolution IR pickers (Delay/Reverb can run in convolution mode, but IR
 * mode has no delay-IR/reverb-IR library wired up to pick one from, so both stay in their
 * non-convolution modes here for now).
 */
export function IrLiveTab({ live }: { live: IrLiveAuditionApi }): React.ReactElement {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Focal section: the two cabinet slots + blend, large, at the top. */}
      <div className="p-3 flex flex-col gap-2 border-b border-nm-border-s">
        <div className="grid grid-cols-2 gap-2">
          <div className={`rounded-lg border p-3 ${live.slotA ? 'border-nm-accent bg-active-bg' : 'border-nm-border-s bg-panel-2'}`}>
            <div className="text-[11px] font-medium text-nm-accent mb-1">SLOT A</div>
            <div className="text-sm text-nm-text truncate" title={live.slotA?.display_name ?? undefined}>
              {live.slotA?.display_name ?? 'Play an IR to load it'}
            </div>
          </div>
          <div className={`rounded-lg border p-3 ${live.slotB ? 'border-sky-500 bg-active-bg' : 'border-nm-border-s bg-panel-2'}`}>
            <div className="text-[11px] font-medium text-sky-500 mb-1">SLOT B</div>
            <div className="text-sm text-nm-text truncate" title={live.slotB?.display_name ?? undefined}>
              {live.slotB?.display_name ?? 'Right-click an IR → Slot B'}
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-nm-text-3 mb-1">
            <span>A</span>
            <span>Blend</span>
            <span>B</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(live.blend * 100)}
            onChange={(e) => live.setBlend(Number(e.target.value) / 100)}
            disabled={!live.slotA && !live.slotB}
            className="w-full accent-nm-accent disabled:opacity-40"
          />
        </div>

        <div className="flex items-center gap-4 pt-1">
          <button
            onClick={() => (live.running ? void live.stop() : undefined)}
            disabled={!live.running}
            title={live.running ? 'Stop live monitoring' : 'Play an IR in the list to start'}
            className="flex-shrink-0 disabled:opacity-40"
            style={{
              width: CAP_SIZE,
              height: CAP_SIZE,
              border: 'none',
              background: `url(${live.running ? stopLit : stopUnlit}) center / contain no-repeat`,
              cursor: live.running ? 'pointer' : 'default'
            }}
          />
          <div
            className="flex-shrink-0 opacity-70"
            style={{
              width: CAP_SIZE,
              height: CAP_SIZE,
              background: `url(${live.running ? playLit : playUnlit}) center / contain no-repeat`
            }}
            title="Play an IR in the list to start monitoring"
          />
          <div className="flex-1 min-w-0">
            <div className="h-2 rounded bg-panel-2 overflow-hidden">
              <div
                className="h-full bg-nm-accent transition-[width] duration-75"
                style={{ width: `${Math.min(100, live.outputMeter * 130)}%` }}
              />
            </div>
            <div className="text-xs text-nm-text-3 mt-1 truncate">
              {live.starting ? 'Starting…' : live.running ? 'Live' : 'Not running'}
            </div>
          </div>
        </div>

        {live.error && <div className="text-xs text-red-600 dark:text-red-400">{live.error}</div>}
      </div>

      {/* Amp capture + devices — small, secondary, below the fold on purpose. */}
      <div className="p-3 flex flex-col gap-3 text-xs border-b border-nm-border-s">
        <div>
          <label className="text-nm-text-3 block mb-1">Amp capture</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 px-2 py-1 rounded border border-field-bd bg-field-bg truncate" title={live.capturePath ?? undefined}>
              {live.captureName ?? 'No capture chosen yet'}
            </div>
            <button
              onClick={() => void live.pickCapture()}
              className="px-2 py-1 rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0"
            >
              {live.capturePath ? 'Change…' : 'Choose…'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-nm-text-3 block mb-1">Input</label>
            <select
              value={live.inputDeviceId ?? ''}
              onChange={(e) => live.setInputDeviceId(e.target.value || null)}
              className="w-full px-2 py-1 rounded border border-field-bd bg-field-bg text-nm-text-2"
            >
              <option value="">System default</option>
              {live.inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-nm-text-3 block mb-1">Output</label>
            <select
              value={live.outputDeviceId ?? ''}
              onChange={(e) => live.setOutputDeviceId(e.target.value || null)}
              className="w-full px-2 py-1 rounded border border-field-bd bg-field-bg text-nm-text-2"
            >
              <option value="">System default</option>
              {live.outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* The real FX rack — same components PlayerPanel.tsx's Live mode renders. */}
      <div className="p-3 flex flex-col gap-3">
        <RackColumn
          header={
            <div className="flex items-center justify-between gap-2 text-xs text-nm-text-2">
              <span>EQ · Gate · Modulation</span>
            </div>
          }
          panel={
            <RackCrop metal={RACK_CROP.rack500}>
              <Rack500
                gate={live.gate}
                eq={live.eq}
                chorus={live.chorus}
                onGate={live.setGate}
                onEq={live.setEq}
                onChorus={live.setChorus}
                power={live.fxPower}
                onTogglePower={() => live.setFxPower(!live.fxPower)}
              />
            </RackCrop>
          }
        />

        <RackColumn
          header={
            <div className="flex items-center justify-between gap-2 text-xs text-nm-text-2">
              <span>{live.delaySlotView === 'echo-lab' ? 'Echo Lab' : 'Delay'}</span>
              <div className="flex rounded border border-field-bd overflow-hidden">
                {(['echo-lab', 'delay'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => live.setDelaySlotView(v)}
                    className={`px-2 py-0.5 ${live.delaySlotView === v ? 'bg-active-bg text-nm-accent' : 'hover:bg-hov'}`}
                  >
                    {v === 'echo-lab' ? 'Echo Lab' : 'Delay'}
                  </button>
                ))}
              </div>
            </div>
          }
          panel={
            live.delaySlotView === 'delay' ? (
              <RackCrop metal={RACK_CROP.delay}>
                <RackDelay delay={live.delay} onChange={live.setDelay} delayPresets={[]} irName={null} irPath={null} />
              </RackCrop>
            ) : (
              <RackEchoLab echoLab={live.echoLab} onChange={live.setEchoLab} />
            )
          }
        />

        <RackColumn
          header={<div className="text-xs text-nm-text-2">Reverb</div>}
          panel={
            <RackCrop metal={RACK_CROP.reverb}>
              <RackReverbTest reverb={live.reverb} onChange={live.setReverb} reverbPresets={[]} irName={null} irPath={null} />
            </RackCrop>
          }
        />
      </div>
    </div>
  )
}

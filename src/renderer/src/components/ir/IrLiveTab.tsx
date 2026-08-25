import playUnlit from '../../assets/transport/play-unlit.png'
import playLit from '../../assets/transport/play-lit.png'
import stopUnlit from '../../assets/transport/stop-unlit.png'
import stopLit from '../../assets/transport/stop-lit.png'
import type { IrLiveAuditionApi } from './useIrLiveAudition'

const CAP_SIZE = 56

/**
 * Live tab (docs/ir-lab-manager-build-plan.md section 8b, built) — the amp-capture picker plus
 * transport for live IR audition, using the same tape-cap artwork NAM Lab's own PlayerPanel Live
 * mode uses (src/assets/transport/*.png) for visual identity, not a re-theme. Row-level play
 * buttons in the center list do the actual IR hot-swapping (useIrLiveAudition.playItem) — this tab
 * is where you pick the amp capture and see/stop what's currently running.
 */
export function IrLiveTab({ live }: { live: IrLiveAuditionApi }): React.ReactElement {
  return (
    <div className="p-3 flex flex-col gap-4 overflow-y-auto h-full">
      <div>
        <div className="text-sm font-medium text-nm-text mb-1">Live IR Audition</div>
        <div className="text-xs text-nm-text-3">
          Plays your interface input through an amp capture in real time — click any IR's play
          button in the list to hear it live, same as NAM Lab's own Live mode, but swapping the
          cabinet instead of the amp.
        </div>
      </div>

      <div>
        <label className="text-xs text-nm-text-2 block mb-1">Amp capture</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border border-field-bd bg-field-bg truncate" title={live.capturePath ?? undefined}>
            {live.captureName ?? 'No capture chosen yet'}
          </div>
          <button
            onClick={() => void live.pickCapture()}
            className="px-2 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0"
          >
            {live.capturePath ? 'Change…' : 'Choose…'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => (live.running ? void live.stop() : undefined)}
          disabled={!live.running}
          title={live.running ? 'Stop live monitoring' : 'Click play on an IR in the list to start'}
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
          title="Play from the IR list to start monitoring"
        />
        <div className="flex-1 min-w-0">
          <div className="h-2 rounded bg-panel-2 overflow-hidden">
            <div
              className="h-full bg-nm-accent transition-[width] duration-75"
              style={{ width: `${Math.min(100, live.outputMeter * 130)}%` }}
            />
          </div>
          <div className="text-xs text-nm-text-3 mt-1 truncate">
            {live.starting
              ? 'Starting…'
              : live.running
                ? `Live — ${live.activeItemName ?? 'no IR yet'}`
                : 'Not running'}
          </div>
        </div>
      </div>

      {live.error && <div className="text-xs text-red-600 dark:text-red-400">{live.error}</div>}
    </div>
  )
}

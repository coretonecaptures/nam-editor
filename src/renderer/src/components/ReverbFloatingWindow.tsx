import { RackReverbTest } from './RackReverbTest'
import { RackFloatingWindow } from './RackFloatingWindow'
import type { ReverbSettings } from '../utils/liveEngine'
import type { ReverbPreset } from '../types/settings'

/** Reverb's floating view. See RackFloatingWindow for the shell's own rationale. */
const NATIVE_WIDTH = 2172

export function ReverbFloatingWindow({
  reverb,
  onChange,
  reverbPresets,
  irName,
  irPath,
  onClose
}: {
  reverb: ReverbSettings
  onChange: (patch: Partial<ReverbSettings>) => void
  reverbPresets: ReverbPreset[]
  irName: string | null
  irPath: string | null
  onClose: () => void
}) {
  return (
    <RackFloatingWindow title="REVERB" nativeWidth={NATIVE_WIDTH} onClose={onClose}>
      <RackReverbTest reverb={reverb} onChange={onChange} reverbPresets={reverbPresets} irName={irName} irPath={irPath} />
    </RackFloatingWindow>
  )
}

import { RackDelay } from './RackDelay'
import { RackFloatingWindow } from './RackFloatingWindow'
import type { DelaySettings } from '../utils/liveEngine'
import type { DelayPreset } from '../types/settings'

/** Delay's floating view. See RackFloatingWindow for the shell's own rationale. */
const NATIVE_WIDTH = 2172

export function DelayFloatingWindow({
  delay,
  onChange,
  delayPresets,
  irName,
  irPath,
  onClose
}: {
  delay: DelaySettings
  onChange: (patch: Partial<DelaySettings>) => void
  delayPresets: DelayPreset[]
  irName: string | null
  irPath: string | null
  onClose: () => void
}) {
  return (
    <RackFloatingWindow title="DELAY" nativeWidth={NATIVE_WIDTH} onClose={onClose}>
      <RackDelay delay={delay} onChange={onChange} delayPresets={delayPresets} irName={irName} irPath={irPath} />
    </RackFloatingWindow>
  )
}

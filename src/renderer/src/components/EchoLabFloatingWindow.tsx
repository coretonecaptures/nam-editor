import { RackEchoLab } from './RackEchoLab'
import { RackFloatingWindow } from './RackFloatingWindow'
import type { EchoLabSettings } from '../utils/liveEngine'

/** Echo Lab's floating view. Thin wrapper over RackFloatingWindow — see that file for the shell's
 *  own rationale (why an in-page overlay instead of a real second window, sizing, drag). */
const NATIVE_WIDTH = 1748

export function EchoLabFloatingWindow({
  echoLab,
  onChange,
  onClose
}: {
  echoLab: EchoLabSettings
  onChange: (patch: Partial<EchoLabSettings>) => void
  onClose: () => void
}) {
  return (
    <RackFloatingWindow title="ECHO LAB" nativeWidth={NATIVE_WIDTH} onClose={onClose}>
      <RackEchoLab echoLab={echoLab} onChange={onChange} />
    </RackFloatingWindow>
  )
}

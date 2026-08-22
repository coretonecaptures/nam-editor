import { RackEchoLab } from './RackEchoLab'
import { RackFloatingWindow } from './RackFloatingWindow'
import { PresetMenu, type PresetOption } from './PresetMenu'
import type { EchoLabSettings } from '../utils/liveEngine'

/** Echo Lab's floating view. Thin wrapper over RackFloatingWindow — see that file for the shell's
 *  own rationale (why an in-page overlay instead of a real second window, sizing, drag). */
const NATIVE_WIDTH = 1748

export function EchoLabFloatingWindow({
  echoLab,
  onChange,
  onClose,
  presets,
  activePresetId,
  onRecall,
  onSaveAs,
  onUpdate,
  onDelete
}: {
  echoLab: EchoLabSettings
  onChange: (patch: Partial<EchoLabSettings>) => void
  onClose: () => void
  /**
   * Own PresetMenu, not just a passive display: this floats independently of the shared rack
   * slot's inline header (see PlayerPanel's delaySlotView), so without this the only visible
   * "Save As" while playing Echo Lab here could be the Delay's — landing a save in the wrong
   * preset list. Also the only way to save at all when both Delay and Echo Lab float at once,
   * since the shared slot then shows neither.
   */
  presets: PresetOption[]
  activePresetId: string | null
  onRecall: (id: string) => void
  onSaveAs: () => void
  onUpdate: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <RackFloatingWindow title="ECHO LAB" nativeWidth={NATIVE_WIDTH} onClose={onClose}>
      <div style={{ marginBottom: 10 }}>
        <PresetMenu
          label="Preset"
          options={presets}
          activeId={activePresetId}
          placeholder="No preset"
          width={210}
          onRecall={onRecall}
          onSaveAs={onSaveAs}
          onUpdate={onUpdate}
          onDelete={onDelete}
          favoritesKind="echo-lab-preset"
        />
      </div>
      <RackEchoLab echoLab={echoLab} onChange={onChange} />
    </RackFloatingWindow>
  )
}

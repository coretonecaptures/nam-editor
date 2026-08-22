import { RackDelay } from './RackDelay'
import { RackFloatingWindow } from './RackFloatingWindow'
import { PresetMenu } from './PresetMenu'
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
  onClose,
  activePresetId,
  onRecall,
  onSaveAs,
  onUpdate,
  onDelete
}: {
  delay: DelaySettings
  onChange: (patch: Partial<DelaySettings>) => void
  delayPresets: DelayPreset[]
  irName: string | null
  irPath: string | null
  onClose: () => void
  /**
   * Own PresetMenu, not just a passive display: this floats independently of the shared rack
   * slot's inline header (see PlayerPanel's delaySlotView), so without this the only visible
   * "Save As" while playing Delay here could be Echo Lab's — landing a save in the wrong preset
   * list. Also the only way to save at all when both Delay and Echo Lab float at once, since the
   * shared slot then shows neither.
   */
  activePresetId: string | null
  onRecall: (id: string) => void
  onSaveAs: () => void
  onUpdate: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <RackFloatingWindow title="DELAY" nativeWidth={NATIVE_WIDTH} onClose={onClose}>
      <div style={{ marginBottom: 10 }}>
        <PresetMenu
          label="Preset"
          options={delayPresets.map((d) => ({ id: d.id, name: d.name }))}
          activeId={activePresetId}
          placeholder="No preset"
          width={210}
          onRecall={onRecall}
          onSaveAs={onSaveAs}
          onUpdate={onUpdate}
          onDelete={onDelete}
          favoritesKind="delay-preset"
        />
      </div>
      <RackDelay delay={delay} onChange={onChange} delayPresets={delayPresets} irName={irName} irPath={irPath} />
    </RackFloatingWindow>
  )
}

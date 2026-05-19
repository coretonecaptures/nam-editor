// Reverse-engineers the NAM preset name from the config block.
// Fingerprint source: neural-amp-modeler core.py / get_wavenet_config()
//
// NAM family (head_scale ~0.02, 2 layers):
//   Complex=32ch, Standard=16ch, Lite=12ch, Feather=8ch, Nano=4ch
//
// REV family (head_scale ~0.99, multiple layers):
//   REVySTD=5 layers, 8ch, kernel 5
//   REVyHI =5 layers, 10ch, kernel 6
//   REVxSTD=4 layers, 8ch, kernel 6
//
// A2 WaveNet (condition_dsp wrapper, bottleneck/gating_mode/conv_pre_film fields):
//   Returns 'A2 WaveNet' — specific preset names not yet defined for A2.

function isA2LayerConfig(l0: Record<string, unknown>): boolean {
  return 'bottleneck' in l0 || 'gating_mode' in l0 || 'conv_pre_film' in l0 || 'secondary_activation' in l0
}

export function detectPreset(config: unknown): string | null {
  const cfg = config as Record<string, unknown> | undefined
  if (!cfg) return null

  // A2: layers live at config.condition_dsp.config.layers, not config.layers
  const conditionDsp = cfg.condition_dsp as Record<string, unknown> | undefined
  const a2Layers = (conditionDsp?.config as Record<string, unknown> | undefined)?.layers
  if (Array.isArray(a2Layers) && a2Layers.length > 0) {
    const l0 = a2Layers[0] as Record<string, unknown>
    if (isA2LayerConfig(l0)) return 'A2'
  }

  // A1: layers at config.layers
  const layers = cfg.layers
  if (!Array.isArray(layers) || layers.length === 0) return null

  const l0 = layers[0] as Record<string, unknown>

  // Defensive check — if A2 fields appear in config.layers too, flag it
  if (isA2LayerConfig(l0)) return 'A2'

  const headScale = cfg.head_scale as number | undefined
  const numLayers = layers.length
  const ch0 = l0.channels as number | undefined
  const kernelSize = l0.kernel_size as number | undefined

  if (ch0 == null) return null

  // REV family: head_scale >= 0.99
  if (headScale != null && headScale >= 0.99) {
    if (numLayers === 5 && ch0 === 8  && kernelSize === 5) return 'REVySTD'
    if (numLayers === 5 && ch0 === 10 && kernelSize === 6) return 'REVyHI'
    if (numLayers === 4 && ch0 === 8  && kernelSize === 6) return 'REVxSTD'
    return null
  }

  // NAM family: head_scale ~0.02, 2 layers
  if (numLayers === 2 && headScale != null && headScale <= 0.02) {
    if (ch0 === 32) return 'Complex'
    if (ch0 === 16) return 'Standard'
    if (ch0 === 12) return 'Lite'
    if (ch0 === 8)  return 'Feather'
    if (ch0 === 4)  return 'Nano'
  }

  return null
}

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

export function detectPreset(config: unknown): string | null {
  const cfg = config as Record<string, unknown> | undefined
  if (!cfg) return null
  const layers = cfg.layers
  if (!Array.isArray(layers) || layers.length === 0) return null

  const headScale = cfg.head_scale as number | undefined
  const numLayers = layers.length
  const l0 = layers[0] as Record<string, unknown>
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

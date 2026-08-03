/**
 * Shows only the coloured faceplate of a rack panel, trimming the black chassis around it.
 *
 * The bounds below are MEASURED off the shipped art, not derived by eye. That matters: the design
 * mock cropped 4.5% off the reverb's left edge when only 1.4% of it is chassis, which is what was
 * slicing the panel. Measuring also makes the faceplate tops line up across units, because every
 * crop starts exactly at its own metal.
 *
 * Offsets use `transform: translate(%)` rather than `top/left: %`. A percentage in `top` resolves
 * against the containing block's HEIGHT, which here is itself derived from `aspect-ratio` — an
 * ordering the browser can resolve inconsistently. A translate percentage resolves against the
 * element's own size, which is always known.
 *
 * Children mount INSIDE the scaler, so the percent geometry in Rack500 / RackDelay /
 * RackReverbTest keeps working untouched no matter how the crop changes.
 */

export interface MetalBounds {
  /** Faceplate edges as a fraction of the source image. */
  l: number
  t: number
  r: number
  b: number
  /** Faceplate width ÷ height, in pixels. */
  aspect: number
}

export function RackCrop({
  metal,
  fitHeight = false,
  children
}: {
  metal: MetalBounds
  /**
   * Size from the available HEIGHT rather than width.
   *
   * Width-driven sizing is what makes a rig overflow a short screen: panels grow to fill the
   * window horizontally and their height follows, so a 1080p display ends up scrolling. Driving
   * from height means the whole rig fits the viewport and simply gets narrower.
   */
  fitHeight?: boolean
  children: React.ReactNode
}) {
  const scale = 100 / (metal.r - metal.l)
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 6,
        aspectRatio: String(metal.aspect),
        ...(fitHeight ? { height: '100%', width: 'auto', maxWidth: '100%' } : { width: '100%' })
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${scale}%`,
          transform: `translate(${-metal.l * 100}%, ${-metal.t * 100}%)`,
          containerType: 'inline-size'
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Measured off the shipped panel art, not taken from the design mock. */
export const RACK_CROP: Record<'rack500' | 'delay' | 'reverb', MetalBounds> = {
  // t is the FACEPLATE top, not the chassis top — a naive scan caught the silver rail screws
  // above the modules and framed 60px of chassis into the box, which broke the alignment.
  // The CHASSIS, not the faceplates: the rack frame, handle, rails and screws are part of the
  // object and worth keeping — it is only the empty void around the enclosure that wastes space.
  // (Faceplate-only would be { l: 0.1015, t: 0.1533, r: 0.9064, b: 0.8568, aspect: 2.288 }.)
  rack500: { l: 0.0169, t: 0.0507, r: 0.982, b: 0.9053, aspect: 2.259 },
  delay: { l: 0.0134, t: 0.1326, r: 0.9807, b: 0.8591, aspect: 3.994 },
  reverb: { l: 0.0143, t: 0.1271, r: 0.982, b: 0.8605, aspect: 3.959 }
}

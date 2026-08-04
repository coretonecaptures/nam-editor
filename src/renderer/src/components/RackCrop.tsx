/**
 * Shows only the coloured faceplate of a rack panel, trimming the black chassis around it.
 *
 * Sizing is deliberately plain: `width:100%` of whatever column it sits in, `aspect-ratio` set,
 * height just falls out. This is exactly the technique the original design_handoff_player_redesign
 * prototype used, and it is the right one. A handful of attempts this session tried to make panels
 * grow into whichever of width/height was "scarcer" instead — a ResizeObserver measurement, then
 * a `1fr`-row CSS Grid, then CSS container-query `min(cqw, cqh*aspect)` math — and each was more
 * fragile than the last: percentage-height circularity, sibling ResizeObservers racing each
 * other's state updates, container queries that can't reference their own element's size. All of
 * that complexity was in service of "don't overflow a short screen," a requirement plain
 * width-driven sizing was never actually incompatible with — the fix for a short screen is letting
 * the page scroll a little, not making every control fight to be as small as possible.
 *
 * The bounds are MEASURED off the shipped art, not the design mock's numbers — the mock cropped
 * 4.5% off the reverb's left edge when only 1.4% of that panel is chassis, which is what was
 * slicing it.
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

export function RackCrop({ metal, children }: { metal: MetalBounds; children: React.ReactNode }) {
  const scale = 100 / (metal.r - metal.l)
  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 6, aspectRatio: String(metal.aspect) }}>
      {/* translate(%) rather than top/left:%, which would resolve against a height that is
          itself derived from aspect-ratio — an ordering the browser can resolve inconsistently.
          A translate percentage resolves against the element's own size, always known. */}
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
  // The CHASSIS, not the faceplates: the rack frame, handle, rails and screws are part of the
  // object and worth keeping — it is only the empty void around the enclosure that wastes space.
  // t trims just above the mounting-screw row, cutting the vented top bezel above it — the screws
  // stay (they read as "rack hardware"), the vent slats don't add anything and just ate height.
  rack500: { l: 0.0169, t: 0.0846, r: 0.982, b: 0.9053, aspect: 2.352 },
  delay: { l: 0.0134, t: 0.1326, r: 0.9807, b: 0.8591, aspect: 3.994 },
  // Reverb shares Delay's crop rather than the design mock's numbers, since both panels are the
  // same 2172x724 art with the same layout — a different crop could only mis-frame one of them.
  reverb: { l: 0.0143, t: 0.1271, r: 0.982, b: 0.8605, aspect: 3.959 }
}

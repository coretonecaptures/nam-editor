/**
 * Trims the black chassis margin off a rack panel so the metal fills its box.
 *
 * Each panel PNG is photographed with rails and chassis around the faceplate. Showing the whole
 * image leaves black bands top and bottom, which wastes the very space the panels need. So the
 * box is given the METAL's aspect ratio, clips overflow, and holds an oversized, offset inner
 * layer — only the metal lands inside the box.
 *
 * Why the children go INSIDE the scaler rather than the box: every rack control is positioned as
 * a percentage of the panel image. Put them on the box and they would drift the moment the crop
 * changed. On the scaler they stay locked to the artwork, and the existing percent geometry in
 * Rack500 / RackDelay / RackReverbTest keeps working untouched.
 *
 * Nothing is enlarged past its source here — the panels are 1774–2172px wide and render at
 * roughly a third of that, so this is still downscaling.
 */
export function RackCrop({
  aspect,
  left,
  top,
  width,
  children
}: {
  /** Box aspect ratio — the METAL's, not the whole image's. */
  aspect: number
  /** Inner scaler offsets and width, as percentages of the box. */
  left: number
  top: number
  width: number
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 6,
        aspectRatio: String(aspect)
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          containerType: 'inline-size'
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Measured against the shipped panel art — see the design handoff README. */
export const RACK_CROP = {
  rack500: { aspect: 2.072, left: -11.68, top: -10.95, width: 123.36 },
  delay: { aspect: 3.974, left: -1.385, top: -17.76, width: 103.34 },
  // Reverb shares Delay's crop, not the different numbers the design mock used. Both panels are
  // the same 2172x724 art with the same layout, so a different crop could only ever mis-frame
  // one of them — which is exactly what clipped the reverb's left edge and bottom.
  reverb: { aspect: 3.974, left: -1.385, top: -17.76, width: 103.34 }
} as const

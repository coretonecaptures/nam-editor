import { useEffect, useRef, useState } from 'react'

/**
 * A photo painted into a small box without the moiré.
 *
 * Chromium's default downscale filter is bilinear — it samples a 2x2 neighbourhood no matter how
 * far the image is being shrunk. Painting a 2000px photo into a 192px box therefore skips most of
 * the source pixels, and any fine repeating detail (grille cloth, tolex, fabric weave) aliases
 * into visible moiré banding. `createImageBitmap`'s `resizeQuality: 'high'` area-averages instead,
 * which is the actual fix. There is no CSS equivalent: every non-default `image-rendering` value
 * (`pixelated`, `crisp-edges`, `-webkit-optimize-contrast`) moves toward nearest-neighbour and
 * makes the aliasing worse, not better.
 *
 * Draws into a <canvas> rather than converting the bitmap back into a blob URL on purpose.
 * `local-file://` is registered without `corsEnabled` (main/index.ts), so these images are
 * cross-origin and the canvas ends up tainted — but tainting only blocks *readback*
 * (`toBlob`/`getImageData`), never drawing or display. Keeping the readback out means this needs
 * no change to the security-reviewed `local-file://` handler.
 *
 * Sizing is in CSS pixels; the backing store is multiplied by devicePixelRatio so it stays sharp
 * on HiDPI displays. Fit is explicit because canvas has no `object-fit`:
 *
 *   - `cover`   fills the box and crops the overflow. Right for a thumbnail grid where a uniform
 *               shape matters more than seeing the whole frame.
 *   - `contain` fits the whole image inside the box and leaves the remainder transparent, so the
 *               element's own CSS background shows through as letterbox bars. Right for a photo
 *               whose subject is the point — a landscape rig shot cropped to a square is mostly
 *               gone. A square source in a wide box simply gets bars down both sides.
 *
 * Falls back to a plain <img> if anything in the decode/resize path fails, so a broken path or an
 * unsupported source degrades to exactly the old behaviour rather than an empty box.
 */
export function ScaledImage({
  src,
  width,
  height,
  fit = 'cover',
  className,
  alt = '',
  title,
  onClick,
  fillParent = false
}: {
  src: string
  /** CSS pixels. The canvas backing store is this times devicePixelRatio. Also the target raster
   * resolution when `fillParent` is set (see below) -- pick something comfortably bigger than the
   * largest this is likely to render at. */
  width: number
  height: number
  fit?: 'cover' | 'contain'
  className?: string
  alt?: string
  title?: string
  onClick?: () => void
  /** For a responsive grid cell whose actual on-screen size isn't known up front (e.g. a card
   * grid that reflows its column count): render the canvas at `width`x`height` px and let
   * `className` (w-full h-full etc.) size it in CSS instead of the usual fixed inline style. The
   * browser's own downscale from there is a small, safe ratio as long as `width`/`height` are
   * already close to the largest real on-screen size, so this still avoids the moiré a raw <img>
   * would show straight off the full-resolution source. */
  fillParent?: boolean
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      void (async () => {
        try {
          const dpr = window.devicePixelRatio || 1
          const targetW = Math.max(1, Math.round(width * dpr))
          const targetH = Math.max(1, Math.round(height * dpr))

          const srcAspect = img.naturalWidth / img.naturalHeight
          const dstAspect = width / height

          // Source rect, destination size, and where in the box it lands.
          let sx = 0
          let sy = 0
          let sw = img.naturalWidth
          let sh = img.naturalHeight
          let drawW = targetW
          let drawH = targetH

          if (fit === 'cover') {
            // Crop the largest centred source rect matching the destination aspect.
            if (srcAspect > dstAspect) sw = Math.round(img.naturalHeight * dstAspect)
            else sh = Math.round(img.naturalWidth / dstAspect)
            sx = Math.round((img.naturalWidth - sw) / 2)
            sy = Math.round((img.naturalHeight - sh) / 2)
          } else {
            // Whole frame, scaled down to fit. The unused remainder stays transparent so the
            // element's CSS background shows through as letterbox bars.
            if (srcAspect > dstAspect) drawH = Math.max(1, Math.round(targetW / srcAspect))
            else drawW = Math.max(1, Math.round(targetH * srcAspect))
          }

          // A single createImageBitmap resize still leaves visible moiré on fine repeating source
          // detail (grille cloth weave, wicker) once the reduction ratio gets large (a 4000px
          // photo into a 300px box is a >13x reduction) -- 'high' quality area-averages each pixel
          // against its immediate neighbourhood, but that one neighbourhood is too small relative
          // to the true downsample ratio to fully suppress a fine repeating pattern. Halving
          // repeatedly (classic mipmap chain) fixes this: each 2x step is a true, alias-free
          // area-average, and chaining enough of them gets the *effective* per-step ratio down to
          // where a single 'high'-quality pass has no aliasing left to leave behind.
          let bitmap = await createImageBitmap(img, sx, sy, sw, sh)
          while (bitmap.width > drawW * 2 && bitmap.height > drawH * 2) {
            const stepW = Math.max(drawW, Math.round(bitmap.width / 2))
            const stepH = Math.max(drawH, Math.round(bitmap.height / 2))
            const next = await createImageBitmap(bitmap, {
              resizeWidth: stepW,
              resizeHeight: stepH,
              resizeQuality: 'high'
            })
            bitmap.close()
            bitmap = next
          }
          const final = await createImageBitmap(bitmap, {
            resizeWidth: drawW,
            resizeHeight: drawH,
            resizeQuality: 'high'
          })
          bitmap.close()
          if (cancelled) {
            final.close()
            return
          }
          canvas.width = targetW
          canvas.height = targetH
          canvas
            .getContext('2d')
            ?.drawImage(final, Math.round((targetW - drawW) / 2), Math.round((targetH - drawH) / 2))
          final.close()
        } catch {
          if (!cancelled) setFailed(true)
        }
      })()
    }
    img.onerror = () => {
      if (!cancelled) setFailed(true)
    }
    img.src = src

    return () => {
      cancelled = true
    }
  }, [src, width, height, fit])

  if (failed) {
    return (
      <img
        src={src}
        alt={alt}
        title={title}
        onClick={onClick}
        className={className}
        style={fillParent ? { objectFit: fit } : { width, height, objectFit: fit }}
        loading="lazy"
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      title={title}
      onClick={onClick}
      role="img"
      aria-label={alt || undefined}
      className={className}
      style={fillParent ? undefined : { width, height }}
    />
  )
}

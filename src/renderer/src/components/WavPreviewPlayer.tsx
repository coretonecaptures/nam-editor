import { useEffect, useState } from 'react'

/**
 * A plain <audio> element for hearing a raw WAV — the DI/return in a NAM Project, not run through
 * any NAM model. `local-file://` can't be pointed at this directly: the S1 security fix restricts
 * that protocol handler to image extensions only (main/index.ts's own comment on it), and loosening
 * a handler that was deliberately hardened for a player convenience is the wrong trade. Instead
 * this reads the file's bytes through the existing, already-unrestricted `file:readBinary` channel
 * (the same one file-hash/import code already uses for arbitrary files) and builds a same-origin
 * blob: URL client-side — no protocol changes, no new IPC surface.
 */
export function WavPreviewPlayer({ path, label }: { path: string; label: string }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setError(null)
    window.api.readFileBinary(path).then((res) => {
      if (cancelled) return
      if (res.error || !res.data) {
        setError(res.error ?? 'Could not read the file.')
        return
      }
      const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'audio/wav' })
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-nm-text-3">{label}</span>
      {error ? (
        <span className="text-[11px] text-red-500">{error}</span>
      ) : (
        <audio controls preload="none" src={url ?? undefined} className="h-8 w-full" style={{ maxWidth: 320 }} />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { FolderGallery, type FolderImagesData } from '../FolderGallery'

/**
 * Gallery tab (plan section 8 / 8a) — reuses NAM Lab's own generic, path-based
 * `window.api.scanImages` + `FolderGallery` component directly rather than building an IR-specific
 * gallery from scratch ("we build this in NAM Lab for a reason, let's make use of it"). No
 * ancestor-inheritance cascade like NAM Lab's pack view (that's specific to NAM's pack/root-folder
 * hierarchy) — IR folders show only their own images.
 */
export function IrGalleryTab({ absPath }: { absPath: string | null }): React.ReactElement {
  const [data, setData] = useState<FolderImagesData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!absPath) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.scanImages(absPath).then((res) => {
      if (cancelled) return
      setData({ own: res.success ? res.images : [], inherited: [], children: [] })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [absPath])

  if (!absPath) {
    return <div className="p-3 text-xs text-nm-text-3">Select a folder to view its photos.</div>
  }
  if (loading || !data) {
    return <div className="p-3 text-xs text-nm-text-3">Loading…</div>
  }
  if (data.own.length === 0) {
    return <div className="p-3 text-xs text-nm-text-3">No photos in this folder yet.</div>
  }
  return <FolderGallery data={data} />
}

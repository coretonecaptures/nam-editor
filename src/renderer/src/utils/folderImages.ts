export interface FolderImagesData {
  own: string[]
  inherited: { folderName: string; paths: string[] }[]
}

export const AMPCOVER_PATTERN = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i

function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

function isCover(imagePath: string): boolean {
  const fileName = norm(imagePath).split('/').pop() ?? ''
  return AMPCOVER_PATTERN.test(fileName)
}

/**
 * Scans a folder's own images plus, when the folder is a subfolder of
 * rootFolder, cascades up through ancestor folders (stopping before the
 * root) collecting each ancestor's own images as a separate labeled group.
 * ampcover.* is excluded everywhere since it's reserved for cover art.
 */
export async function scanOwnAndInheritedImages(
  targetFolder: string,
  rootFolder: string | null | undefined,
  scanImages: (folderPath: string) => Promise<{ success: boolean; images: string[] }>,
): Promise<FolderImagesData> {
  const ownResult = await scanImages(targetFolder)
  const own = ownResult.success ? ownResult.images.filter((p) => !isCover(p)) : []

  const inherited: { folderName: string; paths: string[] }[] = []
  const normTarget = norm(targetFolder)
  const normRoot = rootFolder ? norm(rootFolder) : null

  if (normRoot && normTarget !== normRoot) {
    let current = normTarget
    while (true) {
      const lastSlash = current.lastIndexOf('/')
      if (lastSlash <= 0) break
      const parent = current.substring(0, lastSlash)
      if (!parent.startsWith(normRoot) || parent.length < normRoot.length) break
      if (parent === normRoot) break // stop before root — root images only show at root
      const parentResult = await scanImages(parent)
      const parentPaths = parentResult.success ? parentResult.images.filter((p) => !isCover(p)) : []
      if (parentPaths.length > 0) {
        const folderName = parent.substring(parent.lastIndexOf('/') + 1)
        inherited.push({ folderName, paths: parentPaths })
      }
      current = parent
    }
  }

  return { own, inherited }
}

/**
 * Pure logic for the `local-file://` protocol handler's extension allowlist
 * (security-review-2026-08-31.md S1). Extracted so it's testable without booting Electron --
 * same reasoning namCaptureTraining.ts's own header comment gives for pulling logic out of
 * index.ts. See index.ts's `protocol.handle('local-file', ...)` for the full rationale on why
 * this restricts by file type rather than by directory root.
 */

export const ALLOWED_LOCAL_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'])

/** Extension (with leading '.', lowercased) of a local-file:// URL's path portion, or '' if the
 * path has no '.' at all. `rawPath` is everything after the 'local-file://' prefix -- may still
 * carry a query/hash, which is stripped before looking for the extension. */
export function localFileExtension(rawPath: string): string {
  const withoutQuery = rawPath.split(/[?#]/)[0]
  const dot = withoutQuery.lastIndexOf('.')
  return dot === -1 ? '' : withoutQuery.slice(dot).toLowerCase()
}

export function isAllowedLocalFilePath(rawPath: string): boolean {
  return ALLOWED_LOCAL_FILE_EXTENSIONS.has(localFileExtension(rawPath))
}

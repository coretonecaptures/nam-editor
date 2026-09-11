/**
 * OS-trash-with-fallback, shared between `main/index.ts` (NAM mode's `file:trash`) and
 * `irCatalog/fileOps.ts` (IR mode's catalog-transactional trash, parity backlog item 1).
 *
 * Pulled out of `main/index.ts` rather than exported from it: that file is the Electron entry
 * point and runs `app.whenReady()` and window-lifecycle side effects at import time. Anything
 * outside it that needs a helper defined there would trigger those side effects a second time on
 * import — this module has none, so it's safe for either side to import.
 */
import { shell } from 'electron'
import * as fs from 'node:fs'

async function trashWithRetry(filePath: string, attempts = 4, delayMs = 350): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await shell.trashItem(process.platform === 'win32' ? filePath.replace(/\//g, '\\') : filePath)
      return
    } catch (err) {
      lastError = err
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastError
}

/** Works on a single file OR a whole directory — `shell.trashItem` already supports both; the
 * fallback uses `fs.rm(..., { recursive: true })` rather than `unlink` (which throws EISDIR on a
 * directory) so item 11's folder delete can share this instead of a near-duplicate. `recursive`
 * is simply ignored for a plain file, so this is a strict superset of the old file-only behavior —
 * no change for NAM mode's existing single-file callers. */
export async function deleteWithFallback(filePath: string): Promise<'trash' | 'delete'> {
  try {
    await trashWithRetry(filePath)
    return 'trash'
  } catch {
    await fs.promises.rm(filePath, { recursive: true, force: true })
    return 'delete'
  }
}

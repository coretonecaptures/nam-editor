/**
 * Loads one `.nam` file into the `NamFile` shape `PlayerPanel` needs, for PLAYBACK only.
 *
 * Deliberately not the same path App.tsx's library loading uses (`applyParsedResults`): that one
 * also applies the user's metadata-defaults rules, computes `autoFilledFields`, marks files dirty,
 * and writes straight into App's `files`/`selectedIds` state — all of which are metadata-EDITING
 * concerns. A player only needs to read the model and its metadata; running the defaults engine
 * over a capture nobody is editing would mark it dirty and imply unsaved changes that were never
 * made. So this is a genuinely different operation, not a duplicate of that one.
 *
 * Used by IR mode, which needs a NamFile for the chosen amp capture in order to render the same
 * `PlayerPanel` NAM mode renders (docs/ir-lab-manager-build-plan.md section 8b).
 */
import type { NamFile } from '../types/nam'

export async function loadNamFileForPlayback(filePath: string): Promise<NamFile | null> {
  const result = await window.api.readFile(filePath)
  if (!result || !result.success || result.metadata === undefined) return null

  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
  const metadata = (result.metadata ?? {}) as NamFile['metadata']

  return {
    filePath,
    fileName: fileName.replace(/\.nam$/i, ''),
    version: result.version ?? '?',
    metadata,
    // Same object on purpose: nothing here edits metadata, so there is no "original vs working"
    // distinction to preserve, and isDirty is always false.
    originalMetadata: metadata,
    autoFilledFields: [],
    architecture: result.architecture ?? '?',
    config: result.config,
    isDirty: false
  } as NamFile
}

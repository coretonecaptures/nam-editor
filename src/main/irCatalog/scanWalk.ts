/**
 * Recursive WAV-library walk for the IR catalog scanner.
 *
 * Same traversal shape as the existing `buildIrIndex` in src/main/index.ts (~line 6372, "Cabinet
 * IR index"): iterative stack rather than recursion, `realpath` + a `seen` set to guard against
 * symlink cycles, skips `.`-prefixed dirs / `__MACOSX` / `._` resource forks. That function
 * builds an in-memory byte-buffer index for the existing IR pickers; this one yields folder/file
 * events top-down instead, so a caller can insert `folder` rows (with `parent_id` already known)
 * before the `item` rows that reference them — see docs/ir-lab-manager-build-plan.md section 2a
 * for why these aren't merged into one function yet (open replace-vs-coexist decision).
 */
import * as fs from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface WavFileEntry {
  /** Path relative to the scan root, platform separator. */
  relPath: string
  /** Absolute path on disk. */
  absPath: string
  /** Relative path of the containing folder ('' for the root itself). */
  folderRelPath: string
  size: number
  modifiedAt: string
}

export interface FolderEntry {
  relPath: string
  parentRelPath: string | null
}

export interface WalkEvent {
  type: 'folder' | 'file'
  folder?: FolderEntry
  file?: WavFileEntry
}

/**
 * Walks `root` top-down, yielding a `folder` event for every directory before any `file` events
 * for WAVs directly inside it (children are only visited after their own folder event has been
 * yielded), so a caller can always resolve `folder_id` for a file's containing folder and for a
 * new folder's `parent_id` from folders already seen.
 */
export async function* walkWavLibrary(root: string): AsyncGenerator<WalkEvent> {
  // [dirPath, relPathOfDir] pairs. Root itself is relPath ''.
  const stack: Array<{ dir: string; rel: string; parentRel: string | null }> = [
    { dir: root, rel: '', parentRel: null }
  ]
  const seen = new Set<string>()

  while (stack.length > 0) {
    const { dir, rel, parentRel } = stack.pop() as { dir: string; rel: string; parentRel: string | null }

    let real: string
    try {
      real = await fs.promises.realpath(dir)
    } catch {
      continue
    }
    if (seen.has(real)) continue
    seen.add(real)

    yield { type: 'folder', folder: { relPath: rel, parentRelPath: parentRel } }

    const dirents = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
    // Children pushed in reverse so they pop in original readdir order — cosmetic (progress
    // reporting order), not correctness-relevant.
    const subdirs: fs.Dirent[] = []
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        if (dirent.name.startsWith('.') || dirent.name === '__MACOSX') continue
        subdirs.push(dirent)
      } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.wav')) {
        if (dirent.name.startsWith('._')) continue
        const absPath = join(dir, dirent.name)
        const relPath = relative(root, absPath)
        let stat: fs.Stats
        try {
          stat = await fs.promises.stat(absPath)
        } catch {
          continue
        }
        yield {
          type: 'file',
          file: {
            relPath,
            absPath,
            folderRelPath: rel,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          }
        }
      }
    }
    for (let i = subdirs.length - 1; i >= 0; i--) {
      const dirent = subdirs[i]
      const childDir = join(dir, dirent.name)
      const childRel = relative(root, childDir)
      stack.push({ dir: childDir, rel: childRel, parentRel: rel })
    }
  }
}

/** Normalizes a relative path to use `/` regardless of platform, for stable DB storage/lookup. */
export function toPosixRel(relPath: string): string {
  return relPath.split(sep).join('/')
}

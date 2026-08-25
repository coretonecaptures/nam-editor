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
import { mapPool } from './concurrency'

/**
 * How many files' `stat` calls run concurrently within one directory. Phase 1's measured
 * throughput collapse (docs/ir-lab-manager-build-plan.md section 12) traced to this exact loop
 * running fully serially — one file's round trip at a time, at 7% CPU utilization. This is a
 * starting point, not a tuned value; re-measure against the real library before changing it.
 */
const STAT_CONCURRENCY = 32

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
    const wavDirents: fs.Dirent[] = []
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        if (dirent.name.startsWith('.') || dirent.name === '__MACOSX') continue
        subdirs.push(dirent)
      } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.wav')) {
        if (dirent.name.startsWith('._')) continue
        wavDirents.push(dirent)
      }
    }

    // `stat` per file, up to STAT_CONCURRENCY in flight at once — see the constant's comment.
    // Yielding itself stays sequential afterward; only the I/O is parallelized.
    const statResults = await mapPool(wavDirents, STAT_CONCURRENCY, async (dirent) => {
      const absPath = join(dir, dirent.name)
      try {
        return { dirent, absPath, stat: await fs.promises.stat(absPath) }
      } catch {
        return null
      }
    })
    for (const result of statResults) {
      if (!result) continue
      yield {
        type: 'file',
        file: {
          relPath: relative(root, result.absPath),
          absPath: result.absPath,
          folderRelPath: rel,
          size: result.stat.size,
          modifiedAt: result.stat.mtime.toISOString()
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

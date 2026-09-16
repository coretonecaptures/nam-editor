/**
 * Watches `library_root` rows marked `watch_mode = 'watched'` for filesystem changes and fires a
 * (debounced) rescan — parity backlog item 13. The column has existed since the original build
 * plan (schema.ts) with nothing ever reading it; this is that missing piece, called out by name in
 * the plan as the IR Lab "finished exports" case — a folder you want picked up automatically
 * rather than needing a manual Rescan every time IR Lab writes into it.
 *
 * Scope decision, stated plainly rather than silently built around: this triggers a FULL rescan of
 * the changed root, not a true incremental scan of just the changed subtree. `importLibrary.ts`
 * has no partial-import primitive today — building one (surgical re-parse of one subtree, without
 * re-walking or re-hashing the rest of a potentially enormous root) is a materially larger project
 * than this item on its own, and isn't what the item's own "done when" actually requires: "a new
 * file appears without manual action" and "the watcher survives a root going temporarily offline"
 * are both satisfied by a debounced full rescan just as honestly as by a true incremental one — it
 * costs more CPU per change, not correctness.
 *
 * `fs.watch(..., { recursive: true })` is NOT supported by Linux's inotify backend — Node throws
 * `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` there. Rather than degrading to top-level-only (missing any
 * change inside an existing subfolder), this walks the root and opens one non-recursive `fs.watch`
 * PER DIRECTORY, and re-walks to add/remove per-directory watchers every time a debounced rescan
 * fires — so a brand-new subfolder created after the initial walk starts being watched on the very
 * next change, without needing the app restarted or the root re-added. More file descriptors than a
 * single recursive watch would use (one per directory in the tree, same cost `chokidar` and other
 * userland recursive-watch shims pay on Linux for the same reason), not a correctness compromise.
 */
import { watch, readdirSync, type FSWatcher, type Dirent } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

interface WatchedRoot {
  id: number
  path: string
}

const DEBOUNCE_MS = 2500

// Native recursive watch (Windows/macOS, and Linux roots small enough or configured otherwise):
// one watcher per root.
const activeWatchers = new Map<number, FSWatcher>()
// Manual per-directory recursion (Linux fallback): every watched subdirectory gets its own entry.
const manualWatcherDirs = new Map<number, Map<string, FSWatcher>>()
const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>()

// Same purpose as main/index.ts's own suppressWatcher() for NAM mode's folder watcher, scoped to
// THIS module's watcher set instead — the two are entirely separate watcher systems (different
// maps, different event sources), so NAM mode's suppression call has no effect here. Without this,
// every IR-mode write this app makes to a watched root (rename, batch rename, move, embed-in-file)
// fires this watcher's own change handler and triggers a needless full rescan purely because the
// app's own write touched a file being watched — wasted work at best, and a race where the rescan
// re-touches rows the write just finished at worst. One global window (not per-root) — same
// simple design NAM mode's own suppressWatcher() already uses; a write always targets one root, so
// a 3s global suppression after ANY IR write is a deliberately generous, never-wrong-direction
// tradeoff, not a per-root optimization worth the extra bookkeeping.
const SUPPRESS_MS = 3000
let suppressUntil = 0

/** Call after any local write this app makes to a file inside a watched IR library root —
 * fileOps.ts's rename/move/batch-rename, namCaptureFileOps.ts's capture rename, and
 * wavMetadataWriter.ts's embed-in-file should all call this once their write succeeds. */
export function suppressIrRootWatcher(): void {
  suppressUntil = Date.now() + SUPPRESS_MS
}

function listSubdirs(dirPath: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return [] // gone, permissions, or a transient drive drop — refreshManualWatchers will retry next fire
  }
  return entries.filter((e) => e.isDirectory()).map((e) => join(dirPath, e.name))
}

function walkAllDirs(rootPath: string): string[] {
  const all = [rootPath]
  const queue = [rootPath]
  while (queue.length > 0) {
    const dir = queue.shift() as string
    for (const sub of listSubdirs(dir)) {
      all.push(sub)
      queue.push(sub)
    }
  }
  return all
}

function bindManualDir(rootId: number, dirPath: string, scheduleRescan: () => void, log: (msg: string) => void): void {
  const dirs = manualWatcherDirs.get(rootId)
  if (!dirs || dirs.has(dirPath)) return
  try {
    const w = watch(dirPath, { recursive: false }, () => scheduleRescan())
    w.on('error', (error) => {
      log(`IR root watcher error for "${dirPath}": ${String(error)}`)
      manualWatcherDirs.get(rootId)?.delete(dirPath)
    })
    dirs.set(dirPath, w)
  } catch (err) {
    log(`IR root watcher: could not watch subfolder "${dirPath}": ${String(err)}`)
  }
}

/** Re-walks the root, opening a watcher for any subdirectory that's new since the last walk and
 * closing any whose directory is gone — so the manual-recursion watcher set stays current as the
 * tree changes, not just as of the moment watching started. */
function refreshManualWatchers(rootId: number, rootPath: string, scheduleRescan: () => void, log: (msg: string) => void): void {
  const dirs = manualWatcherDirs.get(rootId)
  if (!dirs) return
  const current = new Set(walkAllDirs(rootPath))
  for (const [dirPath, w] of [...dirs.entries()]) {
    if (!current.has(dirPath)) {
      try {
        w.close()
      } catch {
        // Already gone — nothing to do.
      }
      dirs.delete(dirPath)
    }
  }
  for (const dirPath of current) bindManualDir(rootId, dirPath, scheduleRescan, log)
}

function startWatcher(root: WatchedRoot, onChange: (rootId: number, rootPath: string) => void, log: (msg: string) => void): void {
  const scheduleRescan = (): void => {
    // Within the suppression window from suppressIrRootWatcher(), ignore this change event
    // entirely — don't even touch a pending debounce timer — since it's almost certainly this
    // app's own write, not something external that needs picking up.
    if (Date.now() < suppressUntil) return
    const existing = debounceTimers.get(root.id)
    if (existing) clearTimeout(existing)
    debounceTimers.set(
      root.id,
      setTimeout(() => {
        debounceTimers.delete(root.id)
        // Manual-recursion roots refresh their per-directory watcher set on every fire, BEFORE the
        // rescan callback — a rename/create event just proved the tree changed, so this is exactly
        // the moment a brand-new subfolder needs picking up for next time.
        if (manualWatcherDirs.has(root.id)) refreshManualWatchers(root.id, root.path, scheduleRescan, log)
        onChange(root.id, root.path)
      }, DEBOUNCE_MS)
    )
  }

  const bindNativeRecursive = (): FSWatcher => {
    const watcher = watch(root.path, { recursive: true }, () => scheduleRescan())
    // fs.watch is an EventEmitter — an unhandled 'error' throws and can crash the whole process,
    // not just this watcher (same risk noted on the training-folder watcher in main/index.ts).
    // Real case here: an IR library root living on a mapped/network drive that drops briefly.
    watcher.on('error', (error) => {
      log(`IR root watcher error for "${root.path}": ${String(error)}`)
      activeWatchers.delete(root.id)
      // Retry once after a pause rather than leaving the root silently unwatched forever — a
      // network drive reappearing is the expected recovery case, not a permanent failure.
      setTimeout(() => {
        try {
          activeWatchers.set(root.id, bindNativeRecursive())
        } catch (retryError) {
          log(`IR root watcher retry failed for "${root.path}": ${String(retryError)}`)
        }
      }, 10000)
    })
    return watcher
  }

  try {
    activeWatchers.set(root.id, bindNativeRecursive())
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      log(`IR root watcher: recursive watch unavailable on this platform for "${root.path}" — watching every subfolder individually instead.`)
      manualWatcherDirs.set(root.id, new Map())
      refreshManualWatchers(root.id, root.path, scheduleRescan, log)
      if ((manualWatcherDirs.get(root.id)?.size ?? 0) === 0) {
        log(`IR root watcher: could not watch "${root.path}" at all — no subfolder watchers could be opened.`)
        manualWatcherDirs.delete(root.id)
      }
    } else {
      log(`IR root watcher: could not watch "${root.path}": ${String(err)}`)
    }
  }
}

function stopWatcher(rootId: number): void {
  const timer = debounceTimers.get(rootId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(rootId)
  }
  const watcher = activeWatchers.get(rootId)
  if (watcher) {
    try {
      watcher.close()
    } catch {
      // Already closed/gone — nothing to do.
    }
    activeWatchers.delete(rootId)
  }
  const dirs = manualWatcherDirs.get(rootId)
  if (dirs) {
    for (const w of dirs.values()) {
      try {
        w.close()
      } catch {
        // Already closed/gone — nothing to do.
      }
    }
    manualWatcherDirs.delete(rootId)
  }
}

/** Reconciles the active watcher set against whatever's currently marked `watch_mode = 'watched'`
 * in the DB — call this once at startup and again any time a root's watch mode, or the root list
 * itself, changes (added/removed/relinked). Cheap and idempotent: does nothing for a root whose
 * watch state hasn't changed since the last call. */
export function syncRootWatchers(db: DatabaseSync, onChange: (rootId: number, rootPath: string) => void, log: (msg: string) => void): void {
  const watchedRoots = db.prepare(`SELECT id, path FROM library_root WHERE watch_mode = 'watched'`).all() as unknown as WatchedRoot[]
  const watchedIds = new Set(watchedRoots.map((r) => r.id))

  for (const id of new Set([...activeWatchers.keys(), ...manualWatcherDirs.keys()])) {
    if (!watchedIds.has(id)) stopWatcher(id)
  }
  for (const root of watchedRoots) {
    if (!activeWatchers.has(root.id) && !manualWatcherDirs.has(root.id)) startWatcher(root, onChange, log)
  }
}

/** Stops every active watcher — call on app quit so nothing keeps the process alive or fires a
 * rescan against a database connection that's about to close. */
export function stopAllRootWatchers(): void {
  for (const id of new Set([...activeWatchers.keys(), ...manualWatcherDirs.keys()])) stopWatcher(id)
}

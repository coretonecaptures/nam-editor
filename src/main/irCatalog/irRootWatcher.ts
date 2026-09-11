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
 * `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` there. Falls back to non-recursive (top-level only) on
 * that platform rather than failing to watch at all; a new file inside an EXISTING subfolder won't
 * be picked up there, but a new top-level pack folder will. Documented, not silently degraded.
 */
import { watch, type FSWatcher } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

interface WatchedRoot {
  id: number
  path: string
}

const DEBOUNCE_MS = 2500

const activeWatchers = new Map<number, FSWatcher>()
const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>()

function startWatcher(root: WatchedRoot, onChange: (rootId: number, rootPath: string) => void, log: (msg: string) => void): void {
  const scheduleRescan = (): void => {
    const existing = debounceTimers.get(root.id)
    if (existing) clearTimeout(existing)
    debounceTimers.set(
      root.id,
      setTimeout(() => {
        debounceTimers.delete(root.id)
        onChange(root.id, root.path)
      }, DEBOUNCE_MS)
    )
  }

  const bind = (recursive: boolean): FSWatcher => {
    const watcher = watch(root.path, { recursive }, () => scheduleRescan())
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
          activeWatchers.set(root.id, bind(recursive))
        } catch (retryError) {
          log(`IR root watcher retry failed for "${root.path}": ${String(retryError)}`)
        }
      }, 10000)
    })
    return watcher
  }

  try {
    activeWatchers.set(root.id, bind(true))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      log(`IR root watcher: recursive watch unavailable on this platform for "${root.path}" — falling back to top-level only.`)
      try {
        activeWatchers.set(root.id, bind(false))
      } catch (fallbackErr) {
        log(`IR root watcher: could not watch "${root.path}" at all: ${String(fallbackErr)}`)
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
}

/** Reconciles the active watcher set against whatever's currently marked `watch_mode = 'watched'`
 * in the DB — call this once at startup and again any time a root's watch mode, or the root list
 * itself, changes (added/removed/relinked). Cheap and idempotent: does nothing for a root whose
 * watch state hasn't changed since the last call. */
export function syncRootWatchers(db: DatabaseSync, onChange: (rootId: number, rootPath: string) => void, log: (msg: string) => void): void {
  const watchedRoots = db.prepare(`SELECT id, path FROM library_root WHERE watch_mode = 'watched'`).all() as unknown as WatchedRoot[]
  const watchedIds = new Set(watchedRoots.map((r) => r.id))

  for (const id of activeWatchers.keys()) {
    if (!watchedIds.has(id)) stopWatcher(id)
  }
  for (const root of watchedRoots) {
    if (!activeWatchers.has(root.id)) startWatcher(root, onChange, log)
  }
}

/** Stops every active watcher — call on app quit so nothing keeps the process alive or fires a
 * rescan against a database connection that's about to close. */
export function stopAllRootWatchers(): void {
  for (const id of [...activeWatchers.keys()]) stopWatcher(id)
}

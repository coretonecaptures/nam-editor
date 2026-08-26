/**
 * Single-owner guard for `LiveEngine` (docs/ir-lab-manager-build-plan.md section 8b).
 *
 * HISTORY, because the shape of this module only makes sense with it: IR mode briefly had its own
 * parallel `LiveEngine` (a bespoke hook), so two independent engines could be alive at once,
 * fighting over the same microphone. This started life as a mutex between those two owners. That
 * duplication has since been deleted — IR mode now renders the same `PlayerPanel` NAM mode does,
 * and `AppRoot.tsx` only ever mounts ONE of the two modes at a time, so there is exactly one
 * `PlayerPanel`, and therefore exactly one engine, by construction.
 *
 * So this is no longer resolving contention between two real owners; it's a cheap assertion that
 * the single-owner invariant still holds, and the place a second owner would have to announce
 * itself if one is ever added. Kept rather than deleted for that reason — but it should NOT be
 * read as evidence that two engines are expected.
 *
 * Deliberately a plain module-level singleton, not React context — a would-be second owner would
 * live in a separate component tree under `AppRoot` with no common ancestor to host context.
 */
export type LiveEngineOwnerId = 'nam' | 'ir-mode'

let activeOwner: LiveEngineOwnerId | null = null
const listeners = new Set<(owner: LiveEngineOwnerId | null) => void>()

function notify(): void {
  for (const listener of listeners) listener(activeOwner)
}

/** Claims the single live-monitoring slot for `owner`. Returns false (and claims nothing) if a
 * DIFFERENT owner already holds it — the caller should surface that as an error, not silently
 * proceed into a second `LiveEngine`/`getUserMedia` call. Re-acquiring by the same owner
 * (e.g. restarting) is always allowed. */
export function tryAcquireLiveEngine(owner: LiveEngineOwnerId): boolean {
  if (activeOwner !== null && activeOwner !== owner) return false
  activeOwner = owner
  notify()
  return true
}

/** Releases the slot — a no-op if `owner` doesn't currently hold it (e.g. it never acquired, or
 * was already released), so callers can call this unconditionally on every stop/cleanup path. */
export function releaseLiveEngine(owner: LiveEngineOwnerId): void {
  if (activeOwner === owner) {
    activeOwner = null
    notify()
  }
}

export function getActiveLiveEngineOwner(): LiveEngineOwnerId | null {
  return activeOwner
}

/** For a UI that wants to reflect "the other mode is live" without polling. */
export function subscribeLiveEngineOwner(callback: (owner: LiveEngineOwnerId | null) => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function describeLiveEngineOwner(owner: LiveEngineOwnerId): string {
  return owner === 'nam' ? 'NAM mode' : 'IR mode'
}

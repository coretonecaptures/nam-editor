/**
 * Cross-tree LiveEngine mutex (docs/ir-lab-manager-build-plan.md section 8b, item 2 — the
 * "Cross-tree architecture gap"). `AppRoot.tsx` renders NAM mode (`App.tsx`/`PlayerPanel.tsx`) and
 * IR mode (`IrModeShell.tsx`) as siblings with no shared state, and each now owns its own
 * independent `LiveEngine` instance. Running both live at once means two separate audio contexts/
 * worklets fighting over the same microphone/interface — this module doesn't remove that
 * (a genuinely SHARED single instance would need lifting `LiveEngine` above `AppRoot`, a real
 * state-lifting refactor not attempted here), it just makes the two modes aware of each other so
 * one refuses to start while the other is already live, with an honest error instead of silent
 * device contention.
 *
 * Deliberately a plain module-level singleton, not React context — the two owners live in
 * completely separate component trees under `AppRoot`, so there is no common ancestor to host
 * context even if one were built for this alone.
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

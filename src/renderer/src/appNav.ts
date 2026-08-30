/**
 * Cross-shell navigation bus. AppRoot renders exactly one of App (NAM mode) / IrModeShell /
 * NamProjectsShell at a time, and the trainer workspace lives *inside* App — so
 * NamProjectsShell can't reach it directly. This is a tiny module-level pub/sub (not React
 * state) so the intent survives App being freshly mounted when the mode flips.
 *
 * Flow for "create a training batch from NAM Projects":
 *   1. NamProjectsShell stages the jobs via IPC, then calls goToTrainingBatches().
 *   2. AppRoot's listener flips mode to 'nam' (mounts App).
 *   3. App, on mount, calls consumePendingBatchNav() -> opens the training workspace on Batches.
 * The staged jobs are already in the main-process trainer queue; TrainingPanel picks them up
 * through its own trainer:update subscription, so no job data crosses the shell boundary.
 */

let pendingBatchNav = false
const listeners = new Set<() => void>()

/** Request navigation to NAM mode's trainer workspace, Batches section. */
export function goToTrainingBatches(): void {
  pendingBatchNav = true
  for (const l of listeners) {
    try {
      l()
    } catch {
      // A listener throwing must not stop the others or the caller.
    }
  }
}

/** AppRoot subscribes; the callback should switch to NAM mode. Returns an unsubscribe fn. */
export function onGoToTrainingBatches(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** App calls this once on mount; true means "open the trainer on Batches now". One-shot. */
export function consumePendingBatchNav(): boolean {
  const v = pendingBatchNav
  pendingBatchNav = false
  return v
}

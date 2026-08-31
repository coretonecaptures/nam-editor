/**
 * Cross-shell navigation bus. AppRoot renders exactly one of App (NAM mode) / IrModeShell /
 * NamProjectsShell at a time, and the trainer workspace lives *inside* App — so
 * NamProjectsShell can't reach it directly. This is a tiny module-level pub/sub (not React
 * state) so the intent survives App being freshly mounted when the mode flips.
 *
 * Flow for "create a training batch from NAM Projects":
 *   1. NamProjectsShell stages/queues the jobs via IPC, then calls goToTraining(section).
 *   2. AppRoot's listener flips mode to 'nam' (mounts App).
 *   3. App, on mount, calls consumePendingTrainingNav() -> opens the training workspace there.
 * The jobs are already in the main-process trainer queue; TrainingPanel picks them up through
 * its own trainer:update subscription, so no job data crosses the shell boundary.
 */

export type TrainingNavSection = 'batches' | 'queue'

let pendingSection: TrainingNavSection | null = null
const listeners = new Set<() => void>()

/** Request navigation to NAM mode's trainer workspace on the given section. */
export function goToTraining(section: TrainingNavSection): void {
  pendingSection = section
  for (const l of listeners) {
    try {
      l()
    } catch {
      // A listener throwing must not stop the others or the caller.
    }
  }
}

/** Convenience: staged batch -> the Batches section (review, then Start there). */
export function goToTrainingBatches(): void {
  goToTraining('batches')
}

/** Convenience: live/"run next" -> the Queue section (it's already running or about to). */
export function goToTrainingQueue(): void {
  goToTraining('queue')
}

/** AppRoot subscribes; the callback should switch to NAM mode. Returns an unsubscribe fn. */
export function onGoToTrainingBatches(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** App calls this once on mount; returns the section to open, or null. One-shot. */
export function consumePendingTrainingNav(): TrainingNavSection | null {
  const v = pendingSection
  pendingSection = null
  return v
}

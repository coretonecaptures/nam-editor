# Training, queues, watchers, and history audit

Date: 2026-10-23. Branch: `feature/ir-lab-manager`.

> **Status (2026-10-23): findings 1–15 resolved** on `feature/ir-lab-manager` (commits `f5bacd9`, `25cf9a3`, `c8db6bb`). #12 is resolved by design rather than by injection: stock neural-amp-modeler 0.13.0's `train()` takes no LR settings and A2 uses `config_model_packed.json` (lr 0.004, gamma 0.994, mrstft 0.0005), so NAM Lab keeps that and the batch editor says LR doesn't apply to A2. Still open from "Further risks": atomic queue/history writes, naming consistency between submission paths, and metrics vs. the best checkpoint. `scripts/audit-training.cjs` and `scripts/audit-training-runner.py` now assert the fixed behaviour. The rest of this document is the original audit, unchanged.

Reviewed the embedded Python runner, job execution and finalization, active/staged queues, persistence/recovery, watch-folder scheduling, history retries, IR Lab capture imports, and related UI/IPC. No production code was changed. No actual NAM/PyTorch training was performed and no user training data was changed.

P1 means potential artifact loss, pending-work loss, corrupted run ownership, or training the wrong input pair. P2 means a functional/reliability defect. References are to the audited source; function names remain useful if line numbers shift.

## Findings

### 1. P1 — Batch cancellation can delete a previously trained model

References: `src/main/index.ts:3945` (`startTrainerJob`), `:4429` (canceled-run cleanup), `trainer:cancelBatch`.

At startup, `trainerState.outputModelPath` is initialized to the intended FINAL destination. It becomes the workspace result path only after Python sends `NAM_LAB_RESULT`. If a batch is canceled before that result arrives, the close handler unlinks whatever currently occupies `trainerState.outputModelPath`. An existing model with that name can therefore be deleted even though this attempt never created it. This affects Batch Cancel; Emergency Stop normally takes a different early-return branch.

Reproduction: prepare an existing destination model, start another run with the same destination/name, then cancel its batch before result reporting. The mocked reproduction confirms the old destination is selected for deletion without touching a real file.

Fix: track run-owned artifacts separately from intended destinations. Cancellation should delete only artifacts proven to belong to this attempt, normally inside its workspace.

### 2. P1 — Spawn errors and close events finalize the same run twice

References: `src/main/index.ts:4124` and `:4143`, child `error` and `close` handlers.

The error handler nulls the shared child and pumps another job immediately. A failed spawn also produces a later close event, whose handler still mutates global `trainerState`, clears `trainerChild`, stops the shared checkpoint poll, and creates history for the old job. Depending on timing, this overwrites the next job's starting/running state or loses its child handle. Metrics in the old history row can come from the new run. This can affect later cancellation and queue progression as well as display.

Evidence: the diagnostic runs the actual handlers in error→next-run→old-close order. The old close clears the replacement child and records the replacement run's ESR in the old job's history.

Fix: one idempotent finalizer per attempt; close over the actual child/run ID and reject stale callbacks. Advance the queue exactly once after cleanup completes.

### 3. P1 — Queue persistence drops unfinished work above 2,000 rows

Reference: `src/main/index.ts:2346`, `getPersistableTrainerQueueJobs`.

Persistence takes `trainerQueue.slice(-2000)` without distinguishing pending/staged/active jobs from terminal rows. A queue of 2,001 pending jobs loses its FIRST job on disk; an active job near the beginning can also disappear from the persisted queue. On restart, these jobs are missing rather than recovered. Lost staged or never-run jobs have no history record to recover from.

Evidence: actual persistence selector returns jobs j1…j2000 for j0…j2000.

Fix: always persist every unfinished/staged job. Cap terminal display rows separately or reject additions explicitly before capacity is exceeded.

### 4. P1 — IR Lab history retry can train the wrong DI/return pair

References: `src/renderer/src/components/TrainingPanel.tsx:1577`, `:1595`; `src/shared/trainer.ts`, `TrainerHistoryEntry`; `src/main/namCaptureTraining.ts`, `buildNamCaptureImportPayloads`.

Original IR Lab submissions deliberately use each capture's own excitation/recording pair and force normalization OFF. History does not preserve that excitation path or the full capture provenance. Bulk history retry reconstructs every entry with the global training DI, current normalization preference, and `sourceMode: 'manual-direct'`. Profile-less individual IR Lab retries use this same path. Profile-backed individual retries also fall back to generic profile/history reconstruction rather than preserving the original pair. Capture result write-back and provenance are lost.

Evidence: actual renderer retry code produces global DI + normalization ON + manual-direct for a nam-capture-import history row. Training with that payload may fail checks; when checks are bypassed or the mismatch passes, it can learn the wrong mapping.

Fix: persist the original DI/return pair and capture metadata in history; rebuild IR Lab retries through the capture-import builder and preserve its no-normalization rule. Reject retries when the original pair cannot be recovered.

### 5. P2 — Emergency Stop cannot cancel job preflight

References: `src/main/index.ts:3945`, `startTrainerJob`; `trainer:cancel`; `trainer:cancelBatch`.

The job is marked starting before asynchronous file access, workspace setup, runner creation, and payload writing. Emergency Stop rejects when `trainerChild` is null, even though a starting job exists. Batch Cancel also kills only when a child exists and does not invalidate pending preflight. A cancellation request during slow/network I/O can therefore be rejected or cancel the waiting siblings while allowing the active preparation to continue into training.

Evidence: invoking the real Emergency Stop handler with starting state and no child returns failure.

Fix: cancellation token per attempt, checked after each await and immediately before spawn; allow cancellation in starting state without requiring an existing child.

### 6. P2 — Watcher stability retry cancels its own replacement timer

Reference: `src/main/index.ts:4651`, `scheduleTrainingWatcherFile`.

When the second stat shows a WAV is still changing, the callback recursively schedules another timer for the same profile/path. Its finally block then calls `clearTrainingWatcherTimer(timerKey)`, which now refers to the NEW timer, canceling the retry it just installed. If no later fs.watch event arrives, the WAV never gets queued. The pending count can also remain misleading. The same ownership problem applies when an old in-flight callback finishes after another event installed a newer timer.

Evidence: mocked timers and changing stat results leave no retry timer after the callback returns.

Fix: associate cleanup with the callback's own timer/generation; never remove a newer scheduled retry. Check that the profile is still active before enqueuing after awaits.

### 7. P2 — “Mark skipped” does not reliably prevent watcher enqueue

References: `trainer:retrainFileAction`, mark-skipped branch; `src/main/index.ts:3667`, `trainerHistoryAlreadyHasSource`.

Mark-skipped stores null source size/mtime, but watcher deduplication requires exact equality with the actual size/mtime. The skipped row therefore does not match a real file on the next scan/change. The watcher modal separately treats any matching skip row as skipped without checking its fingerprint, so the UI can say skipped while the enqueue predicate permits training.

Evidence: a null-fingerprint skip row returns false from the actual predicate for a real non-null file fingerprint.

Fix: stat when marking skipped, or explicitly define manual skip as path-scoped and implement that distinction consistently.

### 8. P2 — Individual profile history retry is blocked by normal deduplication

References: `trainer:retryHistoryEntry`; `src/main/index.ts:3647`, `:3667`, `buildTrainerPayloadsForProfile`.

The explicit retry handler clears skipped entries, then calls the same profile payload builder used by watchers. An unchanged successful history row blocks its own retry. Failed queue rows retained for a submission also count as already queued and block retrying their corresponding history rows. The handler does not provide a bypass for the specific history attempt being retried. Group-head retry uses different renderer reconstruction, so individual and group actions behave differently.

Evidence: diagnostics confirm both blockers, and the actual individual retry handler rejects a successful profile history row without enqueuing a job.

Fix: centralize retry reconstruction and bypass completed-attempt deduplication for the explicit retry target while still preventing duplicate active jobs.

### 9. P2 — Canceled queued/staged jobs are missing from history

Reference: `trainer:cancelBatch`.

The handler changes queued/staged jobs to canceled but never appends their history records. Only a genuinely running child's close handler appends one. A batch canceled before it starts is therefore absent from History, and removing its queue rows removes its only record. Partial-batch cancellation records the active attempt but omits the remaining canceled jobs.

Evidence: actual handler cancels queued and staged fixtures while history remains empty.

Fix: append canceled-before-start history once per affected pending job; let the active attempt's finalizer own its separate record.

### 10. P2 — History attempt counts lag the actual attempt by one

References: `src/main/index.ts:3957`, `:4457`; `appendTrainerCanceledHistory` in preflight failure handling.

Startup increments attempts by replacing the queue object. The running function retains the previous `job` object and later writes `attempts: job.attempts` into history. Thus the first run is recorded as attempt 0, the second as 1, and preflight failures have the same stale-object issue.

Evidence: the real startup/close path leaves the queue at attempts=1 but writes attempts=0 to history.

Fix: capture the new attempt number when starting and use that immutable value throughout finalization/history.

### 11. P2 — Clear finished reports success but leaves failed/canceled batches

References: `trainer:clearFinished`; `pruneFinishedBatchesFromQueue`; `TrainingPanel.tsx`, `clearableFinishedCount`.

The UI counts fully terminal error/canceled batches as clearable, but the handler calls the automatic prune function that deliberately preserves any batch containing error/canceled/staged rows. Fully failed batches can therefore keep appearing after Clear finished returns success. This mixes automatic retention policy with an explicit user removal action.

Evidence: calling the actual handler on a fully failed submission returns success and leaves its row untouched.

Fix: implement explicit Clear finished according to the displayed eligibility rule; keep automatic success-only pruning separate.

### 12. P2 — A2 ignores submitted LR, LR decay, and MRSTFT settings

Reference: `src/main/index.ts:2043`, embedded runner `_run_a2`; queue editor and runner payload construction.

These fields are stored in jobs and sent to Python, and queue editing accepts changes, but `_run_a2` never consumes them or injects a modified model/training config. It forwards epochs/batchSize/ny and other options while leaving lr/lrDecay/fitMrstft unused. A user can edit a queued A2 job and get the same effective call.

Evidence: executing the actual extracted Python function with a stub train function produces identical arguments for differing LR, decay, and MRSTFT payloads. This does not determine the installed NAM package's default values.

Fix: apply supported settings through A2 configuration injection, or disable/explain unsupported controls so stored settings reflect what training actually uses.

### 13. P2 — Reused retry workspaces can prefer an old model over a fresh export

References: embedded runner `_find_output_model_path` at `src/main/index.ts:1827`; Emergency Stop close branch; `resetTrainerJobForQueue`.

Retries retain the same train/workspace path. Emergency Stop's cleanup comment says the partial workspace is cleaned, but the branch only unlinks the payload JSON. The Python finder immediately accepts an existing workspace `<modelName>.nam` before inspecting any newly exported checkpoint files. If a previous attempt left that promoted root model and the new attempt exports to a subdirectory/checkpoint name, the old model wins regardless of freshness. Retained files do not establish a fresh successful result.

Evidence: the actual extracted finder returns the retained root model without reaching checkpoint discovery. This is a conditional artifact-selection bug; reproducing it with a particular installed NAM exporter remains outstanding.

Fix: isolate each attempt in a fresh workspace, or constrain output selection to artifacts produced by the current attempt. Require a valid current result acknowledgement before promoting success.

### 14. P2 — Watcher history statuses do not match the UI's status vocabulary

References: `trainer:getWatcherFilesStatus`; `src/renderer/src/components/WatcherFilesModal.tsx:26`.

The IPC handler casts history status to a watcher status type but does not translate its value. History sends success/error; the modal's style/label maps require done/failed. TypeScript assertions do not convert strings, so these entries render with missing labels/styles. Status lookup also ignores file fingerprint changes, allowing an older result to describe a replaced WAV.

Fix: explicitly map success→done and error→failed, and use the same file identity rules as watcher deduplication.

Validation: direct source inspection; no UI automation performed.

### 15. P2 — Bulk retry marks/clears entries even when zero jobs were added

Reference: `src/renderer/src/components/TrainingPanel.tsx:1595`, `handleRetryHistoryBatch`.

Enqueue returns success with queued=0 when duplicate protection removes every payload. The renderer checks only success, then marks every requested history entry retried and clears its superseded terminal queue rows. No new submission may exist. With a partial enqueue, it also marks/clears entries that were not actually accepted. This can remove outstanding failure rows and misstate which captures were retried.

Evidence: actual renderer retry function calls both markHistoryRetried and clearSupersededQueueRows after an enqueue response of success=true, queued=0.

Fix: return accepted source/architecture/job identifiers from enqueue; mark and clear only accepted retries. Surface zero accepted jobs explicitly.

## Further risks and inconsistencies

- Queue/history files are written directly rather than by temporary-file replacement, and loaders convert parse failures to empty arrays. A write interruption can therefore lose the entire file's recoverable state. Add atomic replacement and backup recovery.
- Single-preset manual submission hardcodes `namingTemplate: '{basename}'`, while bundle submission honors `preset.namingTemplate`. Retrying also discards custom model names. These paths can produce inconsistent naming for the same preset/capture.
- Retry reconstruction omits original custom optimizer/profile details, ignores `processedWavPath` in the bulk renderer path, and may append an architecture folder below an already architecture-specific prior output directory. Store a complete immutable recipe and share one reconstruction path.
- The auto-start-on-launch option can clear a recovered pause unless “skip if paused” is enabled. This is configurable behavior, but the queue-loader comment promises an interrupted run stays paused until explicit Resume. Align the documented recovery rule with the selected policy.
- Some final metadata metrics are taken from the last validation callback. Verify that MRSTFT/MSE and A2 sub-model values describe the exported best checkpoint, especially with early stopping and a worse final epoch.
- This review did not validate training quality, installed NAM API compatibility, CUDA/MPS behavior, memory use, long-running checkpoint generation, or process-tree termination with a real trainer environment.

## Validation

- Existing focused Vitest run: **88 tests passed across 4 files**: `namCaptureTraining`, `metadataPatcher`, `namCaptureEnrichment`, and `NamProjectsShell`. These validate related payload/metadata/import/UI behavior, not the main-process queue/finalization state machine.
- `node scripts/audit-training.cjs`: **13 current-bug checks confirmed**, using real functions and IPC handlers extracted from the TypeScript AST with mocked state/files/processes; includes renderer history retry extraction. No Electron app or trainer process is launched.
- `python scripts/audit-training-runner.py`: **2 runner checks confirmed** using extracted functions, stubbed train/Path objects, and Python standard library only. No NAM, PyTorch, GPU, or user files are loaded.
- The diagnostics intentionally assert current failures; convert them to desired-behavior regression tests when implementing fixes.

Recommended order: prevent cancellation artifact deletion; unify attempt ownership/finalization; preserve all unfinished jobs; make retries preserve original capture recipes; fix watcher scheduling; then reconcile history/status/setting behavior. Production fixes have not been applied.

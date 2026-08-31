# De-dup the trainer interface trees (index.ts local ↔ src/shared/trainer.ts)

Status: **not started.** Written 2026-08-31 as a hand-off spec so it can be executed carefully
later. No training run is needed to verify this — the gate is `tsc` + `electron-vite build` +
`vitest` + a short static read.

---

## 1. Background

`src/main/index.ts` declares its **own private copies** of the trainer types:

| index.ts local (approx line) | canonical in `src/shared/trainer.ts` |
|---|---|
| `type TrainingSourceMode` (138) | inline union on each interface |
| `type TrainingSourcePostProcessMode` (139) | inline `'move' \| 'copy' \| 'keep'` |
| `type TrainingLatencyMode` (140) | inline `'auto' \| 'manual'` |
| `type TrainerQueueJobStatus` (1136) | `export type TrainerQueueJobStatus` (216) |
| `type TrainerArchitecture = string` (1135) | `export type TrainerArchitecture = typeof TRAINER_ARCHITECTURES[number]` (13) |
| `interface WaveNetLayerConfig` (1138) | `export interface WaveNetLayerConfig` (15) |
| `interface WaveNetConfig` (1150) | `export interface WaveNetConfig` (27) |
| `interface TrainerStartPayload` (1155) | `export interface TrainerStartPayload` (158) |
| `interface TrainerQueueJob` (1207) | `export interface TrainerQueueJob` (218) |
| `interface TrainerHistoryEntry` (1282) | `export interface TrainerHistoryEntry` (295) |
| `interface TrainerStateSnapshot` (1370) | `export interface TrainerStateSnapshot` (366) |
| `interface TrainerWatcherRuntime` | `export interface TrainerWatcherRuntime` (349) |
| `interface TrainerProfilesStateSnapshot` | `export interface TrainerProfilesStateSnapshot` (361) |
| `const TRAINER_IDLE_STATE` (1428) | `export const IDLE_TRAINER_STATE` (422) |

`tsconfig.node.json` **now includes `src/shared/**/*`** (the F change on 2026-08-31 moved
`trainer.ts` there), so `index.ts` *can* import these directly — it just doesn't yet.

The two trees have drifted. The renderer/shared copy is the one that's kept current; `index.ts`'s
copy lags. As of 2026-08-31, `tsc -p tsconfig.node.json` reports **37 errors**, of which **~22 are
this drift** and **~15 are unrelated** (see §5).

---

## 2. Exact field-level drift

### `TrainerStartPayload` — shared has, index.ts local lacks
- `namMode?: 'a1' | 'a2'`
- `normalizeWav?: boolean`
- `normalizeWavTargetDb?: number`
- `modelNameSuffix?: string | null`

index.ts local has `backupExisting?: boolean` — **shared has it on `TrainerQueueJob`, not on
`TrainerStartPayload`.** Check whether `createTrainerJob`/retry paths read `payload.backupExisting`;
if so, add `backupExisting?: boolean` to shared `TrainerStartPayload` (it's harmless/optional).

### `TrainerQueueJob` — shared has, index.ts local lacks
- `namMode: 'a1' | 'a2'`  *(required in shared)*
- `normalizeWav: boolean`  *(required)*
- `normalizeWavTargetDb: number`  *(required)*
- `validationEsrFull?: number | null`
- `editedAt?: string | null`
- `backupExisting?: boolean`
- `status` union: shared `TrainerQueueJobStatus` includes **`'staged'`**; index.ts local
  `TrainerQueueJobStatus` (line 1136) is `'queued' | 'starting' | 'running' | 'success' | 'error' |
  'canceled'` — **no `'staged'`**. This is the cause of every *"types … and '\"staged\"' have no
  overlap"* error.

### `TrainerHistoryEntry` — shared has, index.ts local lacks
- `namMode?: 'a1' | 'a2'`
- `retriedAt?: string | null`

index.ts local `TrainerHistoryEntry` has `workspacePath?: string` — **shared does not.** Grep for
`.workspacePath` on history entries; if used, add it to shared.

Also note the field **`jobId` / `finishedAt`**: errors at `index.ts(2718)` reference
`someHistoryEntry.jobId` / `.finishedAt`. Neither the local nor the shared `TrainerHistoryEntry`
has those — that call site is passing a **`TrainerQueueJob`** where a `TrainerHistoryEntry` is
expected (or vice versa). This is a **real latent type confusion at index.ts(2715-2718)** — fix
the call site, do not add `jobId` to `TrainerHistoryEntry`.

### `TrainerArchitecture`
Shared: a real union of the 9 arch ids. Local: `string`. Widening to the union may surface a few
"arch string not assignable" spots where index.ts passes a free string. Keep them working with a
cast at the boundary or a narrowing check — do **not** re-widen the shared type.

### `TrainerStateSnapshot` / `TRAINER_IDLE_STATE`
Local `TRAINER_IDLE_STATE` (line 1428) is **missing `history` and `watcherState`** keys that the
local `TrainerStateSnapshot` requires → errors at `index.ts(3870/4407/4418/4447)` where it's
spread. Shared `IDLE_TRAINER_STATE` (line 422) has all keys. Switching to the shared const fixes
these outright.

### `WaveNetConfig`
Structurally identical, nominally distinct. This is why `src/main/namCaptureTraining.ts`'s
`resolveProfile` needs `as CaptureProfileConfig | null` in index.ts's wrapper. After the de-dup,
that cast can be removed.

---

## 3. Execution plan

Do it in **small, individually-buildable steps**, committing after each. Order matters — leaf
types first.

### Step 1 — supporting types
In `index.ts`, delete the local `WaveNetLayerConfig`, `WaveNetConfig`, `TrainerQueueJobStatus`,
`TrainerStatus` (if local), `TrainerArchitecture`, and add to the shared-import list:
```ts
import type {
  WaveNetConfig, WaveNetLayerConfig, TrainerArchitecture,
  TrainerStatus, TrainerQueueJobStatus,
  TrainerStartPayload, TrainerQueueJob, TrainerHistoryEntry,
  TrainerStateSnapshot, TrainerWatcherRuntime, TrainerProfilesStateSnapshot,
} from '../shared/trainer'
import { IDLE_TRAINER_STATE } from '../shared/trainer'
```
Keep `TrainingSourceMode` / `TrainingSourcePostProcessMode` / `TrainingLatencyMode` **local** —
they're index.ts-internal aliases the shared file spells inline; keeping them avoids churn. Verify
their values match shared's inline unions exactly (they do today).

Build. Fix any "duplicate identifier" / "cannot redeclare".

### Step 2 — `TrainerStartPayload`
Delete the local interface. Before building, reconcile:
- add `backupExisting?: boolean` to **shared** `TrainerStartPayload` if a call site reads it off a
  payload (grep `payload.backupExisting` / `\.backupExisting` near payload construction).
Build. Expect the `modelNameSuffix` / `namMode` / `normalizeWav*` errors to **disappear** (they
were "does not exist on the *local* type"). Any *new* error here means a call site was relying on
a field the local type had that shared lacks — list it, decide add-to-shared vs fix-call-site.

### Step 3 — `TrainerQueueJob`
Delete the local interface. Key risk: **partial job construction**. Grep for object literals typed
as `TrainerQueueJob` (or `Partial<TrainerQueueJob>`), especially in:
- `createTrainerJob` (must now also set `namMode`, `normalizeWav`, `normalizeWavTargetDb` — all
  required in shared; `createTrainerJob` already computes `namMode`/normalize values for the
  payload, so copy them onto the returned job)
- `resetTrainerJobForQueue`, `updateTrainerJob(jobId, patch)` call sites
- the persisted-queue load path (`trainer-queue.json` → `TrainerQueueJob[]`)
Build. The `'staged'`-overlap errors should now be **legit** comparisons (shared status union has
`'staged'`).

### Step 4 — `TrainerHistoryEntry`
Delete the local interface.
- add `workspacePath?: string` to **shared** if `appendTrainerHistory` sets it (it does today).
- **Fix `index.ts(2715-2718)`**: that code reads `.jobId` / `.finishedAt` / `.validationEsrFull`
  off something typed as a history entry. Determine what it actually is (almost certainly a
  `TrainerQueueJob` from `getActiveTrainerJob()`), and correct the variable's type / the access.
Build.

### Step 5 — `TrainerStateSnapshot` + idle const
Delete local `TrainerStateSnapshot`, local `TrainerWatcherRuntime`,
`TrainerProfilesStateSnapshot`, and the local `TRAINER_IDLE_STATE`. Replace all
`TRAINER_IDLE_STATE` references with the imported `IDLE_TRAINER_STATE`. Build — the
`3870/4407/4418/4447` "missing history, watcherState" errors go away.

### Step 6 — clean up
- Remove the `as CaptureProfileConfig | null` cast in `buildTrainerPayloadsForNamCaptureImport`'s
  wrapper (index.ts) and the note about it in `src/main/namCaptureTraining.ts`
  (`CaptureProfileConfig` can then just alias the shared shape).
- Delete the "Mirror of the fields on src/shared/trainer.ts" comment blocks — they were the
  stop-gap.
- Grep `src/main` for any remaining `WaveNetConfig` / `TrainerQueueJob` etc. that still resolve to
  a now-deleted local (should be none).

---

## 4. Verification (no training run required)

1. `npx tsc --noEmit -p tsconfig.node.json` — error count should drop from **37 → ~15** (only the
   unrelated §5 items remain). **No new error classes.**
2. `npx tsc --noEmit -p tsconfig.web.json` — must stay **130** (renderer unaffected; it already
   uses the shared types via the `src/renderer/src/types/trainer.ts` re-export shim).
3. `npx electron-vite build` — clean (main + preload + renderer).
4. `npx vitest run` — **445 passing / 0 failing** (unchanged). Pay attention to
   `src/main/namCaptureTraining.test.ts` (7) and `src/main/irCatalog/namCaptureEnrichment.test.ts`
   — those exercise `TrainerStartPayload` shape.
5. Static smoke read (5 min) of the persisted-state round trips, since a wrong optional↔required
   flip here only bites at runtime:
   - `saveTrainerQueue()` / the `trainer-queue.json` load: every `TrainerQueueJob` field the
     loader doesn't explicitly default must be optional in shared, OR the loader must fill it.
     Check `namMode`, `normalizeWav`, `normalizeWavTargetDb` specifically (now required in shared)
     — an old `trainer-queue.json` won't have them. Either give them safe defaults on load
     (`namMode ?? 'a1'`, `normalizeWav ?? false`, `normalizeWavTargetDb ?? -5`) **or** make them
     optional in shared with the same defaults applied at read. Prefer defaulting on load.
   - `emitTrainerState()` builds a `TrainerStateSnapshot` — confirm it sets `history` and
     `watcherState` (it does; the local idle const was the only gap).
6. Optional runtime sanity (no GPU): `npm run dev`, open the Trainer tab, confirm the queue list,
   Batches section, and History render with no console errors. Do **not** need to start a run.

---

## 5. Errors NOT part of this task (leave them; or fix separately, they're each 1-liners)

From the 2026-08-31 `tsc -p tsconfig.node.json` run:

- `index.ts(2530,41)` `string | undefined` not assignable to `string` — a `?.` / `?? ''` at that
  call.
- `index.ts(2957,10)` `updateTrainerPhase` declared but never read — dead function, delete or
  `void` it.
- `index.ts(3980,3)` `ChildProcessByStdio<null, Readable, Readable>` vs
  `ChildProcessWithoutNullStreams` — the `spawn(...)` overload; annotate `trainerChild` as
  `ChildProcessByStdio<Writable | null, Readable | null, Readable | null>` or use the right spawn
  options type.
- `index.ts(4012/4016/4020/4039)` `'trainerChild' is possibly 'null'` ×4 — add a
  `if (!trainerChild) return` guard at the top of that block, or `trainerChild!.` if provably set.
- `index.ts(4606,78)` `Property 'toString' does not exist on type 'never'` — a narrowed-to-never
  branch; likely an exhaustive `switch` fallthrough.
- `index.ts(5355,34)` and `index.ts(7749,48)` `BrowserWindow | undefined` not assignable to
  `BaseWindow` ×2 — `getMainWindow()` can return null/undefined; guard before the Electron call.

None of these touch the trainer type shapes.

---

## 6. Risk notes

- **The whole point of caution:** `TrainerQueueJob` and `TrainerStartPayload` are persisted
  (`trainer-queue.json`) and cross the IPC boundary. Making a field **required** in shared that an
  old persisted file lacks, without a default on load, is a runtime `undefined` waiting to
  happen. Every required-in-shared field that isn't in the local type (`namMode`, `normalizeWav`,
  `normalizeWavTargetDb`, and `TrainerQueueJob.status` gaining `'staged'`) must be checked against
  the load path in Step 3/§4.5.
- Do this on its own branch, one interface per commit, so a bad step is a clean revert.
- If any step produces **more** errors than it removes, stop and reassess that interface's diff
  rather than pushing through.

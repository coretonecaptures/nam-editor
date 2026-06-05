# NAM Lab Training Guide

NAM Lab includes a built-in training workflow that runs the NAM Python trainer directly inside the app. It handles single captures, mixed-architecture batches, staged drafts, automated folder watching, and a full history of completed runs â€” all on the same Python `neural-amp-modeler` install you'd use from the command line.

---

## Requirements

Before training, you need a working NAM Python environment on your machine.

- Install Python + NAM using the official docs:
  - [Local Installation (official)](https://neural-amp-modeler.readthedocs.io/en/latest/installation.html)
  - [Training locally with the full-featured NAM](https://neural-amp-modeler.readthedocs.io/en/latest/tutorials/full.html)
  - [Packed training / A2](https://neural-amp-modeler.readthedocs.io/en/latest/tutorials/packed-training.html)
- Install `neural-amp-modeler` in that environment. A NAM version **>= 0.13.0** is recommended; that's the current official doc line and the one that supports both A1 WaveNet and A2 PackedWaveNet training.
- Note the full path to the Python executable inside that environment
  - Common Windows conda locations:
    - `C:\Users\YourName\miniconda3\envs\nam\python.exe`
    - `C:\Users\YourName\anaconda3\envs\nam\python.exe`
    - `C:\Users\YourName\.conda\envs\nam\python.exe`
  - Common Windows venv location:
    - `C:\path\to\your\project\.venv\Scripts\python.exe`
  - Common macOS / Linux conda location:
    - `~/miniconda3/envs/nam/bin/python`
  - Common macOS / Linux venv location:
    - `/path/to/your/project/.venv/bin/python`
- Have a **reference input DI WAV** - the reamp signal used during capture

NAM Lab does not install Python or NAM itself. It only orchestrates the trainer you already have.

### Quick way to find the right Python

If you already installed NAM but don't remember where it went:

- Open the same terminal where NAM works and run:
  - `python -c "import sys; print(sys.executable)"`
- Or, if you launch it with a named conda env:
  - `conda run -n nam python -c "import sys; print(sys.executable)"`
- Then paste that exact path into **Settings -> Training -> NAM Python Executable**.

---

## First-Time Setup

Open **Settings â†’ Training**.

- **NAM Python Executable** â€” paste the full path to your NAM environment's Python
- **Default Input DI** â€” optional default reference WAV for Quick Add and history-retry flows
- **NAM output path formula** â€” token-based output routing for the trained `.nam`, e.g. `../../NAM/{architecture}/{folder}`
- **Graph output path formula** â€” same idea for ESR plot PNGs
- **Normalize WAV before training** â€” global on/off with a target dBFS
- **Favorite preset** â€” the preset Quick Add uses
- **Auto-start queue on launch** â€” when enabled, NAM Lab automatically begins processing queued jobs when the app opens (takes effect on the next launch). Off by default.
- **Skip auto-start if queue was paused** â€” visible only when Auto-start is on; if you manually paused the queue before closing, the auto-start is skipped so you have to click Resume deliberately. Off by default.
- **Enable experimental training** â€” must be on for the Training workspace to appear

---

## Training Workspace Layout

The training workspace uses a left-rail navigator + main content. The **NAM Lab** eyebrow at the very top of the rail is a clickable back link with a chevron â€” click it to return to the file library (tree / file list / metadata editor).

**Left-rail sections:**

| Section | What it shows |
| --- | --- |
| Dashboard | A "Simple mode" summary â€” hero name of what's running, 8 big stat tiles (Current epoch, Queue progress, Active batch, Current ETA, Completed, Failed, Last ESR, Last item took), Quick Add card, Up Next card |
| Live Run | Real-time telemetry for the active job: ESR-over-epochs chart, statline (Epoch / Rate / Validation ESR / Started), Final output + Checkpoint paths, Up Next, expandable Raw trainer log |
| Queue | Queued / running / finished jobs grouped by batch submission, with filters, Expand-all / Collapse-all, captures + batches counters |
| Batches | **Staged** drafts â€” batches that were saved but not yet queued. Persist across app restarts |
| History | Completed, failed, and canceled runs with twin charts (ESR quality / Throughput), segmented status filter, group headers per batch |
| New Run | The Create Batch form |

Below the main sections, a collapsible **Watch Folders** item shows your active watcher profiles with start/stop controls. A **This Session** stats panel tracks completed runs, average ESR, throughput, and failures for the current session.

The **Now-strip** along the top of every section (except the Dashboard) shows the running job at a glance â€” model name, architecture chip, profile chip, progress bar, Pause-after-current and Emergency-stop controls.

---

## Architectures

NAM Lab supports both NAM generations as **architectures** in one unified picker:

| Architecture | Notes |
| --- | --- |
| **A2** | PackedWaveNet (NAM â‰¥ 0.13). One file contains both Full and Lite sub-models; the plugin picks at load time |
| **A1 - Standard** | Full WaveNet â€” highest A1 quality, largest file, slowest |
| **A1 - Complex** | 32-channel variant â€” richer detail |
| **A1 - Lite** | Good balance of quality and speed |
| **A1 - Feather** | Very lightweight |
| **A1 - Nano** | Smallest |
| **A1 - REVySTD** | 5-layer reverb-capable, 1500-epoch default |
| **A1 - REVyHI** | High-fidelity reverb variant |
| **A1 - REVxSTD** | 4-layer power-of-3 dilations, 1000-epoch default |

There is **no separate "A1 vs A2" toggle** anymore. You tick what you want in the **Architecture(s)** multi-select and NAM Lab picks the right Python runner per job (`_run_a2` for A2, `_run_a1_v13` for A1 on modern NAM, `_run_a1` for legacy NAM). **You can mix A1 and A2 in the same batch** â€” each ticked architecture spawns its own job under one shared batch submission.

Each architecture renders as a color-coded chip everywhere in the trainer (Create Batch, Staged Batches, Queue, History). A2 = rose, Standard = slate, Lite = emerald, Feather = sky, Nano = amber, Complex = blue, REVySTD = violet, REVyHI = purple, REVxSTD = fuchsia.

### Capture Profiles (custom architectures)

NAM Lab uses **Capture Profiles** to extend the picker with your own A1 WaveNet variants:

- Clone any built-in profile as a starting point
- Import a `layers_configs` JSON block from a NAM-BOT preset export
- Edit layers with a form-based UI
- Custom profiles store their own training parameters (LR, LR decay, batch size, NY, fit MRSTFT)
- Available everywhere the built-in architectures are â€” Create Batch, watcher presets, dashboard
- Stored in app settings; survive app restarts

A2 does not currently support custom configs â€” A2 selections always use the official `config_model_packed.json` from your NAM install.

---

## Presets

A **preset** stores a named recipe of architectures + epochs + latency mode + target ESR + normalize override that you can pick from the Create Batch dropdown.

**Fields per preset:**
- **Name** â€” free-form label
- **Architecture(s)** â€” any combination of A1 variants and/or A2
- **Epochs** â€” how many training epochs to run
- **Latency** â€” `Auto` (NAM detects the sample offset) or `Manual` (you specify it)
- **Target ESR** â€” optional early-stop threshold
- **Save graph** â€” saves a validation ESR plot alongside the `.nam`
- **Ignore trainer checks** â€” bypasses NAM's built-in safety validation (use with caution)
- **Normalize WAV before training** â€” override the global setting per preset

The last preset you selected in Create Batch is **persisted across app restarts**. If you've never selected one, the picker initializes from your **Favorite preset** (Settings â†’ Training) and falls back to `Custom` if neither is set.

---

## Create Batch (manual training)

The **New Run** section is the Create Batch form. It groups one or more output WAVs into a single batch submission.

**Sections of the form:**

1. **Captures**
   - **Batch name** (optional) â€” leave blank to auto-name from the capture, folder, or count
   - **Input DI** â€” the reamp reference WAV
   - **Output WAVs** â€” drop files, add files, or add a folder; folder mode groups by subfolder
2. **Training Settings**
   - **Preset** dropdown + description chip on the same row
   - **Architecture(s)** multi-select with color-coded chips below showing the current selection (Ã— to remove)
   - **Epochs**, **Latency**, **Target ESR**, **Save ESR plot**, **Ignore checks**, **Normalize**
3. **Output Routing** â€” formula-driven destination (token-based) or fixed path; preview shows where each `.nam` will land

At the bottom: **Queue + Start** (begins training right away) or **Stage** (save the batch to the Batches tab without running it).

After a successful submission the form clears and the view jumps to Queue (or Batches for staged), so duplicate submissions are hard to make by accident.

### Mixed A1 + A2 batches

Tick `A2`, `A1 - Standard`, and `A1 - REVxSTD` with 3 output WAVs and you get 9 jobs (3 WAVs Ã— 3 architectures) under one shared `submissionId`. Each job carries its own architecture and `namMode` is derived per-job. They run serially through the queue and each lands in its own `{architecture}` folder per the output formula.

---

## Quick Add

The Dashboard's **Quick Add** card lets you fire training without opening Create Batch:

1. Click the file-drop icon (or drop WAVs directly on the card)
2. NAM Lab builds a batch using:
   - **Input DI** from `Settings â†’ Training â†’ Default Input DI` (falls back to the legacy `Training Input WAV` setting)
   - **Routing** from `Settings â†’ Training â†’ Favorite output routing`, falling back to the global **NAM output path formula**
   - **Preset** from `Settings â†’ Training â†’ Favorite preset`
3. The batch queues immediately

The gear icon on the Quick Add card opens Settings on the Training tab so you can tweak the favorites without leaving the workspace.

---

## Queue

The Queue groups jobs by batch submission. Each group expands to show its capture rows.

**Filters and controls:**
- Profile / Status / Architecture select filters
- **Expand all** / **Collapse all** buttons
- Tile row showing **Queued / Running / Done / Failed** counts in both **captures** and **batches**

**When new work is queued, finished/failed/canceled rows auto-clear** â€” the History file is the authoritative record. This keeps the Queue readable across multiple submissions.

**Controls in the now-strip:**
- **Emergency stop** â€” terminates the running Python process immediately
- **Pause after current** â€” turns amber when active. Training cannot be interrupted mid-capture, so the queue keeps the current capture running to completion then stops advancing. Click again to cancel the pause. Use Emergency stop if you need to kill the active job right away.
- **Resume** â€” appears once paused; pulses with a slow accent-ring animation while the queue is paused and there are jobs waiting, so it's easy to spot at a glance

**Batch-level controls:**
- Each batch group in the queue shows a **Run next** button when that batch's first queued job is not already at the front of the queue. Clicking it moves the entire batch ahead of whatever is waiting, so you can promote urgent work without canceling anything.

The queue persists across app restarts. Anything that was running when you closed the app comes back as `queued` with progress cleared (the Python child is gone). Staged, queued, **and finished/failed rows** all survive a restart (capped at 2000 total) so you can see what ran in the previous session alongside newly-queued work. The pause state is also saved â€” if you had paused the queue before closing, it comes back paused.

---

## Staged Batches

The **Batches** tab holds drafts saved via **Stage (save, don't run)** in Create Batch. Each batch card shows:

- An amber type-icon chip (WAVs / folder / watcher)
- The label + amber **Staged** pill
- Meta sub-line: capture count Â· profile chip Â· color-coded architecture chips Â· epochs Â· normalize Â· created date
- Routing line: output destination + DI basename
- Actions: **Edit** (re-open in Create Batch), **Delete** (with confirm), **Queue now** (move to Queue)
- Expand the card to see every WAV in the batch with its architecture chip

**Queue all** in the header moves every staged batch into the live queue.

Staged batches persist across app restarts.

---

## Live Run

The Live Run page is the real-time view of the active job.

- **ESR over epochs** chart â€” log-scale, lower is better; the green dashed line is your target ESR; updates per validation epoch via a Lightning callback NAM Lab installs into the trainer. Spikes are normal â€” see the ESR notes below.
- **Statline** â€” 4 cells: `Epoch / Rate / Validation ESR / Started`. The Val ESR cell is tone-colored (green / amber / red).
- **MRSTFT / MSE statline** â€” a secondary row showing the Multi-Resolution STFT loss (frequency-domain perceptual) and MSE (time-domain). Appears only when the trainer reports these values. For A2 batches each cell shows Full and Lite sub-model values separately (`MRSTFT (Full)` / `MRSTFT (Lite)` / `MSE (Full)` / `MSE (Lite)`). These are diagnostic â€” not needed for day-to-day use, but helpful for comparing convergence behavior across architectures.
- **Final output** â€” full path of the destination `.nam` file
- **Checkpoint export** â€” path of the Lightning checkpoint, populated once training starts
- **Up next** â€” the next 3 jobs in the queue with numbered badges
- **Raw trainer log** â€” collapsible. Shows the same output you'd see in an Anaconda shell: GPU detection, LR scheduler, Replicate ESR, V2/V3 checks, the rolling Epoch progress bar (deduped so each epoch becomes one updating line), and the final aggregate ESR. tqdm refresh frames and progress sanity checks are filtered out to keep it readable.

### Why does the ESR curve have spikes?

The chart plots true per-epoch validation ESR (NAM Lab installs a `pytorch_lightning.Callback` that emits the metric after every validation epoch end). Spikes are real but mostly cosmetic:

1. The chart is **log scale**, so a tiny absolute jump (e.g. `0.005 â†’ 0.012`) looks dramatic.
2. Validation is stochastic â€” different audio chunks per epoch give natural variance.
3. The optimizer is actively searching â€” until the LR decays significantly, every epoch makes a meaningful parameter update.

What's NOT normal: spikes that grow over time, or the curve trending up. Those mean divergence â€” bail and check your data / LR.

---

## Watcher (Automation)

The watcher monitors a folder for new WAV files and trains them automatically as they appear. Set up profiles in **Settings â†’ Training â†’ Watch Profiles**.

### Profile fields

- **Name** â€” profile label
- **Watch Folder** â€” folder to monitor
- **Linked Preset** â€” which preset (architectures, epochs, etc.) to apply
- **Watcher start mode** â€” `Process existing untracked files` or `Watch new files only`
- **Naming Template** â€” output `.nam` filename; supports `{basename}`, `{architecture}`, `{profile}`, `{esr}`
- **Model Output Root** â€” where finished `.nam` files land
- **Graph Output Root** â€” where ESR plots land (if Save graph is on)
- **Source WAV handling** â€” `Move`, `Copy`, or `Keep in place`
- **Source WAV Destination** â€” where moved/copied WAVs go

The **live path summary** at the bottom of each profile shows your actual configured destinations.

### Auto-fill

Click **Auto-fill _Processed folders** to set all three output paths to subfolders of your watch folder:
- `{watchFolder}/_Processed/Models`
- `{watchFolder}/_Processed/WAV`
- `{watchFolder}/_Processed/Graphs`

### Starting and stopping

Each profile has **Enabled** and **Auto-run** toggles. Active profiles appear in the **Watch Folders** section of the rail with start/stop controls. **Sync Now** forces a rescan.

### Re-training protection

The watcher tracks every successfully trained file using a SHA-256 hash + path + size + mtime. A file is only re-queued if its content has actually changed. Rename, copy, and same-folder duplicates don't trigger re-runs. Use **Mark current contents as seen** to skip everything currently in the folder going forward.

### Watcher Files modal

Click the file count in a watcher profile's status row to open it. Per file you can:

- See status (pending / training / done / failed / skipped)
- Sort by newest / oldest / status / name
- **Wipe output & retrain** â€” deletes the trained `.nam` and re-queues
- **Retrain as new file** â€” leaves the existing output, trains a new copy with an incremented suffix
- **Mark as skipped** â€” records the file as intentionally skipped

---

## History

Every completed, failed, or canceled run is recorded in the **History** section. Entries are grouped by batch submission and persist across app restarts.

**Top of the page:**
- **ESR quality Â· last 7 days** stacked-bar chart (green = <.01, amber = <.05, red = â‰¥.05)
- **Throughput Â· models / hour** area chart

**Filter bar:**
- Search by name or path
- Segmented status pill â€” **All / Done / Failed / Canceled**
- Profile, time range, and ESR-tone selects

**Each group header shows:**
- Batch label + source-mode badge (`Run WAVs` / `Run Folder` / `Watch folder`)
- `N done` (emerald) + `N failed` (red) counts
- Timestamp
- **Retry failed** (red, only when there are failures) â€” re-queues the failed entries
- **Retry batch** (when 2+ entries) â€” re-queues every entry

**Each row shows:**
- Tone-colored status checkmark (success), red alert icon (failure), or neutral icon
- Capture name
- Color-coded architecture chip + profile chip + epochs + duration (or red inline error message for failures)
- ESR pill (success) or status pill (failure/canceled)
- Hover actions: View ESR plot, Retry, Reveal in folder
- Clicking the row opens the ESR plot modal

### Right-click context menu

Right-click any history row for:

- **View ESR plot** (if a plot was saved)
- **Retry**
- **Reveal in folder** (if the `.nam` is still on disk)
- **Purge from historyâ€¦** â€” removes just that entry (with a confirm modal). The `.nam` file and ESR plot on disk are left alone.
- **Purge entire batch from historyâ€¦** â€” only appears when the entry belongs to a batch with 2+ entries; removes them all with a single confirm.

### Retry behavior

Retries (per-row, Retry failed, or Retry batch) rebuild jobs from the history entry's metadata and submit them as a **new batch** with a `Retry - {original label}` (or `Retry failed - {original label}`) submission. The Input DI and output formula come from your **current** Settings â€” not whatever was used originally â€” since those aren't stored on the history entry.

**Retries back up the existing `.nam` before overwriting.** If the destination already has a `foo.nam`, NAM Lab renames it to `foo.bak.nam` before writing the new model. One backup max â€” repeated retries replace the same `.bak`. This protects previously-successful models from being clobbered by a retry that happened to come out worse. Normal Create Batch / Quick Add submissions don't back up; they overwrite as before.

### ESR Quality Guide

**For A1 captures (and the A2 Full sub-model)**:

| ESR range | Quality |
| --- | --- |
| < 0.01 | **Great** â€” excellent capture |
| < 0.035 | **Good** â€” solid result |
| < 0.1 | **Acceptable** â€” may be usable depending on the source |
| < 0.3 | **Poor** â€” likely won't sound right |
| â‰¥ 0.3 | **Failed** â€” something went wrong |

**For A2 captures (aggregate ESR)**:

A2 (PackedWaveNet) packs two sub-models into one `.nam` file (Full = channels_8, Lite = channels_3). The official NAM trainer writes the **aggregate** ESR (Full + Lite summed) to `metadata.training.validation_esr`. That number is roughly 2Ã— what an A1 ESR would be for an equally-good model, because it's the sum of two sub-models' errors.

NAM Lab handles this in two ways depending on what the file carries:

- **NAM-Lab-trained A2 captures** also write `metadata.nam_lab.a2_full_validation_esr` and `metadata.nam_lab.a2_lite_validation_esr`. When those fields are present, NAM Lab uses the **Full sub-model ESR** for color coding and dashboard tallies â€” that's the sub-model the plugin loads by default, and it's directly comparable to an A1 ESR using the A1 thresholds above.
- **A2 captures from the official trainer or downloaded from a sharing site** typically only carry the aggregate. NAM Lab uses **A2-aggregate-specific thresholds (~2Ã—)** so they get a fair rating:

| Aggregate ESR | Quality (A2 only) |
| --- | --- |
| < 0.02 | **Great** |
| < 0.07 | **Good** |
| < 0.2 | **Acceptable** |
| < 0.6 | **Poor** |
| â‰¥ 0.6 | **Failed** |

The History row for an A2 capture shows the per-sub-model breakdown as separate chips (`Full 0.0050`, `Lite 0.0203`, `Agg 0.0253`) so you can see all three at once. The metadata editor's right panel shows three StatCards for A2 (`Validation ESR (A2 Aggregate)`, `Validation ESR (A2 Full)`, `Validation ESR (A2 Lite)`); for A1 it shows the single `Validation ESR` card.

> **Forward note:** the NAM project may revisit what to store in `metadata.training.validation_esr` for A2 captures (aggregate vs Full vs both). If the official convention changes, NAM Lab's tolerance bands and label may shift to match â€” but the underlying per-sub-model values in `metadata.nam_lab.*` make it possible to recover the breakdown either way.

### Target ESR (early stopping)

Setting a Target ESR tells the trainer to stop as soon as that threshold is reached, instead of always running to the full epoch count. Recommended starting value: `0.01`. Runs that stopped early are marked **"stopped early âœ“"** in the history.

---

## Dashboard

The Dashboard is the default landing tab in the training workspace. It's deliberately spacious â€” designed to be glance-able from across the room while a batch is running.

- **Hero row** â€” the active model name (34px), running indicator dot, control buttons
- **Eight stat tiles** â€” each with an icon chip and color tint:
  - **Current epoch** (accent) â€” live epoch / total
  - **Queue progress** (accent, featured) â€” captures done / total + batches breakdown
  - **Active batch** (accent) â€” current capture index / total in this batch
  - **Current ETA** (neutral)
  - **Completed** (green) â€” successful captures in the current queue (**clickable** â†’ jumps to History filtered to Done)
  - **Failed** (red) â€” failed captures in the current queue (**clickable** â†’ jumps to History filtered to Failed)
  - **Last ESR** (tone-colored) â€” pulled from the most recent successful history entry (**clickable** â†’ jumps to History)
  - **Last item took** â€” duration of the most recent successful run

- **Quick Add card** â€” drop WAVs to fire a training run with your favorite settings
- **Up Next card** â€” peek at the next few queued jobs

The Completed / Failed counters reset to 0 when a new batch is queued (because finished rows auto-clear from the live queue), and on a fresh app launch with no queued work pending. Last ESR / Last item took read from history and persist across restarts.

---

## WAV Check (Folder Panel Tab)

The **WAV Check** tab in the folder panel (right side of the main library view) compares a WAV staging folder against the current `.nam` folder and shows:

- which WAVs have a matching `.nam` (trained)
- which WAVs are missing a capture (not yet trained)
- which `.nam` files have no matching WAV

From the missing rows you can click **Train** to queue that WAV immediately or **Train All** to queue everything missing.

---

## WAV Normalization

NAM Lab can normalize WAV files before sending them to the trainer.

- Each WAV in a training pair (input DI and output amp) is normalized **independently** to a target peak (default **-5 dBFS**)
- Output is written as 24-bit PCM
- Original source files are **never** modified â€” normalized copies live in the per-run workspace
- Logged to the raw trainer log as `NAM_LAB_NORMALIZE: ...` with peak / gain details

Normalization can be enabled globally in **Settings â†’ Training** or overridden per preset / per Create Batch submission.

---

## Raw Trainer Log

The Live Run page has a collapsible **Raw trainer log** that mirrors what you'd see in an Anaconda / terminal shell â€” the exact stdout/stderr from NAM's `train(...)` call. Behavior notes:

- The Python child is launched with `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8`, `TQDM_MININTERVAL=10`, and `TQDM_ASCII=1` so tqdm behaves like a TTY in a piped stdout.
- Empty / "starting" tqdm refreshes (`Validation: 0it [00:00, ?it/s]`, `Sanity Checking: 0%|...`) are filtered out.
- Consecutive refreshes of the **same** tqdm bar (e.g. `Epoch 25:` refreshing every second) collapse into one rolling line, same visual effect as a terminal rewriting in place.
- Useful prints come through unchanged: `Using device: cuda`, `LR scheduler: ExponentialLR ...`, `Replicate ESR is ...`, `V2 checks ...`, the per-epoch ESR from the Lightning callback, and the final aggregate ESR.
- Backups during retries log `NAM_LAB_BACKUP: foo.nam -> foo.bak.nam`.

The log is selectable â€” drag to highlight, right-click â†’ Copy uses the native OS clipboard.

---

## Persistence Map

What's saved to disk and survives app restarts:

| File | Lives in | Contents |
| --- | --- | --- |
| `trainer-history.json` | `userData/` | Every completed / failed / canceled run, newest first, capped at 2000 |
| `trainer-queue.json` | `userData/` | All queue rows â€” staged, queued, running, finished, failed, and canceled â€” at last save (running jobs come back as `queued` since their Python child is gone). Also persists the pause flag so auto-start-on-launch can respect it. Throttled to one write per 2 s and flushed on quit. Capped at 2000 rows; older rows are in history. |
| `trainer-skipped.json` | `userData/` | Watcher skip records â€” files explicitly marked as skipped |
| `settings.json` | `userData/` | All app settings including watchers, presets, capture profiles, last selected preset, favorite preset / routing / input DI |
| Per-run workspace | `userData/trainer-runs/{runId}/` | Lightning checkpoints, intermediate config, normalized WAVs â€” created per job, retained by `trainingRetainGraphs` setting |

---

## Tips

- Set Target ESR to `0.01` and a generous epoch count (e.g. 1000+) so the trainer stops early on easy captures and runs long on tough ones.
- Save graph is worth keeping on â€” the ESR plot helps diagnose bad captures before distribution.
- The naming template `{basename}_{architecture}` keeps output names unique when training multiple formats from the same WAV.
- Use **Pause after current** rather than Cancel if you need to step away â€” it lets the active job finish cleanly and avoids a partial `.nam` file. Emergency stop is for actual emergencies.
- Mixed batches are cheap â€” tick `A2`, `A1 - Standard`, `A1 - REVxSTD` and produce three flavors of the same capture from a single submission.
- When in doubt about a retry, watch the `.bak.nam` file â€” if the new run's ESR is worse than the old, the backup is right there next to it.

# NAM Lab Training Guide

NAM Lab includes a built-in training workflow that runs the NAM Python trainer directly, without leaving the app. It handles single runs, batched queues, and automated folder watching — all in one place.

---

## Requirements

Before training, you need a working NAM Python environment on your machine.

- Install NAM following the [official instructions](https://github.com/sdatkinson/neural-amp-modeler)
- Note the full path to the Python executable inside that environment
  - Example: `C:\Users\YourName\.conda\envs\nam\python.exe`
- Have a **reference input WAV** — the DI reamp signal used during capture

NAM Lab does not install Python or NAM itself. It only orchestrates the trainer you already have.

---

## First-Time Setup

Open **Settings → Training**.

- **NAM Python Executable** — paste the full path to your NAM environment's Python
- **Default Input WAV** — optional default DI reference. Individual runs can override this.
- **Enable experimental training** — must be on for the Training tab to appear

Use the **Test Python** button to verify the path loads NAM correctly before trying a real run.

---

## Training Presets

Presets store a named training recipe you can reuse across manual runs and watchers.

**Fields per preset:**
- **Name** — free-form label
- **Architecture(s)** — one or more formats to generate (see Architectures below)
- **Epochs** — how many training epochs to run (1000 is a common starting point)
- **Latency** — `Auto` lets NAM detect the sample offset; `Manual` lets you specify it
- **Target ESR** — optional early-stop threshold (see ESR Quality below)
- **Save graph** — saves a validation ESR plot alongside the `.nam` file
- **Ignore trainer checks** — bypasses NAM's built-in safety validation (use with caution)

**Managing presets:**
- Click **+ Add Preset** to create a blank one
- Click the **copy icon** on any preset to duplicate it — useful for making a variant with one changed field
- Saving is blocked if two presets are exact duplicates; change at least one field first

---

## Running Training Manually

The **Training** tab lets you queue individual WAV files for training.

### Single run

1. Choose a source WAV (your captured output file)
2. Select a preset, or configure settings inline without a preset
3. Set a train destination folder
4. Click **Train** (or **Add to Queue** to batch multiple files first)

### Queue

You can queue multiple WAVs before starting. Each WAV × architecture combination becomes one job.

Example: one WAV queued against `standard` and `revxstd` = two jobs.

**Queue controls:**
- **Pause after current** — lets the active job finish, then holds
- **Cancel current** — stops the running job immediately
- **Retry failed** — requeues failed jobs
- **Clear finished** — removes completed rows from the view

Jobs run serially one at a time.

### Inline settings override

If you are not using a preset, you can configure:
- architecture(s)
- epochs
- latency
- target ESR
- save plot / ignore checks

These inline values only apply to the current queued batch.

---

## Training Watcher (Automation)

The watcher monitors a folder for new WAV files and trains them automatically as they appear.

Set up watcher profiles in **Settings → Training → Watch Profiles**.

### Watcher profile fields

- **Name** — profile label
- **Watch Folder** — folder to monitor for new WAV files
- **Linked Preset** — which training preset to apply
- **Watcher start mode** — `Process existing untracked files` or `Watch new files only`
- **Naming Template** — how the output `.nam` file is named; supports:
  - `{basename}` — source WAV filename without extension
  - `{architecture}` — architecture shortname
  - `{profile}` — preset name
  - `{esr}` — achieved validation ESR
- **Model Output Root** — where finished `.nam` files are placed (in architecture subfolders)
- **Graph Output Root** — where ESR plot images are saved (if Save graph is on)
- **Source WAV handling** — what happens to the source WAV after training completes:
  - `Move source WAV to folder below` — removes it from the watch folder
  - `Copy source WAV to folder below` — leaves original in place
  - `Keep source WAV in place` — no movement
- **Source WAV Destination** — where moved/copied WAVs go (only active when not set to Keep)

The **live path summary** at the bottom of each profile shows your actual configured destinations at a glance and updates as you change fields.

### Auto-fill

Click **Auto-fill \_Processed folders** to set all three output paths to subfolders of your watch folder:
- `{watchFolder}/_Processed/Models`
- `{watchFolder}/_Processed/WAV`
- `{watchFolder}/_Processed/Graphs`

### Starting and stopping

Each profile has an **Enabled** toggle and an **Auto-run** toggle. The watcher must also be started from the Training tab.

Use **Sync Now** (in the Folder Dashboard or Settings) to force a rescan of the watch folder without waiting for the next file event.

### Re-training protection

The watcher tracks every successfully trained file using a **SHA-256 content hash** plus path, size, and modification time. A file is only re-queued if its actual content has changed since the last successful run.

Key behaviors:
- renaming a trained WAV does not cause it to be re-queued — the hash still matches
- copying a file to a new path does not produce a duplicate training job
- moving a trained WAV into a subfolder does not trigger a re-run — the watcher only scans the top level of the watch folder

Use **Mark current contents as seen** to tell the watcher to skip all existing files and only react to new additions going forward.

### Watcher Files Modal

Click the file count in a watcher profile's status row to open the **Watcher Files** view. This shows every file the watcher knows about with:
- file name
- current status (pending / training / done / failed / skipped)
- modified date
- sort controls (newest / oldest / by status / by name)

Each file row has a **⋮ action menu** with:
- **Wipe output & retrain** — deletes the trained `.nam` output for that file and re-queues it from scratch
- **Retrain as new file** — leaves the existing output in place and trains a new copy with an auto-incremented filename suffix such as `(2)`, `(3)`, etc., to avoid overwriting the original
- **Mark as skipped** — records the file as intentionally skipped so the watcher does not queue it in future sync passes

---

## Capture Profiles (Architectures)

NAM Lab uses **Capture Profiles** to define training architectures. All 8 built-in profiles run via dynamic Python registration — no edits to `core.py` are required.

**Built-in profiles:**

| Profile | Description |
| --- | --- |
| `Standard` | Full WaveNet — highest quality, largest file, slowest training |
| `Complex` | Extended 32-channel variant — richer frequency detail |
| `Lite` | Lighter WaveNet — good balance of quality and speed |
| `Feather` | Very lightweight — fastest training, smallest file |
| `Nano` | Minimal footprint — lowest resource use |
| `REVySTD` | 5-layer reverb-capable variant, 1500 epoch default |
| `REVyHI` | 5-layer high-fidelity reverb variant |
| `REVxSTD` | 4-layer power-of-3 dilations variant |

**Custom profiles:**
- Create your own profiles with a form-based layer editor
- Clone any built-in as a starting point
- Import a `layers_configs` JSON block from a NAM-BOT preset export
- Custom profiles also run via dynamic registration — no `core.py` modifications needed
- Custom profiles are stored in app settings and available in both the Training panel and watcher presets

Each profile stores its own training parameters (LR, LR decay, epochs, batch size, NY, fit MRSTFT) so the trainer respects profile-specific values rather than hardcoded defaults.

---

## ESR Quality Guide

ESR (Error-to-Signal Ratio) measures how accurately the trained model captures the original signal. Lower is better.

| ESR range | Quality |
| --- | --- |
| < 0.01 | **Great** — excellent capture |
| < 0.035 | **Good** — solid result |
| < 0.1 | **Acceptable** — may be usable depending on the source |
| < 0.3 | **Poor** — likely won't sound right |
| ≥ 0.3 | **Failed** — something went wrong |

### Target ESR (early stopping)

Setting a Target ESR tells the trainer to stop as soon as that threshold is reached, instead of always running to the full epoch count. This can significantly reduce training time when the model converges early.

Recommended starting value: `0.01`

In the training history, runs that stopped early because the target was met are marked with **"stopped early ✓"**.

---

## Training History

Every completed job is recorded in the training history.

Each history row shows:
- model name and source WAV
- architecture
- preset / watcher profile name
- epoch count
- validation ESR with quality color coding
- whether it stopped early because the ESR target was met
- timestamp and status

**Right-click** a history row for actions:
- **View graph** — opens the ESR validation plot image in-app
- **Show .nam** — reveals the output `.nam` file in your file explorer
- **Show WAV** — reveals the source WAV in your file explorer
- **Retry run** — requeues the job using the same parameters

History can be exported to Excel or CSV from the history toolbar.

---

## WAV Check Tab

The **WAV Check** tab helps verify training coverage when you have a folder of reference WAVs and a folder of trained captures.

It compares the WAV staging folder against the current `.nam` folder and shows:
- which WAVs have a matching `.nam` (trained)
- which WAVs are missing a capture (not yet trained)
- which `.nam` files have no matching WAV

From the missing rows you can:
- click **Train** to queue that WAV for training immediately
- click **Train All** to queue all missing WAVs at once
- right-click to copy the filename or show the file in explorer

---

## Duplicate Watcher Profiles

To clone an existing watcher profile for a different folder or preset:
1. Click the **copy icon** in the profile header
2. The clone appears with `(copy)` appended to the name
3. Edit the name, watch folder, and any other fields you want to change
4. Saving is blocked if the clone is still identical to the original

---

## WAV Normalization

NAM Lab can normalize WAV files before sending them to the trainer.

**How it works:**
- each WAV in a training pair (input DI and output amp) is normalized **independently** to a target peak of **-5 dBFS**
- normalization is per-file: the DI and amp WAVs receive separate gain adjustments based on their own peak levels
- output is written as **24-bit PCM** to preserve quality
- the original source files are not modified — normalized copies are written to a temp location for the training run

This matches the behavior of "normalize each file separately" at -5 dBFS, similar to DAW export normalization workflows.

Normalization can be enabled globally in **Settings → Training** or per-preset.

---

## Tips

- Use a dedicated folder per gear or session as your watch folder — the watcher is designed to run continuously as a background intake pipeline
- Set Target ESR to `0.01` and a generous epoch count (e.g. 3000) to get the best result the trainer can achieve without spending time past the point of diminishing returns
- Save graph is worth keeping on — the ESR plot helps diagnose bad captures before you distribute them
- The naming template `{basename}_{architecture}` is useful when training multiple formats from the same WAV, so all output names stay unique
- Use **Pause after current** rather than Cancel if you need to stop a watcher mid-session — it lets the active job finish cleanly and avoids a partial `.nam` file

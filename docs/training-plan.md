# Experimental Local NAM Training Plan

> **Historical planning document.** The phases below have shipped and the training feature has
> grown well past this original scope (A2/PackedWaveNet support, Training Bundles, mixed A1+A2
> batches, a dedicated Presets page, the ignore-checks/"trained despite warnings" system, etc.).
> Some statements below — e.g. custom architectures being "explicitly deferred" — are no longer
> accurate (Capture Profiles now support custom A1 architecture import). For the current, accurate
> feature description, see `docs/training.md`, `docs/features.md`, and `docs/a2-status.md`. This
> file is kept for historical context on the original design reasoning, not as a live spec.

## Purpose

Capture the phased plan for adding a hidden/experimental local NAM training workflow to NAM Lab without depending on chat history.

This is intended to start as a quiet proof of concept and grow into a watcher-driven training pipeline later.

## High-level goal

Long term, NAM Lab should be able to:

- watch a staging folder for newly dropped output WAV files
- queue one or more selected training formats per file
- run training continuously until stopped or the queue is empty
- move processed WAVs into a user-defined processed tree
- place trained `.nam` outputs into a user-defined destination tree
- show queue state, retries, cancelation, pause-after-current, and logs

The first implementation should stay intentionally small and semi-hidden.

## Recommended runtime approach

For the proof of concept, use the official simplified trainer API from the user's installed NAM environment instead of trying to recreate NAM-BOT or driving `nam-full` directly.

Recommended approach:

- NAM Lab spawns a hidden background Python process
- no visible PowerShell or terminal window by default
- stdout/stderr are streamed into an in-app log view
- the helper process imports `nam.train.core.train(...)`
- the user points NAM Lab at the Python executable inside the working NAM environment

Why this approach:

- the user's existing presets map naturally to the simplified trainer parameters
- it avoids generating three separate `nam-full` config files in Phase I
- it stays close to the official trainer flow
- it gives us a smaller, safer first slice

## Assumptions

- the user already has a working local NAM environment
- NAM Lab should not teach installation in v1
- if the configured Python / NAM environment cannot be launched:
  - show an error
  - let the user point to the correct Python executable
  - otherwise abort cleanly
- metadata writing is out of scope for the first pass
- the feature should stay hidden or experimental at first

## Architecture support for Phase I

Built-in architectures to support first:

- `standard`
- `complex`
- `lite`
- `feather`
- `nano`
- `revystd`
- `revyhi`
- `revxstd`

Initial controls should allow:

- architecture / template selection
- epochs
- batch size
- learning rate
- learning rate decay
- `ny`
- `fitMrstft`
- optional latency override

Custom expert architectures from `.nam-bot-preset.json` files are explicitly deferred unless we later add a deeper custom-config runner path.

## Phase I - Single-file proof of concept

### Goal

Prove that NAM Lab can launch a real local NAM training run for one file and show the result cleanly in-app.

### UX shape

Add a hidden/experimental `Training` tab in the right panel, gated behind a setting such as:

- `Enable experimental local training`

### Minimal settings

- `NAM Python executable`
- optional `Default input WAV`

### Phase I panel fields

- `Input Audio`
- `Output Audio`
- `Train Destination`
- `Architecture / Template`
- `Epochs`
- optional `Latency`
- optional advanced flags:
  - `Save ESR plot`
  - `Silent run`
  - `Ignore checks`

### Behavior

When the user clicks `Train`:

1. validate paths and trainer configuration
2. launch the helper Python process in the background
3. call `nam.train.core.train(...)` with the selected values
4. stream logs into NAM Lab
5. show success or failure
6. allow opening the output folder

### Explicit non-goals for Phase I

- no watcher
- no batch multi-file queue
- no metadata editor integration
- no install/setup guide
- no public marketing of the feature
- no custom expert architecture import path

## Phase II - Manual queue without watcher

### Goal

Add practical throughput without the complexity of automatic folder watching.

### Queue model

One training job should represent:

- one source WAV
- one selected format

If the user selects one WAV and three formats, that becomes three jobs.

### Queue states

- waiting
- validating
- running
- succeeded
- failed
- canceled

### Controls

- cancel current
- remove waiting jobs
- pause after current
- retry failed
- clear finished

### Queue display

Each row should show:

- source WAV path or display name
- architecture / format
- current status
- attempt count
- output destination
- final `.nam` path on success
- log output or error summary

### Important behavior

- no true mid-training pause is expected
- `Pause after current` means:
  - let the active job finish
  - do not start the next one

## Phase III - Watched staging folder automation

### Goal

Make NAM Lab behave like a quiet local training intake pipeline.

### Watcher settings

- watch / staging folder
- processed WAV destination root
- trained model output root
- selected formats to generate
- retry count
- move/copy policy for source WAVs

### Watcher behavior

When a new WAV appears:

1. wait until file size / mtime stabilize
2. create one queued job per selected format
3. process jobs until:
   - intake is stopped
   - queue is paused after current
   - queue becomes empty

### Post-processing

After success:

- move or copy the source WAV into the processed tree
- route trained `.nam` outputs into the configured output tree

After failure:

- retry up to configured maximum attempts
- then mark permanently failed

### Runtime controls

- stop intake
- pause after current
- cancel current
- retry failed
- clear finished rows

## Helper runner design

The easiest stable implementation is a small helper Python script that:

- imports `nam.train.core.train`
- reads a JSON payload or argument file
- maps the payload to trainer arguments
- prints structured logs to stdout/stderr
- exits nonzero on failure

NAM Lab should spawn this helper from the main process using the configured Python executable in the NAM environment.

## Suggested Phase I payload shape

```json
{
  "inputPath": "C:/path/to/input.wav",
  "outputPath": "C:/path/to/output.wav",
  "trainPath": "C:/path/to/train-output",
  "modelName": "My Capture",
  "architecture": "revxstd",
  "epochs": 1000,
  "batchSize": 16,
  "ny": 8192,
  "lr": 0.004,
  "lrDecay": 0.002,
  "fitMrstft": true,
  "latency": null,
  "savePlot": true,
  "silent": false,
  "ignoreChecks": false,
  "thresholdEsr": null
}
```

This is illustrative, not final.

## Why not open a terminal window?

For Phase I, the preferred behavior is:

- background process only
- in-app logs only

This feels cleaner, keeps the feature quieter, and avoids a jarring extra console window.

If needed later, we can add an advanced debug toggle like:

- `Show external console for training jobs`

## Test scenarios

### Phase I

- valid Python path + valid WAV paths launches training successfully
- blank latency uses NAM auto-analysis
- manual latency override is passed through
- built-in architectures like `standard`, `complex`, `revyhi`, and `revxstd` launch correctly
- bad Python path produces a clear actionable error
- trainer stderr is shown in-app on failure
- no extra terminal window appears during training

### Phase II

- multiple jobs across multiple formats queue correctly
- one WAV with three formats creates three distinct jobs
- `Pause after current` lets the running job finish and prevents the next one from starting
- `Cancel current` stops the child process and marks the job canceled
- `Retry failed` requeues failed items and increments attempt count

### Phase III

- new WAVs are not queued until file writes stabilize
- one new WAV creates one job per selected format
- processed WAV routing occurs after success
- trained outputs route to the configured destination
- retries stop after the configured maximum
- `Stop intake` blocks new jobs while preserving current queue state

## Recommended build order

1. Phase I proof of concept
2. Phase II manual queue
3. Phase III watcher automation

This keeps the work grounded:

- first prove training works reliably
- then make it practical
- then make it automatic

## Notes for future implementation

- Keep this feature tucked behind an experimental flag at first
- Do not frame it publicly as a NAM-BOT replacement
- Use direct Python executable configuration first, not shell-driven `conda activate`
- Defer metadata integration until after training orchestration is trustworthy

## Important environment note

- The current local trainer environment is **not a stock NAM install**.
- `complex`, `revxstd`, and related architecture options are currently available because the local `core.py` was customized to add them.
- We should not assume those architectures exist in a normal NAM installation.

### Preset portability requirement

For the real trainer feature, NAM Lab should eventually support one of these:

1. **Stored training presets**, similar to NAM-BOT, where the app owns the architecture and learning parameters.
2. **Hard-coded internal preset definitions** for the specific formats we want to support first.

That future step matters because the long-term feature should not depend on local edits to `core.py` just to expose formats like:

- `revxstd`
- custom complex variants
- other non-stock recipes

Phase I can keep using the current customized local trainer environment, but later phases should treat preset definition and portability as a real product requirement.

# NAM Projects Guide

This covers the **NAM Projects** section (Ctrl/Cmd+3) — training and organizing NAM Capture
projects handed over from IR Lab. For browsing an IR catalog, see **IR Library Guide** in the left
menu. Training itself (the trainer workspace, batches, presets) lives in the main **NAM** section —
see **Training Guide**.

---

## 1. What a project is

A NAM Capture project is a folder IR Lab produced, containing one or more captures — a DI
recording paired with the amp/pedal return it excited, ready to train into a `.nam` file. **Add a
folder…** to add a folder of these projects; the list scans for the `.nam-capture.json` sidecar
IR Lab writes next to each capture's WAV, so nothing needs to be typed in by hand to be recognized.

## 2. The project list

- Switch between **List** and **Card** view with the icons above the list.
- Sort by name, capture count, or training progress from the sort control (list-view column
  headers sort too).
- Each project shows a coverage bar — trained vs. total captures, with synthetic (non-recorded)
  captures called out separately.

## 3. A project's header

Opening a project shows its cover image (if IR Lab captured one) and:

- **Reveal NAM Captures folder** / **Reveal _excitations** — jump straight to those folders on
  disk.
- **Open in IR Lab** — hands the project back to IR Lab, ready to capture another position, when
  the connector is configured.
- **Set Project Defaults…** — fills `modeled_by`/`gear_make`/`gear_model`/`gear_type`/`tone_type`
  once for every capture in the project that hasn't already set its own value (or been
  deliberately cleared) — a per-capture override always wins over the project default.
- **Build Pack…** — once captures are trained, auto-detects the folder their `.nam` files share
  (or lets you pick one), writes Pack Info seeded from the project's own title/description/notes,
  and can export a pack sheet — the same Pack Info a NAM-mode folder shows, filled in without
  retyping anything the project already knows.

## 4. A capture's status and actions

Each capture in a project is in one of these states, with the matching action:

| Status     | What it means                                  | Action        |
|------------|-------------------------------------------------|---------------|
| Not queued | Not trained yet, not in the training queue      | **Queue**     |
| Queued     | Waiting in the trainer's queue                   | **Remove**    |
| Training   | Actively training right now                      | **Live run**  |
| Trained    | Has a finished `.nam` file                       | **Open .nam** |
| Failed     | Training run errored out                         | **Retry**     |
| Missing    | The capture's file isn't on disk where expected  | **Relink**    |

**Queue** (and the batch version, queueing a whole selection) jumps the line in the trainer's
queue — it runs after whatever's currently training, or first if the queue is paused.

## 5. Capture detail

Selecting a capture shows its full detail: the DI/return pair, calibration levels (measured by IR
Lab's own guided calibration, not typed in here), model metadata (seeded from IR Lab's own
suggestion — editing it here is a genuine override, called out as "edited" vs. "from IR Lab"), and
a Provenance section with **Open capture in IR Lab** / **Open project in IR Lab**.

- **Rename Capture…** (right-click) renames the WAV and its sidecar files together, keeping them
  in sync — a same-basename guarantee that would otherwise be easy to accidentally break by
  renaming just one file.
- A trained capture gets a real **Play** button — opens the exact same full-viewport player NAM
  mode uses, with the trained model loaded.
- The DI and return WAVs each get a lightweight inline preview player, for a quick listen without
  opening the full rig.

## 6. Training from here

Queueing a capture (or several) sends it to the NAM trainer's own queue, visible from the
**Training** panel — this is the same queue the main NAM section's trainer workspace drives, not a
separate one. A live/in-progress run can be jumped to directly via **Live run**.

## 7. Sending to IR Lab

Both the project header and a capture's own detail panel offer **Open in IR Lab** — this hands the
project or the specific capture's session back to IR Lab (e.g. to capture another mic position),
when the connector is configured (see the status note next to the button if it's greyed out).

A curated **Group** of trained `.nam` files can also be sent to IR Lab's Player as a cycling set
from the main NAM section's Groups panel — see **Feature Reference** for that flow.

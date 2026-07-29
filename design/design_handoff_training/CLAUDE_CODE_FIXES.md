# Claude Code — Round 3. These are STILL broken after two passes. Fix ALL of them.

I re-reviewed the actual built code against the design. Good news: the off-palette cards, dashboard stat-tile icons, and `38px` values **are now fixed**. The items below are what's **still wrong**. Two of them have been on the list twice and skipped both times (the **chart data** and the **green CTAs**). Do not skip them again. Do not stop after the easy CSS swaps.

Work top to bottom. Check each box when the actual code matches.

---

## ☐ 1. THE LIVE-RUN CHART IS STILL EMPTY. This is the #1 issue and has been skipped twice.

**This is a data bug in the Python/main process, NOT a renderer or CSS bug. Stop editing the chart component — it's fine.**

### Why it's empty (confirmed in the code)
- Renderer builds `esrSeries` from `trainerState.epochValidationEsr` (`TrainingPanel.tsx:236`). That part is correct — leave it.
- `main/index.ts:1137` sets `epochValidationEsr` ONLY when the **tqdm progress-bar line** contains `val_loss=` / `val_esr=` / `ESR=` / `esr=`.
- The stock NAM trainer's tqdm bar shows **training loss** in that postfix, not validation ESR. Validation ESR is computed by Lightning at epoch end and is **not** in the bar. → `epochValidationEsr` is null almost every tick → `esrSeries` stays empty → "No data yet" forever. Parsing the tqdm bar harder will not fix this; the number isn't there.

### The fix: have Lightning print the validation ESR itself, then parse that one line.
You already monkey-patch the training config in `_run_a1_v13` / `_run_a1` / `_run_a2` (`main/index.ts` ~line 660). Add a Lightning callback the same way. The training config already declares `loss: {"val_loss": "esr"}`, so the logged `val_loss` **is** ESR.

**Step 1 — inject a callback in the embedded Python runner.** Where the trainer/`pl.Trainer` is constructed (NAM's `core.train()` builds it; attach via the `callbacks` hook or monkeypatch `pl.Trainer.__init__` to append one — whichever the installed NAM version allows). Define:

```python
import pytorch_lightning as pl, json, sys
class _NamLabEsrReporter(pl.Callback):
    def on_validation_epoch_end(self, trainer, pl_module):
        m = trainer.callback_metrics
        # NAM logs the val metric as ESR (loss.val_loss == "esr"); try common keys
        val = m.get("val_loss", m.get("ESR", m.get("val_esr")))
        if val is None:
            return
        try:
            esr = float(val.item() if hasattr(val, "item") else val)
        except Exception:
            return
        # epoch is 0-based here; renderer adds nothing, so emit 1-based to match the bar
        print("NAM_LAB_EPOCH_ESR:" + json.dumps({"epoch": int(trainer.current_epoch) + 1, "esr": esr}), flush=True)
```

Register it on the trainer. If NAM ≥0.13 hides the Trainer, the reliable shim is:

```python
_OrigTrainer = pl.Trainer
def _PatchedTrainer(*a, **kw):
    cbs = list(kw.get("callbacks") or [])
    cbs.append(_NamLabEsrReporter())
    kw["callbacks"] = cbs
    return _OrigTrainer(*a, **kw)
pl.Trainer = _PatchedTrainer
try:
    ... existing train(...) call ...
finally:
    pl.Trainer = _OrigTrainer
```

**Step 2 — parse that line in `main/index.ts`.** Next to the epoch-match block (~line 1124), add a dedicated matcher BEFORE it:

```ts
const esrReport = clean.match(/NAM_LAB_EPOCH_ESR:(\{.*\})\s*$/)
if (esrReport) {
  try {
    const { epoch, esr } = JSON.parse(esrReport[1])
    if (typeof epoch === 'number' && typeof esr === 'number') {
      trainerState = { ...trainerState, progressEpochCurrent: epoch, epochValidationEsr: esr }
      emitTrainerState()
    }
  } catch {}
  return true
}
```

The renderer already appends each `epochValidationEsr` to `esrSeries`, so the curve will populate live with no renderer change.

**Step 3 — never-empty fallback (already partly present, verify it works).** `TrainingPanel.tsx:243` seeds `esrSeries` with the final `validationEsr` on success/error. Confirm `trainerState.validationEsr` is actually set at run end (from the `NAM_LAB_RESULT:` JSON). If it is, a finished run with zero mid-run points still shows its end point instead of "No data yet".

**Verify:** start a real training run → the ESR curve draws a descending line within the first few epochs and updates live. If it's still empty, the callback isn't registering — log `trainer.callback_metrics.keys()` once to find the real metric key and adjust.

---

## ☐ 2. Primary action buttons are GREEN. They must be ACCENT. (Skipped twice.)

The design uses **one** primary-action color: the theme **accent**. Green (`emerald`) is reserved for *success status only* (done badges, ESR<0.01, the NAM-formula card). Right now primary CTAs are a mix — Quick Add is correctly `bg-nm-accent`, but these are still `bg-emerald-600`:

- `TrainingPanel.tsx:~1456` — **"Start queue"** button (now-strip).
- The **"Queue N captures"** CTA at the bottom of Create Batch (was ~line 1786 / search `bg-emerald-600`).
- Any **"Resume"** / **"Queue now"** primary buttons using `bg-emerald-600`.

Change every **primary action** button from:
```
bg-emerald-600 hover:bg-emerald-500 text-white
```
to:
```
bg-nm-accent hover:opacity-90 text-accent-text
```
(matches the Quick Add button that's already correct). Do a file-wide search for `bg-emerald-600` in `TrainingPanel.tsx` and convert each one that is a button/CTA. Leave emerald on *status* elements (badges, the NAM formula sub-card, success text).

---

## ☐ 3. Leftover gray label — `TrainingPanel.tsx:2740`

```jsx
// WRONG (only gray-* left in the training views)
<label className="text-xs font-medium text-gray-500 dark:text-gray-400">Normalize</label>
```
```jsx
// RIGHT
<label className="text-xs font-medium text-nm-text-2">Normalize</label>
```

---

## ☐ 4. The Quick Add gear button does nothing — `TrainingPanel.tsx:~1690`

```jsx
onClick={() => {/* Settings navigate — no direct link available... */}}
```
It's a dead handler. Wire it to open the app's Settings on the Training section (the same navigation the toolbar Settings button uses — call the existing settings-open action / route, e.g. `onOpenSettings?.('training')` or whatever the app exposes). A button that visibly does nothing reads as broken. If there is genuinely no programmatic settings-open, at minimum show a tooltip-only non-button (cursor-default, no hover affordance) — but prefer wiring it.

---

## ☐ 5. `ArchitectureProfilePicker.tsx` — entire file is off-palette

This component renders INSIDE Create Batch (the architecture/profile chooser) so it's part of the training UI, and it's built on raw Tailwind: `border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10`, `border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900`, `text-indigo-700 dark:text-indigo-200`, `text-gray-400 dark:text-gray-500`, `hover:text-indigo-600`, etc. It will not theme in Midnight/Blue/Light.

- Selected card: `border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-500/40` → `border-nm-accent bg-nm-accent/10 ring-1 ring-nm-accent/40`.
- Unselected card: `border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 ...` → `border-nm-border-s bg-panel hover:border-nm-accent/60`.
- Title selected/unselected: `text-indigo-700 dark:text-indigo-200` / `text-gray-900 dark:text-gray-100` → `text-nm-accent` / `text-nm-text`.
- All `text-gray-400 dark:text-gray-500` → `text-nm-text-3`; `text-gray-500 dark:text-gray-400` → `text-nm-text-2`.
- Icon buttons (lines ~94/105/116): `bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 ... hover:text-indigo-600` → `bg-field border-nm-border-s text-nm-text-3 hover:text-nm-accent` (keep the red one's `hover:text-red-500`).
- "Create profile" dashed button (~215) and add-tile: indigo/gray → `border-nm-border-s hover:border-nm-accent`, text `text-nm-text-3 hover:text-nm-accent`.
- The per-architecture top-border/dot accent colors (lines 21–28: slate/sky/blue/violet/purple/fuchsia) — these are deliberate per-arch identifiers. **Keep them** (they're a legend, like status colors), but only if they're legible in all themes; otherwise swap each to a token-safe equivalent. Your call, but don't leave indigo/gray on the *card chrome*.

> The other modals in that grep dump (BatchEditor, BatchRenameModal, BundleEditor, CaptureProfileEditor, ComboInput, FolderCardView) are **pre-existing, out of scope** for this redesign — ignore them unless asked.

---

## ☐ 6. Re-verify the things that WERE fixed didn't regress
- Create Batch: every section card neutral `bg-panel`; only NAM-formula (emerald) + Graph-formula (accent) sub-cards tinted.
- Dashboard: 8 stat tiles each with icon chip + `38px` value; hero name large.
- Batches (staged) page matches `prototype/app/batches.jsx` (amber Staged pill, settings summary, routing line, Edit/Duplicate/Delete/Queue-now, expandable capture list).
- All five themes (Charcoal, Dark, Midnight, Blue, Light) on Create Batch + Dashboard + Live Run.

---

## Final gate before you say "done"
1. Real training run → **chart draws and updates live** (item 1). If empty, you are not done.
2. `grep -nE "bg-emerald-600" TrainingPanel.tsx` → only non-button uses remain (item 2).
3. `grep -nE "(indigo|violet|cyan|sky|fuchsia|purple|gray-[0-9]|slate-[0-9])" TrainingPanel.tsx ArchitectureProfilePicker.tsx` → no matches on card/label/button chrome (items 3, 5).
4. Quick Add gear opens Settings (item 4).
5. Five-theme pass clean (item 6).

Run all five. Don't report success on a subset.

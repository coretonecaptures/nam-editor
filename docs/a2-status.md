# NAM A2 (PackedWaveNet) — Status & NAM Lab Support

## What is A2?

NAM (Neural Amp Modeler) ships two generations of model architecture:

- **A1** — the original WaveNet, with named variants (Standard, Lite, Feather, Nano, Complex, REVySTD, REVyHI, REVxSTD).
- **A2** — **PackedWaveNet**, introduced in `neural-amp-modeler` 0.13. A2 packs multiple submodel sizes into a single training run — one A2 `.nam` file contains both a **Lite** (channels = 3) and a **Full** (channels = 8) sub-model. The plugin picks at load time.

Both generations are first-class in NAM Lab. There is no separate toggle, gate, or beta flag — A2 sits next to the A1 variants in the **Architecture(s)** multi-select and can be picked, mixed with A1 in one batch, queued, retried, and tracked in history exactly like an A1 variant.

---

## Detection (read side)

NAM Lab identifies A2 files by config structure, not by the `architecture` string field (both A1 and A2 still report `"WaveNet"` there).

A2 files wrap their layer config inside a `condition_dsp` block:

```
config.condition_dsp.config.layers   ← A2
config.layers                        ← A1
```

A2 layer configs also contain fields not present in A1 (`bottleneck`, `gating_mode`, `secondary_activation`, `conv_pre_film`). NAM Lab checks for these fingerprint fields to confirm an A2 detection.

When a file is identified as A2:
- The list view shows an **A2** badge (rose chip).
- The metadata editor's Capture Stats section shows `A2` as the detected preset.
- The History row uses the A2 chip color (rose) and an A2 label.

---

## A2 Sub-Types

The official NAM project has not published named A2 sub-types (the equivalent of "Standard" / "Lite" for A1). A2 PackedWaveNet currently uses one stock config (`config_model_packed.json` in the NAM Python package) that produces a Full + Lite pair from a single run.

If the NAM team publishes named A2 variants later, NAM Lab will add them to the picker alongside the existing A2 entry.

---

## A2 Training in NAM Lab

A2 is a **selectable architecture in Create Batch**, in **presets**, and in **watcher profiles**:

| Surface | A2 status |
| --- | --- |
| Architecture multi-select | A2 appears first in the list |
| Mixed-architecture batches | Yes — A2 + A1 in one submission produces separate jobs under one shared `submissionId` |
| Presets | A2 can be the only architecture, or one of several |
| Watcher profiles | Yes — link any A2 preset to a watch folder |
| Live Run / chart / log | Identical to A1, including the per-epoch ESR callback |
| Backup-on-retry | Yes — the Retry batch button protects existing A2 `.nam` files exactly like A1 |
| History detection + ESR badging | Yes |
| Custom A2 configs (user-defined) | No — A2 always uses `config_model_packed.json` from your NAM install |

### How NAM Lab routes A2 jobs

The job's `namMode` is **derived per-job from `architecture`**: `'a2'` → `_run_a2` (PackedWaveNet), anything else → `_run_a1` or `_run_a1_v13` depending on whether the NAM install exposes the legacy `Architecture` enum.

The Python guard that used to require `requested == detected` was relaxed: modern NAM (`detected == 'a2'`) accepts A1 requests via `_run_a1_v13`. Only a genuinely incompatible request — `requested='a2'` on an A1-only NAM install — errors out.

### A2 training defaults

A2 uses the NAM package's built-in config:
- `lr = 0.004`, `weight_decay = 3.17e-7`
- `ExponentialLR(gamma = 0.994)`
- Validation metric `ESR` (also surfaced as `val_loss` in Lightning's callback metrics)

These are not edited from the NAM Lab UI when A2 is selected — the trainer handles them.

### A2 output

An A2 run produces one `.nam` file containing both sub-models (a `SlimmableContainer` with `channels_3` and `channels_8`). The file is written to whatever destination your output formula resolves to, the same as A1. The graph PNG, checkpoint, and history record are also unchanged.

### A2 ESR and tolerance bands

This is the part that surprises people: NAM's `PackedLightningModule.validation_step` logs `val_loss` as the **sum** of both packed sub-models' ESRs (channels_3 Lite + channels_8 Full), and NAM's `_plot()` returns that same `aggregate_esr = sum(esrs)` to `train()`'s output. So a "normal-quality" A2 capture lands ~2× higher on the `validation_esr` scale than an equally-good A1 capture.

NAM Lab handles this with three metadata fields and tone-band selection:

| Field | What's in it | Source |
| --- | --- | --- |
| `metadata.training.validation_esr` | Aggregate (sum of both sub-models) | Official NAM trainer convention **pre-PR #676** |
| `metadata.nam_lab.a2_full_validation_esr` | Full sub-model ESR (channels_8) | NAM Lab-only; written on every NAM Lab A2 training |
| `metadata.nam_lab.a2_lite_validation_esr` | Lite sub-model ESR (channels_3) | NAM Lab-only; written on every NAM Lab A2 training |

**Color coding rules**:
- **A1 captures**: tone uses A1 thresholds (<0.01 green, <0.05 amber) on `validation_esr`.
- **A2 captures with `nam_lab.a2_full_validation_esr`**: tone uses A1 thresholds on the **Full sub-model**'s ESR — that's the sub-model the plugin loads by default and it's apples-to-apples vs A1.
- **A2 captures with only the aggregate** (downloaded files, official-trainer files): tone uses A2-aggregate thresholds (~2× A1: <0.02 green, <0.07 amber, <0.2 red) so they get a fair rating instead of looking systematically bad.

History rows and the metadata-editor right panel both surface all three values (`Full`, `Lite`, `Agg`) for A2 captures so you can see the breakdown at a glance.

---

### Upstream ESR convention change — NAM PR #676

**Status: merged to `main` on 2026-06-08; not yet in any release. Latest release is v0.13.0 (2026-06-02).**

PR #676 ("Use mean packed metrics and remove aggregate ESR from plot") changes what NAM writes to `metadata.training.validation_esr` for A2 captures:

| | Pre-PR #676 | Post-PR #676 |
| --- | --- | --- |
| `metadata.training.validation_esr` | **Sum** of both sub-models (e.g. 0.025 if Full=0.010, Lite=0.015) | **Last sub-model ESR** — `esrs[-1]` = channels_8 **Full** (e.g. 0.010) |
| `ESR` in epoch callback metrics | Sum of both sub-models | **Mean** of both sub-models |
| "Aggregate error-signal ratio = …" stdout line | Present (printed after each training run) | **Removed** |
| Plot title | "Aggregate ESR=X.XXX (…)" | "ESR (…)" |

The problem this fixes: users and developers complained (issue #674) that A2 captures appeared ~2× worse than comparably-good A1 captures because the stored ESR was a sum rather than a per-model value.

#### What changes in NAM Lab when PR #676 ships in a release

**1. `finalEsr` at job completion — `main/index.ts` ~line 1681 — MUST FIX before users upgrade NAM**

Currently for A2:
```typescript
const aggCallback = trainerState.epochValidationEsrAggregate  // was sum, will be mean after PR
const aggFromSum  = subFull + subLite                         // our computed fallback sum
const finalEsr   = aggCallback ?? aggFromSum ?? ...
```
`finalEsr` is written to `metadata.training.validation_esr`. After PR #676, the official .nam file will contain the Full (channels_8) ESR in that field, but NAM Lab would write the mean/sum — a mismatch.

**Fix**: For A2 runs, prefer `subFull` (channels_8) directly as `finalEsr`:
```typescript
const finalEsr = isPackedRun
  ? (typeof subFull === 'number' ? subFull : aggCallback ?? aggFromSum ?? parsed.validationEsr)
  : ...
```

**2. `Aggregate error-signal ratio` stdout regex — `main/index.ts` ~line 1624 — dead code cleanup**

The line `"Aggregate error-signal ratio = X"` no longer appears in NAM output after PR #676. The `epochValidationEsrAggregate` field and its parsing regex become vestigial. Safe to remove after the release; no functional impact (the epoch callback `esr_full`/`esr_lite` values are the primary source and are unaffected).

**3. External A2 captures — `src/renderer/src/utils/esr.ts` — threshold selection**

For captures trained outside NAM Lab (no `a2_full_validation_esr` field):
- **Before PR #676**: `validation_esr` = sum → NAM Lab correctly applies loose `a2_aggregate` thresholds.
- **After PR #676**: `validation_esr` = Full → NAM Lab still sees no `a2_full_validation_esr`, still applies loose `a2_aggregate` thresholds, but now the value is "real" Full-quality ESR — so it will be rated as slightly too green compared to A1.

This is a best-effort situation. Options:
- Accept the mismatch (minor; affects only externally-trained A2 files; the captures are not mis-rated, just compared on a slightly different scale).
- Add a heuristic: if `validation_esr` < some ceiling (e.g. 0.04 — below what any aggregate sum realistically lands), treat it as Full and apply A1 thresholds.
- Longer term: define a versioned convention (e.g. `metadata.nam_lab.a2_esr_convention = 'full' | 'aggregate'`) and set it on every NAM Lab A2 write going forward, so old captures keep their existing rating and new captures use A1 thresholds automatically.

**4. NAM Lab-trained captures — no breakage**

NAM Lab-trained A2 captures always have `metadata.nam_lab.a2_full_validation_esr`, which the display logic already prefers with A1 thresholds. These are unaffected by the upstream change.

#### Summary of action items (deferred until PR #676 is in a release)

| Priority | Action | Location |
| --- | --- | --- |
| High | `finalEsr` for A2: use `subFull` not aggregate/mean | `main/index.ts` ~1681 |
| Medium | External A2 threshold heuristic or `a2_esr_convention` versioning | `esr.ts`, `main/index.ts` |
| Low | Remove dead `Aggregate error-signal ratio` regex and `aggFromSum` | `main/index.ts` ~1624, ~1681 |
| Low | Update this doc + `validation_esr` table above to reflect new convention | `docs/a2-status.md` |

---

## A2 and the `notes` Field

A2 files introduce a top-level `notes` field — an array of strings containing creator or build notes about the model. This is **separate** from the user-authored **Notes / Comments** field that NAM Lab stores in `metadata.nam_lab.comments`.

NAM Lab displays the top-level `notes` content as read-only **A2 Model Notes** in the Capture Stats section of the Metadata Editor. It cannot be edited from within NAM Lab — it lives outside the `metadata` block that NAM Lab's surgical patcher manages.

If the official A2 spec finalizes write semantics for `notes`, NAM Lab will add edit support and may merge the field with the user **Notes / Comments** field into a unified surface.

---

## A1 Is Not Going Away

All eight A1 variants (Standard, Complex, Lite, Feather, Nano, REVySTD, REVyHI, REVxSTD) remain fully supported. The dynamic Capture Profile registration system still lets you ship custom A1 architectures with their own layer configs and per-profile training params.

A1 captures and A2 captures coexist in your library without any special handling — the WAV-check tab, history, dashboards, filters, and bulk editors all treat them the same.

---

## Compatibility Notes

- **NAM ≥ 0.13** — A1 and A2 both work. A1 via `_run_a1_v13` (uses `_get_packed_model_config` monkey-patch), A2 via `_run_a2`.
- **NAM < 0.13** — only A1 works, via `_run_a1` (uses the legacy `Architecture` enum). A2 selections will error out with a clear message.
- **NAM Lab 0.6.1+** — required for mixed A1+A2 batches, the per-job `namMode` derivation, and the WaveNet layer config migration that lets old (flat `head_size`) capture profiles run on modern NAM (nested `head: {...}` schema).

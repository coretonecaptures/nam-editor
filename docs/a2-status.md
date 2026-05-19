# NAM A2 (PackedWaveNet) — Status & NAM Lab Support

## What is A2?

NAM (Neural Amp Modeler) is evolving toward a new model architecture internally called **A2**, based on a design called **PackedWaveNet**. It replaces the original WaveNet architecture (now called **A1**) with a more efficient structure that packs multiple submodel sizes into a single training run.

A1 is not going away. Both generations are expected to coexist — A1 remains the standard for most captures, and A2 will add new options when the trainer is ready.

---

## Current Status (as of May 2026)

**A2 `.nam` files exist** — test and reference captures using the A2 model structure can be found in the NAM source repository (`wavenet_a2_max.nam` and similar). These files are real and can be loaded and viewed in NAM Lab today.

**A2 training is not yet released.** The official NAM trainer does not include A2 training support in any public release as of this writing. The A2 runner code in NAM Lab is stubbed and ready but intentionally disabled until the trainer ships.

**A2 architecture string is still `"WaveNet"`** — both A1 and A2 files report `"WaveNet"` in the `architecture` field. NAM Lab detects which generation a file belongs to by inspecting the model config structure, not the architecture string.

---

## How NAM Lab Identifies A2 Files

A2 files wrap their layer config inside a `condition_dsp` block:

```
config.condition_dsp.config.layers   ← A2
config.layers                        ← A1
```

A2 layer configs also contain fields not present in A1: `bottleneck`, `gating_mode`, `secondary_activation`, `conv_pre_film`. NAM Lab checks for these fingerprint fields to confirm an A2 detection.

When a file is identified as A2, NAM Lab shows an **A2** badge (pink chip) in the file list and displays "A2" as the Detected Preset in the Metadata Editor's Capture Stats section.

---

## A2 Sub-Types

A1 has named variants — Standard, Lite, Feather, Nano, Complex, and the REV family — each with a specific channel count, layer count, and kernel size that NAM Lab fingerprints.

A2 sub-type names (the equivalent of "Standard", "Lite" etc.) have not been officially defined in any public NAM release or documentation as of this writing. NAM Lab will add named A2 sub-types to the preset detection and filter system as soon as the NAM team publishes the official architecture definitions.

---

## A2 in NAM Lab Today

| Feature | Status |
|---|---|
| Detect A2 files by config structure | Working |
| A2 badge in file list | Working |
| A2 filter in Preset / Generation filter | Working |
| A2 Model Notes display (top-level `notes` field) | Working |
| Model Size stat (reads A2 layer path) | Working |
| A2 sub-type names (Standard, Lite etc.) | Not yet — pending official NAM spec |
| A2 training via local trainer | Coming Soon — trainer not yet released |
| A2 Capture Profiles / custom A2 configs | Coming Soon — depends on trainer API |

---

## A2 Training — What to Expect When It Ships

When the official NAM A2 trainer is released, NAM Lab will enable A2 training through the same Training workspace used for A1. The expected changes:

- **Training picker**: the "A2 — Coming Soon" card in the architecture picker will become selectable
- **No custom architecture required**: A2 has its own built-in config (loaded from `config_model_packed.json` in the NAM package) — you select A2 and the trainer handles the rest
- **Single Python environment**: one `neural-amp-modeler` install will handle both A1 and A2; no separate Python path needed
- **Training params**: A2 uses `lr=0.004`, `weight_decay=3.17e-7`, `ExponentialLR(gamma=0.994)`. These will be pre-filled when A2 is selected
- **Dual output**: the packed model design trains two submodels simultaneously (a lite-class and a standard-class), so one A2 run may produce two `.nam` files
- **Capture Profiles**: user-defined custom A2 profiles may be possible once the API surface is known

---

## A2 and the `notes` Field

A2 files introduce a top-level `notes` field — an array of strings containing creator or build notes about the model. This is separate from the user-authored **Notes / Comments** field that NAM Lab stores in `metadata.nam_lab.comments`.

NAM Lab displays the top-level `notes` content as read-only **A2 Model Notes** in the Capture Stats section of the Metadata Editor. It cannot be edited from within NAM Lab, as it lives outside the `metadata` block that NAM Lab's surgical patcher manages.

When A2 and the `notes` field are finalized in the official spec, NAM Lab will add write support and potentially merge the `notes` field with the **Notes / Comments** user field into a unified editable field.

---

## A1 Is Not Going Away

All eight A1 Capture Profiles (Standard, Lite, Feather, Nano, Complex, REVySTD, REVyHI, REVxSTD) remain fully supported. The dynamic registration system NAM Lab uses to run custom A1 profiles works with any `neural-amp-modeler` version that includes the A1 `Architecture` enum — which covers all current stable releases.

A1 and A2 training presets are stored separately. Switching between them in the Training workspace does not affect your existing A1 presets or history.

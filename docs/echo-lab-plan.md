# Echo Lab — research & design notes

Not built. This is the research pass requested before any code, for a second delay unit that
hot-swaps into the Reverb rack slot the same way Chorus/Tremolo already share one slot in the
500-strip — Reverb keeps running in the background; you're toggling which *panel* is showing, not
which *effect* is active. Needs its own rack panel art (brushed metal, forest green faceplate, LCD
window — same treatment as the existing units) before it can actually go in the rig; that's a
separate TODO, not attempted here.

## Reference point: this is a Strymon Timeline-shaped request

The requested mode list — Tape, Digital, Analog, Lo-Fi, BBD — lines up closely enough with
Timeline's actual machine names (dTape, Digital, dBucket, Lo-Fi) that it's worth building from that
as a reference rather than guessing blind. Timeline ships 12 "machines": dTape, dBucket, Digital,
Duck, Trem, Filter, Lo-Fi, Dual, Pattern, Reverse, ICE (pitch-shift/shimmer), Swell. Not all of
those are relevant here, but a few explain gaps in the requested list — see "what's missing" below.

## Direct answer: is BBD the same as Digital?

No — but it's worth clarifying because it's easy to mix up which pair is redundant. **BBD
(bucket-brigade device) is what "analog delay" *is*** — a chain of capacitors passing an analog
voltage sample-to-sample, clocked, no digital conversion anywhere. It is not a variant of digital
delay; it's the thing people mean when they say "analog delay" at all (Boss DM-2, EHX Deluxe
Memory Man, Way Huge Aqua-Puss — all BBD chips, usually the Panasonic MN3005/MN3007 family).

So **"Analog" and "BBD" as separate modes are very likely the SAME mode written twice**, not BBD
vs. Digital being confused. Two ways to resolve it:

1. **Collapse them into one mode** ("Analog / BBD") — simplest, avoids a redundant menu entry.
2. **Split them on purpose** — "Analog" as an idealized warm-but-clean voicing, "BBD" as the same
   idea pushed further into the actual chip's flaws (the ~3-4kHz bandwidth ceiling real BBD chips
   have, plus their companding noise floor). This is a real, audible distinction some pedals
   (Boss DD-500's "Analog" vs a dedicated BBD emulation) do draw — but it's a deliberate design
   choice to split them, not something that falls out for free.

Recommendation: start with one collapsed mode. Split it later only if the single mode's character
turns out to want two distinct settle points.

## The requested controls, with DSP notes

| Control | Notes |
|---|---|
| **Mix** | Standard wet/dry, same as the existing Delay unit. |
| **Dual/Single mode** | Single = today's model (one feedback loop, R derived from L via a ratio, same as `RackDelay`'s existing `ratio` control). Dual = L and R become genuinely INDEPENDENT delay lines, each with its own time and feedback — not just a ratio relationship. This is the single biggest architecture change on this list: two separate `DelayNode`+feedback-loop pairs instead of one chained loop feeding a ping-pong crossfade. |
| **Left Delay / Right Delay** | Two independent time controls, only meaningful in Dual mode. In Single mode these collapse back to Time + Ratio (already built). |
| **Left Feedback / Right Feedback** | Two independent feedback amounts, only meaningful in Dual mode — each line decays independently instead of sharing one feedback loop. |
| **Mode: Tape / Digital / Analog(-BBD) / Lo-Fi** | See "signal chain per mode" below. |
| **Panner (keep)** | Reuse the existing `delayPanOsc`/`delayPanDepth`/`delayPanner` auto-pan mechanism as-is — no changes needed, just needs to sit downstream of whichever mode/dual topology is active. |
| **Modulation** | Wow/flutter-style, reusing the existing `modDepthMs`/`modRateHz` mechanism (see the El Capistan TODO — this is the same LFO-on-delayTime trick, already built). Tape mode probably wants this baked in as part of its character rather than a separately-dialed control; other modes could expose it as an optional add-on. |
| **Width** | Stereo widening on the final wet output. Two ways to get there: (a) generalize the ping-pong-width crossfade technique just built for the regular Delay unit, or (b) a proper mid-side widener (encode wet L/R to mid/side, boost the side signal, decode back) for a more transparent, level-preserving spread. (b) is more correct but is new DSP; (a) is cheap reuse but couples "width" to the ping-pong topology specifically, which doesn't fit Dual mode as cleanly. Leaning toward (b) for this unit since Dual mode needs width to mean something independent of ping-pong. |
| **Tape age** | From the El Capistan research — simulated wear (more noise/dropout/darkening over time or at higher "age" settings). Tape-mode-only; doesn't apply to Digital/Analog/Lo-Fi. |
| **EQ High/Low** | Two-band shelving on the wet output, mirroring Reverb's existing `lowDb`/`highDb` pattern exactly (`REVERB_LOW_SHELF_HZ`/`REVERB_HIGH_SHELF_HZ` in `liveEngine.ts`) — same technique, just for Delay's wet path instead of Reverb's. Sits on the FINAL mix, separate from any mode-internal tone shaping (e.g. Tape mode's own progressive darkening inside its feedback loop) — one shapes the overall effect, the other is baked into the repeats themselves. |
| **Dual mode spread** | The requested "similar to how we did panner width" pattern — a single continuous knob controlling how far Left/Right diverge in Dual mode, rather than requiring two fully independent time/feedback knobs to be set by hand every time. E.g. spread=0 → L and R times equal; spread=100% → L and R pulled maximally apart from a center time. Same UX idea as the ping-pong-width fader: one knob for "how different," not "set two numbers independently." |
| **Color/Drive** | Saturation stage — same `WaveShaperNode`-in-the-loop idea as the El Capistan tape-saturation research. Open question worth deciding at build time: pre-delay (drives what goes IN) vs. inside the feedback loop (drives repeats increasingly, so later repeats saturate more) — both are musically valid and pedals differ; leaning toward feedback-loop placement since it's what "Color" usually implies (character build-up on repeats), matching Tape mode's own saturation approach. |
| **Ducking mode** | Genuinely new infrastructure: needs an envelope follower reading the DRY input level, inversely driving a gain stage on the WET signal — loud playing ducks the repeats down, gaps let them swell back up, with separate attack (fast duck) and release (slower recovery, so it "blooms") time constants. No envelope-follower node exists in the codebase yet; would need either an `AnalyserNode`-based polling follower (like the existing meter code already does for level display) or a small dedicated `AudioWorklet`. Timeline treats Duck as its own whole MACHINE rather than a toggle available on every other mode — worth deciding whether to follow that (Duck is mutually exclusive with Tape/Digital/Analog/Lo-Fi) or make it an independent layer on top of any mode, which is more flexible than the reference hardware but also more to test. |

## What's missing — the other Timeline machines worth considering

Asked directly, so here's what else this class of "everything delay" pedal usually has that isn't
on the list yet, roughly in order of how much I'd weight them:

- **Tap tempo.** Already flagged as a gap in the El Capistan TODO, doubly relevant here — a unit
  with THIS many time-related controls (Left/Right Delay, Spread, multiple modes) is exactly where
  dialing everything by ear via knobs gets tedious fast.
- **Tempo subdivisions.** Once tap tempo exists, letting Time be set as a musical division (dotted
  eighth, triplet, quarter) relative to the tapped tempo rather than raw milliseconds is the
  natural next step — mostly a UI/labeling feature once tap tempo's underlying tempo value exists.
- **Reverse.** One of Timeline's machines, and a distinctive, easy-to-recognize effect (repeats
  play backward, tape-reverse style). Technically: write into the delay buffer normally, read it
  back reversed in chunks — meaningfully different from the other modes' "just filter/saturate the
  existing forward-read delay line" approach, so it's more implementation work than it looks.
- **Freeze.** Also a Timeline machine (and a defining feature of this whole pedal category) —
  captures whatever's currently in the delay buffer and loops it indefinitely, essentially a
  one-shot mini-looper triggered by a hold. Distinctive enough that it's worth at least flagging
  even though nobody asked for it directly; skip if scope is already too big.
- **Filtered/resonant repeats.** Timeline's "Filter" machine — repeats run through a
  sweeping/resonant filter instead of plain EQ. Lower priority; EQ High/Low already covers most of
  the "shape the repeats" want without the extra complexity of a resonant sweep.

Not relevant here and worth ruling out explicitly: Timeline's Dual machine assumes independent
STEREO input processing (two different input signals, or a stereo synth feed) — our signal source
is a mono guitar/DI signal from a NAM capture, so "Dual" here can only ever mean "two delay lines
processing the same mono input differently," not "process left and right input differently." Worth
keeping in mind so Dual mode isn't designed assuming stereo input that will never exist upstream.

## Converged control layout (supersedes the flat mode list above)

Settled after working through "how many modes," "can knobs relabel per mode," and "how do
Modulation and Pan fit" — the flat five-mode list (Single/Dual/Tape/BBD/Ducking) got replaced with
an **orthogonal** structure once it became clear a flat list either explodes combinatorially or
can't combine things a real Timeline can't either (Duck + dTape) for no real reason — software
isn't DSP-budget-constrained the way the hardware reference is.

**Three independent button-selected axes, not five mutually-exclusive modes:**
- **Topology**: Single | Dual
- **Character**: Digital | Tape | **Memory Man** (BBD)
- **Duck**: on/off toggle, layers on top of either topology/character combination

**BBD is named "Memory Man"** (EHX Deluxe Memory Man, MN3005 chip) rather than a generic
"Analog/BBD" label — it's the actual reference point for what this mode should sound like
(progressively darkening/warming repeats from each BBD stage's natural rolloff), and doubles as the
mode name and the sonic target. Explicit priority if scope ever has to shrink: **keep Memory Man
over Ducking** — Duck is a toggle, not a mode, so in the current design neither has to be cut.

**Pan doesn't need a knob.** Same call already made on the existing Delay unit: Pan is an on/off
button with a fixed sweep rate, not a continuous fader. Reusing that here is what frees up the
layout below — no dedicated Pan knob competing for space.

**Modulation ties to Character, not to a universal slot.** It's Tape's defining trait (wow/flutter),
so it gets a dedicated knob there. Memory Man gets its own "Chorus" knob instead — the real Deluxe
Memory Man has a built-in chorus/vibrato circuit, so this reuses the same mod-depth/rate mechanism
at a slower, less-warbly setting than Tape's wow/flutter, and it's true to the hardware reference
rather than invented. Digital doesn't need a modulation knob at all.

**The panel can be taller than Reverb/Delay to fit this** — confirmed OK, it just pushes whatever
rack panel(s) are below it further down when the Echo Lab panel is the one showing. This removes
the earlier constraint that forced Dual mode to fall back to fixed/baked character defaults for lack
of free knob slots — nothing needs to be faked anymore. Three knob rows:

**Row 1 — Topology (relabels Single ↔ Dual):**

| Slot | Single | Dual |
|---|---|---|
| 1 | Mix | Mix |
| 2 | Time | Left Delay |
| 3 | Feedback | Left Feedback |
| 4 | *(dim, unused)* | Right Delay |
| 5 | *(dim, unused)* | Right Feedback |
| 6 | *(dim, unused)* | Spread |

**Row 2 — Character (relabels Digital / Tape / Memory Man, independent of topology):**

| Slot | Digital | Tape | Memory Man |
|---|---|---|---|
| 1 | EQ Tilt | Wow/Flutter | Tone (bandwidth) |
| 2 | *(dim, unused)* | Tape Age | Chorus |
| 3 | Color/Drive | Color/Drive | Color/Drive |
| 4 | Width | Width | Width |

**Row 3 — Utility (always active, mode-independent):**

| Slot | Always |
|---|---|
| 1 | EQ Low |
| 2 | EQ High |
| 3 | Duck Depth *(dim unless Duck is on)* |
| 4 | Duck Release *(dim unless Duck is on)* |

**Button row:** Topology select · Character select · Duck on/off · Pan on/off.

**Knob position labels must NOT be baked into the panel art.** Checked the existing Delay panel
(`v2c-delay-panel.png`) directly — MIX/TIME/RATIO/FEEDBACK/TONE/MOD are permanently engraved into
the photo, code only drives the hover tooltip. That's tolerable for Rack500's one Width→Voicing
swap but not viable here, where up to 6 knobs relabel across two independent axes (Topology ×
Character) — printed metal that's wrong most of the time reads as broken, not as a skin. Order this
unit's plates with **blank, label-free mounting discs** (same category as the existing "no printed
scale/pointer notch" rules in `rack-ui-lessons.md` §2 — a baked label is exactly as much of a future
lie as a baked numeric range), and draw every knob label in CSS at its `centerXPct/centerYPct`,
styled to match the engraved look (small-caps, subtle inset text-shadow). Positions are measured
once against the panel image the same way every other control on it already is, so there's no
alignment risk and no per-mode art variants to generate.

This replaces the earlier "6-knob, 5-flat-mode" table further down in this doc conceptually — that
table and the flat mode list above are kept for their DSP notes (still accurate) but the control
layout itself should be read from this section, not reconstructed from the flat list.

## Generation prompt (ready to use) — v2

v1 render came back with real problems, kept below for the record. v2 fixes all four: knobs
crammed into a narrow grid with an orphaned 6th knob and a lot of dead chassis around it (fixed by
spelling out edge-to-edge full-width spacing instead of trusting "evenly spaced" alone); the bypass
switch got swallowed into the DUCK/PAN column at the same tiny size as everything else instead of
reading as the isolated, larger control every other unit in the line uses (fixed by describing it
separately, away from the mode-switch groups, at a visibly larger size); the LCD ran nearly the
full panel width while the rockers were tiny (rebalanced); and Pan Speed / Mod Rate went back to
being two vertical fader channels — the same motif `RackDelay` already uses — since v1 showed there
was real space to spend and re-adding them is a genuine upgrade over plain on/off, not scope creep
(Mod Rate reads as inert/dimmed in code when Digital character is selected, same as Delay's own Mod
Rate fader dims at zero depth).

Colour direction changed too: **olive drab** instead of forest green, with a light distressed
finish — worn but still a clean, legible studio product shot, not a wrecked prop.

> Photorealistic studio product photography of a hardware audio effects panel faceplate, shot
> flat-on with no perspective distortion (orthographic front view, spec-sheet photo — not an angled
> hero shot). Dark charcoal background (#1a1a1a), soft even studio lighting, slight vignette.
>
> Material: brushed anodized **olive drab** aluminium, fine horizontal grain, matte satin finish,
> with a **light distressed/weathered treatment** — faint edge wear at the corners and screw bosses,
> a few subtle fine scratches catching the light, slightly uneven patina in the finish. Worn-in
> field-gear character, not damaged or dirty — the engraving and controls all stay crisp and fully
> legible. Wide horizontal panel, aspect ratio **3:1**. Small Phillips-head screws in all four
> corners, each showing a touch of the same wear.
>
> Top-left: engraved silkscreen **"ECHO LAB"** in white industrial sans-serif. Immediately to its
> right, a recessed LCD window with a dark bevelled metal bezel, sized to roughly **40% of the
> panel's width** (noticeably narrower than the full header — leave real chassis margin to its
> right before the screw). Screen completely blank and unlit, dark glass with a faint dot-matrix
> pixel grid and a subtle glare reflection, absolutely no text, letters or numbers.
>
> Below the header, three horizontal bands of knobs occupying the **left 60% of the panel width**,
> each band spanning edge-to-edge across that full width with generous, perfectly even gaps —
> every knob in a band aligned in one clean row, none clustered, none orphaned or offset from the
> others:
>
> **Band 1:** six circular knob mounting plates — flush recessed metal discs, completely plain: no
> knob cap, no pointer, no alignment notch, no tick marks, no bright specular highlight in the
> centre shaft hole (should read as an evenly dark recess), and **no engraved label of any kind
> beneath any of them** — leave that metal blank, the plate is unlabeled.
>
> **Band 2:** four more knob mounting plates, identical style to Band 1, spaced evenly across the
> same full width — likewise completely unlabeled, no engraved text beneath any of them.
>
> **Band 3:** four more knob mounting plates, identical plain style to Bands 1–2, same full-width
> even spacing, but this row DOES get small engraved labels beneath each, in the same white
> industrial sans-serif as the unit name: **"EQ LOW"**, **"EQ HIGH"**, **"DUCK DEPTH"**, **"DUCK
> RELEASE"**.
>
> Right 40% of the panel, below the LCD: two vertical recessed fader channels side by side, fine
> tick marks, no fader cap or handle, small engraved labels beneath — **"PAN SPEED"** and **"MOD
> RATE"**.
>
> Below the faders: small black rectangular rocker switches recessed into bevelled housings,
> noticeably **larger than a toy switch — roughly matching the knob plates' visual weight**,
> arranged in four labelled groups — **"TOPOLOGY"** (two rockers, labelled **"SINGLE"** /
> **"DUAL"**), **"CHARACTER"** (three rockers, labelled **"DIGITAL"** / **"TAPE"** / **"MEMORY
> MAN"**), **"DUCK"** (one rocker, labelled **"ON"**), and **"PAN"** (one rocker, labelled
> **"ON"**) — each rocker with its own small **amber** backlit LED above it, lit only above the
> active switch in each group.
>
> Isolated in the panel's far top-right corner, clearly separated from the four switch groups and
> visibly **larger than every other rocker on the panel** (matching the bypass switch's prominence
> on the existing Delay/Reverb units in this same product line): one bypass rocker with its own
> larger amber LED above it.
>
> No knob caps, no fader caps, no pointer needles, and no display text anywhere on the panel. No
> engraved labels beneath any knob in the top two control bands — leave that metal blank.

**Also generate a second identical render with every LED unlit**, per `rack-ui-lessons.md` §4 —
same erase-and-overlay or lit-base-plus-unlit-overlay approach already used for Delay/Reverb,
whichever the actual pair of renders turns out to support. Keep the amber indicator colour
identical to the rest of the line.

## Generation prompt — v3

v2 landed: olive drab distressed finish, isolated oversized bypass, Pan Speed/Mod Rate faders, and
edge-to-edge Band 1 spacing all came out right and should carry forward unchanged. Three fixes for
v3:

1. **"Topology" renamed to "Mode"** on the Single/Dual switch group label — the only wording
   complaint. Character (Digital/Tape/Memory Man) keeps its name.
2. **Band 2/3's four knobs sit directly under Band 1's knobs 2–5**, not spanning their own
   independent full width. Revised again after the first pass at this fix (spanning the same
   edge-to-edge width) turned out not to be what was wanted — the ask is literal column alignment:
   Band 1's six knobs set the six column positions, Bands 2/3 use the middle four of those same six
   columns and leave column 1 and column 6 empty beneath them.
3. **Every LED lit in the reference render**, not just one example selection state. v2's lit render
   only showed Dual/Tape/Duck-On/Pan-On/Bypass lit — Single, Digital, and Memory Man never appeared
   lit in either render, so there's no lit-state pixels to cut a sprite from for those three
   positions. Sprite-cutting needs a lit sample of every single LED, matching how the original
   Delay/Reverb pair worked (one fully-lit, one fully-unlit, same framing).

> Photorealistic studio product photography of a hardware audio effects panel faceplate, shot
> flat-on with no perspective distortion (orthographic front view, spec-sheet photo — not an angled
> hero shot). Dark charcoal background (#1a1a1a), soft even studio lighting, slight vignette.
>
> Material: brushed anodized **olive drab** aluminium, fine horizontal grain, matte satin finish,
> with a **light distressed/weathered treatment** — faint edge wear at the corners and screw bosses,
> a few subtle fine scratches catching the light, slightly uneven patina in the finish. Worn-in
> field-gear character, not damaged or dirty — the engraving and controls all stay crisp and fully
> legible. Wide horizontal panel, aspect ratio **3:1**. Small Phillips-head screws in all four
> corners, each showing a touch of the same wear.
>
> Top-left: engraved silkscreen **"ECHO LAB"** in white industrial sans-serif. Immediately to its
> right, a recessed LCD window with a dark bevelled metal bezel, sized to roughly **40% of the
> panel's width** (noticeably narrower than the full header — leave real chassis margin to its
> right before the screw). Screen completely blank and unlit, dark glass with a faint dot-matrix
> pixel grid and a subtle glare reflection, absolutely no text, letters or numbers.
>
> Below the header, three horizontal bands of knobs occupying the **left 60% of the panel width**,
> laid out on **six consistent vertical columns set by Band 1** — Bands 2 and 3 reuse the middle
> four of those six column positions and leave the outer two columns empty beneath them, so every
> knob across all three bands lines up in a clean vertical grid, column by column, not just each
> row being internally even:
>
> **Band 1:** six circular knob mounting plates, one per column, evenly spaced — flush recessed
> metal discs, completely plain: no knob cap, no pointer, no alignment notch, no tick marks, no
> bright specular highlight in the centre shaft hole (should read as an evenly dark recess), and
> **no engraved label of any kind beneath any of them** — leave that metal blank, the plate is
> unlabeled.
>
> **Band 2:** four more knob mounting plates, identical style to Band 1, positioned directly beneath
> Band 1's columns 2, 3, 4, and 5 — columns 1 and 6 stay empty in this row — likewise completely
> unlabeled, no engraved text beneath any of them.
>
> **Band 3:** four more knob mounting plates, identical plain style, positioned in the same columns
> 2–5 as Band 2 directly beneath it (columns 1 and 6 empty here too), but this row DOES get small
> engraved labels beneath each, in the same white industrial sans-serif as the unit name: **"EQ
> LOW"**, **"EQ HIGH"**, **"DUCK DEPTH"**, **"DUCK RELEASE"**.
>
> Right 40% of the panel, below the LCD: two vertical recessed fader channels side by side, fine
> tick marks, no fader cap or handle, small engraved labels beneath — **"PAN SPEED"** and **"MOD
> RATE"**.
>
> Below the faders: small black rectangular rocker switches recessed into bevelled housings,
> noticeably **larger than a toy switch — roughly matching the knob plates' visual weight**,
> arranged in four labelled groups — **"MODE"** (two rockers, labelled **"SINGLE"** / **"DUAL"**),
> **"CHARACTER"** (three rockers, labelled **"DIGITAL"** / **"TAPE"** / **"MEMORY MAN"**),
> **"DUCK"** (one rocker, labelled **"ON"**), and **"PAN"** (one rocker, labelled **"ON"**) — **every
> rocker in every group shown in its lit/active state, each with its own small amber backlit LED lit
> above it** — every single LED on this panel should be lit in this render, none dark.
>
> Isolated in the panel's far top-right corner, clearly separated from the four switch groups and
> visibly **larger than every other rocker on the panel** (matching the bypass switch's prominence
> on the existing Delay/Reverb units in this same product line): one bypass rocker with its own
> larger amber LED, also lit.
>
> No knob caps, no fader caps, no pointer needles, and no display text anywhere on the panel. No
> engraved labels beneath any knob in the top two control bands — leave that metal blank.

**Then generate a second render, same exact framing/lighting/camera as the first, with every LED
unlit instead** — this pairing (all-lit / all-unlit, not "one example state" like v2's lit render)
is what the LED erase-and-overlay technique in `rack-ui-lessons.md` §4 needs: a lit sample of every
single position to cut sprites from, and a clean unlit base to erase down to metal. Worth a quick
pixel-difference check between the two once they're back, before assuming they're swappable —
independent generations can drift a few px everywhere even when asked to match.

### v1 (superseded, kept for the record)

> Photorealistic studio product photography of a hardware audio effects panel faceplate, shot
> flat-on with no perspective distortion (orthographic front view, spec-sheet photo — not an angled
> hero shot). Dark charcoal background (#1a1a1a), soft even studio lighting, slight vignette.
>
> Material: brushed anodized **dark forest green** aluminium, fine horizontal grain, matte satin
> finish. Wide horizontal panel, aspect ratio **3:1**. Small Phillips-head screws in all four
> corners.
>
> Top-left: engraved silkscreen **"ECHO LAB"** in white industrial sans-serif. Immediately to its
> right, running most of the panel's width, a wide recessed LCD window with a dark bevelled metal
> bezel — the screen completely blank and unlit, dark glass with a faint dot-matrix pixel grid and a
> subtle glare reflection, and absolutely no text, letters or numbers.
>
> Below the header, three horizontal bands of controls, top to bottom:
>
> **Band 1:** six evenly-spaced circular knob mounting plates — flush recessed metal discs,
> completely plain: no knob cap, no pointer, no alignment notch, no tick marks, no bright specular
> highlight in the centre shaft hole (should read as an evenly dark recess), and **no engraved label
> of any kind beneath any of them** — leave that metal blank, the plate is unlabeled.
>
> **Band 2:** four more knob mounting plates, identical style and spacing rules to Band 1 —
> likewise completely unlabeled, no engraved text beneath any of them.
>
> **Band 3:** four more knob mounting plates, identical plain style to Bands 1–2, but this row DOES
> get small engraved labels beneath each, in the same white industrial sans-serif as the unit name:
> **"EQ LOW"**, **"EQ HIGH"**, **"DUCK DEPTH"**, **"DUCK RELEASE"**.
>
> Far right, spanning the same vertical space as the three knob bands: small black rectangular
> rocker switches recessed into bevelled housings, arranged in four labelled groups —
> **"TOPOLOGY"** (two rockers, labelled **"SINGLE"** / **"DUAL"**), **"CHARACTER"** (three rockers,
> labelled **"DIGITAL"** / **"TAPE"** / **"MEMORY MAN"**), **"DUCK"** (one rocker, labelled
> **"ON"**), and **"PAN"** (one rocker, labelled **"ON"**) — each rocker with its own small **amber**
> backlit LED above it, lit only above the active switch in each group. Include one additional
> bypass rocker, separate from the four groups, with its own amber LED.
>
> No knob caps, no fader caps, no pointer needles, and no display text anywhere on the panel. No
> engraved labels beneath any knob in the top two control bands — leave that metal blank.

After generation: measure Band 1/2/3 knob-plate centres and the switch-group positions as
percentages of the final image, same as `RackDelay`'s `KNOB_XS`/`KNOB_Y`/`STEREO_XS` constants —
and render every knob/button label as CSS text at those coordinates rather than trusting anything
printed in Bands 1–2, since there is nothing printed there to trust.

## Proposed signal topology (sketch, not final)

```
input -> [Color/Drive, if pre-delay]
       -> split into L delay line, R delay line (Single: R derived from L via ratio; Dual: independent)
            each line's feedback loop interior depends on MODE:
              Digital   -> clean, nothing added
              Analog/BBD-> bandwidth-limited lowpass (~3-4kHz) + light saturation/noise floor
              Tape      -> wow/flutter (modDepthMs/modRateHz) + saturation + progressive darkening + tape age
              Lo-Fi     -> sample-rate / bit-depth reduction
            [Color/Drive, if inside the loop instead]
       -> merge L/R -> Width (mid-side) -> EQ High/Low (shelving) -> Panner (existing) -> [Ducking gain] -> wet output
```

Mix, and the existing Delay unit's own convolution mode, are orthogonal to all of this and don't
need to change.

## Build-order recommendation, if this gets picked up

1. Mode framework (Digital/Analog-BBD/Lo-Fi/Tape) + Mix — proves the hot-swap-with-Reverb slot
   mechanism and the per-mode signal chain shape before anything else depends on it.
2. Dual/Single + Left/Right Delay/Feedback + Spread — the real architectural piece.
3. Width, EQ High/Low, Color/Drive, Tape age — all fairly mechanical once the mode framework and
   dual-line topology exist.
4. Ducking — needs the new envelope-follower infrastructure, cleanly separable from everything above.
5. Tap tempo / subdivisions, Reverse, Freeze — nice-to-haves from the gap list, only if there's
   still appetite after 1-4.

## Still open before any of this is buildable

- The rack panel art itself (forest green brushed metal, LCD window, matching the photoreal
  treatment the existing 500-strip/Delay/Reverb panels have) — a new asset-generation pass, same
  process used for the existing panels, not attempted in this doc.
- Where Left/Right Delay, Left/Right Feedback, Spread, Tape age, Color/Drive, Width, EQ High/Low,
  and a mode selector all physically fit on one panel without it turning into a wall of knobs —
  worth sketching the panel LAYOUT before generating art, not after.

## Build status

Panel art committed (`assets/fx/echo-lab-panel.png`, the unlit render — `RackLed` draws all LED
states in CSS, so only one clean base image is needed, same as Delay/Reverb). `RackEchoLab.tsx`
built with all three knob rows, both faders, all four switch groups, and CSS-drawn font-matched
labels for Bands 1-2 (colour sampled from the panel's own real engraved text). Wired into
`PlayerPanel` sharing Delay's rack slot via `delaySlotView`.

**Font note:** the panel's engraved text was ID'd (via ChatGPT) as closely matching DIN 1451/FF
DIN — no specific font file backs it, the image model just synthesized lettering in that style.
`RackEchoLab`'s CSS-drawn Bands 1-2 labels now use a `'DIN Alternate', 'Bahnschrift', ...` stack to
get close without a new font dependency (macOS ships DIN Alternate, Windows ships Bahnschrift).
Good general advice for the NEXT plate, line-wide: generate panel art with NO text at all, then add
every label as real vector type (a proper DIN font) in code/Figma afterward — sidesteps the
generator's own typography drift entirely (it silently changed "TOPOLOGY" to "MODE" partway through
this unit's iterations) and gives perfectly crisp, consistent, editable labels instead of baked
raster text. Worth folding into `rack-ui-lessons.md` §8's template as a standing rule, not just an
Echo Lab note — not done yet, flagging for whoever next touches that doc.

**Rocker switches don't visually rock — settled, not pursuing real photographed art.** `RackButton`
is a static hit-region across the whole rack line (Delay/Reverb's switches don't tip either) — only
the LED changes state, the switch art itself never moves. Real physical rockers alternate position,
and several rounds of AI-generated attempts at a genuine "pressed down" second state (isolated
close-up, explicit hinge/tilt mechanics, wall-switch/see-saw framing, no baked text) all failed to
produce a usable or even identifiable result. Given up on the photographed version — `RackButton`'s
CSS-only `pressed` treatment (a directional inset-shadow shift, see its doc comment) is the
permanent solution: it's a real, validated, working visual difference on its own, and the LED
remains the primary, unambiguous state indicator regardless. Not worth more generation attempts
unless someone hand-illustrates or photographs a real second position later.

**If this panel is ever fully regenerated:** use press buttons (matching Delay/Reverb's own
switches) instead of rockers. The rocker choice is what created this whole rabbit hole in the
first place — a press button's on/off state is a solid-vs-inset look, not a physical tilt, so it
doesn't have this problem at all. Not worth redoing the current panel over, per explicit direction
("too late now") — logged only so the next full regen doesn't repeat the same mistake.

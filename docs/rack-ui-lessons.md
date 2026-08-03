# Building the photoreal rack UI — what to do differently next time

Written 2026-08-02, after building three units (500-series EQ/Gate/Modulation strip, Delay,
Reverb) from AI-generated panel art. Everything here is a lesson paid for once. The point of this
document is that redesigning the plates should cost an afternoon, not another full build.

The single biggest lesson is at the top because it governs everything else:

> **Specify the panel layout for the SOFTWARE, not for the photograph.** The first set of plates
> were commissioned to find out whether the idea was even possible. They are wasteful: too tall,
> too much dead metal, displays too small to say anything useful, and module widths that do not
> match. All of that is fixable in the prompt, and none of it is fixable in code.

---

## 1. Layout rules for the next set of plates

### Aspect ratio is the whole ballgame

Three units were generated at three different proportions, and it caused real problems:

| Unit | Native | Aspect | Problem |
|---|---|---|---|
| Reverb | 2076 x 758 | **2.74 : 1** | fine |
| Delay | 1774 x 887 | 2.00 : 1 | tall; wastes vertical space |
| 500-series | 1693 x 929 | **1.82 : 1** | at equal width it towers over the other two |

At a shared width, a 1.82:1 panel is **50% taller** than a 2.74:1 one. There is no code fix — the
500-series strip had to be width-capped so it did not dominate the screen, and cropping made it
*worse* (removing width makes the aspect taller still).

**Target 2.8:1 to 3.2:1 for every unit, and state the ratio explicitly in the prompt.** Units that
share a ratio can sit side by side, stack, or scale together with no special-casing.

### Put the display in the header band, beside the unit name

Currently the display sits in the lower-right of Delay and Reverb, which forces the panel taller
and leaves it narrow enough that ~14-18 characters is the practical limit. That is barely enough
for `DELAY TIME - 538MS` and not enough for most preset names.

**Next time: a wide display running along the top, to the right of the engraved unit name.** The
header band is otherwise dead metal. A display ~50% of panel width fits 30+ characters, which
means preset name *and* live value together instead of choosing between them.

### Lay controls out horizontally to kill height

Delay is tall because it stacks: knob row, then a separate lower band holding the fader channels
and the display. Its switch groups (ENGINE, STEREO) sit in a third zone top-right.

**Next time: one horizontal band.** Knobs left, switches and fader channels sharing the right —
faders beside the buttons, not below the knobs. That alone would take Delay from 2:1 to roughly
3:1 without dropping a single control.

### Keep module widths uniform

The Modulation module in the 500-series strip was made deliberately wider to hold four knobs plus
two switch groups. It reads as unbalanced next to EQ and Gate.

**Next time: identical module widths.** If Modulation needs more room, give it a taller stack or a
two-column control area within the same width, or accept a second switch row. Uniform slots are
also what makes a module swappable later (e.g. dropping an IR-loader module into a spare bay).

### Put a power switch on every unit

Delay and Reverb have no painted power switch, so on/off had to become an ordinary software
toggle beside the preset bar. That works and is honest, but a lit hardware switch on the plate
would be better, and it is one more rocker + LED in the prompt.

**Every unit needs: one bypass rocker + LED, positioned consistently across the whole line.**

### Budget the dead space

The 500-series render includes a blank fourth bay and generous chassis margin. Blank space is
fine if it is *intentional* (a logo bay), but it should be counted before generating, because it
directly reduces how large the actual controls are drawn at a given screen width.

---

## 2. What must NEVER be baked into panel art

Every item here had to be patched out by hand with PIL. All of it is avoidable by asking.

| Baked-in thing | Why it breaks | Ask for instead |
|---|---|---|
| **Display text** (`TAPE — 380ms`, `PLATE — INIT`) | Software draws live text over the glass; baked text shows through underneath | Blank dark glass with a faint dot-matrix pixel grid and a glare reflection |
| **Pointer notch on knob plates** | The knob sprite carries its own pointer; the plate's notch peeks out around it | Plain recessed mounting discs, no notch, no tick marks |
| **Bright specular rim in the shaft hole** | Reads as a white sliver escaping from under the knob | An evenly dark recess |
| **Knob caps** | We composite rotatable knobs on top | Empty mounting plates only |
| **A lit LED** | The lit state must be code-controlled | See §4 — ask for **two renders**, or all-unlit |
| **Printed scales / numbers (0-10, dB marks)** | A printed range becomes a lie the moment the code's range changes | Unlabelled tick marks at most; the value is shown on hover |

Everything in that table is one sentence in the prompt and saves an hour of pixel surgery each.

---

## 3. Knob art

### Requirements

- **True flat-lay.** Camera directly overhead, **zero visible side wall**. This is the one that
  went wrong: Console EQ came out genuinely overhead and works; Strymon Cream, Neve Red and Neve
  Grey are all slightly angled and are unusable.
- **No directional lighting.** Radially symmetric shading only (soft centre highlight or vignette).
  A knob rotates as a rigid unit, so a baked highlight swings with it and lands in a physically
  impossible place. This is why a photographed hardware knob cannot be used, and why the flat
  plugin-style knob is required.
- **Exactly one asymmetric element:** the pointer line. Knurling and flutes are fine — a radially
  periodic texture has no wrong orientation.
- **Chroma-key green (#00FF00) background.** Neutral grey sits too close to grey knobs and fringes
  when masked. Nothing in a knob is naturally green, so every variant keys cleanly.

### Prompt wording that actually worked

`"orthographic"` **did not work** — it is a CAD term, thin in the training data, and the model
reverted to flattering three-quarter product photography. What worked better:

> flat-lay product photography, camera mounted directly overhead on a copy stand, lens
> perpendicular to the top face, zero elevation angle... **none of the knob's side wall or body
> height should be visible at all**

**Shorter prompts beat longer ones.** A more prescriptive rewrite (exact ridge counts,
"not a bell curve", explicit reference-image instructions) produced *worse* results than the
simpler version. These tools do not do a strong image-lock from reference photos in this flow, so
extra constraints mostly add conflicting instructions. Take "close" and move on — fine repeated
geometry (exact flute counts) is a known weak spot and will not converge.

### Cutting knobs out — the mistake to avoid

The knob sprites were first cut as a **square centred on the silhouette**. For the angled knobs
this was wrong: their silhouettes are *taller than wide* (the extra height is side wall below the
round face), so a centred square grabbed side wall and the sprite was off-centre — white fringe
above, dark crescent below, on every knob.

**Correct method: use the silhouette's WIDTH as the diameter and align to the TOP of the
silhouette,** then apply a circular alpha mask with ~2px blur. Also strip green fringe inside the
mask (any pixel where `g > r+45 and g > b+45` → desaturate) before setting alpha.

### Sizing

Match the knob sprite to the plate's outer ring diameter, not the shaft hole. Check clearance
against the label text below — on the 500-series, 92px knobs on 110px vertical spacing was the
practical limit.

---

## 4. LEDs

Two working strategies. Which one applies depends on what the renders give you.

**Preferred — erase and overlay (used for Delay, Reverb):**
1. Erase every LED from the panel back to clean metal (see §6 for the interpolation method).
2. Cut **lens-only** on/off sprites and overlay the right one per state.

Delay was ideal because a single render contained both lit and unlit LEDs under identical
lighting — cut one of each and you are done.

**Fallback — lit base, overlay unlit (used for the 500-series strip):** when you have an all-lit
and an all-unlit render that are **not pixel-aligned** (independent generations differ by a few
pixels everywhere — verify with a difference image, doubled text is the giveaway), you cannot swap
or cross-cut them wholesale. Use the **lit** render as the base and overlay an unlit lens to switch
one **off**.

### LED rules, all learned the hard way

- **Cut lens-only, tight.** A 48px-radius sprite overwrote the `CONVOLUTION` silkscreen. A 34px
  paste of *metal-plus-LED* from one position onto another produced a visible square, because the
  panel's shadow gradient means metal at two x-positions is not the same brightness. Keep the
  sprite barely larger than the lens so the background is the panel's own.
- **Cut one unlit sprite per faceplate colour** on a multi-colour unit (navy/purple/silver), so the
  sprite's few background pixels always match.
- **Do not add a CSS glow on top of a photographed glow.** The render's own glow is already
  correct; a `drop-shadow` on top reads as blown out.
- **Check the clear region against nearby silkscreen.** A ±24px erase band smeared the `STEREO`
  heading; ±15px was correct.
- **Pin the indicator colour in the prompt.** Reverb's LED came back teal while Delay's came back
  amber, purely because one prompt specified it and the other did not.

---

## 5. Displays

- **Font: Doto** (`@fontsource/doto/500.css`) — a real dot-matrix face, not a monospace
  approximation. Amber `#ffa41f` with a text-shadow glow.
- **Size the font to the GLASS, not the panel.** Displays differ enormously between units (the
  Gate's little value window versus Delay's wide readout); a shared size overflowed the small ones.
  Current formula, in container-query units:
  `fontCqw = min(3.0, (widthPct * 0.88) / (charCount * 0.62))` — Doto is ~0.62em per character.
- **Never wrap. Truncate.** No segmented display wraps.
- **Content rule that settled well:** a loaded preset shows *only* its name (the lit LED already
  says the mode, so a `CONV - ` prefix wastes glass). With no preset: the IR name in convolution
  mode, or the headline parameter otherwise (`DELAY TIME - 538MS`).

---

## 6. Image-prep techniques (PIL)

All patching is done offline once, and the result committed as the asset. No numpy needed.

**Finding control centres — row/column profiling.** A naive column scan picks up label text and
screws. Better: count dark pixels per row within the module's x-band and take contiguous bands
above a threshold — a knob dome is a wide dark run, text is narrow and broken up.

**Erasing something from brushed metal — horizontal interpolation.** For each row, linearly
interpolate between the pixel just left and just right of the region. Preserves the horizontal
brush grain *and* the panel's shadow gradient. Used for pointer notches and LEDs.

**Erasing display text — vertical interpolation per column.** For each column, interpolate between
a clean row above and below the text. Preserves the LCD's dot-matrix grid texture, so the emptied
glass still reads as a real screen.

**Evening out a shaft-hole highlight.** Paste a Gaussian-blurred circular mask filled with the
sampled dark hole colour.

**Keying a green-screen asset.** Alpha out pure green; for fringe pixels (`g > r+40 and g > b+40`)
desaturate toward the object's own tone and soften alpha rather than deleting.

**Cut, do not regenerate.** Cropping/masking/repositioning is free and instant. Only pay for a
generation when the *content* is wrong — a missing control, wrong proportions. Repositioning,
isolating a module, or pulling one knob out of a sheet is always a cut.

---

## 7. Code architecture (this part worked — keep it)

- **Every coordinate is a percentage of its own panel image.** Measured once offline against the
  native resolution. This is what lets units of different native sizes scale together, sit side by
  side, and survive being redrawn at any width. Scaling the whole rig is one number.
- **Fonts use container-query units** (`cqw`) on a `containerType: 'inline-size'` wrapper, so text
  tracks the panel rather than the viewport.
- **Shared parts live in `RackParts.tsx`** (`RackLed`, `RackButton`, `RackDisplay`), with
  `RackKnob`, `RackFader`, `RackPower`, `RackValueTip` alongside. A new unit is geometry constants
  plus wiring.
- **Knobs rotate the whole image; faders only translate.** That difference is why knob art must be
  non-directionally lit while a fader cap may keep its highlight.
- **Button press = a dark inset overlay, not a transform.** The hit region is transparent, so
  `scale()` had nothing visible to scale and the press appeared to do nothing.
- **Inert controls dim and park at zero rather than disappearing.** An empty fader channel looks
  broken and gives no clue what the slot is for. Display-only — the stored value is untouched.
- **A native `<select>` does not fire `onChange` when you re-pick the current option.** Preset
  dropdowns must reset their own value to `""` after every pick, or reloading the preset you just
  saved silently does nothing.
- **Panels must not redefine engine behaviour.** Delay's Center/Ping-Pong/Pan were briefly
  collapsed into one exclusive three-way because the artwork grouped them; that silently turned
  ping-pong off when Pan was enabled and audibly changed the delay. The panel is a skin.

---

## 8. Prompt template for the next plate

Reuse everything except the name, accent colour, and control list, so the line reads as one family.

> Photorealistic studio product photography of a hardware audio effects panel faceplate, shot
> flat-on with no perspective distortion (orthographic front view, spec-sheet photo — not an
> angled hero shot). Dark charcoal background (#1a1a1a), soft even studio lighting, slight
> vignette.
>
> Material: brushed anodized **[COLOUR]** aluminium, fine horizontal grain, matte satin finish.
> Wide horizontal panel, aspect ratio **3:1**. Small Phillips-head screws in all four corners.
>
> Top-left: engraved silkscreen **"[NAME]"** in white industrial sans-serif. **Immediately to its
> right, running most of the panel's width, a wide recessed LCD window** with a dark bevelled
> metal bezel — the screen **completely blank and unlit**, dark glass with a faint dot-matrix
> pixel grid and a subtle glare reflection, and **absolutely no text, letters or numbers**.
>
> Lower band, left to right: **[N]** evenly-spaced circular knob mounting plates — flush recessed
> metal discs, **completely plain: no knob cap, no pointer, no alignment notch, no tick marks, and
> no bright specular highlight in the centre shaft hole**, which should read as an evenly dark
> recess. Small engraved labels beneath each: **[LABELS]**.
>
> To their right, **[N] vertical recessed fader channels** with fine tick marks, **no fader cap or
> handle**, and no labels beneath.
>
> Far right: small black rectangular rocker switches recessed into bevelled housings, in labelled
> groups **[GROUPS]**, each with a small **amber** backlit LED above it — lit only above the active
> switch in each group. Include one bypass rocker with its own amber LED.
>
> No knob caps, no fader caps, no pointer needles, and no display text anywhere on the panel.

**Also generate a second identical render with every LED unlit** (see §4), and keep the amber
indicator colour identical across every unit in the line.

# TODO

## Future project: real VST3 plugin (presets + all FX)

Feasibility assessment only, not started: `docs/vst3-plugin-assessment.md`. Verdict: a multi-month
native C++ project, not a packaging job — Web Audio nodes (all of `liveEngine.ts`) don't exist
outside a browser, so every effect (Gate/EQ/Modulation/Delay/Echo Lab/Reverb) needs reimplementing
in real-time-safe C++. The NAM inference core has a real head start (already vendored C++, and
Steven Atkinson's own official plugin is built in iPlug2 on this same DSP core) — that's the
one piece worth treating as "mostly transfers." Framework leaning: iPlug2, given that lineage.

## Echo Lab — second delay unit, shares the orange Delay's rack slot

Built and shipped: full DSP (Single/Dual topology, Digital/Tape/Memory Man Character, EQ, Ducking,
Ping-Pong, series routing with Delay), photoreal panel (`RackEchoLab.tsx`), presets in both the
popout and non-popout views. Design doc: `docs/echo-lab-plan.md`. Remaining open items:

- **Cut the stem out of the fader track (Pan Speed/Mod Rate).** The printed channel groove has a
  visible mechanical "stem"/rail running down its center; worth an image-editing pass to erase it
  (same horizontal-interpolation technique used for LED/pointer-notch removal elsewhere in this
  line) so the cap sits in a clean track rather than visually competing with a baked-in rail.
  Related to, but separate from, the cap-size/track-clearance fix already applied in code — this
  one needs the art touched, not just coordinates.
- ~~Floating view.~~ Done — `EchoLabFloatingWindow.tsx` (avoid "pop out/pop-out" in any UI text for
  this feature, per explicit direction — "Float" instead). Built as an in-page draggable floating
  panel rather than a blocking modal or a second OS window: sized to the panel's own native pixel
  width (capped to the viewport), not a smaller fixed constant — an earlier 900px version was
  actually smaller than the inline rendering already got on a wide window. Own drag handle and
  close button, no backdrop, so Delay stays fully visible and editable in the shared slot at the
  same time. Floating auto-switches the shared slot to Delay; closing switches it back to Echo
  Lab. Position isn't persisted (resets each time it's reopened) — not asked for, easy to add
  later if wanted.
- **A genuinely different (skinny) fader cap for Pan Speed/Mod Rate.** The current cap
  (`rack-fader-cap.png`, shared with Delay/Reverb) was widened to fix a "hole in the middle" gap
  against the channel's printed tick marks — but since the cap's height scales with its width
  (fixed aspect ratio), the wider cap now reaches down far enough to cover the printed "PAN
  SPEED"/"MOD RATE" labels at some fader positions. Needs a genuinely different, narrower cap
  shape (closer to a real channel-strip EQ slider) rather than further resizing the current wide
  one — new art, not a CSS tweak.
- Real alternate up/down rocker-switch art (see the "Next milestone" note in
  `docs/echo-lab-plan.md`) — still only the CSS-only `pressed` stand-in, no photographed second
  switch position exists yet.

## Tap tempo for Delay / Echo Lab time knobs

Not started. Came up while explaining that "dotted-eighth" in the Delay's Ratio knob doc comment is
just descriptive — there's no BPM or note-value math anywhere in the app (confirmed: zero
references to tempo/BPM/note-value in `liveEngine.ts` or `PlayerPanel.tsx`). Getting a quarter or
dotted-eighth delay today means dialing Time by ear and guessing at Ratio, which is exactly the
"huge gaps, can't get precise" complaint that led to knobs gaining a right-click-to-type field
(`RackKnob`'s new `typeable` prop, currently only on Delay's Time and Echo Lab's L/R Delay).

**Scoped small, per-knob — not a global session BPM.** This app isn't a DAW; there's no transport
or click track for a global tempo to lock to, and a global BPM would drag in real complexity (where
does it live, does it persist, what happens when nothing is synced to it) for no payoff over the
simpler version below. Real hardware delay pedals don't have a "BPM" concept either — their tap
footswitch sets the delay time directly from the interval between taps, which is all that's needed
here:

- **Where it lives:** extend the same right-click popover the `typeable` numeric field already
  opens on a time knob — add a "TAP" button next to the field. No new UI surface, no ambiguity
  about which knob a tap applies to (you tap the knob you're setting, same as reaching for the
  field).
- **Algorithm:** keep a small ring buffer of the last ~4-8 tap timestamps; average the intervals
  between consecutive taps to get the delay time in ms and call the knob's existing `onChange`.
  Reset the buffer if the gap since the last tap exceeds ~2s (mimics hardware's tap-timeout, so an
  old tap sequence doesn't quietly average into a new one). Clamp to the knob's own min/max — note
  Time's current 1200ms ceiling is only ~50 BPM at a quarter note, worth widening if this ships.
- **Closes the dotted-eighth loop properly:** add a few Ratio quick-pick buttons (1x even, 0.75x
  dotted-eighth, 0.667x triplet, 0.5x straight eighth) next to Ratio's own field once it's
  `typeable` too, so tapping the base quarter into Time/L Delay and clicking "dotted-eighth" gets
  the classic U2-style pattern exactly, instead of hand-tuning Ratio and eyeballing it.
- Applies to the orange Delay's Time knob and Echo Lab's Time (Single) / L Delay (Dual) — the ones
  already `typeable`. R Delay in Dual can either get its own independent tap or, more consistent
  with how Ratio already works off one base, derive from L Delay's tap the same way.

## Tape-echo character for the algorithmic Delay (Strymon El Capistan territory)

Research pass only — no new knobs, no DSP built yet. El Capistan (and the class of pedal it
belongs to — Roland Space Echo, EHX Memory Man, Boss RE-2/RE-20/DD-500's tape modes) is not just
"delay with a lowpass in the feedback loop," which is roughly what `RackDelay`'s existing `toneHz`
control already gives us. The character comes from several fairly separable pieces, each of which
is either a real DSP addition or a UI-only reframing of what's already there:

- **Wow & flutter.** Slow (wow) and fast (flutter) pitch instability from the physical tape
  transport — the read head's speed isn't perfectly constant. This is the single most
  identifiable "tape" trait and the one thing a plain lowpass can't fake. We already HAVE the
  mechanism: `modDepthMs`/`modRateHz` (`DelaySettings`) modulate the delay read head exactly the
  way tape wow does — see the existing doc comment on `modDepthMs`, "the same mechanism as tape
  wow or a BBD chorus." A tape-flavoured preset is mostly a matter of a small `modDepthMs` at a
  slow `modRateHz` (wow) — genuinely close to already-buildable with a good default, not a new
  feature. True flutter (faster, more irregular) would want a second, quicker modulation layered
  on top rather than reusing the same single LFO — that part IS new.

- **Repeats darken AND compress with each pass.** `toneHz` already darkens progressively (it's
  inside the feedback loop, so each repeat passes through it again). What's missing is the
  SATURATION side — real tape compresses and adds harmonic distortion as it's driven, and that
  compounds through repeats the same way the tone filter does. A soft-clip `WaveShaperNode`
  inside the feedback loop (same position as `delayDamp`) would give this; needs its own amount
  control (this is what El Capistan's "Bias" knob does — a clean-to-heavily-saturated range) and
  careful gain-staging so it makes repeats characterful rather than just loud/harsh.

- **Multi-head mode.** The real hardware's biggest structural feature: multiple physical
  playback heads at different tap positions along the tape, so one input produces several
  differently-timed, differently-weighted repeats at once — rhythmically far more interesting
  than a single feedback tap. `pingPongWidth` (just built) proves the "more than one simple
  on/off" pattern works well as a fader; a proper multi-tap mode would need actual new delay taps
  (more `DelayNode`s at fixed ratios of the main time, individually leveled), not a repurposed
  existing control — this is the biggest single piece of new engine work in this list.

- **Sound-on-sound / looping mode.** Feedback pushed toward and effectively AT unity, turning the
  delay into an overdub loop rather than a decaying echo. `MAX_FEEDBACK` (`liveEngine.ts`) is
  deliberately clamped to 0.9 specifically to prevent runaway buildup — a real "sound on sound"
  mode is a different, deliberate contract (accept that it doesn't decay, or decays extremely
  slowly) rather than just raising that ceiling, which would also make the ordinary feedback knob
  dangerous to over-turn.

- **Tap tempo.** Not tape-specific, but the kind of thing you'd expect on any delay in this class
  and we don't have it — dialing `timeMs` by ear via the knob works but is nothing like tapping a
  rhythm. Would need a footswitch-equivalent (spacebar? a UI tap target?) measuring interval
  between taps and writing it to `timeMs`. Independent of everything else on this list.

- **Built-in spring reverb tail.** El Capistan bundles a spring reverb specifically for blending
  with the echo (not a general-purpose reverb unit). We already have a full separate Reverb rack
  unit, so this is really "can Delay's wet output feed Reverb's input for this one use case," not
  a new reverb implementation — lower priority since the two units already coexist in the same
  rig and can already be used together, just not pre-blended into one control.

Priority if this gets picked up: wow/flutter first (cheapest, reuses existing modulation
machinery, and is the most identifiable trait), tape saturation second (one new node, clear
payoff), multi-head last (genuinely new topology, biggest scope).

## Swap Bass and Treble on the 500-strip EQ

Currently top-to-bottom: Bass, Middle, Treble (`Rack500.tsx`, `EQ_KNOB_YS` indices 0/1/2, each
knob's own `label`). Most real rack EQ units run the other way — Treble on top, Bass on bottom.
Not just a label swap: the knob at `EQ_KNOB_YS[0]` (top position) needs to become Treble's
`onChange`/`value` (currently Bass's), and vice versa for `EQ_KNOB_YS[2]` — the position on the
panel and which parameter it controls have to move together, or the labels would say one thing
and the knob would adjust another.

## DONE (2026-08-21): macOS code signing + notarization — unblocks reliable safeStorage (keychain)

**Status**: Developer ID Application certificate obtained and installed (Team ID `G72M3ADC6N`),
App Store Connect API key generated for notarization, all six values (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`) set
as GitHub Actions secrets. `build/entitlements.mac.plist` added; `package.json` `build.mac` now
sets `hardenedRuntime`/`entitlements`/`entitlementsInherit`/`extendInfo.NSMicrophoneUsageDescription`.
`.github/workflows/release.yml`'s `build-mac` job rewritten to sign + notarize for real (dropped
the old ad-hoc `codesign --sign -` + `--prepackaged` two-pass dance) with a
`codesign --verify` + `spctl -a -t install` check. Not yet verified against a real tagged release
build — that's the next step (see "What to obtain" section below for the original plan, kept for
reference).

Also fixed alongside this, from "Related problems found while planning" below: `storeAiKey` now
refuses (throws, surfaced to the user via the existing save-key error UI) rather than silently
writing an unencrypted key when `safeStorage` is unavailable; `saveTone3kTokens` keeps its
plaintext fallback (background OAuth flow, no UI to report through) but now logs a loud warning;
`NSMicrophoneUsageDescription` got a real sentence instead of Electron's placeholder.

**`safeStorage` is already built and working** — this is not new code, it is a *release
engineering* problem. Two things already use it (`src/main/index.ts`):

| What | File in userData | Function |
|---|---|---|
| Tone3000 OAuth tokens | `tone3000-tokens.bin` | `loadTone3kTokens` / `saveTone3kTokens` |
| AI provider keys (Anthropic/OpenAI) | `ai-key-{provider}.bin` | `storeAiKey` / `readAiKey` / `clearAiKey` |

### Why an Apple Developer account is genuinely required

On macOS, `safeStorage` encrypts with an AES key it stores in the **login Keychain**. Keychain
ACLs are bound to the app's **code signing identity** — not its path or bundle ID. Today CI does
an **ad-hoc signature** (`.github/workflows/release.yml`: `codesign --deep --force --sign -`),
which has no Team ID and produces a *different* identity on every single build.

Consequence: to macOS, each NAM Lab update is a different app. After updating, the new build
cannot read the keychain entry the old one created, so **users silently lose their Tone3000
login and AI keys on every update** (the code catches the failure and falls through to "no saved
tokens", so it looks like being logged out rather than an error). A Developer ID certificate
gives one stable identity across all builds, which is what makes stored secrets survive updates.

Same account also fixes Gatekeeper: unsigned/ad-hoc DMGs currently need right-click → Open or
`xattr -d com.apple.quarantine`. Notarization removes that.

### What to obtain (user)

1. **Apple Developer Program** membership — $99/yr, can take a day or two to approve.
2. **Developer ID Application** certificate (NOT "Mac App Distribution" — that is for the App
   Store). Export as `.p12` with a password. Developer ID *Installer* is not needed, since we
   ship a DMG rather than a `.pkg`.
3. **App-specific password** (appleid.apple.com) or an **App Store Connect API key** for
   notarization. API key is preferable for CI — it does not break when the Apple ID password
   changes.
4. Note the **Team ID** (10-character string, visible in the developer portal).

### Work to do (code/config)

1. **New `build/entitlements.mac.plist`** — Hardened Runtime is mandatory for notarization, and
   Electron does not run under it without these:
   - `com.apple.security.cs.allow-jit` — V8.
   - `com.apple.security.cs.allow-unsigned-executable-memory` — V8 again.
   - `com.apple.security.device.audio-input` — **required or Live mode's mic breaks entirely.**
   - `com.apple.security.cs.disable-library-validation` — probably unnecessary (no native deps;
     `dependencies` is pure JS) but standard for Electron; try without it first.
2. **`package.json` build.mac additions**: `hardenedRuntime: true`, `gatekeeperAssess: false`,
   `entitlements` + `entitlementsInherit` pointing at the plist above, and `notarize: { teamId }`.
3. **Rewrite the mac CI job** — delete the ad-hoc `codesign --sign -` step and the
   `--prepackaged` DMG dance it forces; with a real certificate, electron-builder signs and
   notarizes in one normal `--mac dmg --universal` run. Drop `CSC_IDENTITY_AUTO_DISCOVERY: false`
   from the mac job (keep it on Windows/Linux).
4. **GitHub secrets**: `CSC_LINK` (base64 of the `.p12`), `CSC_KEY_PASSWORD`, plus either
   `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` or
   `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`.
5. **Verify** on a real download (not a local build): `codesign --verify --deep --strict`,
   `spctl -a -vvv -t install`, then confirm Tone3000 login survives installing a *newer* build
   over an older one — that last one is the actual point of the exercise.

### Related problems found while planning (worth fixing at the same time)

- **Plaintext fallback is a real security hole.** `storeAiKey` and `saveTone3kTokens` both fall
  back to writing the secret **unencrypted** when `safeStorage.isEncryptionAvailable()` is false.
  An API key sitting in cleartext in userData is worse than refusing to save. Should either
  refuse and tell the user, or at minimum surface a warning — silently writing plaintext is the
  wrong default. Most likely to bite Linux AppImage users with no libsecret/gnome-keyring.
- **Microphone purpose string is Electron's placeholder.** There is no `extendInfo` in the build
  config, so the packaged app inherits Electron's generic
  `"This app needs access to the microphone"`. Should be a real sentence explaining Live mode.
  Cheap to fix via `build.mac.extendInfo.NSMicrophoneUsageDescription`.
- **One-time migration cost.** The first properly-signed build is a new identity, so existing
  users lose stored tokens/keys *once* and must re-authenticate. Unavoidable, and it fixes
  itself forever after. Worth a line in the release notes rather than letting it look like a bug.
- **Windows and Linux need nothing here.** Windows `safeStorage` uses DPAPI (tied to the user
  account, no signing involved); Linux uses libsecret. Only macOS binds to code identity.

---

## DONE (2026-08-02): Chorus -> Modulation with Tremolo + Harmonic Tremolo

Rename the Chorus block to **Modulation** and add a mode switch between **Chorus** (existing) and
**Tremolo** (new), rather than a separate FX block — both are "vary something about the note over
time" effects sharing the same rate/depth/LFO-shape territory, not unrelated effects that happen to
sit next to each other. Also good timing: the rack UI work already means this module needs a
mode-selector switch like Delay/Reverb have, so this is the moment to fold tremolo in rather than
treat Chorus as a single-purpose block forever.

**Tremolo, standard**: amplitude modulation via an LFO-driven `GainNode`, the same
oscillator -> depth-gain -> target pattern already used for the chorus LFO and the delay's auto-pan
in `liveEngine.ts` — just targeting an output gain stage instead of delay time or pan. Depth and
Rate are the two controls a real Fender tremolo circuit exposes (labeled "Intensity" and "Speed"
on the amp panel).

**Harmonic tremolo, if feasible**: the real trick behind the "vibrato channel" on silverface Fender
amps (Twin Reverb, Deluxe Reverb, etc.) — Fender's own panel calls it "Vibrato" but it's actually
harmonic tremolo, not pitch vibrato, a naming mix-up worth getting right in our own UI. It splits
the signal into low and high bands through a crossover filter pair, then tremolo-modulates each
band with LFOs 180° out of phase — as the low band swells the high band dips and vice versa. That
phase relationship is what gives it the shimmer/coloring plain tremolo doesn't have. More DSP than
standard tremolo (two filters, two gain stages, a summing mixer) but nothing novel relative to
what's already in the engine.

**Architecture note**: build both tremolo variants (and chorus) as parallel branches selected by
gain, matching the established pattern already in this codebase (ping-pong/mono, plate/convolution
reverb) rather than reconnecting the live graph, which clicks.

**Open**: knob labels. Real hardware can't relabel a knob's silkscreen text depending on mode, but
Mix/Depth/Rate apply to both Chorus and Tremolo, while Chorus's Width knob has no Tremolo
equivalent (classic Fender tremolo is mono/uniform, not stereo). Either drop to 3 knobs that work
in both modes, or accept the 4th knob's *function* changes by mode and give it a code-rendered
label instead of baked silkscreen text — same principle already established for LCD/preset text
living outside the panel image rather than baked into it. See the rack-prompt mapping below.

**Rack panel impact** (for whenever the Modulation module's prompt gets regenerated):
1. Rename the engraved label from "CHORUS" to "MODULATION".
2. Add a 2-way switch group — "TYPE": CHORUS / TREMOLO — with an LED per option, grouped the same
   way Delay's ENGINE/STEREO switch rows are (small group label above a row of small switches).
3. Add one more small toggle+LED, "HARMONIC", meaningful only in Tremolo mode (dim/inert in
   Chorus mode, same as Delay's Ratio knob going inert outside Ping-Pong).
4. Keep Mix/Depth/Rate baked as knob labels (valid in both modes); drop Width or leave that 4th
   knob's printed label blank/neutral and render its live name in code, matching the LCD/preset
   text convention.
5. Space: this pushes Modulation from the simplest module in the strip to the second-busiest
   after Gate — it now needs two switch groups plus a toggle+LED, so it may need to be a touch
   wider than EQ's slot rather than forcing everything into the same narrow column.

**Built.** Both circuits ship: standard amplitude tremolo and harmonic (brownface) tremolo, with
a Chorus/Tremolo type switch and a Harmonic toggle. Rate is shared between chorus and tremolo —
both are just an LFO frequency, and the real Fender circuit has one Speed knob driving both
variants — while depth is separate (`depthMs` in milliseconds for chorus, `tremoloDepth` 0..1 for
tremolo). The UI label is "Modulation"; the internal type stays `ChorusSettings`, since renaming
it would churn the FX-preset system and a persisted localStorage key for no functional gain.

**One DSP correction worth recording.** The first version routed standard tremolo through the
harmonic crossover with both bands modulated in phase, on the assumption that a lowpass and
highpass at the same corner sum back to flat. They do not — the phase relationship digs a notch
at the crossover, so plain tremolo came out tone-coloured. Standard now modulates the full-band
signal on its own path and the crossover is harmonic-only. The crossover Q was also dropped below
Butterworth on purpose: the overlap is not a defect to minimise, it is what produces harmonic
tremolo's phasing character.

Resolved along the way: the knob-label mismatch is handled by Mix and Width simply going inert in
Tremolo mode, exactly as a mode-specific knob does on real hardware. Width is exposed in both the
flat slider UI and the rack panel.

---

## DONE: Play groups — save a shortlist of captures and audition just those, back and forth

**Implemented** (`b33f432`, commit message: "Add play groups — hand-picked cross-folder shortlists
for A/B comparison"). `GroupsAdminPage.tsx` and `AddToGroupPopover.tsx` exist, wired into
`PlayerPanel.tsx`, `App.tsx`, and `types/settings.ts`. Original brainstorm kept below for design
rationale.

Comparing a handful of captures today means finding them again by scrolling/searching the tree or
Tone Map each time there's a new one to add to the comparison. **Wanted:** a lightweight, named
group — add captures to it from anywhere in the library (crosses folders, not a single-folder
scope) — then open the player already scoped to just that group, and step forward/back through
only its members with the existing prev/next stepper (`onStep`/`stepIndex`/`stepCount` in
`PlayerPanel.tsx`, currently fed by `visibleFiles` in `App.tsx`) rather than every visible file.

- Works with either audition mode already in the player — the rendered Preview clip or the live
  looped DI — since a group is just a different *set of files* to step through, not a new
  playback mechanism.
- "Add to group" needs a UI entry point somewhere captures are already selectable — FileList
  multi-select context menu is the obvious first one; Tone Map is a natural second, since that's
  where someone is most likely to be comparing tones by ear already.
- Storage: a named list of file paths, most likely `AppSettings` alongside the other named lists
  (`userCaptureProfiles`, the FX presets) rather than per-folder state, since the whole point is
  crossing folder boundaries.

Open questions:
- Multiple groups at once, or one scratch group you keep replacing? Multiple named groups is more
  useful (build a "maybe" shortlist while still comparing others) but is also the bigger UI lift.
- What happens when a grouped capture is moved, renamed, or trashed — does the group silently
  lose it, or flag a broken entry?
- Should stepping through a group loop (last -> first) rather than stop, given the whole use case
  is rapid back-and-forth comparison rather than working through a list top to bottom?

---

## Play a DI clip THROUGH the live FX rig (not just a live guitar)

Today the two modes are separate: Preview renders a DI clip offline through the model, and Live
plays your guitar through the model plus the whole FX rack. There is no way to hear a **DI clip**
running through the live rack — which is what you want when you have no guitar to hand, or when
you want the exact same performance while you dial delay and reverb by ear.

Noted while building the redesigned player: the Setup drawer originally carried a DI-source
picker, which was cut because in Live you are playing a guitar and the DI is irrelevant. But if
this feature is built, the DI picker stops being drawer clutter and becomes a primary control —
it belongs **front and centre**, near the transport, not hidden behind a gear icon.

Sketch: feed the decoded DI buffer into the live graph in place of the mic input
(`AudioBufferSourceNode` -> the same node the mic source feeds), loop it, and leave the rest of
the chain untouched. The engine already normalises and resamples DI clips for Preview
(`playerAudio.ts`), so most of the loading work exists. The open question is transport — a
looping clip needs play/stop/scrub, which the Live view currently has no room for.

---

## Live recorder — DI to mono, post-FX to stereo

Record what's actually happening in Live mode to disk, not just monitor it. Two independent
tracks, each optional:

- **DI track**: the raw input, tapped before the gate — mono, one file per take. This is the
  reference DI other tools (or a re-amp later) would want, and it's exactly the signal already
  available at `this.splitter` in `liveEngine.ts`, before anything in the chain touches it.
- **Post-FX track**: everything after `outputGain` — stereo, capturing the model plus the whole FX
  chain (gate/EQ/chorus/delay/reverb) as actually heard.

**Scoped 2026-08-02 — roughly a day. Not conceptually hard, but five separate pieces, two with
real gotchas.**

### The decided approach

**`MediaRecorder` is the obvious route and it is the wrong one.** It only emits compressed
container formats (webm/opus in Chromium) — there is no way to get WAV out of it. For a NAM tool
whose whole point is that the DI track is re-ampable reference material, lossy is disqualifying.
So recording has to be an **AudioWorklet that accumulates raw Float32 and posts blocks to the
main thread**. That single decision is the difference between an afternoon and a day, and it is
worth writing down because `MediaRecorder` will keep looking tempting.

### What already exists

- **Both tap points are in place and named**: `this.splitter` (raw input, pre-gate, mono) and
  `outputGain` (post-everything, stereo) in `liveEngine.ts`. Both are read-only branches, so
  nothing here can break existing playback.
- **Worklet infrastructure is well-trodden** — `public/` already holds four (`nam`, `nam-offline`,
  `reverb`, `gate`), so a fifth follows a known path.
- **Settings pattern is copy-paste**: a `recordingsPath` alongside `diPreviewLibraryPath` /
  `irLibraryPath` / `reverbLibraryPath`, with a folder picker in Settings → Player.
- `LiveEngine.latencyMs` is already exposed (see the alignment question below).

### What does not exist yet

- **There is no binary-write IPC channel at all.** `file:writeMetadata` is the surgical text
  patcher, not a general writer. This needs a new channel plus a main-process handler, following
  the existing `file:*` convention.
- WAV encoding — about 50 lines, no dependency. RIFF header plus interleaved PCM.

### The two real gotchas

1. **Memory and IPC payload size.** Stereo 48k float32 is ~23 MB per minute, so a ten-minute take
   is ~230 MB sitting in the renderer and then crossing IPC in one shot. Converting to 24-bit PCM
   before sending roughly halves it. For v1: accumulate and send on stop, with a length cap and a
   warning. Incremental streaming to the main process is the follow-up, not the starting point.
2. **DI and post-FX are tapped at different points, so the post-FX track lags by the model's
   latency.** `latencyMs` makes compensating easy *if we decide to* — and that is a product call,
   not a technical one. Aligning them makes the pair usable for re-amping; leaving them raw is
   more honest about what actually happened. Decide before building, not after.

### Format

- WAV first — no encoder dependency, and an exact match for what NAM captures ship as.
- **MP3 explicitly deferred** ("future option") — needs a real encoder (e.g. `lamejs`), which is
  new dependency weight for a compression step nobody has asked for.
- Where files land and how they are named: a dedicated recordings folder in Settings → Player,
  most likely, rather than alongside the capture being played.

Open questions: start/stop tied to transport play/stop, or an independent record-arm toggle?
Does starting the DI/post-FX record together make sense as one button, or should they be
independently armable given they're genuinely different use cases (reamp material vs. "how did
that just sound")?

---

## DONE (first simple build, 2026-08-03): Chain two NAM captures live — "pedal into amp"

Feed one capture's output into a second capture's input, live — e.g. an overdrive/fuzz pedal
capture feeding an amp capture, both being NAM models. Live-mode-only; Preview still renders
offline through a Worker with its own single-model path, untouched.

Built: `liveEngine.ts` takes an optional `preModelJson` + `preGain`, instantiates a second
`nam-processor` `AudioWorkletNode` ahead of the main one, and wires
`gate -> preWorklet -> preGainNode -> worklet -> fxInput`. `preGainNode` is a plain GainNode, not
inside either model, specifically so the drive into stage two can be ramped from a knob live
without reloading anything. UI: the identity band's "+ PEDAL CAPTURE" chip is now a real file
picker (`window.api.openFiles`, `.nam` filter); once something is loaded it shows the capture's
name with a × to clear, and a "Drive" JogWheel appears in the master dock (only then — no point
showing a knob for a stage that isn't loaded). Picking/clearing restarts the engine like switching
the main capture does; the drive knob itself does not restart anything.

**Still the open question, unchanged from before, and now testable:** whether this sounds like
anything usable. A NAM capture is trained on clean guitar in, not on another model's output —
that mismatch is exactly why the drive trim exists, so you can find out by ear whether some
setting makes it work. No gain-staging heuristics or auto-leveling were added; this is
deliberately just "wire it up and listen," per the plan to prototype before investing further.

Not done: no persistence (pedal-capture choice resets each session), no indicator in the
signal-chain rail beyond the chip itself, no live model-swap without a restart (mirrors the
existing single-capture behavior, not a regression).

---

## DONE (verified 2026-08-01): switching captures already keeps the FX rig locked

Checked rather than built — this already works. `PlayerPanel` is deliberately not remounted when
`file` changes (comment at the call site: "the panel handles file changes internally instead"),
and Gate/EQ/Chorus/Delay/Reverb all live in that one component's React state. Switching to a
different capture while Live is running only reloads the model
(`useEffect(() => { if (liveRunning) void startLive() }, [file.filePath])`,
`PlayerPanel.tsx:1318-1321`) — it does not touch any FX state, so `startLive()` re-sends whatever
the rig currently is. Change amps, keep the whole rig, exactly as asked.

Two things intentionally still vary per capture, and should keep doing so:
- **Cab IR auto on/off** — follows each capture's `gear_type` (`needsCabIr`) unless the user has
  manually toggled it this session (`irManuallySetRef`), which then locks it regardless of what
  the next capture would normally suggest.
- **Output normalize gain** — recalculated per capture from its own loudness metadata
  (`computeLiveNormalizeGain`), because this is loudness *matching* between captures, not a rig
  setting; locking it would make quieter/louder captures actually sound quieter/louder rather than
  levelled for fair comparison.

---

## DONE: Convolution delay

**Implemented** (`40b42e1`). `delayConvolver`, `setDelayIr`, and a dedicated delay IR library path
exist in `liveEngine.ts`, with the delay mode toggle (Algorithmic/Convolution) and IR browse button
in `PlayerPanel.tsx`/`SettingsPanel.tsx`. Original brainstorm kept below for design rationale.

The reverb can load an impulse; the delay cannot. A convolution delay would cover the things an
algorithmic line cannot reach — real tape machine repeats with their wow, head bump and saturation
baked in, spring tanks, and the odd non-linear pedals people capture.

**Blocked on material.** Nothing has been tried yet because no delay impulse pack has been bought
or tested, and it is genuinely unclear whether the results justify the CPU. Worth remembering what
the reverb work established: convolution can only reproduce a LINEAR, TIME-INVARIANT system, and a
tape delay's wow, flutter and self-oscillation are none of those. A tape impulse will give the
tonal colour of the repeats but not their movement.

If it turns out to be worth it, the pieces mostly exist:

- `setReverbIr` already does the whole job — decode, trim silence, resample, stereo, energy
  normalisation. A delay convolver would be the same code pointed at a different node.
- `IrPicker` already browses an indexed library; a third library path alongside `irLibraryPath`
  and `reverbLibraryPath` follows the pattern set in Settings &rarr; Player.
- Impulse length is the open question. Reverb impulses trim to ~11s; a delay impulse with several
  audible repeats could be longer still, and convolution cost is linear in length.

---

## DONE: Noise gate

**Implemented** (`40b42e1`). Ported from AudioDSPTools' `NoiseGate.cpp` into `gate-worklet.js`, on
the raw input before the model, with a full UI card (threshold/hold/release). Original rationale
kept below.

Wanted at the front of the live chain, before the model — a high-gain capture amplifies room noise
and single-coil hum along with everything else, and the tuner work already showed how much hum a
real rig carries.

**Licence checked 2026-08-01 — cleared to proceed.**

The gate is not in the plugin repo or in NeuralAmpModelerCore. It lives in **AudioDSPTools** at
`dsp/NoiseGate.cpp` / `dsp/NoiseGate.h`. All three repos are **MIT, (c) Steven Atkinson**
(plugin 2022, AudioDSPTools and Core 2023).

MIT is permissive but NOT public domain: the copyright notice and permission text must be retained
in copies and substantial portions. A C++ to TypeScript port is a derivative work, so porting it
still carries that obligation. Concretely:

- Header comment in our file crediting Steven Atkinson / AudioDSPTools with the MIT notice.
- A third-party notices file if we start carrying more than one such port.
- No copyleft, no share-alike, commercial use fine. (Worth having checked — plenty of open-source
  audio DSP is GPL, which would have forced this whole app to be GPL.)

Remaining work is just the port. A gate is a few dozen lines (threshold, attack, hold, release),
and the detector belongs on the DRY INPUT before the model: gating after a high-gain model means
gating amplified noise, which chatters. Writing one is not the hard part; matching NAM's feel is,
which is the whole reason for porting theirs rather than inventing one.

Placement is settled either way: on the raw input, before the model. Gating after a high-gain model
means gating the amplified noise, which chatters.

---

## Pop-out pedalboard view for the player FX

A photoreal pedalboard as an alternative to the condensed slider layout, in a modal/full-screen
view so it is not constrained by the player panel's 420px floor.

**Status: assets prepared, nothing wired up.** No code references any of it yet.

### What exists

| File | State |
|---|---|
| `assets/fx/pedalboard.jpg` | Gemini render, 2528x1686. Watermark patched out. Chorus's baked-in lit LED neutralised, so all three sockets are unlit and the glow is ours to control. |
| `assets/fx/knob-black.png` | Sheet row 1 #2. Cut, de-fringed, circular-masked. Delay. |
| `assets/fx/knob-cream.png` | Sheet row 1 #4. Same treatment. Chorus + Reverb. |

Measured coordinates (pixels in the 2528x1686 background):

| Pedal | x | y | w | h |
|---|---|---|---|---|
| Chorus | 138 | 436 | 556 | 862 |
| Delay | 793 | 436 | 748 | 865 |
| Reverb | 1640 | 435 | 755 | 863 |

LED centre is at (0.50, 0.687) of each pedal. Footswitch top edge on the chorus is y=1096 — any
future clone/patch of that pedal must stay above it, which is what the asserts in the prep script
enforce. Knob diameter used in the preview: 0.052 of the image width.

### The architecture decision that matters

Position every control as a **percentage of its own pedal**, never of the background image. Then
swapping the artwork means re-measuring three rectangles and nothing else; the 16 knob positions,
labels, LEDs and switches all survive untouched. Done the obvious way — absolute coordinates
against the whole image — every background change costs a re-measure of all 22 elements.

### Still to build

- Knob component: **vertical** drag (rotational drag feels wrong), shift for fine, wheel, double-
  click to reset, and a visually-hidden `<input type="range">` behind each one so keyboard and
  screen-reader support is not thrown away.
- Rotation is the whole bitmap, -135deg..+135deg. Safe because these knobs are radially symmetric
  apart from the indicator line — the chrome skirt rotates but reads as static.
- Silk-screen labels as real HTML text, blended (`mix-blend-mode` / screen) so the ink picks up
  the brushed grain rather than floating on it. Proven in the preview; do NOT bake text into the
  artwork.
- LED sprites (see below) rather than a CSS glow — the CSS approximation does not look good enough.
- The reverb's **Plate/Convolution toggle has no home** in the current artwork.

### If the artwork is regenerated

Lock the control set first: **chorus 3, delay 7, reverb 6 + one toggle**, three footswitches,
three LEDs. Then:

- Still **no knobs** in the render. They have to rotate, and baking them freezes positions that
  are still being tuned.
- Feed the existing preview back as a **reference image** for proportions. The one real defect in
  the current render is that the delay enclosure never got the extra width it was asked for, so
  7 knobs at 4-across is cramped while the chorus has half a pedal of dead space.
- Ask for **two versions: all LEDs off, and all LEDs on.** The off one is the background; the on
  one exists only so the three lit LEDs can be cut out as sprites. Three pedals switching
  independently is 8 combinations — two whole-board images cover 2 of them, but background +
  three sprites covers all 8, with real rendered glow.
- Give the reverb somewhere for its toggle.

### Open

- Cream knob's indicator is a wide stripe that reads as a screw slot rather than a pointer at
  size. Row 1 #6 (plain black, thin line, no chrome skirt) is the obvious alternative.
- Whether the pop-out replaces the condensed layout at wide widths or stays a separate mode.

---

## DONE: Save the player's FX rig as a recallable preset

**Implemented** (`40b42e1`). Chorus/Delay/Reverb each got an independent named preset list (settings
+ convolution IR where relevant), plus a separate Rig preset snapshotting all five FX blocks at
once, stored in `AppSettings`/`settings.json`. Original brainstorm kept below for design rationale.

Every player control now persists — delay, chorus, reverb (mode and per-mode parameters), cab IR,
reverb impulse, volume, input channel, output device — but there is exactly ONE of each. Dialling
in a clean ambient sound means losing the tight slapback you had, and there is no way back to it
short of remembering six slider positions.

**Wanted:** named presets, saved and recalled from the player.

- A preset is the FX state, not the rig: delay, chorus, reverb settings, and the chosen reverb
  impulse path. Deliberately NOT the input channel, output device, or input gain — those describe
  the room you are sitting in, not the sound, and carrying them between presets would mean
  recalling a preset could silently change which socket the app listens to.
- Cab IR is the awkward case. It belongs to the capture more than to the effects, and it is
  already shared with the Tone Map through `diSelection.ts`. Probably store it in the preset but
  make recalling it optional.
- Storage: the settings file rather than localStorage, since presets are worth surviving a
  profile reset and worth exporting. `AppSettings` already carries similar lists
  (`trainingPresets`, `metadataSuggestRuleLibrary`) that this can follow.

Open questions:
- **Per-capture recall.** Should a capture remember which preset it was last auditioned through?
  Tempting, but it would make two captures sound different for reasons the Tone Map cannot show,
  which is the same trap the shared DI/cab choice exists to avoid.
- **Factory presets.** A few starting points (slapback, ambient wash, clean plate) would show what
  the controls do far better than the defaults, which are all off.
- Whether presets should also cover the preview player once FX exist there — see below.

---

## FX in the preview player

Delay, chorus and reverb are Live-only. Preview renders offline through a Worker
(`namRender.worker`), so each effect would need a second, offline implementation — the live ones
are all Web Audio nodes and an AudioWorklet, none of which exist in that path. Until then, a
capture auditioned in Preview and played in Live are not the same sound, which undercuts the
"both modes agree" principle the shared cab IR was built for.

The plausible route is an OfflineAudioContext render for the effects stage: it supports the same
node types, so the delay and convolution reverb would port nearly unchanged. The plate reverb
would need the worklet to run under OfflineAudioContext, which is supported but untested here.

---

## Let the user choose the start/end point of an audition clip

Both the hover audition and the preview render take a fixed slice of the DI, chosen by
`findLoudestWindowStart` — the loudest window of `AUDITION_CLIP_SECONDS` (hover, 5 s) or
`MAX_PREVIEW_SECONDS` (preview, 12 s). "Loudest" is a decent guess and a poor answer: the part of
a DI that best shows what a capture does is often not its loudest part, and the automatic window
can land mid-phrase, cut off a chord, or sit on the one bar of palm mutes in an otherwise open
riff. There is no way to say "audition *this* bit".

**Wanted:** per-clip in/out points the user sets once and the app remembers.

- A waveform strip for the selected DI with draggable in/out handles, most naturally in the DI
  Source section of the player, where the clip is already chosen.
- Stored per DI file path, alongside the existing DI preferences in `utils/diSelection.ts`
  (`nam-player-di-prefs`) — the same "player and Tone Map must agree" argument applies, since a
  capture auditioned over two different bars of playing is not being compared fairly.
- Falls back to `findLoudestWindowStart` when a clip has no saved points, so nothing changes for
  anyone who doesn't set them.

Open questions:
- **Two lengths or one.** Hover wants short (render cost is linear in length); preview can afford
  12 s. Either the user sets one region and hover takes the first `AUDITION_CLIP_SECONDS` of it,
  or they set the region per mode. The first is simpler and probably right.
- **Cache invalidation.** `useAudition` caches rendered clips keyed by capture; changing the
  in/out points must evict them, or auditioning keeps playing the old region.
- Whether the clip length itself should become a setting at the same time — it is currently the
  hardcoded `AUDITION_CLIP_SECONDS` and `MAX_PREVIEW_SECONDS`.

---

## [HIGH PRIORITY] Settings: dedicated "Playback" section with per-type DI folders

**Partly done.** Settings → **Player** now exists and holds `diPreviewLibraryPath`,
`irLibraryPath` and `irMix`. The per-type DI folder work below is still outstanding. The IR half
of the question is also answered: `irLibraryPath` is now recursively indexed and browsed through
IrPicker rather than by subfolder-as-category, so IRs do *not* need per-type folders.

Player settings are currently squeezed into Settings → Library alongside unrelated options
(`diPreviewLibraryPath`, `irLibraryPath`, `irMix`). They deserve their own **Playback** section,
and the DI library needs to stop depending on the user having pre-organized one folder tree.

**Today:** one `diPreviewLibraryPath`, and categories are inferred from its immediate subfolder
names (`Clean/`, `Break Up/`, ...). That works only if the user restructures their existing DI
collection to match, which is a real barrier — most people already have DIs scattered across
folders they don't want to move.

**Wanted:** pick a folder *per type*, so the app does the organizing instead of the filesystem:

| Type | Folder |
|---|---|
| Clean | `<browse>` |
| Break Up | `<browse>` |
| Medium Gain | `<browse>` |
| High Gain | `<browse>` |
| Lead | `<browse>` |
| Heavy | `<browse>` |

Then the player's pill row is built from configured types rather than discovered subfolders, and
the per-type dropdown lists the wavs in that type's folder.

Design decisions still open:
- **Shape of the setting.** A `Record<categoryName, folderPath>` is the obvious model, but should
  the type list itself be user-editable (add "Acoustic", "Bass", rename "Heavy")? Leaning yes —
  hardcoding six categories will be wrong for someone. `DI_CATEGORY_ORDER` in
  `utils/playerAudio.ts` is the current canonical list and would become the *default* set.
- **Coexistence with the current single-folder mode.** Simplest is to keep both: if per-type
  folders are configured they win; otherwise fall back to scanning `diPreviewLibraryPath` for
  subfolders (which already works and shouldn't break for anyone using it).
- **Same question for IRs.** `irLibraryPath` has the identical subfolder-as-category convention,
  so per-type IR folders (by cab size? by mic?) may deserve the same treatment — or may not,
  since IR packs usually *are* already organized in folders.
- **Ordering** when types are user-defined: explicit drag order, or keep matching against the
  canonical gain progression and append unknowns (what `sortDiCategories` does now).

Also worth moving into the new Playback section while it exists: `namStandalonePath` arguably
belongs there rather than under Library, and the preview length (currently the hardcoded
`MAX_PREVIEW_SECONDS = 12` in `PlayerPanel.tsx`) could become a setting.

---

## DONE: Player cabinet IR stage

**Implemented.** Captures whose `gear_type` has no cabinet (`amp`, `preamp`, `pedal_amp`,
`pedal`, `studio`) are raw power-amp signal and sound harsh alone; they now get a cabinet IR
convolved in. `amp_cab`/`amp_pedal_cab` skip it automatically so you never hear two speakers
in series. Unknown/absent `gear_type` is left alone rather than coloured wrongly, and the user
can force the IR on or off either way.

- **IR source:** a user-pointed folder (`irLibraryPath`, Settings -> Library), same
  subfolder-as-category convention as the DI clip library. Nothing is bundled, which sidesteps
  the cab-IR licensing question entirely.
- **Scan IPC:** `player:scanWavLibrary` — the DI handler generalized, since both libraries are
  "a folder of wavs organized into category subfolders".
- **Convolution:** Web Audio `ConvolverNode` inside an `OfflineAudioContext`, baked into the
  cached preview buffer (suits render-then-play; no live graph to rebuild per play). Parallel
  wet/dry paths with `dryGain = 1 - mix` copied from upstream's topology, so cab amount is
  blendable via the `irMix` setting. `convolver.normalize = false` so switching cabs doesn't
  jump the level — our own loudness stage handles that.
- **Chain order:** model -> IR -> DC blocker -> normalize. IR before normalization because IRs
  vary wildly in gain. When an IR is applied, loudness metadata no longer describes the signal,
  so normalization falls back to peak-based.
- **Verified** against a real IR (`FNDR 2x12 G12-65 MIX.wav`): 6kHz down 21.2dB, 2kHz down
  5.2dB, fundamental unchanged — a real speaker's rolloff.

Follow-ups worth considering: per-capture IR memory (currently one selection for the session),
suggesting an IR from `nl_cabinet` metadata, and IR support in the future tone map.

---

## DONE: In-app tone player — offline WASM render (no real-time AudioWorklet)

**Implemented.** `native/nam-wasm/` holds the vendored single-threaded WASM module and build
script; `nam-offline.js` + `namRender.worker.ts` are the offline render worker path; `PlayerPanel.tsx`
was rewritten to render offline instead of real-time AudioWorklet (`8939932`). Follow-on fixes
landed after: bounded-block rendering to avoid `std::bad_alloc` (`9735434`), quiet/gainless preview
fixes (`41991d2`), and Play Live vs. Preview click behavior (`ff96735`). Original plan kept below
for reference.

**Status (stale): was IN PROGRESS on `feature/player`.** Prior attempt on this branch (see
`docs/player-investigation.md`, checkpoint `5c84181`) tried to embed Tone3000's
`neural-amp-modeler-wasm` React player (`T3kPlayer`) for real-time playback via
`AudioWorkletNode`. That's permanently blocked in Electron: the WASM module is built with
`-pthread -sAUDIO_WORKLET -sWASM_WORKERS` (see upstream `wasm/CMakeLists.txt`), which requires
`self.crossOriginIsolated === true` to transfer `SharedArrayBuffer` into the worklet thread.
Every approach tried to get `crossOriginIsolated` to `true` in Electron 41/Chromium 130 failed
(COOP/COEP via `onHeadersReceived`, custom `app://` protocol, Vite middleware, `sandbox: true`
— which additionally broke preload since the current preload does synchronous `fs`-based
settings bootstrap incompatible with a sandboxed preload). Do not re-attempt the real-time
AudioWorklet path without a fundamentally different preload/window architecture.

**New approach — fork the DSP core, drop threading entirely:**

The actual neural-net inference in `tone-3000/neural-amp-modeler-wasm` (MIT licensed,
https://github.com/tone-3000/neural-amp-modeler-wasm) is an ordinary synchronous C++ call —
`wasm/t3k-wasm-module.cpp`'s `process(float* in, float* out, int n_samples)`, backed by
`nam::get_dsp(jsonStr)` and `nam::DSP::process()` from the vendored `NAM/*.cpp` sources. It has
**no threading requirement of its own** — the `-pthread`/`AudioWorklet` machinery only exists to
schedule that call every 128 samples from the browser's real-time audio thread. Since a preview
player doesn't need real-time bounded latency (render once, then play back), we don't need any
of that scaffolding.

Plan:
1. Vendor `NAM/*.cpp` + `NAM/*.h` and the `Dependencies/eigen` / `Dependencies/nlohmann` headers
   from the upstream repo (MIT — freely forkable) into this repo, e.g. under `native/nam-wasm/`.
2. Write a new, small entry point (not present upstream) exposing three C functions:
   `loadModel(jsonStr) -> handle`, `processBuffer(handle, in, out, n)`,
   `freeModel(handle)` — directly wrapping `nam::get_dsp` / `nam::DSP::process`. No
   `emscripten/webaudio.h`, no `EMSCRIPTEN_WEBAUDIO_T`, no click-to-resume handler, none of the
   AudioWorklet plumbing.
3. Compile with plain `emcc` (Emscripten SDK — not yet installed on this machine, needs
   confirmation before installing) — **no** `-pthread`, `-sAUDIO_WORKLET`, or `-sWASM_WORKERS`.
   Just `-sMODULARIZE -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH -sEXPORTED_FUNCTIONS=...`. Produces an
   ordinary single-threaded `.wasm` that never allocates `SharedArrayBuffer` — so
   `crossOriginIsolated` is never checked and never needs to be true. This is not "bypassing" the
   COOP/COEP security gate (which exists to gate Spectre-class side-channels via shared memory +
   high-res timers) — it's not using the feature that requires the gate at all, which is the
   correct fix, not a workaround.
4. Renderer side: a plain Web Worker loads the module, is handed the `.nam` file's JSON contents
   and the DI reference WAV's samples, calls `processBuffer` once over the whole buffer (NAM
   inference is cheap; expect well under a second for a several-second capture on any modern
   CPU, even single-threaded), gets back rendered float samples, builds a WAV/`AudioBuffer`.
5. Playback: normal `AudioBufferSourceNode` (or encode to WAV blob + `<audio>`). No
   `AudioWorkletNode`, no COI requirement, no dependency on the Python/conda `nam` env at all —
   this stays fully client-side and is bit-accurate to the real NAM plugin since it's the same
   DSP core.
6. Wire into `PlayerPanel.tsx`: replace the AudioWorklet init path with "render once, cache
   result, play the rendered buffer." Simpler UI too — no live mic input needed for a library
   preview player (could be a v2 addition once offline render works).

**Not yet installed / needs a decision before compiling:** Emscripten SDK (`emsdk`) is not on
this machine — sizable download + first-time toolchain setup. Vendoring the C++ sources and
writing the new entry point + CMake target can happen without it; actually producing a `.wasm`
needs `emcc` installed and confirmed first.

---

## DONE (branch `feature/player`): "Tone Map" — organic clickable tone-browsing dashboard(s)

**Built.** Full-window view: amp rows ordered cleanest→heaviest by *measured* mean gain, continuous
saturation X axis, tone-type colour, multi-select facets (amp / creator / tone type), hover-to-name,
click-to-play through the in-app player, heat cells for dense rows, real axis zoom with pan +
scrollbar, and rows that auto-size to half the window with a drag grip. The brainstorm below is kept
for the design rationale; **the successor ideas are the "Scan mode" and "Tone Radio" entries that
follow it.**

Original brainstorm follows.

**Immediate, concrete first step (separate, smaller item — see the folder-dashboard gain strip
entry below):** two simple 1D gradient/heat strips on the folder dashboard — one for gain level
(clean → high gain, using `metadata.gain`) and one showing tone-type category counts as a
heat/gradient strip (how many captures fall into each `tone_type` bucket). That's the concrete
near-term deliverable and is tracked separately so it doesn't get stuck behind this bigger idea.

**The bigger idea — a real explorable map, not just a strip:** an "organic chart" view that plots
*all* tones in the library (or a scoped subset) on some kind of 2D field — e.g. gain on one axis,
brightness/character or gear type on another — where visually-close points represent
similar-sounding captures, clustered rather than just linearly sorted. The user should be able to:
- **Filter** the map before/while browsing — e.g. "only Marshall-type amps" — and watch the map
  narrow to just that cluster.
- **Click a point (or a cluster)** to get oriented — "here's the cluster of upper-mid-gain
  Marshall tones" — as a way to *discover* tones you might like, not just find a specific one you
  already know the name of.
- **Play a clicked tone immediately**, using the in-app player above — this is explicitly called
  out as the feature that would make the whole thing "REALLY useful": click a point in the map,
  hear it right there, no separate load/select step.

**Open design questions to resolve before scoping real implementation:**
- What determines position on the "map" — is it purely metadata-driven (gain, tone_type, gear
  fields — all already on `NamFile`/`.nam` metadata, no new extraction needed), or does it need an
  actual similarity/clustering computation (e.g. fingerprinting `waveNetConfig`/architecture the
  way `detectPreset.ts` already does for preset matching)? Metadata-driven is far cheaper to ship
  first; true similarity clustering is a "v2" if the metadata-driven version doesn't feel
  "organic" enough.
- Is this one dashboard or several purpose-built ones (a "by gain" map, a "by gear" map, a "by
  quality/ESR" map)? The user brainstorm mentioned "some sort of new dashboard(s)" — plural is on
  the table.
- Where does this live in the app — a new top-level view, or a mode within the existing folder
  dashboard?
- How does filtering compose with the existing folder-tree scope — is the map always
  library-wide, or does it respect "currently browsing this folder"?

Do not start building the big map until these are actually answered; the gain/tone-type strips
below are the right-sized next step.

---

## DONE: Scan mode — audition a scoped set by ear, in order

**Implemented** (`f23c722 Scan mode: audition a scoped set of captures by ear`), with help docs
added in `ae0c49e`. Original brainstorm kept below for design rationale.

**Status (stale): was "next thing to build."** The Tone Map's weakness is that every facet it offers is a *name*, and you
cannot name a tone you have not heard. Scan mode makes the ear the filter: pick a scope, then sweep
through it hearing each capture crossfade into the next, radio-tuning style. Stop when something
catches you.

**Scope first, then scan** — the drill-down is the point, not a later refinement:
- this creator only (`modeled_by`, normalized via `utils/gearMake.ts`)
- this amp only (`gear_make` + optional `gear_model`)
- **this amp family**, and **several families at once** — see the amp-family taxonomy entry below
- the current folder-tree scope, or library-wide
- compose with the Tone Map's existing facet state so scanning "what I'm looking at" is one click

**Scan order matters more than similarity does.** v1 orders the scoped set by measured
`metadata.gain` (clean → saturated), which needs *no new measurement at all* and is already a
smooth, meaningful sweep. Better orderings (see Tone Radio below) can replace the comparator later
without touching the UI — keep ordering behind a single function so that swap stays cheap.

**The real engineering constraint — MEASURED.** Each capture must be rendered through the WASM model
before it can be heard, and render time is dominated by clip length (~60 ms fixed model load/reset,
then ~120 ms per audio-second):

| scan clip | render per capture |
|---|---|
| 0.5 s | 117 ms |
| 1 s | 176 ms |
| 3 s | 406 ms |
| 6 s | 727 ms |
| **12 s (today's `MAX_PREVIEW_SECONDS`)** | **1518 ms** |

So scanning must **not** reuse the 12 s preview — 1.5 s of silence before every capture makes a
sweep unusable. Use a short dedicated scan clip (~3 s) and a prefetch pool rendering ahead of the
playhead; at 406 ms across 4 workers that is one capture ready every ~100 ms, comfortably faster
than anyone sweeps. Prefetch is most of the work here — budget for it rather than discovering it
late.

**Descriptors are scope-lazy, never library-wide.** 38k captures would be ~1.6 h across 4 workers;
the ~100–500 captures in the scope you are about to sweep are far less. Sweeping starts immediately
on metadata ordering and re-sorts as descriptors land, so the wait is never blocking.

**Incremental, and cheaper than the prescan.** Cache per capture keyed by path + mtime + size +
probeVersion, so adding or editing captures rescans only what changed — never the whole scope again.
The prescan's 618 ms probe was sized to *test identity* (sine + three sweep levels); ordering only
needs the sweeps, so the shipped probe is smaller:

| probe | per capture | 3,853-capture folder, 4 workers |
|---|---|---|
| 1 sweep — brightness only | ~176 ms | **~2.8 min** |
| 2 sweeps — brightness + drive-dependent tilt | ~300 ms | ~4.8 min |

Show the estimate before starting (count x measured ms / workers) and let the user cancel; the cost
scales with scope, and a narrow scope like "these two amps from this maker" is seconds.

**Changing the audition DI does NOT invalidate the scan.** Worth stating because it is the obvious
worry: the descriptor probe is a *synthetic sweep*, not the user's DI, so it characterises the model
itself and is independent of whatever clip you later audition with. The DI only affects what you
hear during a sweep, and is rendered on demand.

The real nuance is drive level, not clip choice. Model response is level-dependent — measured `tilt`
spanned **-300 to +217 Hz**, so some captures genuinely reorder between gentle and hard playing.
That is handled by storing centroid at more than one drive level in the *same* scan, so sorting by
"clean playing" vs "driven" is free and still needs only one pass. No per-DI rescan, ever.

**Metadata cleanup is the user's job, not the scanner's.** Split spellings (SLAMMIN MOFO x4,
`MARSHALL`/`Marshall`) are exactly what the app's batch editor exists for. `gearMake.ts` grouping
still helps the picker read sensibly, but scan mode should not try to be clever about it.

**This is ordinary app code.** The scan runs locally in worker threads on the user's own machine —
no network, no service, nothing external. Every user scans their own library.

**Open questions:**
- Fixed dwell time per capture, or hold-to-listen / release-to-advance?
- Same DI clip for every capture in a sweep (fair comparison, and the render cache stays warm) —
  confirm, but almost certainly yes.
- Crossfade length: long enough to be pleasant, short enough that 50 captures is not 5 minutes.
- Does a "keep" action collect favourites into a shortlist as you sweep?

---

## [MEDIUM] Amp family taxonomy — group makes into families for scoping

Needed by Scan mode's drill-down and useful to the Tone Map's facets. Curated `gear_make` → family
mapping (British / American clean / American high-gain / boutique / fuzz / bass / …), covering the
~54 distinct makes in the library. Curated rather than measured because it is instantly explainable
and reliable, where a clustered grouping would be neither.

Must handle the dirty reality already documented above: case-split spellings, and the 656
`tz-make` placeholder captures that belong to no make at all. Families are a *grouping over* the
normalized keys from `utils/gearMake.ts`, not a replacement for it. Multi-select, since "Marshall
and everything Marshall-derived" (Friedman, Splawn, Bogner …) is exactly the query worth having.

---

## [MEDIUM] Tone Radio — browse by ear-adjacency instead of by name

Successor to the Tone Map, and the eventual source of a better Scan ordering. One capture plays;
8–12 nearest neighbours by *measured timbral distance* sit around it, closer ring = more similar.
Click one → it plays and becomes the new centre, neighbours recompute. Two dials bias the
neighbourhood rather than filter it: darker ⟷ brighter, cleaner ⟷ dirtier. The "filter" is a
heading, not a checkbox.

**The reason it is worth doing at all:** similarity never looks at `gear_make`, so the 656 untagged
captures become exactly as findable as a tagged Marshall. No name-based facet can reach them.

**Do not trust the descriptor before testing it — see the validation entry below.** A single
fixed-amplitude sweep response captures static EQ and saturation but *not* harmonic order and *not*
dynamic feel, which is a large part of what separates two amps by ear. Expect to need the richer
feature set (harmonic even/odd ratio, multi-level compression index) described there.

Also worth keeping in mind: neighbour-browsing can trap you in a pocket where everything sounds the
same, so a deliberate "further afield" / temperature control is part of the feature, not a polish
item.

**Deferred sibling:** the "molecules" free-floating scatter (user: *"like molecules"*) is the same
data in a second view mode — positions from the same descriptors, same hit-testing and
click-to-play, only the layout and mark rendering differ.

---

## MEASURED (2026-07-31): descriptor prescan results — Tone Radio is NOT supported by the evidence

Ran the falsifiable test on the real library (3,853 captures, 140 sampled at 14 each across the 10
makes with enough captures). One combined probe per capture — 220 Hz sine for harmonic structure,
plus log sweeps at three drive levels for spectral tilt and compression — rendered through the
bundled WASM core in Node. 140/140 rendered, 0 failures, 618 ms/capture (~40 min library-wide
single-threaded, ~10 min across 4 workers, cached).

**Verdict: do not build Tone Radio.** Nearest-neighbour same-make accuracy was **23.6% against 9.4%
chance** — real signal at 2.5x lift, but far too weak to navigate by. Same-make captures sit only
**1.13x** closer to each other than to other makes. Per-make recall is wildly uneven: Two Rock and
Victory 50%, but **Friedman 0/14** — not one Friedman's nearest neighbour was another Friedman.
Clicking a capture and being offered "similar" amps would be wrong three times in four.

**Caveat worth keeping:** "same make" may itself be a poor ground truth, since one amp's clean and
lead channels genuinely sound different. A low score partly indicts the label, not only the
descriptor. But it does settle the product question — similarity cannot be *sold* as "amps like
this one".

**What the run did prove, and it is useful:**
- **`metadata.gain` is nearly useless as an axis.** Measured across all 3,853: median 0.797, and
  **79.2% fall inside 0.55–0.85** — a 30% slice of the axis holding four fifths of the library.
  Only 10 captures (0.3%) are below 0.40. On identity it scores 12.1%, barely over 9.4% chance.
  Adding it to the timbre features made them *worse* (25.7% timbre-only vs 23.6% with gain).
  This is why the Tone Map's X axis looks bunched — the axis is real but the data is not spread
  along it.
- **Compression (how much output level fails to track input level) is the single best feature at
  20%** — and it is exactly what a fixed-amplitude probe cannot see. Multi-level probing earns its
  cost; single-level probing would have missed the most informative dimension.
- **Spectral centroid has genuinely wide spread**: 372–1083 Hz, sd 159. It fails at *identity* but
  it is a real, continuous, well-distributed perceptual quantity — i.e. a good **sort key**, which
  is what Scan mode actually needs. Brightness ordering beats gain ordering on spread alone.

**Reframe: the descriptor fails as a similarity metric but succeeds as an ordering.** Use it to sort
a scan sweep, not to claim two captures sound alike.

**Library metadata reality — CORRECTED.** A first pass scanned only `Y:/_RELEASES` (3,853 captures,
own releases) and concluded the creator facet was dead. That was an artifact of the folder chosen.
Across the real collection (`Y:` plus `F:/NAM Captures Paid and Tone3000`) there are **38,263
captures**, and:
- **26 distinct `modeled_by`** — the creator facet is very much alive. It is also the strongest case
  for normalization anywhere in the app: SLAMMIN MOFO appears as **four** spellings totalling ~5,840
  (`SLAMMIN MOFO` 3863, `slamminmofo` 1425, `Slammin Mofo` 184, plus `MADE BY KDM TRAINED BY SLAMMIN
  MOFO` 368). Others: Core Tone Captures 18,372, ML Soundlab 904, stjepanherceg 520, 2dor 320.
- **71 distinct `gear_make`**, 15,251 (40%) with none at all, `tz-make` placeholder 1,947, and
  `MARSHALL` 1590 vs `Marshall` 182 again splitting on case.
- Gain stays useless regardless of folder — the distribution above holds.

**Scale changes the descriptor economics completely.** 38,263 x 618 ms = **6.6 hours
single-threaded, ~1.6 hours across 4 workers**. That is far too much to ask of every user as a
blocking step, and every user builds their own collection so it cannot be precomputed and shipped.
**Descriptors must therefore be scope-lazy, not library-wide** — see the Scan mode entry.

---

## [HIGH PRIORITY] Validate timbral descriptors before building anything on them

**Gate for Tone Radio and for any similarity-based Scan ordering.** The earlier probe measured
spectral centroid across 14 real captures at 349–608 Hz and, importantly, *independent of gain*
(five captures at gain ≈0.43 sat at ≈530 Hz while five at ≈0.44 sat at ≈370 Hz) — so it is a
genuinely orthogonal axis, ~133 ms/capture, ~1.5 min for the library across 4 workers, cached.

**But a single fixed-amplitude sweep is probably not enough**, and this should be proven or
disproven cheaply before any UI depends on it. What it misses:
- **Harmonic order** — even (2nd/4th) vs odd (3rd/5th) is much of "warm/tubey" vs "harsh/fizzy",
  and a sweep's centroid confounds harmonic generation with EQ rather than separating them.
- **Dynamic response** — how the tone changes with input level is arguably *the* thing that
  separates captures, and a fixed-amplitude probe cannot see it at all.

Richer feature set to measure instead (all cheap, all from the same render path):
- spectral tilt / centroid at **two or three drive levels**, not one
- **even/odd harmonic ratio** from a pure sine via Goertzel (the "character" axis)
- **compression index**: how much output level compresses as input rises (the "feel" axis)
- measured `metadata.gain`, free, already present

**The falsifiable test, and it must come first:** captures of the *same amp by the same creator*
should land close together, and captures of clearly different amps should not. If same-amp captures
do not cluster, the descriptor is not capturing amp identity and we need to know that *before*
building a browser on top of it. Cheap to run, and it settles the question by measurement instead of
argument.

Also measure before committing: base64 IPC for 2,577 models may dominate the 133 ms of DSP, in which
case the render path moves to the main process. Do not pre-build that — measure on ~50 real captures
first.

---

## [MEDIUM] Folder dashboard: gain + tone-type gradient strips

Two 1D gradient/heat strips on the folder dashboard (not the big Tone Map above — this is the
concrete, buildable slice of it):
1. **Gain strip**: every capture in scope placed along a clean → high-gain gradient using
   `metadata.gain` (already a read-only field on `NamFile`, no new extraction needed). Color
   intensity or position = gain value.
2. **Tone-type strip**: count of captures per `tone_type` category, rendered as a heat/gradient
   strip (which categories are well-represented in this folder/library vs. sparse).
Scope: folder dashboard (i.e. respects current folder-tree scope, not necessarily library-wide —
confirm against the Tone Map's "library-wide vs. scoped" open question above so the two don't
diverge in behavior later). Keep this intentionally simple (a strip, not a full scatter/map) —
it's the fast, obviously-useful version; the bigger clickable/filterable map is tracked
separately above.

---

## DONE: Option to include folder images (amp/cab/mic photos etc.) in the pack PDF

**Implemented.** Pack Info export now has a "Rig photos (N)" checkbox + thumbnail picker next
to the Simple/Advanced export buttons in `PackInfoEditor.tsx` (~line 2224). Wiring:
- `scanOwnAndInheritedImages` (`utils/folderImages.ts`) scans the folder's own images plus a
  cascade **up** through ancestor folders (stopping before root), each as a labeled group;
  `ampcover.*` is always excluded (reserved for cover art).
- `buildExportGallery()` (`PackInfoEditor.tsx` ~1357) inlines selected images as data URIs and
  passes them through to both `generatePackHtml` and `generatePackHtmlAdvanced` as a new
  `gallery` param. The advanced export renders a paginated "Rig Photos" grid
  (`packExportAdvanced.ts` ~256, `chunkGalleryPages` / `.gallery-grid`).
- Per-image include/exclude persisted via `exportIncludeGallery` +
  `exportExcludedGalleryImages` on `PackInfo`.

**Known limitation / follow-up:** the cascade is **up-only** (own + ancestor folders).
`folder:scanImages` (`main/index.ts:6303`) is a flat, non-recursive `readdir`, so photos sitting
in **child subfolders** of the pack folder are never picked up. The "Rig photos" checkbox is
also gated on there being at least one own/inherited image, so a pack whose photos all live in
subfolders shows no toggle at all. See the "include child subfolder photos" item below.

---

## [MEDIUM] Rig photos: include child-subfolder photos (bidirectional gallery)

Today `scanOwnAndInheritedImages` only cascades **up** (own + ancestors). A pack folder whose
gear photos live in child subfolders (e.g. per-capture folders) gets nothing. Extend the scan
to also collect images from descendant subfolders as additional labeled groups, surfaced in the
same "Rig photos" picker so each image stays individually include/excludable. Decisions still
open: recursion depth (immediate children vs. full descend), whether children default-on or need
their own checkbox, and how to keep noisy folders (DI waveform screenshots etc.) from flooding
the picker.

---

## [TOP PRIORITY] Investigate: "NAM did not produce a .nam file at the expected location"

Occasional training failures where the job completes without error but no `.nam` file is found at the output path. The error message is: `"NAM did not produce a .nam file at the expected location."`.

- Identify when this happens (specific architectures, epoch counts, WAV pair characteristics, or workspace paths with special characters/spaces?)
- Check whether NAM actually errored silently (non-zero exit, stderr output) vs. genuinely wrote the file somewhere else
- Confirm the expected output path construction in `main/index.ts` matches where NAM actually writes its output for each architecture variant
- Add better diagnostics: log the full expected path, list files actually present in the workspace dir after the run, surface that info in the failure history entry so users (and devs) can see what actually happened

---

## DONE (2026-07-12): Training-queue batch drag migrated to @dnd-kit

**Long-standing pain point.** Reordering training batches by dragging has been attempted ~15+
times across multiple sessions/models and has never worked *reliably*. The 2026-07-10 pass
(see the "batch drag" note under Experimental training) fixed several real defects and made it
work in the common case, but two things remain and are the whole point of this ticket:

1. **Collapsed batches don't drag reliably.** A collapsed batch card is just its header (much
   shorter hit area), so cursor tracking / drop-target resolution behaves differently than for
   an expanded card. This is the specific case the user calls out as still broken.
   - **Root cause, confirmed via code review (2026-07-11), distinct from the gap-hit-testing bug
     fixed on 2026-07-10:** `mousemove` events are rate-limited by the browser (tied to display
     refresh, not actual pixel distance moved), not fired continuously. A collapsed card is only
     ~45-50px tall. At normal drag speed, with several collapsed cards stacked only `space-y-3`
     apart, it's entirely plausible that **zero mousemove samples ever land within that 45px
     band** — the cursor's tracked position jumps straight from "card above" to "card below"
     without ever registering the intended card as a match. The existing 80px nearest-neighbor
     fallback (`resolveDragTargetBatch`, added 2026-07-10) does NOT help here: it only rescues a
     sample that landed reasonably close to a target; it can't retroactively notice a target the
     cursor skipped over between two samples with no nearby sample at all. Widening the 80px
     radius further is not a real fix — it starts resolving drops onto the wrong adjacent card
     instead of the intended one. This is why further mouse-event patching is not recommended;
     see the `@dnd-kit` note below for why that architecture doesn't have this failure mode.
2. **No drag ghost/preview.** The current implementation only dims the source card
   (`opacity-50`) and rings the target — there is no floating "ghost" of the dragged batch
   following the cursor, which is what makes a drag feel real and predictable. Compounds #1:
   with everything collapsed and visually similar, and no cursor-following visual, the user has
   no clear signal of where the drag currently thinks it's hovering — so even correctly-resolved
   drops can *feel* unreliable.

**Do NOT keep patching the hand-rolled mouse-event drag.** That's the approach that has failed
repeatedly. The current code (`TrainingPanel.tsx`, the batch drag handle `onMouseDown` +
`resolveDragTargetBatch` + `draggingBatch`/`dragOverBatch` state) attaches `window` mousemove/
mouseup listeners and hit-tests with `elementFromPoint`. It was built this way because native
HTML5 DnD (`draggable`/`onDrop`) does not fire `drop` reliably on same-window targets in
Electron on Windows.

**The proven path is already in this repo: `@dnd-kit`.** `@dnd-kit/core` + `@dnd-kit/sortable`
+ `@dnd-kit/utilities` are already dependencies AND already used successfully for drag-reorder
**with a ghost image** in `PackInfoEditor.tsx` and `PackTargetsEditor.tsx`. The pattern there:
`DndContext` with `useSensors(useSensor(PointerSensor))` + `SortableContext` +
`verticalListSortingStrategy` + `closestCenter`, and `onDragEnd` reads `event.active`/
`event.over`. Pointer sensors work in Electron where HTML5 DnD doesn't, and `@dnd-kit`'s
`DragOverlay` gives the floating ghost for free — solving both remaining problems at once, and
collapsed vs. expanded is a non-issue because dnd-kit tracks the pointer, not element geometry.

**Recommended implementation when picked up:**
- Wrap the batch list (Queue "Batches" view) in a `DndContext` with a `PointerSensor`
  (add a small `activationConstraint: { distance: 4 }` so a click-to-collapse isn't read as a
  drag), `SortableContext` over the batch `groupKey`s with `verticalListSortingStrategy`.
- Make each batch card a `useSortable` item keyed by `groupKey`; keep the existing drag-handle
  as the sortable listener target so clicking the header still collapses.
- Render a `DragOverlay` containing a compact clone of the batch header as the ghost.
- On `onDragEnd`, map `active.id`/`over.id` (both `groupKey`s) to the existing IPC calls
  (`moveSubmissionBefore` / `moveSubmissionToEnd`) — the main-process reorder handlers are
  correct and should not change; only the renderer drag mechanism is being replaced.
- Delete the mouse-event drag code (`resolveDragTargetBatch`, the `onMouseDown` window-listener
  block, `draggingBatchRef`/`dragOverBatchRef`/`draggingBatch`/`dragOverBatch`).
- Test specifically: dragging a **collapsed** batch, dragging above the running batch, dragging
  to the very end, and that a plain header click still collapses (doesn't start a drag).

**Implemented 2026-07-12.** `TrainingPanel.tsx`'s Queue "Batches view" now uses `DndContext`
(`PointerSensor`, `activationConstraint: { distance: 5 }`) + `SortableContext`
(`verticalListSortingStrategy`, items = batch `groupKey`s) + a `DragOverlay` ghost (compact
clone of the batch header, done/total count). Each batch card is wrapped in a small render-prop
component (`SortableBatchCard`) that calls `useSortable({ id: group.groupKey })` — this avoids
extracting the ~250-line card body into its own component with dozens of threaded props; the
render-prop callback still closes over every handler/variable the existing JSX already used.
`onDragEnd` reuses the exact same `moveSubmissionBefore`/`moveSubmissionToEnd` IPC calls the old
mouse-event handler called. The old `draggingBatch`/`dragOverBatch`/`resolveDragTargetBatch`/
`groupedQueueRef` state and the `onMouseDown` window-listener block were deleted outright.
Verified via `tsc --noEmit` (net-zero new errors — two pre-existing errors from the deleted
mousemove code disappeared) and a dev-server launch smoke test (app builds and starts with no
console/render errors). **Still needs**: real manual verification in the running app — drag a
collapsed batch, drag above the running batch, drag to the end of the list, and confirm a plain
header click still collapses instead of starting a drag.

---

## ~~[MEDIUM PRIORITY] Fix literal `\uXXXX` escape sequences showing up as raw text in UI strings~~ — Done

All 18 plain JSX attribute strings containing `\uXXXX` escapes (which don't get JS
escape-sequence processing, so users saw literal `—` etc.) were wrapped in `{"..."}`
so the escape is processed as a JS string literal. Chose the `{...}` expression form over
pasting raw Unicode chars deliberately: this repo had an encoding-hardening pass
(commit `bf6d33f`) that replaced raw Unicode with `\u` escapes to avoid garbling on Windows,
so keeping the source ASCII while wrapping in braces respects that and still renders correctly.
Regression check: `grep -rn '="[^{][^"]*\\u[0-9a-fA-F]\{4\}' src --include="*.tsx"` returns 0.

---

## Modularization

**Status: Components exist but are themselves too large. Priority: Medium.**

58 TS files in `src/renderer/src/` — already well-structured with a `components/` directory and a 5,520-line App.tsx. However several component files are themselves monoliths that need splitting:

| File | Lines | Problem |
|------|-------|---------|
| `TrainingPanel.tsx` | 5,202 | Larger than poke-locker's App.tsx was |
| `SettingsPanel.tsx` | 2,956 | Three or four logical sections |
| `PackInfoEditor.tsx` | 2,432 | Editor + preview + export mixed |
| `FileList.tsx` | 1,966 | Grid + detail + modals all in one |
| `PackTargetsEditor.tsx` | 1,180 | Could split into sub-panels |
| `FolderTree.tsx` | 1,180 | Complex tree logic + UI mixed |
| `MetadataEditor.tsx` | 1,169 | Multiple field groups |

**App.tsx** (5,520 lines) also needs reduction — the root component should be ~300–400 lines.

**Plan** (do these in priority order):

1. **TrainingPanel.tsx** — Split into:
   - `training/QueuePanel.tsx` — job queue + status + controls
   - `training/HistoryPanel.tsx` — history browser + grouped entries
   - `training/BatchBuilder.tsx` — WAV/folder intake + preset selection
   - `training/WatcherPanel.tsx` — watch folder rules
   - `training/PresetsPanel.tsx` — bundle/preset management
   - `training/lib/` — queue helpers, ESR utils, naming templates

2. **SettingsPanel.tsx** — Split into:
   - `settings/GeneralSettings.tsx`
   - `settings/AISettings.tsx`
   - `settings/TrainingSettings.tsx`
   - `settings/SecuritySettings.tsx`

3. **App.tsx** — Extract remaining section scaffolding so root is nav + state only.

**Approach**: Same Node.js extraction script pattern used in poke-locker. Target `npx tsc --noEmit` clean before committing each file.

## UI test harness

**Status: not started. Priority: Medium — the IR Lab Manager branch (`feature/ir-lab-manager`)
has shipped a lot of renderer surface with zero UI coverage.** Raised 2026-09-02: several sessions
of grid / mode-rail / capture-card / DataGrid work landed verified only by `electron-vite build`
succeeding, because there is no way to render a component here and look at it (unlike `ir-lab`'s
`IRLabUiShot` offscreen renderer). Three tiers, do them in this order:

1. **Component tests — do now.** `@testing-library/react` + `jsdom` under the existing `vitest`
   (no new runner, no CI infra). jsdom does not lay out or paint, so this catches *logic and
   wiring*, not visual regressions: renders-without-throwing, prop plumbing, conditional
   rendering, interaction → callback. Highest-value first targets:
   - `DataGrid.tsx` — sort toggle (asc→desc→asc, controlled vs local), column show/hide + order
     persists to `localStorage`, per-column filter narrows rows (text + checklist), selection
     (click / ctrl / shift-range / ctrl-A), `onVisibleRowsChange` fires with the sorted order,
     controlled/virtualised mode asks for the right `onRangeChange` window.
   - Pure helpers already extractable and untested: `NamProjectsShell`'s `matchesFacets` /
     `availableFacets` / `sortRows` / `toBatchItem` / `CAPTURE_COLUMNS` getValue+sortValue,
     `IrModeShell`'s `IR_GRID_COLUMNS`, the `relTime`/`formatBytes`/`audioLabel` formatters
     (see also Modularization item — pull these into `*/lib/` files as part of this).
   - `ModeRail` / `NamLabCrumb` — smoke render + mode-switch callback.
   This is the concrete follow-through on the `docs/technical-debt-2026-08-31.md` D7 item.

2. **A `?dev=components` gallery route — optional, cheap.** One page (behind a query param, dev
   builds only) that renders `DataGrid`, `CaptureCard`, `ModeRail`, the IR grid, etc. against
   fixture data with no `window.api` dependency. Lets a human eyeball a component in isolation
   without clicking through the whole app, and gives tier 3 a stable target to screenshot.

3. **Playwright + Electron E2E — defer until this branch is near merge.** The right tool for the
   questions `build` can't answer ("does the rail clear the Windows titlebar overlay / the macOS
   traffic lights", "does the 3-mode switch actually work end to end", "does the grid look right
   at a narrow panel width") and for screenshot-diff visual regression. But it is real infra —
   Electron+Playwright wiring, 3-OS CI runners, flake management — and should not block feature
   work mid-branch. Wire it as part of the pre-merge hardening pass, alongside making `tsc` a
   gate (`docs/technical-debt-2026-08-31.md` D1).

## Packaging and release

- App icon files for Windows and macOS (`.ico` / `.icns`)
- ~~Code signing and notarization~~ — Done, see "macOS code signing + notarization" above.

## Security and hardening

- ~~**macOS safeStorage Keychain prompt on every launch**~~ — Done, proper fix landed: see "macOS
  code signing + notarization" above. Real Developer ID signing gives builds a stable code
  identity across updates, which is what stops the repeated Keychain prompt (and stops
  Tone3000/AI-key data from being orphaned on every update). Not yet verified against a real
  tagged release build.

- ~~Move Tone3000 OAuth token storage from plain `userData/tone3000-tokens.json` to `safeStorage` with migration from the old plain JSON file.~~ â€” Done. `tone3000-tokens.bin` written via `safeStorage.encryptString`; legacy `.json` is auto-migrated and unlinked on next save (`loadTone3kTokens` / `saveTone3kTokens` in `main/index.ts`).
- ~~Move AI provider keys (OpenAI, Anthropic, etc.) to `safeStorage`.~~ â€” Done. Per-provider `ai-key-{provider}.bin` files via `storeAiKey` / `readAiKey`. Keys never travel back to the renderer (saved by name; never re-emitted).
- ~~Add external URL validation in main process (`openExternal`, `window.open` handling) and allow only expected schemes.~~ â€” Done. `openExternalSafe(raw, allowedProtocols)` gates `shell.openExternal`; default allowlist is `['https:', 'mailto:']`. Used by the `app:openExternal` IPC handler and by `webContents.setWindowOpenHandler` for child-window requests.
- ~~Standardize renderer links on `window.api.openExternal(...)` instead of raw `window.open(...)`.~~ â€” Done. Zero `window.open(` / `window.location.href =` usages remain in `src/renderer/`.
- ~~Add URL guardrails for remote download helpers~~ â€” Done.
  - Tone3000 model + cover URLs are filtered through `isAllowedTone3000Url` (https:// only, hostname must be `tone3000.com` or `www.tone3000.com`) before any `fetch`.
  - `cover:downloadFromUrl` accepts only `http:` / `https:` URLs via `parseAllowedUrl`, validates `Content-Type` starts with `image/`, and restricts the saved extension to a known image-format whitelist.
- Review the broad preload / IPC surface and plan a narrower permission model before any store-distribution push. The preload currently exposes ~80 IPC channels â€” many of them broad filesystem operations (read/write/move/trash arbitrary paths). For app-store distribution this would need either: (a) per-channel scope/origin checks, (b) renderer-supplied paths restricted to user-selected dialogs/drops only, or (c) splitting trainer / library / Tone3000 IPC namespaces with separate preload scripts. Pending.
- Evaluate whether `sandbox: false` can be tightened without breaking file management, trainer flows, or local image rendering. `contextIsolation: true` and `nodeIntegration: false` are already in place, which provide the strongest practical boundaries â€” but a true `sandbox: true` would force the preload to be sandboxed too (no `require` of arbitrary modules) and would need a refactor of the preload's `electron`/`webUtils` imports. Pending; do this as a separate test-heavy pass.

## Pack Info and export

- Pack Info export markdown: add support for indented / nested bullet lists in the PDF export parser
- Pack Info `Copy to...`
- Pack export subfolder filter
- Pack export body text size and footer text size controls
- Add selection-based spreadsheet export from the file list and grid, e.g. right-click selected rows -> `Export these to Excel`, so small ad hoc subsets do not require a separate filter or folder.

## Library and file management

- Per-capture images
- OS `Open folder in NAM Lab`
- Append to comments (batch)
- Investigate: refresh after copying files may not be fully working. Suspected cause (needs more testing to confirm): `handleCopyToFolder` (`App.tsx` ~2724) only calls `refreshFolderTree()` after a copy, which rescans the folder tree/nav plus pack-info and bundle folder lists (`refreshFolderTree`, ~1898) - it does not reload the currently-open folder's file grid (`loadFolderByPath`/`loadFiles`). If the destination is the folder currently being viewed (or the user copies into a subfolder then navigates there), the newly copied files may not show up until the folder is manually reselected/reloaded. Confirm repro, then decide whether to also reload the current file list when the destination matches (or is under) the currently open folder.
- ~~**Duplicate move destination picker**~~ âœ“ â€” Already implemented; "Change folderâ€¦" button in DuplicatesModal lets user pick destination before moving.

## Import and performance

- Blank xlsx import template with lookup dropdowns
- Large collection / network share load performance: add mtime cache
- Tone3000 search follow-up: if the API stays limited, explore a bounded multi-page fetch/cache strategy for narrow searches, favorites, or creator-focused browsing without trying to mirror the full catalog locally.
- Tone3000 OAuth picker/select flow: add a hosted Tone3000 picker path alongside direct API browsing, so users can choose tones through Tone3000's recommended Select OAuth flow without replacing the current NAM Lab browser/download workflow.

## Onboarding and discoverability

- Inline `?` help popovers on complex fields (Python path, training presets, metadata suggestions, watch folders) â€” one-click "how to set this up" context that doesn't require opening docs.
- Setup wizard (non-forced): shown on the home/empty state when no folder is loaded (first launch experience), and accessible anytime from the Help menu. Covers: (1) loading a NAM folder, (2) key settings walkthrough with plain-language explanations of what each does, (3) capture defaults and what "fill on load" means, (4) Python/training setup if the user wants local training. Not a blocker â€” dismissible at any point.
- Clean function wizard: step-by-step guide explaining what the Clean tool does, when to use it, and how to configure it safely before running it on a real library.
- Metadata suggestions wizard: walkthrough for building suggestion rules â€” explains the concept, walks through creating a first rule, shows a live preview of what would change before the user commits.
- Capture defaults "fill blank on load" toggles: add a checkbox next to each capture default field so users can opt in to auto-populating that field when loading a .nam that has it blank, without needing to configure a full metadata suggestion rule.
- Settings discoverability: the app has grown deep â€” consider a search-within-settings feature or a "Quick Setup" shortcut panel that surfaces the most commonly needed first-time settings (Python path, default folder, modeled-by name) without scrolling the full settings page.

## Grid and UI

- Pack Info / Parse Pack Notes guidance + parser follow-up: clarify in the UI that glossary parsing only recognizes `TOKEN = meaning` or `TOKEN: meaning` today (not `TOKEN – meaning`), make the parser more forgiving for human-written legends that use dash separators, document the intended workflow ("parse into Glossary first, then create folder-scoped rules from curated glossary rows"), and review better default field-targeting for shorthand tokens such as `VAR`, `LO`, `BRI`, `WRM`, `SCP` (likely `nl_amp_switches`) versus cab/DI legend tokens like `DI`, `Mars`, `Mars BE`, `Mars 2` (likely glossary-only or `Comments` by default).

- Metadata header path display: consider a second muted/grey full-path presentation or alternate layout that shows more of the real file path without stealing too much editor real estate.
- Metadata editor: make `Trained By` editable instead of read-only when we are ready to expose trainer/source editing in the normal UI.
- Metadata editor layout: swap the icon/type and date placement in the stats/header area so the date sits on top and the type/icon treatment moves below it.
- Card view right-click "Get Cover Image": for folders without an ampcover, let the user fetch one from the web and save it as `ampcover.jpg`. See implementation notes below.
- Card view size picker: add a small/medium/large toggle (or slider) in the card view toolbar so the user can adjust card size to suit their display/resolution without leaving the view.
- ~~**Simplify the folder tree right-click menu — currently cluttered and overwhelming.**~~ — Done. User (2026-07-10): "very cluttered and overwhelming." `FolderTree.tsx`'s single-folder context menu now promotes 5 always-visible actions (Reveal in Explorer, Import metadata from spreadsheet, New subfolder, Rename folder, Save all in folder) to the top, per the user's explicit pick. Everything else stays in the existing Folder/Metadata/Maintenance/Organize-Export groupings, now collapsed by default behind a clickable header (`MenuSection` component) — collapse state persists via `localStorage` (`nam-tree-menu-collapsed-sections`) across all folders. Multi-select folder menu (2+ folders) is unchanged.

## Keyboard shortcuts

- Define logical shortcut keys for card view navigation (open card view, browse into folder, open folder, back) and common file operations (save, revert, batch edit, next/previous file)
- Add a Keyboard Shortcuts section in Settings for discovering and customizing key bindings

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule

## NAM A2 / PackedWaveNet (future)

- **[PENDING UPSTREAM] PR #676 ESR convention change** — NAM `main` (merged 2026-06-08, not yet released; latest release is v0.13.0 from 2026-06-02). Changes `metadata.training.validation_esr` for A2 from **sum** of both sub-models to **`esrs[-1]`** (channels_8 Full). Also changes epoch `ESR` metric from sum → mean, and removes the `"Aggregate error-signal ratio = X"` stdout line. When a NAM release ships this:
  - `main/index.ts` ~1681: change `finalEsr` for A2 to use `subFull` (channels_8) directly instead of the aggregate/mean.
  - `main/index.ts` ~1624: remove the now-dead `Aggregate error-signal ratio` stdout regex and `epochValidationEsrAggregate` tracking.
  - `esr.ts`: decide threshold treatment for externally-trained A2 captures (no `a2_full_validation_esr` field) whose `validation_esr` will now be a real Full value — either accept slight threshold mismatch or add a versioning convention.
  - Full analysis and action items in `docs/a2-status.md` under "Upstream ESR convention change — NAM PR #676".

- A2 architecture research (done): A2 = PackedWaveNet / Slimmable NAM â€” released in `neural-amp-modeler` source. Uses a fundamentally different model: single flat config with 23 sub-layers, `LeakyReLU` activation, Fibonacci-ish dilations `[1,3,7,17,41,101,239,â€¦]`, and two submodels (`channels_3` + `channels_8`) trained simultaneously so one run yields lite+standard outputs. Config loaded from `config_model_packed.json` resource file.
- A2 NAM Lab support: the current `__namlab__` Architecture enum trick is not applicable â€” the new `core.py` has no `Architecture` enum and no `get_wavenet_config()`. Supporting A2 requires a separate Python runner mode that calls `PackedLightningModule` directly with the packed config JSON. Doable as a new runner branch; should be treated as a separate feature once A2 stabilizes in the official NAM release.
- A2 config reference: packed config is at `nam/train/_resources/config_model_packed.json` in the NAM source; `lr=0.004`, `weight_decay=3.17e-7`, `ExponentialLR(gamma=0.994)`, `mrstft_weight=0.0005`. Two submodels: `channels_3` (nano-class) and `channels_8` (standard-class).

## Remote training (future / exploratory)

- **Remote training agent**: allow NAM Lab on one machine to dispatch training jobs to a separate, more powerful machine on the local network â€” e.g. a dedicated GPU workstation â€” while the user continues editing on their laptop. NAM Lab on the host machine would run a lightweight agent/server that accepts jobs from any NAM Lab instance on the same network.
- **Shared-drive workflow**: the simplest form of remote training would be shared-drive coordination â€” the submitting machine writes WAV pairs and a job manifest to a network path; the remote machine watches that path (via the existing Watch Folders mechanism), trains, and writes `.nam` outputs back. No custom protocol needed; just documenting the pattern and making the UX easy.
- **Remote job monitor**: a "Remote" section or dashboard card that shows live status (epoch, ESR, ETA) streamed from a remote agent, so the user can monitor a GPU workstation run without switching machines.
- **Remote queue dispatch**: extend the existing queue IPC so a job can be marked as `remote`, serialized, and sent to a remote NAM Lab agent over a local network socket (e.g. WebSocket or lightweight REST). The remote agent queues and executes it, streams back progress events, and sends the finished `.nam` back or writes it to a shared path.
- **Agent discovery**: mDNS/Bonjour-based local service discovery so NAM Lab instances can find each other on the network without manual IP entry â€” similar to how AirPlay or local dev servers advertise themselves.
- **Auth / trust model**: for any network-facing agent, define a simple shared-secret or pairing handshake so random machines on the same network cannot submit arbitrary training jobs to an exposed agent.

## Experimental training

- Training panel container usage: reduce the forced-feeling outer padding / dead margins so the trainer uses more of its available width and height, especially as the panel is resized.
- Training entry-point cleanup (partially done): standalone Training workspace exists and is the main surface now; finish retiring or simplifying the old file-level `Metadata | Training` pairing so metadata stays the file editor surface and Training lives as its own standalone workspace/tool.
- Training comparison test: run the same capture through a full `1000 epoch REVxSTD` build in both NAM-BOT and NAM Lab, then compare the resulting `.nam` files directly and also do a listening check to confirm they sound the same (or understand why they do not).
- ~~Training queue controls/icons~~: already SVGs â€” done.
- Training panel layout (partially done): a first cleanup pass happened, but the Training section still needs a dedicated neatening pass so Run WAVs / Run Folder / Queue, routing, and custom controls use space more gracefully and read more cleanly.
- ~~Training architecture picker UX: validate on queue that at least one profile is selected~~ â€” Done. `handleQueue` blocks with "Choose at least one architecture before queueing." when `targetArchitectures.length === 0`; same guard on preset-save flow.
- ~~Training queue status line: fix the misleading green running summary~~ â€” Done in the workspace redesign. Now strip shows the active job name or "Queue idle"; the "Queue Running - 0 queued" wording is gone.
- ~~**Training history graph preview**~~ â€” Stale; training page redesigned.
- ~~Training watch presets: support more than one preset per watch folder~~ — Done. Replaced by Training Bundles: named groups of presets that fan out into multiple training recipes; watcher profiles now reference a bundle ID.
- ~~**[HIGH PRIORITY] Per-architecture batch settings**~~ — Done. Training Bundles let each preset store its own architecture list, epoch count, and all other settings; one submission fans out across all presets in the bundle.
- ~~**[HIGH PRIORITY] New training output folder detection**~~ — Done. A green dismissable banner appears in the Queue section when a batch completes, collecting unique output folder paths from successful jobs.
- ~~**[HIGH PRIORITY] Queue visual ordering after restart**~~ — Done. `getPersistableTrainerQueueJobs()` now filters the original array in-place (builds a set of kept terminal IDs) so submission order is preserved exactly on reload.
- Batch edit — architecture changes: the current Edit modal (epochs / ESR / LR) does not support changing architecture(s). Adding architecture changes is significantly harder because each architecture is its own `TrainerQueueJob` with a separate model name, output path, workspace path, and waveNetConfig. The clean approach is to rebuild the queued job set for the submission: remove all current queued jobs in the submission, then create new ones from the edited payload (same WAV list + new architecture list + updated settings). Needs: (a) store `namingTemplate` and the original WAV output paths on each job (already done — `namingTemplate` added to `TrainerQueueJob`); (b) an IPC handler that takes `(submissionId, { architectures, epochs, thresholdEsr, lr, lrDecay })` and rebuilds the queued jobs; (c) extend the Edit modal with the architecture multi-select. Be cautious: rebuilding jobs resets their `jobId`, `workspacePath`, `outputModelPath` etc. — any running job in the batch must be left alone (only rebuild `queued` jobs).
- **Bug: drag-and-drop in the training queue — PARTIALLY improved (2026-07-10), still not fully reliable. See the dedicated HIGH PRIORITY section near the top of this file.** The 2026-07-10 pass fixed several concrete defects in the hand-rolled mouse-event drag — (a) `elementFromPoint` returned null in the 12px gaps between cards / over padding, so drops there silently did nothing → now falls back to the vertically nearest card within 80px; (b) no visual feedback → the target card now shows an accent ring; (c) the IPC result was discarded so a rejected reorder looked like success → failures now surface in the queue error banner; (d) `moveSubmissionBeforeSubmission` required the *target* batch to have a queued row so dragging above the running batch failed outright → now falls back to the target's first row of any status; plus successful drags finally have a scheduling effect (sticky-preference fix below). **But per the user it still does not reliably drag COLLAPSED batches and has no proper drag ghost/preview image** — the remaining work is scoped in the HIGH PRIORITY section.
- **Per-job drag WITHIN a batch (future, per user):** job rows still use native HTML5 `draggable`/`onDrop`, which doesn't fire `drop` reliably in Electron on Windows — port to the same mouse-event pattern as batch drag when picked up (`reorderTrainerJob` IPC already exists). User: within-batch only, never across batches.
- **[RE-EVALUATE] Prompt for queue placement when queueing while the queue isn't empty.** User (2026-07-10): "i added a new batch while queue not empty, i thought fable had a pass that would ask if you want it at the top, next, or add to do to re-evaluate that" — expected a dialog asking where a new batch should land (top / next / end) when submitted while something is already queued or running. Searched all branches/history (`git log --all -p -S` for queue-placement-choice code, "Add to top", "where would you like", etc.) and found **no trace this was ever implemented** — either it was scoped/discussed in an earlier session but never actually built, or it's a mix-up with a different app/session. Treat as a fresh feature to build, not a regression to restore.
  - Underlying behavior today (unchanged): `enqueueTrainingPayloads` (`main/index.ts` ~3136) always does `trainerQueue.push(...jobs)` — straight append to the end, no prompt. Finished/failed/canceled rows deliberately stay in the queue until cleared (so a running batch stays visible), which means a freshly queued batch often visually lands right under the current batch simply because the running batch is the last "live" entry before it.
  - If built: reuse the existing reorder primitives already shipped (`moveSubmissionBeforeSubmission` / `moveSubmissionToEnd` / the sticky-preference fix from the 2026-07-10 queue-semantics pass) rather than inventing new queue-placement logic — the prompt would just be a UI-level choice that calls into machinery that already exists and is already correct.
- **Drag-and-drop a WAV file onto an existing batch card (Queue or Staged Batches) to append it to that batch.** User (2026-07-10): "say i add 5 captures, its running 2 of 5...and i find a 6th file i want to add to this batch, i just drag it to the batch window and it adds it to the end of that batch." Assessed as medium difficulty, not a deep architectural change:
  - **The hard part is already solved.** `groupedQueue`/`groupedStagedQueue` (`TrainingPanel.tsx`) group jobs by `submissionId` regardless of array position/insertion order — a new job pushed with the SAME `submissionId` as an existing batch will automatically render merged into that batch's card. No new grouping/merging logic needed; `enqueueTrainingPayloads` (`main/index.ts:3146`) already does the actual enqueue.
  - **Real work needed:** (a) a drop handler on the batch card `<div data-submission-id=...>` in both the Queue Batches view (`TrainingPanel.tsx` ~3221) and the separate Staged Batches rendering; (b) build a `TrainerStartPayload` for the dropped file by cloning settings (architecture, epochs, LR, thresholdEsr, output routing/naming template, Input DI, `submissionId`) from an existing job already in that batch — same WAV-drop pattern the Create Batch form already uses (`addWavsToBatchList`, ~line 4212), just targeting an existing submission's template instead of the form's current draft settings.
  - **The one genuinely fiddly part:** multi-architecture batches. If the original 5 captures were fanned out across multiple architectures (e.g. both A1-Standard and A2), dropping 1 new file should likely create one new job PER distinct architecture already present in that submission, not just one job — mirroring the original fan-out. Needs a real decision, not just code.
  - **Scope decision:** probably disallow dropping onto a `watcher`-sourced batch (`sourceMode: 'watcher'`) — manual mid-batch additions don't fit that source mode's model, and the user's described scenario is a manual "Run WAVs" batch anyway.
- ~~**[VERY SOON] Training queue semantics pass: reorder / park / sticky-batch behavior.**~~ — Done (2026-07-10), all sub-items shipped:
  - ~~`Run next` / move-to-top doesn't actually run next~~ — Fixed. New `trainerStickyPreferenceCleared` flag: every explicit reorder (batch drag, Run next, per-job Next, watcher retry-now) recomputes whether the first queued job now belongs to a different batch than the active one; if so, the next pump after the current job finishes uses pure queue order instead of the sticky preference. The running job is never interrupted, and reordering the active batch back to the front restores normal batch-continuation (recomputed, not latched).
  - ~~Batch reordering moves every non-active row~~ — Fixed. `moveSubmissionBeforeSubmission` / `moveSubmissionToEndOfQueue` now move **queued rows only**; the active job stays pinned, staged rows stay in Staged Batches, terminal rows don't participate. The grouped-card UI already merges split batches and anchors card order on the first queued/running row, so rows left behind never split a card.
  - ~~Park wording~~ — Fixed. "Park batch" tooltip now says explicitly: finishes the current capture if one is training, then freezes the rest in Staged Batches; does NOT stop the active run (Emergency stop does that).
  - Restart behavior preserved as-is (starting/running rows demote to queued on load, queue paused) — untouched.
  - ~~Parked-batch finished rows review~~ — Decided (user): keep finished rows visible in the queue card. `pruneFinishedBatchesFromQueue` no longer skips staged rows when deciding all-success, so parking a half-done batch keeps its finished rows in the queue as a progress record until the parked remainder is unstaged and completes.
- Queue grouping (partially done): queue/history rows already carry submission grouping for `Run WAVs`, `Run Folder`, and `Watcher`; remaining work is to deepen the batch/session UX where it helps without complicating the serial executor.
- ~~Live A2 ESR labeling~~ — Done. The live stat card now shows `Validation ESR (Full)` for A2 runs.
- ~~Queue/history grouping UX: collapsed/expanded batches~~ â€” Done. Queue cards have per-batch chevron + Expand-all / Collapse-all buttons in the filter bar; same on Staged Batches header.
- Training preset sharing: consider an export/import format so Capture Profile configs can be shared between users as standalone recipe files.
- Training history (partially done): reviewable grouped history exists; add export/report workflows and make sure the long-term storage/revisit experience is as useful as the live queue.
- **Plan a retry workflow rethink.** Current retry behavior always creates a brand-new submission (`Retry - ...`) rather than mutating the old history/queue row in place. That is technically safe, but it may not match user expectations when the failure is clearly non-retryable (for example a NAM pre-check failure like bad validation replicate/self-ESR). Plan a UX pass before changing behavior:
  - Decide whether Retry should stay as "always re-queue a fresh batch" or split into clearer actions such as `Retry`, `Retry as new batch`, `Re-run failed capture`, or `Duplicate settings`.
  - Consider context-sensitive behavior for known non-retryable failures: disable Retry, warn first, or offer a more specific action like `Open log` / `Review source WAV` instead of implying the same input will likely succeed on a second try.
  - Revisit whether the original failed row should remain visually distinct from the new retry submission, and whether there should be an explicit parent/child link between them in History.
  - If the workflow changes, update help/tooltips so users understand whether retry reuses current settings, current Input DI, current routing, and backup-overwrite behavior.
- Training watcher intake: maybe later, if the final expected output file is missing, allow reprocessing even when matching history already exists.
- Training verification report (partially done): WAV Check tab added â€” compares NAMs in the current folder against a user-chosen WAV staging folder, shows trained/missing/extra counts, and provides per-row Train and Train All buttons that enqueue jobs and jump to the queue view; remaining work is to surface ESR targets, epoch counts, and architecture verification against preset expectations.
- Training verification report (WAV Check tab, `WavCoverageTab.tsx`): add export for missing-only items from either side - the "Missing NAM" (red, WAVs with no trained NAM) and "No Source WAV" (amber, trained NAMs with no matching WAV) sections currently have no export at all. Also add a per-section "Copy all names" action for each column - today the only copy affordance is a per-row right-click "Copy filename" context menu (one file at a time), there is no bulk copy of every missing name in a section to the clipboard.
- Training workflow (partially done): submission groups exist in queue/history; later consider a higher-level `job / batch` concept where one queued item can represent a multi-format set while watcher mode remains a separate automation layer.
- Training settings IA (partially done): training already has its own Settings tab; revisit once watcher folders, presets, history, and verification need more room or more specialized navigation inside Training itself.
- Training watch/preset UX: redesign watch folders and presets into a cleaner expandable master-detail style, so the user first sees a compact list with key summary fields and only expands/drills into one item at a time to edit the full details.
- ~~Training drag-and-drop WAV intake~~ — Done. The WAV list drop zone in Create Batch accepts WAV files and folders from Windows Explorer/Finder via `webUtils.getPathForFile`.
- **[HIGH PRIORITY] Training history: per-batch expand/collapse + investigate paging.** Queue and Staged Batches both already have per-batch collapse (chevron, backed by the shared `collapsedBatches` set) plus filter-bar "Expand all" / "Collapse all" buttons (`TrainingPanel.tsx` ~3038 and ~3465) - History has neither. Every group in `groupedHistory` always renders all of its entries unconditionally (~3820), so a batch with many captures cannot be collapsed at all, and there is no global expand/collapse toggle in the History filter bar. Add the same collapsedBatches-backed chevron per group plus matching Expand all / Collapse all buttons, reusing the existing pattern rather than inventing a new one.
  - Also look into paging (or windowed/virtual scrolling) for History: the tab currently renders every entry into a single grouped list, and with 1000s of past runs the page becomes heavy. Default ~50-100 entries per page, with Older/Newer controls and a Show all escape hatch. Filter/search must apply across the full history, not just the current page. Worth checking whether per-batch collapse alone (above) is enough to keep things light before committing to full paging/virtualization.
- Training dashboard counter behavior: verify the intended lifecycle of the Dashboard `Completed` / `Failed` / `Queue progress` tiles end-to-end. Expected today: (a) within a session, the counters stay at the last finished queue's totals until a new batch is queued, at which point finished/error/canceled rows auto-clear from the queue and the tiles reset to 0; (b) across app restarts, the queue persistence file only stores `staged + queued + running` jobs so success/error rows never round-trip and the tiles read 0 on cold start. Run the scenarios â€” finish a queue and reopen the dashboard, queue a new batch and confirm the counters drop, close the app and reopen with nothing pending, close with staged batches pending â€” and see if the lived behavior matches expectations. If the "counters stuck at last run's count" reminder is more confusing than helpful, switch the Completed/Failed tiles to read from `todayStats` (history-today scope) instead of the in-memory queue so they read as a session counter.
- OS drag-and-drop from Explorer/Finder: main library area (`handleOsDrop` in App.tsx) and training WAV intake are done. Remaining: wire drag-drop intake in gear-locker and expense-tracker.

## Metadata suggestions and organization

- Refine overwrite guards for metadata suggestion rules with a friendlier UI than a raw comma-separated text field (for example chips, multi-pick placeholders, or explicit junk-value presets).
- Expand friendly pattern-rule support beyond the first-pass `Prefix + value` matcher for settings strings like `G5.5`, `G1.2`, `G8`.
- Phase II / discussion: support broader wildcard or regex-style suggestion rules for patterned metadata tokens where one rule should recognize a family of values without requiring a separate exact-token rule for every variant.
- Discussion: explore reverse-template / pattern-based rules that extract metadata from naming structures (for example something in the spirit of `{tone_type} {creator} {cabinet}`) without requiring users to understand regex.
- Design a safe explicit-source workflow to collect `.nam` files from user-chosen intake folders into a working folder, without trying to automatically infer which existing folders are "loose" versus valid staging/archive/release locations.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
- AI-assisted suggestion rule discovery: explore sending a sample of a folder's filenames and existing metadata values to the AI and asking it to identify meaningful token patterns worth turning into suggestion rules â€” e.g. it notices `G5.5` / `G1.2` prefixes map to `input_level_dbu`, or that a filename segment always matches `gear_model`. Would need a clear review/confirm step before any rules are committed.

## Future: read IR Lab's embedded WAV metadata, IR library management

Not started -- came up 2026-08-21 discussing whether cab-IR organization belongs in an app or in
Finder/Explorer folders. IR Lab (sibling native app, same author, `Documents/GitHub/ir-lab`) already
collects real capture metadata per IR at capture time (cabinet, speaker, microphone, position,
notes) but today only bakes it into the exported filename, not into the WAV file itself. IR Lab has
a planned to-do to start writing that metadata into the WAV's own BWF `bext` chunk (and/or a
LIST/INFO chunk) on export, the same mechanism field recorders use for scene/take/mic-position data
-- see that repo's own tracker for status before starting this.

Once IR Lab writes that metadata, this app could read it back out and offer real IR library
features that plain folder browsing can't: faceted search/filter (cabinet x speaker x mic x
position, cutting across folders rather than needing pre-sorted directories), audition-in-place,
waveform preview, and duplicate/near-duplicate detection. Two Notes Wall of Sound and TONE3000
(formerly ToneHunt, the actual `.nam` community library) are the closest existing references for
what this kind of browser should feel like -- TONE3000 in particular is the direct analog for a
`.nam`-and-IR library UI, since it already solves tag search + in-browser preview + community
sharing for exactly this file-type pairing.

Scope this as its own project once IR Lab's write side exists, not before -- there is nothing to
read yet, and the metadata schema (which fields, what they're called) should be decided jointly
with IR Lab so both apps agree on one taxonomy rather than inventing two.

## Future: import IR Lab's "NAM Capture" projects into the trainer queue (automated workflow)

Not started -- blocked on IR Lab's own NAM Capture feature stabilizing (still being actively built
on the Mac side as of 2026-08-29, 28 commits deep already: `docs/nam_capture_plan_2026-08-28.md`,
`src/session/NamCaptureStore.h/.cpp`, `src/ui/NamCaptureWorkspace.cpp` in that repo). This section
records the plan and the schema confirmed against that source tonight -- **re-verify against IR
Lab's actual code before implementing anything**, the same discipline `labProjectEnrichment.ts`'s
own header comment already follows for the (different, older) IR-capture schema, since this is
explicitly not finalized yet.

### The goal

IR Lab's NAM Capture mode captures a DI/reamp pair (excitation played through real hardware or a
plugin, the return recorded) with no IR-specific processing at all -- exactly the input/output WAV
pair NAM Lab's own trainer already consumes as `inputPath`/`outputPath`. The end-to-end workflow:
capture in IR Lab -> NAM Lab discovers it automatically -> queues it for training with zero manual
file-picking -> once trained, IR Lab can show which of its captures already became a model.

### What IR Lab already writes (confirmed against `NamCaptureStore.cpp`, 2026-08-29)

One folder per capture, no nesting -- same convention as IR Lab's own IR captures
(`docs/ir-lab-session-file-format.md`):

```
<project.outputRoot>/<sanitizedName>-<captureId>/
    excitation.wav      -- 32-bit float mono, the DI/reference signal played
    recording.wav        -- 32-bit float mono, same sample count, the captured return
    nam-capture.json
```

`nam-capture.json`: `schemaVersion` (1), `captureId`, `captureName`, `createdAt`, `app` ("IR Lab"),
`captureScope` ("Cabinet"/"Device"/"Software"), `excitation`/`recording` (relative filenames --
explicit, not inferred from naming convention), `excitationSourceName`, `stimulusSha256` (optional,
SHA-256 of the source stimulus file's bytes), `sampleRate`, `measuredLatencySamples`, `projectId`,
`projectName`, and -- only present when true -- `synthetic` + `syntheticSourceIrName` for a DI x IR
convolution render (a synthesized capture, not a real mic'd/device recording).

The explicit `excitation`/`recording` field names are the important design win here: NAM Lab's
existing folder-watcher has to infer the DI/reamp pairing from a naming convention today: this
schema removes that guesswork entirely.

### Proposed plan (NAM Lab side, once the schema is confirmed stable)

1. **Discovery.** A new pass, sibling to `labProjectEnrichment.ts` but for this different schema --
   scan a watched/scanned folder tree for `nam-capture.json` files (do not conflate with IR
   captures' `session.json`/`analysis.json` shape, these are unrelated capture types from the same
   app). Decide whether this lives in `irCatalog/` (cataloged like everything else IR Lab writes) or
   is purely a trainer-queue feed with no catalog row of its own -- leaning toward the latter
   initially, since "a NAM Capture becomes a model" is a training-pipeline concern, not a
   browse/search one, and IR Lab's own plan doc says NAM Capture projects get "no metadata curation
   UI" on IR Lab's side either.
2. **Mapping to a trainer job.** `excitation.wav` -> `inputPath`, `recording.wav` -> `outputPath`,
   `captureName` (sanitized) seeds the default model name, `sampleRate` cross-checked against
   whatever the training profile expects. **Never auto-queue a `synthetic: true` capture** -- surface
   it distinctly ("synthetic -- DI x IR convolution, not a real capture") since training on a
   convolved render instead of an actual mic'd/device capture would silently produce a misleading
   model, exactly the provenance concern IR Lab's own plan doc raises for this flag.
3. **Auto-queue vs. review.** Given the ask is specifically an *automated* workflow: a setting
   ("Auto-queue new NAM Captures found in watched folders", default off to start) that, when on,
   queues a real (non-synthetic) capture the moment its `nam-capture.json` appears with no matching
   `nam-lab-result.json` yet (see below) already next to it. Off by default: surface a reviewable
   list instead ("N new NAM Captures found -- Queue selected"), same shape as the trainer's existing
   manual-folder-run flow.
4. **Feeding the result back to IR Lab.** Once a job sourced this way finishes, write a sidecar NAM
   Lab owns exclusively -- `nam-lab-result.json` in the SAME capture folder, never written or edited
   by IR Lab (single-writer-per-file, same principle `docs/ir-lab-manager-shared-catalog-schema.md`
   already establishes for the shared catalog) -- recording `outputModelPath`, `architecture`,
   `validationEsr`, `trainedAt`, and NAM Lab's own `trainerHistoryId` as a cross-reference into its
   own `trainer-history.json` for full detail. IR Lab's side (not this app's job to build) can then
   show "Trained ✓" against a capture purely by checking whether that file exists -- no coupling
   beyond reading one JSON file, no shared database, no IPC between the two apps.
5. **Re-verify the schema.** Before writing any of the above, diff `nam-capture.json`'s actual shape
   against what's recorded here -- this was captured mid-build on 2026-08-29 and the plan docs in
   that repo (`nam_capture_plan_2026-08-28.md`, `nam_capture_buildout_2026-08-28.md`) themselves
   describe open questions still being resolved.

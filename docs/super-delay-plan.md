# Super Delay — research & design notes

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

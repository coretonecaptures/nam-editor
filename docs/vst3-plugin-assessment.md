# VST3 plugin — feasibility assessment (not started)

Assessment only, requested 2026-08-05 before any build work. Question: what would it take to
package the presets and all FX (Gate, EQ, Modulation, Delay, Echo Lab, Reverb, amp modeling) into a
real VST3 plugin.

**Verdict up front:** a real, multi-month C++ audio-engineering project, not a packaging exercise.
The web version's *design* (what each effect does, parameter ranges/defaults, preset shapes, the
whole signal-chain architecture) transfers almost completely and is genuinely valuable — the hard
"what should this sound like and look like" decisions are already made. Almost none of the *code*
transfers: Web Audio API nodes (`BiquadFilterNode`, `DelayNode`, `ConvolverNode`, `WaveShaperNode`,
etc., all of `liveEngine.ts`) are Chromium-internal and don't exist outside a browser. Every effect
needs reimplementing from scratch in a real-time-safe systems language.

## What actually transfers

- **The NAM inference core.** `native/nam-wasm/NAM/` already vendors Steven Atkinson's C++ DSP core
  (via Tone3000's WASM fork). The WASM build itself wouldn't be used in a plugin, but the
  underlying C++ source could be — and there's a directly relevant precedent: Atkinson's own
  official Neural Amp Modeler plugin is built in C++ with **iPlug2**, using this exact DSP core.
  Most de-risked part of the project.
- **The design spec of every effect** — Echo Lab's Single/Dual topology, the harmonic-tremolo
  complementary crossover, the ping-pong math, every parameter's range/default — reusable as a spec
  to build the real-time version against, even though none of the implementing code carries over.
- **Preset data shapes.** `EchoLabSettings`, `DelaySettings`, etc. are typed value bags; the shape
  maps reasonably directly onto a VST3 state-serialization blob. The mechanism differs, the schema
  doesn't.

## What has to be built from zero

- **Every FX block as native DSP** — Gate, EQ, Chorus/Tremolo, Delay, Echo Lab, Reverb. Hand-written
  biquad filter math, delay-line read/write with feedback, a real convolution engine (partitioned
  FFT, not a browser built-in) for the IR-based modes, waveshaper curves, LFOs, channel matrixing.
  This is the bulk of the effort. Echo Lab alone (dual topology, three Characters, the ducking
  envelope follower, the ping-pong crossfade) is a nontrivial DSP module on its own.
- **Real-time-thread safety, throughout.** A VST3 `process()` callback runs on a hard-real-time
  thread with a strict time budget: no allocation, no locks, no blocking I/O, nothing
  garbage-collected. Web Audio's engine handles that discipline invisibly today; a native rewrite
  has to earn it explicitly, including a lock-free UI-thread-to-audio-thread parameter hand-off.
- **The UI.** Two real paths:
  - Rebuild the photoreal rack UI (`RackKnob`/`RackFader`/`RackButton`/`RackLed`, all the panel-art
    positioning) natively in a C++ GUI framework.
  - Or embed a WebView inside the plugin (JUCE 7+ has first-class support) and reuse the actual
    React components almost as-is, talking to the audio engine over a message bridge instead of
    Electron IPC — preserves far more of the existing frontend work, at the cost of WebView quirks
    in some hosts (sandboxing, Windows needing WebView2/Edge present) and a less "native" feel.
- **VST3 SDK integration** — parameter registration/automation, host communication, passing
  Steinberg's validator, state save/load wired to the real parameter tree.

## Framework choice

**iPlug2** is the more natural fit given the NAM lineage — same framework the official NAM plugin
already uses, likely faster onboarding for the amp-modeling piece, has WebView UI support if that
route is chosen. **JUCE** is the more general-purpose, larger-ecosystem alternative (more built-in
DSP building blocks that could shortcut some effect reimplementation) and also has mature WebView UI
support now. Either is legitimate; iPlug2 edges it given what this app already builds on.

## Format/scope note

VST3 alone is Windows/macOS/Linux. AU (Logic/GarageBand) and AAX (Pro Tools) export from the same
JUCE/iPlug2 codebase reasonably well — but AAX specifically requires an Avid developer agreement and
licensed SDK, a legal/business step on top of the engineering, not just another compile target.

## Bottom line

Think "hire or become a C++ audio plugin developer for a few months," not "wrap the existing app."

# Third-party notices

NAM Lab's own code is MIT licensed — see `LICENSE`. This file covers what it's built on top of.

## Neural Amp Modeler (Steven Atkinson)

This app reads and writes the `.nam` capture format, and its in-app tone preview player vendors
and compiles a copy of the NAM DSP core to WebAssembly (`native/nam-wasm/NAM/`, sourced via
Tone3000's [`neural-amp-modeler-wasm`](https://github.com/tone-3000/neural-amp-modeler-wasm) fork,
upstream commit `755686ee86894d89f463200f4574764dd1dd4290`). The compiled output of that core ships
in the app as `nam-offline.wasm` / `nam-worklet.wasm`.

```
MIT License
Copyright (c) 2023 Steven Atkinson
```

Full text: `native/nam-wasm/LICENSE.upstream`. NAM Lab is an independent tool built to work with
files produced by, and DSP originated in, Steven Atkinson's
[neural-amp-modeler](https://github.com/sdatkinson/neural-amp-modeler) project (also MIT, same
copyright holder) — it is not affiliated with or endorsed by that project.

## nlohmann/json

Vendored single-header JSON library used inside the WASM build (`native/nam-wasm/vendor/nlohmann/`).

```
MIT License
Copyright (c) 2013-2025 Niels Lohmann
```

## Eigen

The WASM build links against [Eigen](https://eigen.tuxfamily.org) for the DSP core's matrix math.
Eigen is fetched at build time (`native/nam-wasm/build.sh`) rather than committed to this repo, but
its compiled code is statically linked into the shipped `.wasm` output. Eigen's core is licensed
under the **Mozilla Public License 2.0**; unmodified upstream source is publicly available at the
link above, satisfying MPL 2.0's source-availability terms for the unmodified portions in use here.

## TONE3000

NAM Lab integrates with the [TONE3000](https://www.tone3000.com) API for browsing and downloading
community tone captures. Use of that API is governed by TONE3000's own API Terms of Service and
Design Requirements (see tone3000.com/api), which require TONE3000 branding/attribution to be
shown in-app wherever TONE3000 content is browsed or loaded (entry points, tone list views, loaded
tones within a signal chain, and tone detail views). **That in-app branding/attribution has not yet
been audited for compliance as of this file's creation (2026-08-05)** — this note exists so it
doesn't get silently dropped; see the architect review for tracking.

## Fonts

`@fontsource/doto`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`,
`@fontsource/barlow-semi-condensed` — all SIL Open Font License / Apache-licensed families,
redistributed by the Fontsource project. No additional attribution required beyond what's already
in each package.

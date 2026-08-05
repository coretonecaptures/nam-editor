# Senior architect review — NAM Lab player + app surface

Requested review of the live player's design plus a security/legal sweep of the broader app, done
in one pass on 2026-08-04 alongside building the Echo Lab unit. Two people effectively wrote this:
the player-architecture section is a direct account from the session that just built inside that
code; the security/IPC/legal section is an independent audit of the main process and preload
boundary, which nobody had reason to touch this session otherwise.

**Bottom line:** nothing found rises to "stop and fix before shipping." The one functional bug
found (a routing setting with no UI control) was fixed directly during this pass. Everything else
below is either already fine (marked Info/Good) or a deliberate trade-off worth knowing about, not
an emergency. Read the Priority list first; the rest is reference detail.

---

## Priority list (read this part)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `secondaryDelayPosition` (Echo Lab ↔ Delay routing order) was wired in DSP and shown in the chain rail, but had no UI control to change it | Bug | **Fixed this pass** |
| 2 | File-management IPC handlers (`file:read`, `file:move`, `file:trash`, `folder:*`, etc.) don't scope paths to the library root the way `isPathWithin()` already does for companion/inbox assets | Medium | Not fixed — see §2 |
| 3 | `protocol.handle('local-file', ...)` maps any `local-file://` URL straight to `file://` with no validation | Medium | Not fixed — see §2 |
| 4 | No `LICENSE` file or `license` field in `package.json` for a distributed desktop app | Info | Not fixed — legal/business decision, not a code fix |
| 5 | `sandbox: false` on the BrowserWindow | Low | Not fixed — see §2 |
| 6 | Companion HTTP bridge binds `0.0.0.0` over plain HTTP with wide-open CORS | Low–Medium | Not fixed — see §2 |
| 7 | `PlayerPanel.tsx` is ~4000 lines doing six jobs | Tech debt | Not fixed — flagged for next touch |
| 8 | No build-time check that rack-unit pixel coordinates actually match their art | Tech debt | Not fixed — flagged, see §1 |

Everything else in the full sections below is Info-level ("checked, it's fine") or a documented,
deliberate trade-off, not a defect.

---

## 1. Player / audio-engine architecture

Scope: `src/renderer/src/utils/liveEngine.ts` (~2600 lines, the whole Web Audio graph),
`src/renderer/src/components/PlayerPanel.tsx` (~4000 lines, state + two UI treatments), and the
per-unit rack components (`RackDelay.tsx`, `RackReverbTest.tsx`, `Rack500.tsx`, `RackEchoLab.tsx`).
Written from direct knowledge — this session built Echo Lab inside this exact system.

### What's sound

- **"Always wired, selected by gain" is the load-bearing convention, and it's a good one.** Every
  mode switch in this engine (Delay's ping-pong/mono, Reverb's plate/convolution, Chorus's
  standard/harmonic tremolo, now Echo Lab's Single/Dual and Ping-Pong crossfade) is built as two
  permanently-connected signal paths whose relative gain is what actually changes, rather than
  disconnecting/reconnecting nodes live. This is *why* mode switches don't click, and it's applied
  consistently enough across five-plus independent features that it reads as a genuine house style,
  not a pattern that happened once. The cost is real (idle nodes processing audio nobody hears) but
  is a correct trade against audible clicks, and is bounded — nothing here spawns nodes in a loop.
- **`enabled` means "mute the wet path," never "remove from the graph."** Delay's dry signal
  reaches `fxMid` whether or not Delay is on; same now for Echo Lab. This is what let Echo Lab's
  series-routing (`reconcileChainOrder`) stay simple — Echo Lab's own bypass state never needed to
  be part of the routing decision, only `secondaryDelayPosition` does, because a "bypassed" unit is
  still structurally transparent.
- **Settings objects are the single source of truth, engine methods are pure functions of them.**
  `setDelay`/`setReverb`/`setEchoLab` all follow the same shape: merge the patch, clamp every
  field, store it, then push every derived audio-param value in one pass. There's no partial-update
  path and no way for the stored settings object and the live audio state to drift apart, because
  every call re-derives everything from the merged object rather than diffing.
- **The `Number.isFinite` guard pattern is now applied preemptively, not just reactively.** The
  ping-pong-width NaN bug from earlier this session (an old preset missing a field → `Math.min(1,
  undefined)` → `NaN` → silently broken crossfade) got the same defensive guard copied straight
  into Echo Lab's `pingPongWidth` clamp before it could recur, rather than after a bug report.

### Real risk areas — worth deliberate attention, not urgent fixes

- **`PlayerPanel.tsx` is doing too many jobs in one file (~4000 lines).** State for six FX blocks,
  two entirely different UI renderings (popped-out rack view and inline slider view) sharing that
  state, preset CRUD for five preset types, save-as-modal logic, and live-input device management
  all live in one component. Nothing here is *wrong*, but the file is past the size where a reader
  can hold its shape in their head, and every new FX block (Echo Lab included) adds ~150-200 lines
  of near-identical preset boilerplate to it. Splitting the preset CRUD into a shared hook
  (`useFxPreset<T>(presets, current, setCurrent, onPresetsChange)`) would cut the per-block
  boilerplate by more than half without changing behavior — a real candidate for the next time this
  file is touched, not urgent on its own.
- **The engine's field count has grown large enough that partial-application bugs are the main
  risk class going forward, not audio-graph bugs.** Every new `EchoLabSettings`-style field needs
  three places to stay in sync: the interface, the clamp block in `setX`, and any UI range table
  (Echo Lab needed a fourth: `CHAR1_RANGE`/`CHAR2_RANGE` mirrored between `RackEchoLab.tsx` and
  `setEchoLab`'s own clamp — now de-duplicated by exporting the tables rather than copying them,
  but that pattern will recur for the next unit). A small dev-only runtime assertion that every key
  in a `DEFAULT_X` object has a corresponding clamp line would catch a forgotten field at first
  load instead of at "why did this preset silently reset to 0."
- **Ducking's envelope follower is a `setInterval` polling an `AnalyserNode`, not sample-accurate.**
  Deliberate and documented as such (`docs/echo-lab-plan.md`), fine for a musical ducking effect,
  but it's the first timer-driven (as opposed to AudioParam-scheduled) audio-affecting logic in
  this engine. If a second feature ever wants the same pattern, it's worth promoting to a small
  shared `EnvelopeFollower` utility rather than copy-pasting the poll loop.
- **`RackColumn`/`RackCrop`'s percentage-of-source-image coordinate system is precise but has no
  build-time verification.** Every rack unit's knob/switch/fader position is a hand-measured pixel
  constant. This session's own Echo Lab LED-alignment bug (measured by eye off a grid overlay,
  wrong by up to 19px) shows the failure mode: nothing catches a bad coordinate until a human looks
  at the render. The fix used this pass — a Python centroid/bounding-box scan against the actual
  committed asset — is the right technique, but it's a manual step a future contributor could skip.
  Worth turning into a checked-in `verify-rack-coords.py` all four units' constants run through,
  flagging any control whose measured center drifts from its declared constant.

### Bug found and fixed during this pass

`EchoLabSettings.secondaryDelayPosition` (whether the orange Delay's signal feeds into Echo Lab, or
Echo Lab feeds into Delay) was fully wired in `liveEngine.ts` and reflected in the player's
signal-chain rail — but nothing anywhere called `onChange({ secondaryDelayPosition: ... })`, so it
was permanently stuck at its default. Fixed by adding a toggle button next to the Delay/Echo Lab
view switcher in the popped-out rack header, and a matching button in the non-popout Echo Lab card,
both only shown when both units are enabled (the setting is meaningless otherwise).

No other dangling nodes, unguarded division, unbounded array growth, or missed `await` found in the
new code — every new node type has a matching field-nulling line in the engine's teardown path.

---

## 2. Security / IPC boundary / legal (main process + preload)

Independent audit of `src/main/*.ts` and `src/preload/index.ts` — the surface this session didn't
otherwise touch.

### IPC / main-process security

- **BrowserWindow config — Info/Good.** `contextIsolation: true`, `nodeIntegration: false`
  (`src/main/index.ts:5063-5068`). `sandbox: false` is set explicitly — **Low**: with
  `contextIsolation` on and no raw Node exposed via preload the practical risk is limited, but an
  unsandboxed renderer still has a full Node runtime context available to it if ever compromised,
  which a sandboxed renderer would not.
- **Preload surface — Info/Good.** `src/preload/index.ts` exposes only typed
  `ipcRenderer.invoke`/`.on` wrappers. No `fs`, `child_process`, or raw `ipcRenderer` handle is
  placed on `window.api`.
- **No path scoping on file-management IPC handlers — Medium.** A working `isPathWithin()` helper
  exists (`src/main/index.ts:452-463`) and is used for companion-bridge and inbox-asset paths, but
  **not** for the much larger surface: `file:read`, `file:writeMetadata`, `file:move`,
  `file:trash`, `file:copy`, `folder:scanNam`/`scanTree`, `folder:create`/`rename`/`move`, etc.
  These trust whatever absolute path the renderer sends, with no scope check against a library
  root. In normal operation paths originate from native file dialogs or prior scans, so this isn't
  directly attacker-reachable today — but it means there's no defense-in-depth: any future
  renderer-side XSS would have unrestricted filesystem read/write/delete via IPC, not just inside
  the user's library folder. Worth hardening given the app already has the primitive built.
- **`protocol.handle('local-file', ...)` — Medium.** `src/main/index.ts:6100-6103` maps
  `local-file://<anything>` straight to `file://<anything>` via `net.fetch`, zero validation. Any
  renderer content that can construct such a URL (an `<img src>`, a `fetch()`) can read arbitrary
  files on disk. Same caveat as above: not attacker-reachable today, but an unrestricted primitive.
- **No CSP.** No `Content-Security-Policy` found anywhere. Low severity for a local desktop app,
  but a missing defense-in-depth layer against the (currently theoretical) scenarios above.
- **child_process usage — Info/Good.** All `spawn`/`execFile` calls pass argument arrays, not
  shell strings. The one `execSync` with string interpolation (PowerShell drive-type check) only
  interpolates a value already validated against `/^[A-Z]:\\$/` immediately beforehand — injection
  not possible.
- **Companion HTTP bridge (LAN server for the iOS app) — Low/Medium.** Binds `0.0.0.0:38571` (all
  interfaces), guarded by a bearer/query token compared with `crypto.timingSafeEqual` — solid auth
  design. However: plain HTTP means the token is sniffable on a shared network, and
  `Access-Control-Allow-Origin: '*'` is maximally permissive. Opt-in and token-gated, so Low-to-
  Medium; consider binding to the LAN interface only when actually in use, or documenting the trust
  assumption (trusted home/studio network).

### Third-party content & key storage

- **AI keys — confirmed via `safeStorage`, Info/Good.** Verified in code, not just assumed:
  `storeAiKey`/`readAiKey` write to `userData/ai-key-{provider}.bin` via
  `safeStorage.encryptString/decryptString`, falling back to plaintext only if OS encryption is
  unavailable. Keys are never sent back to the renderer.
- **Tone3000 OAuth tokens** — same `safeStorage` pattern, with automatic migration off a legacy
  plaintext file and cleanup afterward. Good.
- **No XSS vectors found.** Zero hits for `dangerouslySetInnerHTML`, `eval(`, `new Function(`
  across the renderer. React's default escaping neutralizes untrusted Tone3000/metadata content.
- All external fetches (Tone3000, Anthropic, OpenAI, GitHub Releases for updates) are HTTPS. The
  Tone3000 client ID in source is a public OAuth identifier, not a secret.

### Licensing / legal posture

- **No `LICENSE` file, no `license` field in `package.json`** — worth flagging for a distributed
  desktop app; the project's own licensing terms aren't declared anywhere. This is a business/legal
  decision, not something to silently default.
- Bundled fonts (`@fontsource/doto`, `ibm-plex-sans`, `ibm-plex-mono`, `barlow-semi-condensed`) are
  all SIL Open Font License / Apache families redistributed by Fontsource for exactly this use — no
  concern.
- No bundled third-party audio content (`.wav`/`.nam`/IR/preset sample data) found anywhere in the
  repo.
- Secret-pattern scan (`sk-`, `api_key`, `secret`, `password`, `token=`) found only UI placeholder
  strings and legitimate OAuth field names — no committed credentials.

### Bugs flagged (not fixed — outside this session's scope, reporting only)

- `execSync` PowerShell drive-type check has no distinct timeout-vs-failure logging — a hung
  `powershell.exe` and "no such drive" read identically in logs. Low, diagnostics-only.
- `file:writeMetadata`'s verification-read-after-write does a full synchronous write+read round
  trip per save with no debouncing — fine for single saves, possible minor throughput cost under
  batch-editor bulk writes. Not confirmed as an observed issue.
- `companionBridgeServer` gets assigned the `http.Server` object at creation time even if
  `.listen()` subsequently fails to bind (e.g., port already in use) — `companion:getBridgeInfo`'s
  `running: companionBridgeServer != null` check could then report the bridge as running when it
  never actually bound. Worth a second look.

---

## What to actually do with this

Nothing here blocks anything. In rough order of "worth doing if you're picking one thing":

1. Apply `isPathWithin()` (or equivalent) to the file-management IPC handlers and the
   `local-file://` protocol handler — the primitive already exists, this is wiring, not design.
2. Decide and declare a license for the repo.
3. When `PlayerPanel.tsx` next needs a new FX block or a big edit, pull the preset CRUD out into a
   shared hook rather than adding a sixth copy of it.

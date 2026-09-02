# NAM Lab — security review (concerns not yet addressed)

Date: 2026-08-31. Scope: the `feature/ir-lab-manager` branch as a whole
(~28 900 insertions over `master` at `df29cd8`), with emphasis on the NAM
Capture / NAM Projects import path added this cycle. This is a **defensive
review of an offline desktop app** — no network services, no auth, no
multi-tenant data. Threat model is: a malicious or malformed *file on disk*
that the user points the app at (a downloaded IR pack, a shared capture
folder, a crafted `.nam`/`.json`/`.wav`), and defense-in-depth against a future
renderer-XSS.

Severity is relative to that model. Nothing here is a live remote exploit.

---

## S1 — No CSP + unrestricted `local-file://` file read  ·  severity: medium (latent high)

**What.** `src/renderer/index.html` sets **no** Content-Security-Policy (no
`<meta http-equiv>`), and `src/main/*.ts` installs **no** `onHeadersReceived`
CSP header. Separately, `src/main/index.ts:6196`:

```js
protocol.handle('local-file', (req) => {
  const fileUrl = 'file://' + req.url.slice('local-file://'.length)
  return net.fetch(fileUrl)      // no path validation, no allowlist, no root check
})
```

registered with `{ secure: true, bypassCSP: true, stream: true }`
(`index.ts:6032`). Any string the renderer puts in an `<img src>` / `fetch()`
as `local-file:///<abs path>` is read from disk and returned. There is no
restriction to the library roots, the app's own dirs, or image types.

**Why it is not exploitable today.** The renderer runs with
`contextIsolation: true`, `nodeIntegration: false`. Nothing in `src/renderer`
renders untrusted markup — no `dangerouslySetInnerHTML`, no markdown→HTML, no
`innerHTML`, no template eval (grep-verified). Folder READMEs and vendor-doc
text render as React text nodes. So there is currently no way for file-borne
content to inject an element that would abuse the protocol.

**Why it is a real concern.** The safety is entirely "no injection sink exists
*yet*." The moment anyone adds markdown rendering to the README panel, renders
Tone3000 HTML, or adds a rich-text field, `local-file://` + no-CSP turns a
stored-XSS into **arbitrary local file exfiltration** (`<img
src="local-file:///C:/Users/<user>/.ssh/id_rsa" onerror=beacon>`), because
there is no CSP `img-src` / `connect-src` to stop the beacon either. This
cycle's NAM Projects UI also newly pipes **scanner-derived filesystem paths**
(`imagePaths`, `graphPath`) straight into `<img src>`.

**Fix.**
1. Add a strict CSP (`default-src 'self'; img-src 'self' local-file:;
   connect-src 'self' <known API hosts>; script-src 'self'`) via
   `session.defaultSession.webRequest.onHeadersReceived`.
2. In the `local-file` handler, resolve + normalize the requested path and
   reject anything not under a known root (library roots, `app.getPath('userData')`,
   the training output roots). Reject non-media extensions.
3. Consider `sandbox: true` on the `BrowserWindow` (currently `false`,
   `index.ts:5201`).

---

## S2 — Renderer-supplied absolute paths drive filesystem + shell operations  ·  severity: low–medium

Several IPC handlers added this cycle take paths straight from the renderer and
act on them in the main process with no confinement:

| IPC | Main-process effect | File |
| --- | --- | --- |
| `irLibrary:findNamModelCandidates` | recursive `readdirSync` walk of any root the renderer names (bounded: depth ≤6, ≤20 000 entries, skips dotdirs/`node_modules`) | `namCaptureEnrichment.ts:712` |
| `irLibrary:relinkNamModel` | writes the given path as a JSON string into `<CaptureName>.nam-lab-result.json` (sidecar path derived from the DB, not the renderer) | `namCaptureEnrichment.ts:703` |
| `shell:openFile` / `shell:revealFile` | `shell.openPath` / `shell.showItemInFolder` on an arbitrary path | `index.ts` |
| `irLibrary:scan` | walks + hashes any folder the renderer names | `irLibraryIpc.ts` |

Today the renderer is our own bundled code, so this is a defense-in-depth gap,
not a bug: a compromised renderer (see S1) gets a "walk any directory tree" and
"ask the OS to open any file" primitive for free. `shell.openPath` on an
attacker-chosen path is the sharpest — on Windows it will happily launch an
executable or a `.lnk`.

**Fix.** Same root-allowlist helper as S1, applied to every path-taking IPC.
For `shell:openFile`, additionally refuse non-data extensions (`.exe`, `.bat`,
`.cmd`, `.ps1`, `.lnk`, `.scr`, …) and `.url`/`.desktop`.

---

## S3 — `setNamCaptureMetadata` builds SQL from unvalidated patch keys  ·  severity: low (latent)

`namCaptureEnrichment.ts:663`:

```js
for (const [k, v] of Object.entries(patch)) {
  sets.push(`${col[k]} = ?`)   // col[k] is undefined for an unknown key
  ...
}
db.prepare(`UPDATE nam_capture_item SET ${sets.join(', ')} WHERE item_id = ?`)
```

`col` is a fixed whitelist map, so **there is no SQL injection** — an unknown
key yields the literal string `"undefined = ?"` and SQLite throws a syntax
error. The renderer only ever sends keys from `NamCaptureMetadataPatch`, so
this is latent. Still worth closing: `if (!(k in col)) continue`. The IPC
handler (`irLibraryIpc.ts:261`) passes `patch: Record<string, unknown>`
through untouched, so the guard belongs in the function.

---

## S4 — SQLite catalog integrity: hand-rolled migrations on an experimental engine  ·  severity: medium (data-loss, not confidentiality)

`node:sqlite` is a Node **experimental** API (warns on every run). The
`collection`/`nam_project` schema migration in `schema.ts` does manual
table-rebuild surgery (`CREATE collection_new`, copy, `DROP`, `RENAME`). This
**corrupted a user's `catalog.db` twice this session** (`358cf43`, `d930141`):
first an orphaned `collection_old` + poisoned `sqlite_master`, then FK
references in 5 child tables left pointing at `collection_old` after a
`RENAME TO` executed with `legacy_alter_table` OFF.

It is now hardened (rebuild from canonical `CORE_SCHEMA_SQL`, shared-columns-
only copy, forced `legacy_alter_table = ON`, a repair pass for dangling refs,
3 regression tests). But:

- There is **no automatic pre-migration backup** of `catalog.db`. A failed
  migration on a large real library is unrecoverable without the user's own
  file history. Recovery this session needed an external `sqlite3.exe` +
  `.recover` + `.dump` + `sed`.
- Every future `collection`-shape change re-enters the same manual path.
- The catalog holds only derived data (it can be rebuilt by re-scanning), so
  this is availability/annoyance, not a breach — but "re-scan 17 000 items"
  is a real cost.

**Fix.** (a) Copy `catalog.db` to `catalog.db.bak-<timestamp>` before running
any migration that alters a table; keep the last N. (b) Pull the table-rebuild
into one tested helper (`rebuildTable(db, name, newDef)`) instead of
open-coding it per migration. (c) Track the Node position on `node:sqlite`
stability; pin the Electron version that provides FTS5 (see D5).

---

## S5 — Trainer spawns an arbitrary interpreter with an app-authored script  ·  severity: low (local, user-configured)

`index.ts:3981`: `spawn(pythonPath, ['-u', runnerPath, payloadPath])`.
`pythonPath` is user-set in Settings; `runnerPath` is app-bundled;
`payloadPath` is an app-written JSON temp file. This is inherent to the
feature (NAM training is a Python process) and the interpreter path is the
user's own choice, so the trust boundary is acceptable. Noted for completeness
because:

- The payload JSON now carries capture-derived strings (`modeledBy`,
  `gearMake`, …, and file paths) from scanned `nam-capture.json` files. Confirm
  the Python runner treats every payload field as data (no `shell=True`, no
  `eval`, no f-string into a subprocess). Not audited here — it is in the
  training-runner repo, not this one.
- `execSync` at `index.ts:4806` — verify its command is fully constant / not
  built from any scanned string.

---

## S6 — No integrity checks on imported files  ·  severity: informational

The scanner parses WAV headers (`wavHeader.ts`), BWF `bext` chunks, JSON
sidecars, and vendor PDFs/CSVs (`vendorDocExtraction.ts`, `vendorParsers/`)
from arbitrary user-supplied folders. Parsers look bounded (fixed field reads,
no `eval`), and `wavHeader.ts` has 173 lines of tests. Residual risks are the
usual parser-hardening ones: a crafted WAV/`bext` with absurd chunk sizes, a
PDF that expands pathologically, a JSON bomb. Worth a fuzz pass on
`wavHeader.ts` and the sidecar readers if this ever ingests untrusted packs at
scale. No evidence of a memory-safety sink (pure JS/TS, no native parsing).

---

## S7 — `safeStorage` / Tone3000 token handling  ·  severity: informational (pre-existing, adjacent)

Not touched this cycle, but in scope for "audit the application": Tone3000
login tokens are persisted and decrypted via `safeStorage` (Keychain-backed on
macOS) — `index.ts` `loadTone3kTokens`. On Windows `safeStorage` is DPAPI
(user-scoped, not password-gated). Confirm tokens are never written to the
plain log (`switchLogToUserData`) and never round-tripped through the renderer
in clear. This is the one place the app has a real secret.

---

## S8 — Open-source posture + AI / search credential handling  ·  severity: informational (verified safe as designed)

Added 2026-09-02, in response to: "the code is open source on GitHub — is our
handling of AI keys for search still safe, the way we do it?"

### Repo split (from `docs/ir-lab-manager-build-plan.md` §0, §13)

| Piece | Visibility |
| --- | --- |
| `nam-editor` (this repo — shell, IR Lab Manager catalog/scan/audition/search/parsers, tray, `catalog.db`) | **Public, MIT** (`LICENSE` + `NOTICE.md` present) |
| `ir-lab` (JUCE capture app) | Private — only registers the `irlab://` URL scheme and forwards an incoming request into its own `reopenSession()` |
| Connector constants (`IR_LAB_URL_SCHEME` + payload field names) | Private, **injected at build time** via env var, same pattern as `CSC_KEY_PASSWORD`; never committed. A build from public source runs fully, minus "Send to IR Lab" silently no-opping. |

Open, non-blocking (tracked in the plan, not this review): the exact IR Lab
*content*-license enforcement point, and whether any future piece of IR mode
becomes paid — both only change what gets injected into that private config
later, not the public code.

**Conclusion: being public is not a credential risk.** There is no
app-/vendor-owned secret anywhere in the source. Every credential the app
touches is the *user's own*, entered at runtime, stored encrypted per machine
outside the repo. Publishing the source reveals only the *mechanism* (which
provider endpoints, which header names) — the same information any API doc
carries.

### AI keys (`app:saveAiKey` / `app:aiEnrich` / `app:clearAiKey`, `index.ts` ~6322-6405)

- Keys are **user-supplied** — the user pastes their own Anthropic / OpenAI
  key. No shared key ships.
- Stored at `userData/ai-key-<provider>.bin` via `safeStorage.encryptString`.
  `storeAiKey` **throws rather than write plaintext** when
  `safeStorage.isEncryptionAvailable()` is false — correct.
- Read only in the main process. `aiEnrich` calls the provider from main with
  the key in the header and returns **only the completion text**. There is no
  `getAiKey` IPC, so the key never travels back to the renderer.
- Provider hosts are hardcoded per provider (`api.anthropic.com`,
  `api.openai.com`) — the renderer supplies only `provider` / `model` /
  `prompt`, never a base URL.

Minor hardening:

1. **`readAiKey` has a dead plaintext fallback**
   (`isEncryptionAvailable() ? decrypt : buf.toString('utf-8')`) that
   contradicts `storeAiKey`'s refuse-plaintext stance. Nothing writes an
   unencrypted `.bin`, so it's unreachable today — but make `readAiKey` also
   return `null` when encryption is unavailable, so a planted plaintext file
   can't be picked up.
2. **`aiEnrich` is data egress**: the prompt is built in the renderer from a
   capture's metadata and sent to the user's chosen third-party AI. It's
   user-initiated and on the user's own account, but there is no in-UI
   disclosure of *what* leaves the machine. Add a one-line "this sends these
   fields to <provider>" note next to the button.
3. If a **third provider** is ever added, keep it to a fixed `provider → host`
   map in main — never accept an endpoint/base-URL from the renderer.

### Tone3000 search / tokens (`loadTone3kTokens` / `saveTone3kTokens`)

- OAuth access/refresh tokens for the user's **own** tone3000.com account.
  `userData/tone3000-tokens.bin` via `safeStorage` **outside dev**; the
  `!isDev` guard means a developer's real refresh token sits **plaintext** in
  `userData` during `npm run dev`. Acceptable for a dev convenience, worth a
  line in CONTRIBUTING so nobody is surprised.
- Legacy plaintext `tone3000-tokens.json` is migrated to the `.bin` on load
  and unlinked — good.
- Token used only in main-process `net.fetch` with a `Bearer` header; confirm
  it is never written to the plain log (`switchLogToUserData`) — the refresh
  failure path logs `body.slice(0, 300)` of the *error response*, not the
  token, which is fine.

### Companion bridge (adjacent, not "search")

`index.ts` runs a local HTTP server (`companionBridgeConfig.bindAddress`,
`companionTokenMatches`, `Bearer` auth) for a companion app. Out of scope for
the AI-key question but it is a live listening socket with its own auth — give
it its own pass if the companion feature ships broadly (bind address default,
token generation/rotation, what endpoints it exposes).

---

## Priorities

1. **S1** — add a CSP now, before any markdown/HTML rendering lands. Cheap,
   high leverage.
2. **S4b** — pre-migration `catalog.db` backup. One function, prevents the
   next repeat of this session's corruption.
3. **S2 / S1.2** — one shared "path is under a known root" helper, applied to
   the protocol handler and every path-taking IPC.
4. **S3** — one-line guard.
5. **S5 / S6** — verify the Python runner and add parser fuzzing when
   untrusted-pack ingestion becomes a real workflow.

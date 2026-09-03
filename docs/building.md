# NAM Lab — Building from source

End users should download a prebuilt installer from the
[Releases](https://github.com/coretonecaptures/nam-editor/releases) page and
follow [`install.md`](install.md). This document is for building and packaging
NAM Lab yourself.

NAM Lab is an Electron app: **electron-vite** for the dev server and bundling,
**electron-builder** for the platform installers. Runs on Windows, macOS, and
Linux.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20 LTS or newer (24.x is what the maintainers run) | Ships `npm`. Electron 41 requires Node 20+. |
| **npm** | 9+ | Bundled with Node. `package-lock.json` is committed — use `npm ci` for reproducible installs. |
| **git** | any recent | |
| A C/C++ toolchain | platform default | `npm install` builds a couple of small native deps (`keytar`-style secure storage, file watchers). macOS: Xcode Command Line Tools (`xcode-select --install`). Windows: "Desktop development with C++" workload or `npm i -g windows-build-tools`. Linux: `build-essential`. |

**Not required to build or run the app:**

- **Emscripten** — only needed if you change the offline NAM inference module
  (`native/nam-wasm/`). The built artefacts (`nam-offline.wasm`,
  `nam-worklet.wasm`, and their loader JS) are committed under
  `src/renderer/public/`, so a normal build/run uses them as-is. See
  [§6](#6-rebuilding-the-nam-wasm-module-optional).
- **Python / `neural-amp-modeler`** — only used at *runtime* by the optional
  built-in training workspace, which shells out to your own local install. It
  is not a build dependency and nothing in the training path is exercised by
  `npm run build`.

---

## 2. Clone and install

```bash
git clone https://github.com/coretonecaptures/nam-editor.git
cd nam-editor
npm ci          # or: npm install
```

---

## 3. Run in development

```bash
npm run dev
```

`electron-vite dev` starts the Vite dev server for the renderer, compiles the
main and preload processes, and launches Electron with hot-reload. The three
processes map to:

```
src/main/index.ts       main process — file I/O, IPC handlers, window management
src/preload/index.ts    exposes the typed `window.api` to the renderer
src/renderer/src/       all React UI (never touches the filesystem directly)
```

---

## 4. Tests

```bash
npm test          # vitest run (one-shot)
npm run test:watch
```

Config is `vitest.config.ts`. The suite focuses on the surgical `.nam`
metadata patcher (`patchMetadataFields()` and friends) and preset wiring —
see `CLAUDE.md` / `AGENTS.md` for why write-back is never
`JSON.parse` → `JSON.stringify`.

---

## 5. Build and package

### Bundle only (no installer)

```bash
npm run build         # electron-vite build -> out/
npm run preview       # run the bundled app without packaging
```

### Platform installers

```bash
npm run package:mac     # -> release/NAM Lab-<version>-*.dmg
npm run package:win     # -> release/NAM Lab Setup <version>.exe   (NSIS)
npm run package:linux   # -> release/NAM Lab-<version>.AppImage
```

Each `package:*` script runs `npm run build` first, then
`electron-builder --<platform> --publish never`. Output goes to `release/`
(configured in `package.json` → `build.directories.output`).

electron-builder can only build a macOS `.dmg` on macOS and a Windows NSIS
installer on Windows (Linux AppImages can be produced from Linux or, with
some care, macOS). CI builds each on its native runner.

### Packaging assets

`electron-builder` config lives in `package.json` under `"build"`. It expects,
relative to the repo root:

| Path | Used for |
|------|----------|
| `build/icon.icns` | macOS app icon |
| `build/icon.ico` | Windows app icon |
| `build/icon.png` | Linux app icon |
| `build/entitlements.mac.plist` | macOS hardened-runtime entitlements (includes the microphone entitlement for Live mode) |

`appId` is `com.coretonecaptures.namlab`; the app registers a `.nam` file
association.

### Signing

Local `package:*` builds are **unsigned** — that's why `install.md` documents
the Gatekeeper / SmartScreen bypass. Signed + notarized macOS builds are
produced only in CI, which injects the Apple Developer ID certificate and
notarization credentials from repository secrets. **Never** put a `.p12`,
`.p8`, `CSC_KEY_PASSWORD`, or notarization key in the repo or a build script
(see `CLAUDE.md` → "NEVER COMMIT SECRETS").

---

## 6. Rebuilding the NAM WASM module (optional)

Only needed if you touch `native/nam-wasm/`. Requires the Emscripten SDK:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh          # emsdk_env.bat on Windows cmd

cd /path/to/nam-editor/native/nam-wasm
./build.sh
```

`build.sh` fetches a pinned Eigen commit (matched to upstream
`neural-amp-modeler-wasm` so numerical output stays bit-accurate to the NAM
plugin), compiles with `emcc` directly (no CMake), and writes the module +
loader into `src/renderer/public/`. Commit the regenerated `.wasm` / `.js`
outputs alongside your source change so other contributors don't need
Emscripten.

Read `native/nam-wasm/README.md` before changing the build flags — the
single-threaded, non-`SharedArrayBuffer` design is deliberate (Electron cannot
be made cross-origin-isolated; `docs/player-investigation.md` has the full
history).

---

## 7. Troubleshooting

- **`npm install` fails compiling a native module** — install the platform
  C/C++ toolchain from §1, delete `node_modules` and `package-lock.json`'s
  peer state (`rm -rf node_modules && npm ci`), and retry.
- **Electron won't launch after `npm run dev`** — stale bundle; delete `out/`
  and rerun.
- **Packaged app can't read/write `.nam` files on macOS** — the packaged build
  needs the entitlements file at `build/entitlements.mac.plist`; a build with
  hardened runtime but no entitlements will be sandboxed.
- **Secure-storage / Keychain prompts in a dev build** — expected; NAM Lab
  stores TONE3000 tokens and AI keys via Electron `safeStorage`. See
  `install.md`.

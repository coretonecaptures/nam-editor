# NAM Editor

A desktop app for editing metadata in [Neural Amp Modeler](https://www.neuralampmodeler.com/) `.nam` files — without touching the model weights or breaking the file format.

Built with Electron, React, and Tailwind CSS. Runs on **Windows** and **macOS**.

> **This app does not run captures or process audio.** It is purely a metadata editor for `.nam` files. To actually use your captures, you need the [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free, available for all major DAWs).

---

## What It Does

Neural Amp Modeler captures store metadata (capture name, gear info, tone type, etc.) as JSON inside the `.nam` file alongside the model weights. Most tools don't expose this metadata for editing — NAM Editor lets you open many files at once, update their metadata, and save back safely.

This is especially useful for capture artists who want to properly tag their `.nam` files before sharing or uploading them to tone libraries.

**Key guarantees:**
- Only the metadata fields you explicitly edit are written back
- Model weights, architecture, config, and all other file data are preserved exactly
- Files that haven't changed are never written to

---

## Features

### Library View (Folder Mode)
- Open a folder and get a three-panel layout: **Folder Tree | File List | Metadata Editor**
- Folder tree shows all subfolders with file counts; click any node to filter the file list to that folder
- Each folder shows a **blue total count** and an **amber dirty count** (unsaved edits)
- All three panels are **resizable** — drag the dividers to adjust
- **Refresh** button rescans the folder for new or removed files (warns about unsaved changes)
- Remembers the last opened folder and reopens it automatically on next launch

### File Management
- Open individual `.nam` files or an entire folder (scans recursively)
- Drag & drop files directly onto the window
- Shift+click and Ctrl+click for range and multi-selection in the file list
- Opening a new file or folder replaces the current session (with unsaved-changes warning)
- Close All button clears the session

### Metadata Editing
- **Capture Name** — display name shown in plugins
- **Modeled By** — capture artist / creator
- **Gear Type** — amp, pedal, cab, preamp, DI, other
- **Tone Type** — clean, crunch, high-gain, fuzz, overdrive, distortion, other
- **Manufacturer** and **Model** — gear make/model
- **Input / Output Level (dBu)**
- Ctrl+S / Cmd+S to save the current file
- Read-only stats: architecture, NAM version, loudness, gain, validation ESR, epoch count (if present)

### Smart Defaults (Settings)
Settings are stored locally and start blank on every new installation. Each section can be **enabled or disabled independently** — turn off a section to browse other people's captures without applying your defaults.

**Current Amp Info** *(toggleable)*
- Default Manufacturer and Model — applied to files missing those fields on open

**Capture Defaults** *(toggleable)*
- Default Modeled By — applied if the file has no `modeled_by`
- Default Input Level (dBu) — applied if the file has no `input_level_dbu`
- Default Output Level (dBu) — applied if the file has no `output_level_dbu`

**Behavior**
- **Populate name from filename** — auto-sets Capture Name to the filename if empty
- **Auto-detect tone type** — scans the filename for tone keywords and sets Tone Type if empty; the rightmost keyword wins (e.g. `BE Clean Crunch DI` → Crunch). Keywords: `clean`, `crunch`, `lead`/`highgain`/`hi-gain`, `fuzz`, `overdrive`/`od`/`edge`/`drive`, `distortion`/`dist`
- **Amp Suffix** — configurable filename ending that auto-sets Gear Type to Amp (default: `DI`); e.g. set to `DIRECT` if your files end that way

**Startup**
- **Remember last opened folder** — every time you open a folder it becomes the default for next launch
- **Default Folder** — manually pin a specific folder path to always open on launch

### Active Defaults Pill
A slim bar above the status bar shows which defaults are currently active (e.g. `Amp: Friedman BE100 · Capture: Core Tone Captures · Name from filename`). Disappears entirely when nothing is enabled — glanceable reminder before you open files.

### Change Tracking
- Fields auto-populated by settings are highlighted in **amber** so you know what changed
- Files with any auto-populated fields are immediately marked as **pending save**
- Amber dot in the file list and folder tree shows unsaved edits
- Highlights clear after saving

### Batch Edit
- Right-click any folder in the library tree → **Batch edit…**
- Applies to all files in that folder and all subfolders recursively
- Check only the fields you want to change — unchecked fields are untouched
- Confirm dialog shows exactly which fields and how many files will be affected before applying

### Per-Folder Actions (Right-click)
Right-click any folder node in the library tree for:
- **Save all in folder** — saves all unsaved files under that path
- **Revert all in folder** — discards unsaved changes (with confirmation)
- **Batch edit…** — opens the batch editor scoped to that folder

### Name from Filename
- If loaded files have no Capture Name set, a **"Name from File (N)"** button appears in the toolbar
- One click sets the capture name to the filename (minus `.nam`) for all unnamed files

### Filtering & Search
- Search by name, manufacturer, model, or modeled-by
- Filter chips: **All / Unnamed / No Type / No Maker / No Tone** — filters against the *original* file values, not auto-filled ones
- Each file item shows a **"N missing"** badge with a tooltip listing which tracked fields (Name, Gear Type, Manufacturer, Model, Modeled By, Tone Type) are still empty

### Save
- Save individual files or **Save All** with a confirmation dialog
- Save All only writes files that have actual changes

---

## Installation

Download the latest installer from the [Releases](https://github.com/coretonecaptures/nam-editor/releases) page.

| Platform | File |
|----------|------|
| Windows  | `NAM-Editor-Setup-x.x.x.exe` |
| macOS    | `NAM-Editor-x.x.x.dmg` |

> **macOS note:** The app is currently unsigned. On first launch, right-click the app and choose **Open** to bypass Gatekeeper.

> **Windows note:** Windows Defender SmartScreen may show a warning on first run. Click **More info → Run anyway**.

---

## Development

**Requirements:** Node.js 20+

```bash
git clone https://github.com/coretonecaptures/nam-editor.git
cd nam-editor
npm install
npm run dev
```

> On Windows, run dev with: `powershell -ExecutionPolicy Bypass -command "npm run dev"`

### Build installers locally

```bash
# Windows
npm run package:win

# macOS
npm run package:mac
```

Output goes to the `release/` folder.

### Publish a release

Tag a version and push — GitHub Actions builds both platforms automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds a Windows `.exe` installer and a macOS `.dmg`, then attaches them to a GitHub Release.

---

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [electron-vite](https://electron-vite.org/) — build tooling
- [React](https://react.dev/) — UI
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [electron-builder](https://www.electron.build/) — packaging

---

## Requirements

- **To use this app:** Windows 10+ or macOS 10.13+
- **To use your captures:** [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free) — available for VST3, AU, AAX, and standalone

---

## About

There's no existing tool that lets capture artists manage `.nam` metadata locally, in bulk, before sharing their work. NAM Editor was built to fill that gap — a fast, offline desktop app that gives you full control over how your captures are tagged and presented to the people who use them.

Conceived by [Core Tone Captures](https://github.com/coretonecaptures). Code written by [Claude Code](https://claude.ai/code).

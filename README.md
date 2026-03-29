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

### File Management
- Open individual `.nam` files or an entire folder (scans recursively)
- Drag & drop files directly onto the window
- Load dozens of files at once — sidebar shows all of them
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
Each user configures their own defaults — settings are stored locally on your machine and start blank for every new installation. Configure defaults that auto-populate empty fields when you open files:
- **Default Modeled By** — applied if the file has no `modeled_by` value
- **Default Input Level** — applied if the file has no `input_level_dbu`
- **Current Amp Info** — default Manufacturer and Model applied to files missing those fields
- **Auto Gear Type** — if the filename ends in `DI`, Gear Type is set to `Amp`; otherwise `Cab`

Settings are saved locally and persist between sessions.

### Change Tracking
- Fields auto-populated by settings are highlighted in **amber** so you know what changed
- Files with any auto-populated fields are immediately marked as **pending save**
- Highlights clear after saving — amber only appears while a value differs from what's on disk

### Batch Edit
- Select multiple files (Ctrl+click) and apply the same values to all of them at once
- Check only the fields you want to change — unchecked fields are left alone
- Works on the current selection or all loaded files

### Name from Filename
- If loaded files have no Capture Name set, a **"Name from File (N)"** button appears in the toolbar
- One click sets the capture name to the filename (minus `.nam`) for all unnamed files

### Filtering & Search
- Search by name, manufacturer, model, or modeled-by
- Filter chips: **All / Unnamed / No Type / No Maker / No Tone** — filters against the *original* file values, not auto-filled ones
- Each file item shows a yellow **"N empty"** badge counting unfilled fields

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

Conceived and designed by [Core Tone Captures](https://github.com/coretonecaptures) based on real-world capture workflow needs. Built entirely by [Claude Code](https://claude.ai/code) (Anthropic's AI coding assistant) — the code was written by AI, not by hand. Core Tone Captures provided the vision, requirements, and feedback; Claude Code did the implementation.

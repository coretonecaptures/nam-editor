# NAM Lab — First Launch Instructions

NAM Lab is currently in beta and is not yet code-signed. Both macOS and Windows will show a one-time security warning on first launch. This is expected and safe to bypass.

---

## macOS — "Apple cannot verify this app" or "app is damaged"

macOS Gatekeeper blocks apps that aren't notarized by Apple.

**Option A — from the warning dialog:**
1. When the warning appears, click **Done** (do not move it to trash)
2. Open **System Settings → Privacy & Security**
3. Scroll down — you'll see *"NAM Lab was blocked"*
4. Click **Open Anyway**
5. Enter your Mac password if prompted

**Option B — if macOS says the app is "damaged":**

This happens on newer macOS (Ventura/Sonoma) that quarantine downloads more aggressively.

1. Open **Terminal** (search Spotlight for "Terminal")
2. Run this command — drag the app into Terminal after `xattr -cr ` to fill in the path:
   ```
   xattr -cr /Applications/NAM\ Lab.app
   ```
3. Launch the app normally

> You only need to do this once. After the first approved launch macOS remembers your choice.

---

## Windows — "Windows protected your PC" (SmartScreen)

1. When the SmartScreen dialog appears, click **More info**
2. Click **Run anyway**

> If you're uncomfortable bypassing SmartScreen, scan the installer with [VirusTotal](https://www.virustotal.com) before running it.

---

## Linux — AppImage

No installation required. AppImage runs on most distros (Ubuntu, Fedora, Arch, Mint, etc.).

1. Download the `.AppImage` file
2. Make it executable:
   ```
   chmod +x NAM-Lab-x.x.x.AppImage
   ```
3. Double-click to run, or: `./NAM-Lab-x.x.x.AppImage`

No signing required — AppImage runs without security warnings.

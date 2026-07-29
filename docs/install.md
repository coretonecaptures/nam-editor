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

## macOS — Keychain access prompt ("NAM Lab wants to use your confidential information")

If you have connected a Tone3000 account or stored an AI provider key, macOS may show a Keychain access dialog each time the app launches:

> *"NAM Lab wants to use your confidential information stored in 'NAM Lab' in your keychain."*

**This is expected and is a sign the app is working correctly.** NAM Lab stores your credentials using macOS Secure Storage (the system Keychain) rather than a plain text file, so they are protected at rest and never travel to any server. The dialog is macOS asking you to confirm that NAM Lab is allowed to read its own encrypted data.

**To stop being prompted every launch:**
1. Click **Always Allow** when the dialog appears — macOS will remember your choice for this app.
2. If you missed that and clicked Allow instead, open **Keychain Access** (search Spotlight), find the **NAM Lab** entry, right-click → **Get Info** → **Access Control** tab → check **"Allow all applications to access this item"**, then save.

> We are working towards code-signing and notarizing NAM Lab with an Apple Developer certificate. Once signed, macOS will permanently trust the app and will not show this prompt again. Until then, clicking **Always Allow** is the one-time fix.

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

/**
 * The public half of the IR Lab connector — docs/ir-lab-manager-build-plan.md sections 0 and 11.
 *
 * The actual URL scheme is intentionally NOT hardcoded here. nam-editor is public/MIT; per the
 * plan's own design, this repo works fully without the private value, "Send to IR Lab" simply
 * documented as unavailable rather than the build breaking. The real scheme is injected via the
 * IR_LAB_URL_SCHEME environment variable at build/run time — the same pattern this repo already
 * uses for CSC_KEY_PASSWORD and friends in .github/workflows/release.yml. For local testing, set
 * it in your own shell environment before running `npm run dev`/`npm run build`; nothing in this
 * repo reads a committed file for it.
 *
 * Payload shape confirmed directly against the private IR Lab repo's own implementation of
 * section 11 (2026-08-24, reported after a live test against the real app): plain query
 * parameters, no JSON, no shared database, sent via a single OS-level open call — no socket, no
 * IPC, no file handoff. A `blend` payload's items must be repeated `item=` keys, not comma-
 * joined — `URLSearchParams.append` does this correctly and percent-encodes each path
 * automatically. `preset`, when given, must exactly match one of IR Lab's own preset name
 * strings (e.g. "Cab IR", "Long Reverb IR") — IR Lab does no fuzzy matching on this string.
 */
import { shell } from 'electron'
import { readIrLabStatus, type IrLabStatus } from './irLabStatus'

export type IrLabPayload =
  | { kind: 'session'; captureId: string }
  | { kind: 'blend'; items: string[] } // capped at 8 by the caller — see irCatalog/tray.ts
  // Added 2026-09-25 (ir-library-gpt-audit's "Play in IR Lab" — the direct Live Audition
  // Cab A/B loader, distinct from `blend`'s Blender-window handoff). Deliberately its OWN route
  // rather than overloading `blend` — same reasoning the audit itself gives: these are different
  // workflows. Capped at 4 items by the caller (irLibraryIpc.ts): 1-2 fill Cab A/B on a normal
  // rig, 3-4 fill both cab slots on each lane of a stereo rig. NOT YET IMPLEMENTED on IR Lab's
  // receiving side (ExternalHandoffRouter.cpp only handles session/blend/nam/namgroup/project as
  // of this comment) — see docs/ir-lab-play-in-ir-lab-spec-2026-09-25.md for the IR Lab-side
  // contract this route needs.
  | { kind: 'playcab'; items: string[] }
  | { kind: 'project'; id: string; preset?: string }
  // Added 2026-09-11: IR Lab shipped its receiving side (commit bb2ece4, "NAM Lab integration:
  // incoming nam/namgroup routes + outbound bridge") ahead of NAM Lab having a sender. Both are
  // allowlisted against IR Lab's OWN configured `defaultNamFolder()` setting (LiveAuditionSettingsStore),
  // same LOW-1 pattern as `blend`'s Cab IR/Reverb IR/DI roots — see irLabRoots.ts's matching check.
  | { kind: 'nam'; file: string; slot?: number }
  // manifestPath must itself live under IR Lab's defaultNamFolder (checked the same way as
  // `file` above) — the manifest's own JSON content lists the actual items and is NOT part of
  // this URL (a real group can run to dozens of paths, far past what a URL can hold).
  | { kind: 'namgroup'; manifestPath: string; slot?: number }

export interface IrLabSendResult {
  success: boolean
  reason?: string
}

// Replaced at build time by electron.vite.config.ts (main `define`). Absent under vitest, hence
// the typeof guard.
declare const __IR_LAB_URL_SCHEME__: string | undefined

/** The scheme baked in at build time; a runtime IR_LAB_URL_SCHEME still overrides it (dev). */
export function irLabUrlScheme(): string {
  return process.env.IR_LAB_URL_SCHEME || (typeof __IR_LAB_URL_SCHEME__ === 'string' ? __IR_LAB_URL_SCHEME__ : '')
}

export function irLabConnectorAvailable(): boolean {
  return Boolean(irLabUrlScheme())
}

/** Pure (no Electron dependency) so it's actually unit-testable — see irLabConnector.test.ts.
 * `sendToIrLab` below is the only caller that also fires the real OS-level open call. */
export function buildIrLabUrl(scheme: string, payload: IrLabPayload): string {
  const params = new URLSearchParams()
  let path: string
  switch (payload.kind) {
    case 'session':
      path = 'session'
      params.set('captureId', payload.captureId)
      break
    case 'blend':
      path = 'blend'
      for (const item of payload.items.slice(0, 8)) params.append('item', item)
      break
    case 'playcab':
      path = 'playcab'
      for (const item of payload.items.slice(0, 4)) params.append('item', item)
      break
    case 'project':
      path = 'project'
      params.set('id', payload.id)
      if (payload.preset) params.set('preset', payload.preset)
      break
    case 'nam':
      path = 'nam'
      params.set('file', payload.file)
      if (payload.slot != null) params.set('slot', String(payload.slot))
      break
    case 'namgroup':
      path = 'namgroup'
      params.set('manifest', payload.manifestPath)
      if (payload.slot != null) params.set('slot', String(payload.slot))
      break
  }
  return `${scheme}${path}?${params.toString()}`
}

/**
 * Why IR Lab would not act on this link, from the status file it writes on every launch, or null
 * to send. Checked before every send (2026-10-23): without it, a link to an IR Lab that was never
 * run, is unlicensed (its router refuses every link), or predates the route was reported here as
 * "sent" and then nothing happened. Pure, for the tests.
 */
export function irLabSendBlocker(status: IrLabStatus, route: IrLabPayload['kind']): string | null {
  if (!status.installed) {
    return 'IR Lab has not been opened on this computer yet. Install it, open it once, then try again.'
  }
  if (status.licenseState === 'unlicensed') {
    return 'IR Lab is not licensed on this computer, so it ignores links from NAM Lab. Add its license in IR Lab’s Settings, then try again.'
  }
  if (status.routes !== null && !status.routes.includes(route)) {
    return 'This version of IR Lab cannot receive this from NAM Lab. Update IR Lab, open it once, then try again.'
  }
  return null
}

export async function sendToIrLab(payload: IrLabPayload): Promise<IrLabSendResult> {
  const scheme = irLabUrlScheme()
  if (!scheme) {
    return { success: false, reason: 'IR Lab connector is not configured in this build.' }
  }
  const blocker = irLabSendBlocker(readIrLabStatus(), payload.kind)
  if (blocker) return { success: false, reason: blocker }

  const url = buildIrLabUrl(scheme, payload)
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

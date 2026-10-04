/**
 * Reads IR Lab's own outbound status file — its side of the 2026-09-11 IR Lab Integration Audit's
 * finding A3 ("we can't tell whether IR Lab is installed, licensed, or which version"). IR Lab's
 * `IntegrationBridge` (commit bb2ece4, shipped ahead of this side existing) writes
 * `<appData>/IR Lab/integration-status.json` on launch and whenever license state changes — a
 * plain overwritten snapshot, never a log. This is read-only: nothing here writes that file.
 *
 * `irLabConnectorAvailable()` (irLabConnector.ts) only ever checked whether the build-time
 * IR_LAB_URL_SCHEME env var was injected — true or false for every install on the machine, so
 * "Send to IR Lab" either always worked or always silently failed with no way to tell a user
 * without IR Lab installed from one whose license lapsed. This file adds the missing dimension:
 * whether IR Lab has actually RUN on this machine, and what it reported about itself last time.
 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type IrLabLicenseState = 'licensed' | 'unlicensed' | 'unknown'

export interface IrLabStatus {
  /** False when IR Lab has never written a status file on this machine — "not installed" is the
   * honest reading (this app has no other way to detect a real install), not "installed but
   * never launched", since the file is written on launch. */
  installed: boolean
  version: string | null
  licenseState: IrLabLicenseState
  /** IR Lab's own licensing model (docs/licensing.md Phase 1) has no trial concept — always null.
   * Kept as a field (not dropped) so a future Phase-2 activation server's trial state has
   * somewhere to land without a shape change on this side. */
  trialDaysRemaining: number | null
  /** The irlab:// routes this IR Lab build receives (IR Lab 2026-10-01+). null = an older IR Lab
   * that predates the list -- which also predates `playcab`, so treat null as "not supported". */
  routes: string[] | null
}

/** True when IR Lab's last status file says it receives this irlab:// route. */
export function irLabSupportsRoute(status: IrLabStatus, route: string): boolean {
  return status.routes !== null && status.routes.includes(route)
}

const UNKNOWN_STATUS: IrLabStatus = { installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null, routes: null }

/** IR Lab's per-user data folder. IR Lab resolves it with JUCE's userApplicationDataDirectory,
 * which is ~/Library on macOS -- NOT Electron's appData (~/Library/Application Support), so
 * reading under appData there never found IR Lab's file. On Windows both are %APPDATA%. */
export function irLabAppDataDir(): string {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'IR Lab')
    : join(app.getPath('appData'), 'IR Lab')
}

export function irLabStatusFile(): string {
  return join(irLabAppDataDir(), 'integration-status.json')
}

/** Pure — takes the file's already-read text so it's unit-testable without a real filesystem. */
export function parseIrLabStatus(json: string): IrLabStatus {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return UNKNOWN_STATUS
  }
  if (typeof parsed !== 'object' || parsed === null) return UNKNOWN_STATUS
  const obj = parsed as Record<string, unknown>
  const licenseState = obj.licenseState === 'licensed' || obj.licenseState === 'unlicensed' ? obj.licenseState : 'unknown'
  return {
    installed: obj.installed === true,
    version: typeof obj.version === 'string' ? obj.version : null,
    licenseState,
    trialDaysRemaining: typeof obj.trialDaysRemaining === 'number' ? obj.trialDaysRemaining : null,
    routes: Array.isArray(obj.routes) ? obj.routes.filter((r): r is string => typeof r === 'string') : null
  }
}

export function readIrLabStatus(): IrLabStatus {
  try {
    return parseIrLabStatus(readFileSync(irLabStatusFile(), 'utf-8'))
  } catch {
    // No file at all — IR Lab has never run on this machine (or wrote to a different profile).
    return UNKNOWN_STATUS
  }
}

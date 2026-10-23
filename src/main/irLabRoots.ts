/**
 * Reads IR Lab's own configured library folders so "Send to IR Lab" can catch the exact failure
 * IR Lab's own `blend` route handler enforces, before firing the handoff rather than after.
 *
 * IR Lab's link handler (security audit 2026-08-31, LOW-1) accepts an `item=` path
 * into the blend route only when it resolves under one of three folders the user configured there
 * — Cab IR, Reverb IR, or DI. Anything else is silently dropped and IR Lab shows its own banner
 * ("pointing outside your IR library — ignored"), in the OTHER app, after the user already thinks
 * the send succeeded here. This reads the same three settings IR Lab itself reads, so we can warn
 * in THIS app instead.
 *
 * `LiveAuditionSettingsStore::storeFile()` (ir-lab/src/audio/LiveAuditionSettingsStore.cpp) is
 * `<userApplicationDataDirectory>/IR Lab/live-audition-settings.json`. JUCE's
 * userApplicationDataDirectory is `~/Library` on macOS, NOT Electron's appData
 * (`~/Library/Application Support`): reading under appData found nothing on a Mac, so every
 * blend / Play in IR Lab / Publish send was refused as "no folder configured" (fixed 2026-10-23).
 * `irLabAppDataDir()` holds that rule once for this file and the status file. On Windows both
 * are `%APPDATA%`. Read-only: this never writes IR Lab's config. If IR Lab has
 * never been run, or the file is missing/malformed, this returns an empty list rather than
 * throwing — "IR Lab isn't configured yet" is an ordinary, common state, not an error.
 */
import { join, resolve, sep } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { irLabAppDataDir } from './irLabStatus'

const SETTINGS_KEYS = ['defaultCabIrFolder', 'defaultReverbIrFolder', 'defaultDiFolder'] as const
// Added 2026-09-11 alongside IR Lab's `nam`/`namgroup` routes (commit bb2ece4) — same LOW-1
// allowlist pattern, checked against this ONE setting instead of the blend route's three.
const NAM_SETTINGS_KEY = 'defaultNamFolder' as const

export function irLabSettingsFile(): string {
  return join(irLabAppDataDir(), 'live-audition-settings.json')
}

/** Pure — takes the file's already-read text so it's unit-testable without a real filesystem. */
export function parseIrLabAllowedRoots(json: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const roots: string[] = []
  for (const key of SETTINGS_KEYS) {
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) roots.push(value)
  }
  return roots
}

/** Pure sibling of `parseIrLabAllowedRoots` for the single NAM-folder setting `nam`/`namgroup`
 * are allowlisted against. Returns null rather than '' when unset, matching how
 * `checkNamAllowlist` distinguishes "not configured" from "configured but this path isn't in it". */
export function parseIrLabNamFolder(json: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const value = (parsed as Record<string, unknown>)[NAM_SETTINGS_KEY]
  return typeof value === 'string' && value.trim() ? value : null
}

export function readIrLabAllowedRoots(): string[] {
  try {
    return parseIrLabAllowedRoots(readFileSync(irLabSettingsFile(), 'utf-8'))
  } catch {
    return []
  }
}

export function readIrLabNamFolder(): string | null {
  try {
    return parseIrLabNamFolder(readFileSync(irLabSettingsFile(), 'utf-8'))
  } catch {
    return null
  }
}

/** Case-insensitive on Windows (NTFS paths are case-preserving, not case-sensitive) — matches how
 * IR Lab compares paths on that platform. Elsewhere, exact. Symlinks are resolved
 * first when the path exists, as IR Lab's router canonicalises both sides (2026-10-10): a file
 * reached through a link would otherwise pass here and be refused there. */
function normalize(p: string): string {
  let r = resolve(p)
  try {
    r = realpathSync.native(r)
  } catch {
    // Not on disk (yet): compare the plain resolved path.
  }
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** Mirrors IR Lab's own "inside one of these folders" check. */
export function isUnderAnyRoot(absPath: string, roots: string[]): boolean {
  const target = normalize(absPath)
  return roots.some((root) => {
    const normRoot = normalize(root)
    return target === normRoot || target.startsWith(normRoot.endsWith(sep) ? normRoot : normRoot + sep)
  })
}

export interface BlendAllowlistCheck {
  allowed: string[]
  rejected: string[]
  /** True when IR Lab has no Cab IR / Reverb IR / DI folder configured at all — a different
   * message than "these particular items are outside your configured folders." */
  noRootsConfigured: boolean
}

export function checkBlendAllowlist(absPaths: string[], roots: string[] = readIrLabAllowedRoots()): BlendAllowlistCheck {
  if (roots.length === 0) {
    return { allowed: [], rejected: absPaths, noRootsConfigured: true }
  }
  const allowed: string[] = []
  const rejected: string[] = []
  for (const p of absPaths) (isUnderAnyRoot(p, roots) ? allowed : rejected).push(p)
  return { allowed, rejected, noRootsConfigured: false }
}

/** Same pre-flight idea as `checkBlendAllowlist`, for the `nam`/`namgroup` routes' single
 * `defaultNamFolder` setting instead of the three Cab IR/Reverb IR/DI roots. */
export function checkNamAllowlist(absPaths: string[], namFolder: string | null = readIrLabNamFolder()): BlendAllowlistCheck {
  if (!namFolder) {
    return { allowed: [], rejected: absPaths, noRootsConfigured: true }
  }
  const allowed: string[] = []
  const rejected: string[] = []
  for (const p of absPaths) (isUnderAnyRoot(p, [namFolder]) ? allowed : rejected).push(p)
  return { allowed, rejected, noRootsConfigured: false }
}

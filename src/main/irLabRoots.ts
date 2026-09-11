/**
 * Reads IR Lab's own configured library folders so "Send to IR Lab" can catch the exact failure
 * IR Lab's own `blend` route handler enforces, before firing the handoff rather than after.
 *
 * IR Lab's `ExternalHandoffRouter.cpp` (security audit 2026-08-31, LOW-1) accepts an `item=` path
 * into the blend route only when it resolves under one of three folders the user configured there
 * — Cab IR, Reverb IR, or DI. Anything else is silently dropped and IR Lab shows its own banner
 * ("pointing outside your IR library — ignored"), in the OTHER app, after the user already thinks
 * the send succeeded here. This reads the same three settings IR Lab itself reads, so we can warn
 * in THIS app instead.
 *
 * `LiveAuditionSettingsStore::storeFile()` (ir-lab/src/audio/LiveAuditionSettingsStore.cpp) is
 * `<userApplicationDataDirectory>/IR Lab/live-audition-settings.json` — JUCE's
 * userApplicationDataDirectory and Electron's `app.getPath('appData')` resolve to the same
 * per-platform location (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS), so no
 * platform branching is needed here. Read-only: this never writes IR Lab's config. If IR Lab has
 * never been run, or the file is missing/malformed, this returns an empty list rather than
 * throwing — "IR Lab isn't configured yet" is an ordinary, common state, not an error.
 */
import { app } from 'electron'
import { join, resolve, sep } from 'node:path'
import { readFileSync } from 'node:fs'

const SETTINGS_KEYS = ['defaultCabIrFolder', 'defaultReverbIrFolder', 'defaultDiFolder'] as const

export function irLabSettingsFile(): string {
  return join(app.getPath('appData'), 'IR Lab', 'live-audition-settings.json')
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

export function readIrLabAllowedRoots(): string[] {
  try {
    return parseIrLabAllowedRoots(readFileSync(irLabSettingsFile(), 'utf-8'))
  } catch {
    return []
  }
}

/** Case-insensitive on Windows (NTFS paths are case-preserving, not case-sensitive) — matches how
 * `juce::File::operator==` compares on that platform. Elsewhere, exact. */
function normalize(p: string): string {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** Mirrors `ExternalHandoffRouter.cpp`'s own `file == root || file.isAChildOf(root)` check. */
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

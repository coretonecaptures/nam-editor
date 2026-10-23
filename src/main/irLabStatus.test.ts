import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { parseIrLabStatus, irLabSupportsRoute, irLabAppDataDirFor } from './irLabStatus'

describe('parseIrLabStatus', () => {
  it('reads a real status file IR Lab writes', () => {
    const json = JSON.stringify({ schemaVersion: 1, installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null, routes: null, linkReceipts: false })
    expect(parseIrLabStatus(json)).toEqual({ installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null, routes: null, linkReceipts: false })
  })

  it('reads unlicensed state', () => {
    const json = JSON.stringify({ installed: true, version: '1.4.0', licenseState: 'unlicensed', trialDaysRemaining: null, routes: null, linkReceipts: false })
    expect(parseIrLabStatus(json).licenseState).toBe('unlicensed')
  })

  it('falls back to unknown for malformed JSON rather than throwing', () => {
    expect(parseIrLabStatus('{not json')).toEqual({ installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null, routes: null, linkReceipts: false })
  })

  it('falls back to unknown for valid JSON that is not an object', () => {
    expect(parseIrLabStatus('42').licenseState).toBe('unknown')
  })

  it('treats an unrecognized licenseState string as unknown, not a crash', () => {
    const json = JSON.stringify({ installed: true, licenseState: 'something-a-future-version-might-add' })
    expect(parseIrLabStatus(json).licenseState).toBe('unknown')
  })

  it('defaults installed to false and version to null when absent', () => {
    expect(parseIrLabStatus('{}')).toEqual({ installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null, routes: null, linkReceipts: false })
  })

  it('reads the advertised irlab:// routes and answers support per route', () => {
    const status = parseIrLabStatus(JSON.stringify({ installed: true, licenseState: 'licensed', routes: ['blend', 'playcab', 7] }))
    expect(status.routes).toEqual(['blend', 'playcab'])
    expect(irLabSupportsRoute(status, 'playcab')).toBe(true)
    expect(irLabSupportsRoute(status, 'portableProject')).toBe(false)
  })

  it('treats a status file without routes (older IR Lab) as supporting no new route', () => {
    expect(irLabSupportsRoute(parseIrLabStatus(JSON.stringify({ installed: true, licenseState: 'licensed' })), 'playcab')).toBe(false)
  })
})

describe('irLabAppDataDirFor', () => {
  // IR Lab's JUCE userApplicationDataDirectory: ~/Library on macOS, %APPDATA% on Windows. Electron's
  // appData on macOS is ~/Library/Application Support, which IR Lab never writes (2026-10-23: the
  // folder-settings reader used it and found nothing).
  it('is ~/Library/IR Lab on macOS and never asks for appData there', () => {
    expect(irLabAppDataDirFor('darwin', '/Users/a', () => { throw new Error('appData read on macOS') })).toBe(join('/Users/a', 'Library', 'IR Lab'))
  })
  it('is <appData>/IR Lab elsewhere', () => {
    expect(irLabAppDataDirFor('win32', 'C:/Users/a', () => 'C:/Users/a/AppData/Roaming')).toBe(join('C:/Users/a/AppData/Roaming', 'IR Lab'))
  })
})

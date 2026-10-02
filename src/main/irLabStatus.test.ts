import { describe, it, expect } from 'vitest'
import { parseIrLabStatus, irLabSupportsRoute } from './irLabStatus'

describe('parseIrLabStatus', () => {
  it('reads a real status file IR Lab writes', () => {
    const json = JSON.stringify({ schemaVersion: 1, installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null, routes: null })
    expect(parseIrLabStatus(json)).toEqual({ installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null, routes: null })
  })

  it('reads unlicensed state', () => {
    const json = JSON.stringify({ installed: true, version: '1.4.0', licenseState: 'unlicensed', trialDaysRemaining: null, routes: null })
    expect(parseIrLabStatus(json).licenseState).toBe('unlicensed')
  })

  it('falls back to unknown for malformed JSON rather than throwing', () => {
    expect(parseIrLabStatus('{not json')).toEqual({ installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null, routes: null })
  })

  it('falls back to unknown for valid JSON that is not an object', () => {
    expect(parseIrLabStatus('42').licenseState).toBe('unknown')
  })

  it('treats an unrecognized licenseState string as unknown, not a crash', () => {
    const json = JSON.stringify({ installed: true, licenseState: 'something-a-future-version-might-add' })
    expect(parseIrLabStatus(json).licenseState).toBe('unknown')
  })

  it('defaults installed to false and version to null when absent', () => {
    expect(parseIrLabStatus('{}')).toEqual({ installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null, routes: null })
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

import { describe, it, expect } from 'vitest'
import { parseIrLabStatus } from './irLabStatus'

describe('parseIrLabStatus', () => {
  it('reads a real status file IR Lab writes', () => {
    const json = JSON.stringify({ schemaVersion: 1, installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null })
    expect(parseIrLabStatus(json)).toEqual({ installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null })
  })

  it('reads unlicensed state', () => {
    const json = JSON.stringify({ installed: true, version: '1.4.0', licenseState: 'unlicensed', trialDaysRemaining: null })
    expect(parseIrLabStatus(json).licenseState).toBe('unlicensed')
  })

  it('falls back to unknown for malformed JSON rather than throwing', () => {
    expect(parseIrLabStatus('{not json')).toEqual({ installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null })
  })

  it('falls back to unknown for valid JSON that is not an object', () => {
    expect(parseIrLabStatus('42').licenseState).toBe('unknown')
  })

  it('treats an unrecognized licenseState string as unknown, not a crash', () => {
    const json = JSON.stringify({ installed: true, licenseState: 'something-a-future-version-might-add' })
    expect(parseIrLabStatus(json).licenseState).toBe('unknown')
  })

  it('defaults installed to false and version to null when absent', () => {
    expect(parseIrLabStatus('{}')).toEqual({ installed: false, version: null, licenseState: 'unknown', trialDaysRemaining: null })
  })
})

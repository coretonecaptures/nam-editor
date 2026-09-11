import { describe, it, expect } from 'vitest'
import { describeIrLabAvailability } from './irLabStatusMessage'

describe('describeIrLabAvailability', () => {
  it('disables and explains when the connector was not built into this app at all', () => {
    const result = describeIrLabAvailability(false, null, 'Send this')
    expect(result.disabled).toBe(true)
    expect(result.tooltip).toMatch(/not configured in this build/)
  })

  it('stays clickable but says IR Lab has not run yet when there is no status file', () => {
    const result = describeIrLabAvailability(true, null, 'Send this')
    expect(result.disabled).toBe(false)
    expect(result.tooltip).toMatch(/hasn't reported running/)
  })

  it('surfaces trial days remaining for an unlicensed install', () => {
    const result = describeIrLabAvailability(true, { installed: true, version: '1.4.0', licenseState: 'unlicensed', trialDaysRemaining: 5 }, 'Send this')
    expect(result.tooltip).toMatch(/unlicensed \(5 trial days left\)/)
  })

  it('uses singular day wording for exactly one trial day', () => {
    const result = describeIrLabAvailability(true, { installed: true, version: '1.4.0', licenseState: 'unlicensed', trialDaysRemaining: 1 }, 'Send this')
    expect(result.tooltip).toMatch(/1 trial day left/)
  })

  it('reports the action label and version for a licensed install', () => {
    const result = describeIrLabAvailability(true, { installed: true, version: '1.4.0', licenseState: 'licensed', trialDaysRemaining: null }, 'Send this')
    expect(result.tooltip).toBe('Send this in IR Lab (v1.4.0)')
  })
})

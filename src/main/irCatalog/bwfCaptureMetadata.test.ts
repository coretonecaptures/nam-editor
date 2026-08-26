import { describe, it, expect } from 'vitest'
import { parseBwfCaptureMetadata } from './bwfCaptureMetadata'

describe('parseBwfCaptureMetadata', () => {
  it('parses every field IR Lab writes, in its documented order', () => {
    const fields = parseBwfCaptureMetadata(
      'Cabinet: Mesa 4x12 | Speaker: V30 | Microphone: SM57 | Position: Cap edge, 1in | Notes: bright | CaptureType: Hardware',
      'IR Lab'
    )
    expect(fields).toEqual({
      cabinet: 'Mesa 4x12',
      speaker: 'V30',
      microphone: 'SM57',
      position: 'Cap edge, 1in',
      notes: 'bright',
      captureType: 'Hardware'
    })
  })

  it('omits fields the operator left blank rather than emitting empty strings', () => {
    const fields = parseBwfCaptureMetadata('Cabinet: Mesa 4x12 | Speaker: V30', 'IR Lab')
    expect(fields).toEqual({ cabinet: 'Mesa 4x12', speaker: 'V30' })
    expect(fields).not.toHaveProperty('notes')
  })

  it('trusts Originator as the signal, not just the presence of a Description', () => {
    // Some other tool's bext chunk could coincidentally contain colon-separated text; without the
    // Originator check this would be misread as real capture fields.
    expect(parseBwfCaptureMetadata('Cabinet: Something', 'Adobe Audition')).toBeNull()
    expect(parseBwfCaptureMetadata('Cabinet: Something', null)).toBeNull()
  })

  it('returns null for a missing or empty chunk rather than an empty object', () => {
    expect(parseBwfCaptureMetadata(null, 'IR Lab')).toBeNull()
    expect(parseBwfCaptureMetadata('', 'IR Lab')).toBeNull()
  })

  it('splits the combined MicADistance token into value + unit', () => {
    const fields = parseBwfCaptureMetadata('Cabinet: Mesa 4x12 | MicADistance: 3.50in', 'IR Lab')
    expect(fields).toEqual({ cabinet: 'Mesa 4x12', micADistance: 3.5, micADistanceUnit: 'in' })
  })

  it('handles a cm unit and non-integer values', () => {
    const fields = parseBwfCaptureMetadata('MicADistance: 7.25cm', 'IR Lab')
    expect(fields).toEqual({ micADistance: 7.25, micADistanceUnit: 'cm' })
  })

  it('ignores an unparseable MicADistance token rather than throwing', () => {
    expect(() => parseBwfCaptureMetadata('MicADistance: garbage', 'IR Lab')).not.toThrow()
    expect(parseBwfCaptureMetadata('MicADistance: garbage', 'IR Lab')).toBeNull()
  })
})

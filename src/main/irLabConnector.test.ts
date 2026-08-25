import { describe, it, expect } from 'vitest'
import { buildIrLabUrl, irLabConnectorAvailable } from './irLabConnector'

describe('buildIrLabUrl', () => {
  it('builds a session URL', () => {
    const url = buildIrLabUrl('irlab://', { kind: 'session', captureId: 'abc-123' })
    expect(url).toBe('irlab://session?captureId=abc-123')
  })

  it('builds a blend URL with repeated item= keys, not comma-joined', () => {
    const url = buildIrLabUrl('irlab://', {
      kind: 'blend',
      items: ['C:\\IRs\\a.wav', 'C:\\IRs\\b.wav']
    })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.getAll('item')).toEqual(['C:\\IRs\\a.wav', 'C:\\IRs\\b.wav'])
    // Not a single comma-joined value — this is the mistake the plan's spec explicitly warns
    // against ("Repeat the key per file — do not comma-join").
    expect(url).not.toContain(',')
  })

  it('percent-encodes paths with spaces and special characters', () => {
    const url = buildIrLabUrl('irlab://', {
      kind: 'blend',
      items: ['C:\\My IRs\\Ownhammer 412 & Friends.wav']
    })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.getAll('item')).toEqual(['C:\\My IRs\\Ownhammer 412 & Friends.wav'])
  })

  it('caps a blend at 8 items — the plan\'s own slot count, matching IR Lab\'s Blender', () => {
    const items = Array.from({ length: 12 }, (_, i) => `C:\\IRs\\${i}.wav`)
    const url = buildIrLabUrl('irlab://', { kind: 'blend', items })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.getAll('item')).toHaveLength(8)
    expect(params.getAll('item')).toEqual(items.slice(0, 8))
  })

  it('builds a project URL with an optional preset, omitted when not given', () => {
    const withPreset = buildIrLabUrl('irlab://', { kind: 'project', id: 'proj-1', preset: 'Cab IR' })
    expect(new URLSearchParams(withPreset.split('?')[1]).get('preset')).toBe('Cab IR')

    const withoutPreset = buildIrLabUrl('irlab://', { kind: 'project', id: 'proj-1' })
    expect(withoutPreset).not.toContain('preset')
  })
})

describe('irLabConnectorAvailable', () => {
  it('reflects whether IR_LAB_URL_SCHEME is set', () => {
    const original = process.env.IR_LAB_URL_SCHEME
    try {
      delete process.env.IR_LAB_URL_SCHEME
      expect(irLabConnectorAvailable()).toBe(false)
      process.env.IR_LAB_URL_SCHEME = 'irlab://'
      expect(irLabConnectorAvailable()).toBe(true)
    } finally {
      if (original === undefined) delete process.env.IR_LAB_URL_SCHEME
      else process.env.IR_LAB_URL_SCHEME = original
    }
  })
})

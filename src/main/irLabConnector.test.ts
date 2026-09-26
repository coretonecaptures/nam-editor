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

  it('builds a playcab URL with repeated item= keys, not comma-joined', () => {
    const url = buildIrLabUrl('irlab://', {
      kind: 'playcab',
      items: ['C:\\IRs\\a.wav', 'C:\\IRs\\b.wav']
    })
    const params = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith('irlab://playcab?')).toBe(true)
    expect(params.getAll('item')).toEqual(['C:\\IRs\\a.wav', 'C:\\IRs\\b.wav'])
    expect(url).not.toContain(',')
  })

  it('caps playcab at 4 items — 1-2 fill Cab A/B, 3-4 fill both lanes of a stereo rig', () => {
    const items = Array.from({ length: 8 }, (_, i) => `C:\\IRs\\${i}.wav`)
    const url = buildIrLabUrl('irlab://', { kind: 'playcab', items })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.getAll('item')).toHaveLength(4)
    expect(params.getAll('item')).toEqual(items.slice(0, 4))
  })

  it('builds a project URL with an optional preset, omitted when not given', () => {
    const withPreset = buildIrLabUrl('irlab://', { kind: 'project', id: 'proj-1', preset: 'Cab IR' })
    expect(new URLSearchParams(withPreset.split('?')[1]).get('preset')).toBe('Cab IR')

    const withoutPreset = buildIrLabUrl('irlab://', { kind: 'project', id: 'proj-1' })
    expect(withoutPreset).not.toContain('preset')
  })

  it('builds a nam URL with file + optional slot', () => {
    const url = buildIrLabUrl('irlab://', { kind: 'nam', file: 'C:\\NAM\\Amp.nam', slot: 1 })
    expect(url.startsWith('irlab://nam?')).toBe(true)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('file')).toBe('C:\\NAM\\Amp.nam')
    expect(params.get('slot')).toBe('1')

    const withoutSlot = buildIrLabUrl('irlab://', { kind: 'nam', file: 'C:\\NAM\\Amp.nam' })
    expect(withoutSlot).not.toContain('slot')
  })

  it('builds a namgroup URL carrying the manifest PATH, not the group contents', () => {
    const url = buildIrLabUrl('irlab://', { kind: 'namgroup', manifestPath: 'C:\\NAM\\nam-lab-group-1.json', slot: 0 })
    expect(url.startsWith('irlab://namgroup?')).toBe(true)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('manifest')).toBe('C:\\NAM\\nam-lab-group-1.json')
    expect(params.get('slot')).toBe('0')
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

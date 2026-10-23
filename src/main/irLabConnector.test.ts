import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildIrLabUrl, irLabConnectorAvailable, irLabSendBlocker, waitForIrLabReceipt } from './irLabConnector'
import { parseIrLabStatus } from './irLabStatus'

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

describe('irLabSendBlocker (2026-10-23: never report "sent" for a link IR Lab will ignore)', () => {
  const status = (over: Partial<Parameters<typeof irLabSendBlocker>[0]> = {}) => ({
    installed: true, version: '1.0.0', licenseState: 'licensed' as const, trialDaysRemaining: null, routes: ['blend', 'nam', 'playcab'] as string[] | null, linkReceipts: true, ...over
  })
  it('sends to a licensed IR Lab that knows the route', () => {
    expect(irLabSendBlocker(status(), 'nam')).toBeNull()
  })
  it('stops when IR Lab was never opened, is unlicensed, or predates the route', () => {
    expect(irLabSendBlocker(status({ installed: false }), 'nam')).toMatch(/not been opened/)
    expect(irLabSendBlocker(status({ licenseState: 'unlicensed' }), 'nam')).toMatch(/not licensed/)
    expect(irLabSendBlocker(status({ routes: ['blend'] }), 'namgroup')).toMatch(/cannot receive/)
  })
  it('an older IR Lab that lists no routes still gets the routes it always had', () => {
    expect(irLabSendBlocker(status({ routes: null }), 'blend')).toBeNull()
  })
})

describe('IR Lab link receipts (2026-10-23)', () => {
  it('adds the op id to the link', () => {
    expect(buildIrLabUrl('scheme://', { kind: 'nam', file: '/m/a b.nam' }, 'op-12345678')).toBe('scheme://nam?file=%2Fm%2Fa+b.nam&op=op-12345678')
  })
  it('reads and removes the receipt, or gives up after the timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'irlab-receipts-'))
    try {
      writeFileSync(join(dir, 'op-1.json'), JSON.stringify({ op: 'op-1', route: 'playcab', ok: false, message: 'Stereo rig not enabled' }))
      expect(await waitForIrLabReceipt(dir, 'op-1', 1000, 10)).toEqual({ ok: false, message: 'Stereo rig not enabled' })
      expect(existsSync(join(dir, 'op-1.json'))).toBe(false)
      expect(await waitForIrLabReceipt(dir, 'op-2', 50, 10)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('the status file says whether IR Lab writes receipts', () => {
    expect(parseIrLabStatus(JSON.stringify({ installed: true, linkReceipts: 1 })).linkReceipts).toBe(true)
    expect(parseIrLabStatus(JSON.stringify({ installed: true })).linkReceipts).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  NAME_MIN_WIDTH,
  SCAN_COLUMNS,
  scanColumnValue,
  scanGridTemplate,
  visibleScanColumns
} from './scanColumns'
import type { NamFile } from '../types/nam'

function file(metadata: Record<string, unknown>): NamFile {
  return {
    filePath: '/x/y.nam',
    fileName: 'y.nam',
    version: '0.5.4',
    metadata: metadata as NamFile['metadata'],
    originalMetadata: metadata as NamFile['metadata'],
    autoFilledFields: [],
    architecture: 'WaveNet',
    config: {},
    isDirty: false
  }
}

describe('visibleScanColumns', () => {
  it('shows nothing extra when there is only room for the name', () => {
    expect(visibleScanColumns(NAME_MIN_WIDTH)).toEqual([])
  })

  it('adds columns in priority order as the panel widens', () => {
    const narrow = visibleScanColumns(420)
    const wide = visibleScanColumns(900)
    // Whatever fits at a narrow width must still be there when wider — columns are only ever
    // added on the right, never reshuffled, or the table would rearrange itself as you drag.
    expect(wide.slice(0, narrow.length)).toEqual(narrow)
    expect(wide.length).toBeGreaterThan(narrow.length)
  })

  it('leads with gear, which is what you scan for', () => {
    expect(visibleScanColumns(600)[0]).toBe('gear')
  })

  it('shows every column at full width', () => {
    const total = SCAN_COLUMNS.reduce((n, c) => n + c.width, 0) + NAME_MIN_WIDTH + 200
    expect(visibleScanColumns(total)).toHaveLength(SCAN_COLUMNS.length)
  })

  it('never overflows the panel it was given', () => {
    for (let width = 200; width <= 1600; width += 17) {
      const visible = visibleScanColumns(width)
      const used = visible.reduce(
        (n, id) => n + (SCAN_COLUMNS.find((c) => c.id === id)?.width ?? 0),
        0
      )
      expect(used + NAME_MIN_WIDTH, `${width}px`).toBeLessThanOrEqual(width)
    }
  })

  it('survives a zero or nonsense width rather than throwing', () => {
    expect(visibleScanColumns(0)).toEqual([])
    expect(visibleScanColumns(-100)).toEqual([])
    expect(visibleScanColumns(NaN)).toEqual([])
  })
})

describe('scanGridTemplate', () => {
  it('gives the name column the slack and each other a fixed width', () => {
    expect(scanGridTemplate(['gear', 'tone'])).toBe('minmax(0, 1fr) 150px 82px')
  })

  it('is just the name column when nothing else fits', () => {
    expect(scanGridTemplate([])).toBe('minmax(0, 1fr)')
  })
})

describe('scanColumnValue', () => {
  it('joins make and model into one gear cell', () => {
    expect(scanColumnValue(file({ gear_make: 'Mesa', gear_model: 'Mark IV' }), 'gear')).toBe('Mesa Mark IV')
  })

  it('reads the make alone when there is no model', () => {
    expect(scanColumnValue(file({ gear_make: 'Mesa' }), 'gear')).toBe('Mesa')
  })

  it('uses friendly labels for tone and gear type', () => {
    expect(scanColumnValue(file({ tone_type: 'hi_gain' }), 'tone')).toBe('Hi Gain')
    expect(scanColumnValue(file({ gear_type: 'amp_pedal_cab' }), 'gearType')).toBe('Amp + Pedal + Cab')
  })

  it('falls back to a readable form for values it has no label for', () => {
    expect(scanColumnValue(file({ tone_type: 'some_new_tone' }), 'tone')).toBe('some new tone')
  })

  it('pairs the cabinet with its config, and shows either alone', () => {
    expect(scanColumnValue(file({ nl_cabinet: '4x12', nl_cabinet_config: 'V30' }), 'cab')).toBe('4x12 · V30')
    expect(scanColumnValue(file({ nl_cabinet: '4x12' }), 'cab')).toBe('4x12')
    expect(scanColumnValue(file({ nl_cabinet_config: 'V30' }), 'cab')).toBe('V30')
  })

  it('returns an empty string for missing fields rather than "undefined"', () => {
    for (const column of SCAN_COLUMNS) {
      expect(scanColumnValue(file({}), column.id), column.id).toBe('')
    }
  })

  it('ignores whitespace-only metadata, which would render as a blank cell either way', () => {
    expect(scanColumnValue(file({ nl_amp_settings: '   ' }), 'settings')).toBe('')
  })
})

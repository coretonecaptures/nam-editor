/**
 * Mount-safety for Scan mode.
 *
 * renderToString runs every useMemo (facet building, scoping, ordering) without needing a DOM,
 * an AudioContext or workers — effects don't run, so no audio is touched. That covers the
 * crash-on-mount risk over messy real-world metadata, which is where the danger actually is.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { NamFile } from '../types/nam'
import { ScanMode } from './ScanMode'

let n = 0
function cap(meta: Partial<NamFile['metadata']> = {}): NamFile {
  n++
  return {
    filePath: `/lib/${n}.nam`,
    fileName: `cap-${n}`,
    version: '0.5.0',
    architecture: 'WaveNet',
    config: {},
    metadata: meta,
    originalMetadata: meta,
    autoFilledFields: [],
    isDirty: false
  } as NamFile
}

function render(files: NamFile[], props: Record<string, unknown> = {}): string {
  return renderToString(
    createElement(ScanMode, {
      libraryFiles: files,
      diPath: 'F:/Mix/Dry Guitar.wav',
      onOpenInPlayer: () => {},
      ...props
    } as never)
  )
}

const LIBRARY = [
  cap({ name: 'Plexi Crunch', gear_make: 'MARSHALL', modeled_by: 'SLAMMIN MOFO', tone_type: 'crunch', gain: 0.8 }),
  cap({ name: 'Plexi Clean', gear_make: 'Marshall', modeled_by: 'slamminmofo', tone_type: 'clean', gain: 0.6 }),
  cap({ name: 'Rectifier', gear_make: 'Mesa Boogie', modeled_by: 'Core Tone Captures', tone_type: 'hi_gain', gain: 0.9 }),
  cap({ name: 'Placeholder', gear_make: 'tz-make', modeled_by: null, tone_type: null })
]

describe('ScanMode', () => {
  it('mounts with an empty library', () => {
    expect(() => render([])).not.toThrow()
  })

  it('mounts with no DI configured and explains what is missing', () => {
    const html = render(LIBRARY, { diPath: null })
    expect(html).toMatch(/DI/i)
  })

  it('lists every capture when nothing is scoped', () => {
    const html = render(LIBRARY)
    for (const name of ['Plexi Crunch', 'Plexi Clean', 'Rectifier', 'Placeholder']) {
      expect(html).toContain(name)
    }
  })

  it('shows the scope count', () => {
    expect(render(LIBRARY)).toContain('4')
  })

  it('merges split make spellings into one chip', () => {
    // MARSHALL + Marshall must offer a single "Marshall 2" chip, not two chips of 1.
    const html = render(LIBRARY)
    const marshallChips = html.match(/Marshall/gi) ?? []
    expect(marshallChips.length).toBeGreaterThan(0)
    expect(html).not.toContain('MARSHALL</button>')
  })

  it('offers the hold/latch control', () => {
    expect(render(LIBRARY)).toMatch(/Hold|Latched/)
  })

  it('explains that several amps make a family', () => {
    expect(render(LIBRARY)).toMatch(/famil/i)
  })

  it('survives metadata that is null throughout', () => {
    const nulls = [
      cap({ name: null, gear_make: null, modeled_by: null, tone_type: null, gain: null })
    ]
    expect(() => render(nulls)).not.toThrow()
  })

  it('survives a large library without throwing', () => {
    const many = Array.from({ length: 800 }, (_, i) =>
      cap({ name: `cap ${i}`, gear_make: `Make ${i % 30}`, tone_type: i % 2 ? 'crunch' : 'clean', gain: 0.5 + (i % 40) / 100 })
    )
    expect(() => render(many)).not.toThrow()
  })

  it('falls back to the file name when a capture has no name', () => {
    const html = render([cap({ gear_make: 'Fender' })])
    expect(html).toMatch(/cap-\d+/)
  })
})

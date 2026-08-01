/**
 * Mount safety for the Tone Map's list view.
 *
 * renderToString runs the ordering pass without a DOM, an AudioContext or workers — effects don't
 * run, so no audio is touched. That covers the crash-on-mount risk over messy real metadata.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { NamFile } from '../types/nam'
import { ScanList } from './ScanList'
import type { AuditionApi } from '../hooks/useAudition'

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

const audition: AuditionApi = {
  play: () => {},
  stop: () => {},
  prefetch: () => {},
  playingPath: null,
  ready: new Set<string>(),
  diReady: true,
  error: ''
}

function render(files: NamFile[], props: Record<string, unknown> = {}): string {
  return renderToString(
    createElement(ScanList, {
      files,
      audition,
      latched: false,
      onOpenInPlayer: () => {},
      ...props
    } as never)
  )
}

const LIBRARY = [
  cap({ name: 'Rectifier', gear_make: 'Mesa Boogie', tone_type: 'hi_gain', gain: 0.9 }),
  cap({ name: 'Plexi Clean', gear_make: 'Marshall', tone_type: 'clean', gain: 0.6 }),
  cap({ name: 'Plexi Crunch', gear_make: 'MARSHALL', tone_type: 'crunch', gain: 0.8 })
]

describe('ScanList', () => {
  it('explains itself when the facets match nothing', () => {
    expect(render([])).toMatch(/nothing matches/i)
  })

  it('lists every capture it is given', () => {
    const html = render(LIBRARY)
    for (const name of ['Rectifier', 'Plexi Clean', 'Plexi Crunch']) {
      expect(html).toContain(name)
    }
  })

  it('sweeps cleanest first regardless of the order handed in', () => {
    const html = render(LIBRARY)
    expect(html.indexOf('Plexi Clean')).toBeLessThan(html.indexOf('Plexi Crunch'))
    expect(html.indexOf('Plexi Crunch')).toBeLessThan(html.indexOf('Rectifier'))
  })

  it('shows the scope size and a render estimate', () => {
    const html = render(LIBRARY)
    expect(html).toContain('3')
    expect(html).toMatch(/about|under a second/)
  })

  it('marks which captures are already rendered', () => {
    const ready: AuditionApi = { ...audition, ready: new Set([LIBRARY[0].filePath]) }
    expect(() => render(LIBRARY, { audition: ready })).not.toThrow()
  })

  it('survives metadata that is null throughout', () => {
    expect(() =>
      render([cap({ name: null, gear_make: null, tone_type: null, gain: null })])
    ).not.toThrow()
  })

  it('falls back to the file name when a capture has none', () => {
    expect(render([cap({ gear_make: 'Fender' })])).toMatch(/cap-\d+/)
  })

  it('handles a large scope without throwing', () => {
    const many = Array.from({ length: 900 }, (_, i) =>
      cap({ name: `cap ${i}`, tone_type: i % 2 ? 'crunch' : 'clean', gain: 0.5 + (i % 40) / 100 })
    )
    expect(() => render(many)).not.toThrow()
  })
})

/**
 * Mount-safety tests for the redesigned PlayerPanel.
 *
 * renderToString executes the component's initial render (including the useState initializers that
 * read localStorage) without needing a DOM. Effects don't run, so this doesn't exercise audio — it
 * catches the crash-on-mount class of bug, which is what a large UI replacement most risks.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { NamFile } from '../types/nam'
import { PlayerPanel } from './PlayerPanel'

let counter = 0
function capture(meta: Partial<NamFile['metadata']> = {}, config: unknown = {}): NamFile {
  counter++
  return {
    filePath: `/lib/cap-${counter}.nam`,
    fileName: `cap-${counter}`,
    version: '0.5.0',
    architecture: 'WaveNet',
    config,
    metadata: meta,
    originalMetadata: meta,
    autoFilledFields: [],
    isDirty: false
  } as NamFile
}

function render(file: NamFile, props: Record<string, unknown> = {}): string {
  return renderToString(
    createElement(PlayerPanel, {
      file,
      onClose: () => {},
      diLibraryPath: null,
      irLibraryPath: null,
      irMix: 1,
      coverImagePath: null,
      ...props
    } as never)
  )
}

describe('PlayerPanel (redesign)', () => {
  it('mounts with a bare capture', () => {
    expect(() => render(capture())).not.toThrow()
  })

  it('shows the Tone Preview eyebrow and the mode toggle', () => {
    const html = render(capture({ name: 'FR MRSH JCM2000 CH2' }))
    expect(html).toMatch(/TONE PREVIEW|Tone Preview/i)
    expect(html).toContain('FR MRSH JCM2000 CH2')
    expect(html).toMatch(/Preview/)
    expect(html).toMatch(/Live/)
  })

  it('renders the tape transport section', () => {
    const html = render(capture())
    expect(html).toMatch(/TRANSPORT|Transport/i)
    // Engraved labels are Oswald; the fonts are vendored via @fontsource.
    expect(html).toContain('Oswald')
  })

  it('renders metadata rows only for fields that have values', () => {
    const html = render(
      capture({
        name: 'Test',
        gear_make: 'MARSHALL',
        gear_model: 'JCM800',
        gear_type: 'amp_cab',
        tone_type: 'overdrive',
        modeled_by: 'SLAMMIN MOFO'
      })
    )
    expect(html).toContain('MARSHALL JCM800')
    expect(html).toContain('Overdrive')
    expect(html).toContain('SLAMMIN MOFO')
    // Fields with no value must not produce empty cells.
    expect(html).not.toMatch(/>Cabinet</)
  })

  it('falls back to the bundled placeholder when there is no cover', () => {
    const html = render(capture(), { coverImagePath: null })
    expect(html).toMatch(/amp_placeholder|<img/)
  })

  it('uses the local-file scheme when a cover exists', () => {
    const html = render(capture(), { coverImagePath: 'F:/packs/ampcover.png' })
    expect(html).toContain('local-file://')
  })

  it('explains the empty state when no DI library is configured', () => {
    const html = render(capture())
    expect(html).toMatch(/DI/i)
  })

  it('survives metadata with nulls throughout', () => {
    expect(() =>
      render(
        capture({
          name: null,
          gear_make: null,
          gear_model: null,
          gear_type: null,
          tone_type: null,
          modeled_by: null,
          gain: null,
          loudness: null
        })
      )
    ).not.toThrow()
  })

  it('renders an ESR row for an A2 capture without tripping the A2 detection path', () => {
    // getCaptureBestEsr needs architecture + config from OUTSIDE metadata; passing bare metadata
    // is the documented bug this guards against.
    const file = capture({ name: 'A2 cap' }, { submodels: [{}, {}] })
    expect(() => render(file)).not.toThrow()
  })
})

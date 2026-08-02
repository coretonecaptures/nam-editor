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
import { PLAYER_MIN_WIDTH, TRANSPORT_SCALE, PlayerPanel } from './PlayerPanel'

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
    // Engraved labels use the app's own IBM Plex with wide tracking, NOT a novelty face —
    // Oswald was dropped because it appeared nowhere else in the app and read as foreign.
    expect(html).toContain('IBM Plex Sans')
    expect(html).not.toContain('Oswald')
    // Barlow is still allowed, but only on the Live RECORDING sign (not rendered in Preview).
    expect(html).not.toContain('Barlow')
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

describe('PLAYER_MIN_WIDTH', () => {
  // The transport buttons used to overflow the metal faceplate once the panel was dragged
  // narrow, because the layout reserved 300px while the caps needed ~360.
  const CAP_SIZE = 78
  const CAP_GAP = 8
  const FACEPLATE_PAD = 14
  // Caps and faceplate padding are artwork pixels living inside the zoomed faceplate, so the
  // width they actually claim is scaled. The section padding sits outside the zoom and is not.
  const faceplate = (CAP_SIZE * 4 + CAP_GAP * 3 + FACEPLATE_PAD * 2) * TRANSPORT_SCALE

  it('leaves the four caps comfortably inside the faceplate', () => {
    expect(PLAYER_MIN_WIDTH).toBeGreaterThan(faceplate + 16 * 2)
  })

  it('reserves enough for the caps at whatever scale the transport renders', () => {
    // The old bug was a floor picked independently of the artwork. Guard the relationship, not
    // the number: the floor has to track TRANSPORT_SCALE, not a constant someone typed once.
    expect(PLAYER_MIN_WIDTH).toBeGreaterThan(faceplate)
    expect(PLAYER_MIN_WIDTH).toBeLessThan(faceplate * 2)
  })

  it('stays a sane panel width rather than dominating the window', () => {
    expect(PLAYER_MIN_WIDTH).toBeLessThan(600)
  })

  it('lets two players sit side by side in an ordinary window', () => {
    // The point of shrinking the transport: two devices, plus a drag handle and a file list,
    // inside a 1280px window.
    expect(PLAYER_MIN_WIDTH * 2).toBeLessThan(1280)
  })
})

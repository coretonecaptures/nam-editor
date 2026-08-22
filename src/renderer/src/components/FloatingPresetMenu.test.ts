/**
 * Regression coverage for the bug where playing Echo Lab in its floating window (or Delay in
 * its own) could save a preset into the WRONG module's list — see the fix in DelayFloatingWindow
 * and EchoLabFloatingWindow, and the guard added around the shared inline PresetMenu in
 * PlayerPanel.tsx.
 *
 * What this file can and can't prove: PlayerPanel's echoLabFloating/delayFloating state only
 * starts true after a click, and this project's test harness (see vitest.config.ts) uses
 * renderToString with no jsdom/event simulation — so the floating state itself is unreachable
 * here, and the inline-header suppression (`!delayFloating`/`!echoLabFloating` in PlayerPanel)
 * has no feasible test today. What IS testable, and what these cases cover, is the half of the
 * fix that lives in the floating windows themselves: that each one renders with its OWN preset
 * list correctly wired, independent of the other's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { EchoLabFloatingWindow } from './EchoLabFloatingWindow'
import { DelayFloatingWindow } from './DelayFloatingWindow'
import { DEFAULT_DELAY, DEFAULT_ECHO_LAB } from '../utils/liveEngine'
import type { DelayPreset, EchoLabPreset } from '../types/settings'

// RackFloatingWindow (both floating windows render inside it) reads window.innerWidth in its
// initial useState — this project's vitest environment is plain `node` (see vitest.config.ts;
// component tests use renderToString and don't otherwise need jsdom), so that global needs a
// minimal, test-local stand-in rather than pulling in a full DOM env project-wide.
beforeAll(() => {
  ;(globalThis as { window?: { innerWidth: number } }).window = { innerWidth: 1280 }
})
afterAll(() => {
  delete (globalThis as { window?: unknown }).window
})

// Deliberately NOT DEFAULT_ECHO_LAB/DEFAULT_DELAY as-is: RackEchoLab/RackDelay each do their own
// independent LCD-name matching by deep-comparing live settings against delayPresets/
// echoLabPresets (see RackDelay's irPath-matching comment) — separate from the PresetMenu's own
// activeId prop. Reusing the literal default object for both "live settings" and "stored preset
// settings" would make that unrelated mechanism match too, muddying what these tests are for.
const echoPresets: EchoLabPreset[] = [
  { id: 'e1', name: 'ECHO-ONLY-PRESET', settings: { ...DEFAULT_ECHO_LAB, mix: 0.42 } }
]
const delayPresets: DelayPreset[] = [
  { id: 'd1', name: 'DELAY-ONLY-PRESET', settings: { ...DEFAULT_DELAY, mix: 0.42 }, irPath: null }
]

function renderEchoLabFloating(activePresetId: string | null): string {
  return renderToString(
    createElement(EchoLabFloatingWindow, {
      echoLab: DEFAULT_ECHO_LAB,
      onChange: () => {},
      onClose: () => {},
      presets: echoPresets.map((p) => ({ id: p.id, name: p.name })),
      activePresetId,
      onRecall: () => {},
      onSaveAs: () => {},
      onUpdate: () => {},
      onDelete: () => {}
    })
  )
}

function renderDelayFloating(activePresetId: string | null): string {
  return renderToString(
    createElement(DelayFloatingWindow, {
      delay: DEFAULT_DELAY,
      onChange: () => {},
      delayPresets,
      irName: null,
      irPath: null,
      onClose: () => {},
      activePresetId,
      onRecall: () => {},
      onSaveAs: () => {},
      onUpdate: () => {},
      onDelete: () => {}
    })
  )
}

describe('EchoLabFloatingWindow', () => {
  it('mounts with its preset props without crashing', () => {
    expect(() => renderEchoLabFloating(null)).not.toThrow()
  })

  it('shows its own active preset name when one is passed, not a placeholder', () => {
    const html = renderEchoLabFloating('e1')
    expect(html).toContain('ECHO-ONLY-PRESET')
  })

  it('never renders the Delay-only preset name — the two lists are not cross-wired', () => {
    const html = renderEchoLabFloating('e1')
    expect(html).not.toContain('DELAY-ONLY-PRESET')
  })

  it('falls back to the placeholder when nothing is active, rather than showing a stale name', () => {
    const html = renderEchoLabFloating(null)
    expect(html).not.toContain('ECHO-ONLY-PRESET')
  })
})

describe('DelayFloatingWindow', () => {
  it('mounts with its preset props without crashing', () => {
    expect(() => renderDelayFloating(null)).not.toThrow()
  })

  it('shows its own active preset name when one is passed, not a placeholder', () => {
    const html = renderDelayFloating('d1')
    expect(html).toContain('DELAY-ONLY-PRESET')
  })

  it('never renders the Echo Lab-only preset name — the two lists are not cross-wired', () => {
    const html = renderDelayFloating('d1')
    expect(html).not.toContain('ECHO-ONLY-PRESET')
  })

  it('falls back to the placeholder when nothing is active, rather than showing a stale name', () => {
    const html = renderDelayFloating(null)
    expect(html).not.toContain('DELAY-ONLY-PRESET')
  })
})

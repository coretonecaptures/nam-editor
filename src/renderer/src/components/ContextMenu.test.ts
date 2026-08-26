/**
 * Mount-safety tests for the shared context menu shell, same pattern PlayerPanel.test.ts uses
 * (renderToString, no jsdom — catches crash-on-mount, not click behavior).
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

function render(items: ContextMenuItem[]): string {
  return renderToString(createElement(ContextMenu, { x: 10, y: 20, items, onClose: () => {} }))
}

describe('ContextMenu', () => {
  it('mounts with a plain item list', () => {
    expect(() => render([{ label: 'Reveal in Folder' }])).not.toThrow()
  })

  it('renders every item label', () => {
    const html = render([{ label: 'One' }, { label: 'Two' }, { label: 'Three' }])
    expect(html).toContain('One')
    expect(html).toContain('Two')
    expect(html).toContain('Three')
  })

  it('renders a divider without a label', () => {
    const html = render([{ label: 'Above' }, { divider: true }, { label: 'Below' }])
    expect(html).toContain('Above')
    expect(html).toContain('Below')
  })

  it('marks a disabled item so it cannot be clicked', () => {
    const html = render([{ label: 'Disabled action', disabled: true }])
    expect(html).toContain('disabled')
  })

  it('mounts with an empty item list', () => {
    expect(() => render([])).not.toThrow()
  })
})

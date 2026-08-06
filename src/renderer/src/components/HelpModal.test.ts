/**
 * Mount-safety test for MarkdownViewer, the Help menu's hand-rolled markdown renderer.
 *
 * `#### ` (h4) lines used to hang the outer parser loop forever: nothing in the if-chain matched
 * a 4-# prefix, and the paragraph-collection loop's own guard excludes any line starting with `#`
 * — so `i` never advanced and the loop spun until the tab's memory growth crashed the renderer.
 * Adding an Effects Reference section with `####` subheadings to features.md hit this for real.
 *
 * renderToString needs no jsdom, but it does execute the parser fully, which is exactly where the
 * risk lives — so this both confirms real termination (vitest's own test timeout is the actual
 * regression guard: a reintroduced infinite loop fails this test by hanging, not by throwing) and
 * exercises every doc the Help menu actually loads, not just a synthetic fixture.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MarkdownViewer } from './HelpModal'
import workflowsDoc from '../../../../docs/workflows.md?raw'
import featuresDoc from '../../../../docs/features.md?raw'
import trainingDoc from '../../../../docs/training.md?raw'
import a2Doc from '../../../../docs/a2-status.md?raw'
import installDoc from '../../../../docs/install.md?raw'

function render(markdown: string): string {
  return renderToString(createElement(MarkdownViewer, { markdown }))
}

describe('MarkdownViewer', () => {
  it('terminates and renders every real Help doc', () => {
    for (const doc of [workflowsDoc, featuresDoc, trainingDoc, a2Doc, installDoc]) {
      expect(() => render(doc)).not.toThrow()
    }
  })

  it('renders h4 (####) headings instead of hanging', () => {
    const html = render('#### A subheading\n\nSome text.')
    expect(html).toContain('<h4')
    expect(html).toContain('A subheading')
  })

  it('falls back to a paragraph for any unmatched leading-# line, guaranteeing forward progress', () => {
    const html = render('##### Five hashes\n\nNext paragraph.')
    expect(html).toContain('Five hashes')
    expect(html).toContain('Next paragraph')
  })

  it('does not hang on an empty document', () => {
    expect(render('')).toBe('<div class="space-y-3"></div>')
  })
})

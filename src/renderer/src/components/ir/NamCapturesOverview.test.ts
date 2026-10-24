import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NamCapturesOverview } from './NamCapturesOverview'
import type { NamLibraryOverview } from '../../types/namProjects'

const overview: NamLibraryOverview = {
  totalProjects: 2,
  totalCaptures: 10,
  trainedCaptures: 6,
  untrainedCaptures: 4,
  syntheticCaptures: 3,
  avgTrainedEsr: 0.0123,
  byScope: [{ key: 'Direct amp', count: 7 }, { key: 'Software', count: 3 }],
  bySampleRate: [{ key: '48 kHz', count: 10 }],
  byArchitecture: [{ key: 'A2', count: 4 }, { key: 'standard', count: 2 }],
  projects: [
    { collectionId: 'a', name: 'Mesa Mark IV', captureCount: 4, trainedCount: 4, syntheticCount: 0, avgTrainedEsr: 0.004 },
    { collectionId: 'b', name: 'Victory Kraken', captureCount: 6, trainedCount: 2, syntheticCount: 3, avgTrainedEsr: null }
  ]
}

// React's server renderer separates adjacent text nodes with <!-- -->; strip them so "2/6" reads as one string.
const render = (o: NamLibraryOverview): string =>
  renderToString(
    createElement(NamCapturesOverview, { overview: o, buildReport: () => '', onOpenProject: () => {}, onCopyError: () => {} })
  ).replace(/<!-- -->/g, '')

describe('NamCapturesOverview', () => {
  it('renders the coverage hero, stats, breakdowns and per-project rows', () => {
    const html = render(overview)
    expect(html).toContain('Training coverage')
    expect(html).toContain('Mostly trained') // 60%
    expect(html).toContain('% trained')
    expect(html).toContain('Capture scope')
    expect(html).toContain('Trained architecture')
    expect(html).toContain('Mesa Mark IV')
    expect(html).toContain('2/6')
    expect(html).toContain('0.0123')
  })

  it('lists the most untrained project first', () => {
    const html = render(overview)
    expect(html.indexOf('Victory Kraken')).toBeLessThan(html.indexOf('Mesa Mark IV'))
  })

  it('does not crash on an empty library', () => {
    const html = render({
      ...overview,
      totalProjects: 0, totalCaptures: 0, trainedCaptures: 0, untrainedCaptures: 0, syntheticCaptures: 0,
      avgTrainedEsr: null, byScope: [], bySampleRate: [], byArchitecture: [], projects: []
    })
    expect(html).toContain('No captures yet')
    expect(html).toContain('No data')
  })
})

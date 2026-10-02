import { describe, it, expect } from 'vitest'
import { parseNamLabUrl } from './namLabUrl'

describe('parseNamLabUrl', () => {
  it('parses a real project deep link from IR Lab', () => {
    expect(parseNamLabUrl('namlab://project?id=abc-123')).toEqual({ route: 'project', id: 'abc-123' })
  })

  it('rejects a non-namlab protocol', () => {
    expect(parseNamLabUrl('irlab://project?id=abc-123')).toBeNull()
  })

  it('rejects an unrecognized route', () => {
    expect(parseNamLabUrl('namlab://blend?id=abc-123')).toBeNull()
  })

  it('rejects a project link with no id', () => {
    expect(parseNamLabUrl('namlab://project')).toBeNull()
  })

  it('parses a library link with an escaped absolute folder path', () => {
    expect(parseNamLabUrl('namlab://library?path=%2FUsers%2Fme%2FNAM%20Profiles')).toEqual({
      route: 'library',
      path: '/Users/me/NAM Profiles'
    })
  })

  it('rejects a library link with no path', () => {
    expect(parseNamLabUrl('namlab://library')).toBeNull()
    expect(parseNamLabUrl('namlab://library?path=')).toBeNull()
  })

  it('returns null for malformed input rather than throwing', () => {
    expect(parseNamLabUrl('not a url')).toBeNull()
  })

  it('parses a train link with selected captures (escaped, as IR Lab sends them)', () => {
    expect(parseNamLabUrl('namlab://train?project=p%201&capture=a%26b&capture=c')).toEqual({
      route: 'train',
      projectId: 'p 1',
      captureIds: ['a&b', 'c'],
      scope: 'selected',
      projectFolder: null
    })
  })

  it('parses a train-all-untrained link', () => {
    expect(parseNamLabUrl('namlab://train?project=p1&path=%2FUsers%2Fme%2FAmp%20Project&scope=untrained')).toEqual({
      route: 'train',
      projectId: 'p1',
      captureIds: [],
      scope: 'untrained',
      projectFolder: '/Users/me/Amp Project'
    })
  })

  it('rejects a train link with no project, or with nothing to train', () => {
    expect(parseNamLabUrl('namlab://train?capture=a')).toBeNull()
    expect(parseNamLabUrl('namlab://train?project=p1')).toBeNull()
  })
})

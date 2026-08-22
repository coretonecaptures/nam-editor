/**
 * patchMetadataFields is the one write path CLAUDE.md calls out as the app's single critical
 * invariant: never JSON.parse -> JSON.stringify a .nam file, because that reformats/reorders the
 * whole file and can corrupt model weights or field order other tools depend on. These tests
 * exist to catch exactly that class of regression — a "correct" patch that quietly rewrites bytes
 * it was never supposed to touch.
 */
import { describe, it, expect } from 'vitest'
import { findOuterMetadataMatch, findMatchingBrace, serializeJsonValue, escapeRe, patchMetadataFields } from './metadataPatcher'

// A realistic-shaped .nam file: oddly-indented on purpose (not what a "clean" formatter would
// produce), with a large fake weights array standing in for the multi-megabyte float payload a
// real capture has. If patchMetadataFields ever falls back to JSON.parse/stringify internally,
// this weights array is exactly what would get reformatted/reordered first.
function fixture(): string {
  return [
    '{',
    '  "version": "0.5.0",',
    '  "architecture": "WaveNet",',
    '  "config": { "layers": [1, 2, 3] },',
    '  "weights": [0.1, -0.2, 0.30000001, 1e-8, 42],',
    '  "metadata": {',
    '    "name": "My Capture",',
    '    "modeled_by": "Alice",',
    '    "gain": 0.5,',
    '    "date": null',
    '  }',
    '}'
  ].join('\n')
}

describe('patchMetadataFields', () => {
  it('replaces an existing string field and changes nothing else, byte-for-byte', () => {
    const before = fixture()
    const after = patchMetadataFields(before, { name: 'New Name' })
    expect(after).toContain('"name": "New Name"')
    // Nothing outside the single changed value differs, including the oddly-placed
    // config/weights formatting a naive JSON.stringify would normalize away.
    const untouchedRegion = after.slice(0, after.indexOf('"metadata"'))
    expect(untouchedRegion).toBe(before.slice(0, before.indexOf('"metadata"')))
    expect(after).toContain('"weights": [0.1, -0.2, 0.30000001, 1e-8, 42]')
  })

  it('replaces a numeric field without quoting it', () => {
    const after = patchMetadataFields(fixture(), { gain: 0.75 })
    expect(after).toContain('"gain": 0.75')
    expect(after).not.toContain('"gain": "0.75"')
  })

  it('replaces a field with null', () => {
    const after = patchMetadataFields(fixture(), { modeled_by: null })
    expect(after).toContain('"modeled_by": null')
  })

  it('replaces null with a real value', () => {
    const after = patchMetadataFields(fixture(), { date: '2026-08-22' })
    expect(after).toContain('"date": "2026-08-22"')
  })

  it('JSON-escapes quotes and backslashes in a new string value', () => {
    const after = patchMetadataFields(fixture(), { name: 'Say "hi" \\ bye' })
    expect(after).toContain('"name": "Say \\"hi\\" \\\\ bye"')
    // And the escaped result is itself valid JSON for that one field.
    expect(() => JSON.parse(`{${after.match(/"name":\s*"(?:[^"\\]|\\.)*"/)![0]}}`)).not.toThrow()
  })

  it('inserts a field that does not exist yet, matching the block\'s indentation', () => {
    const after = patchMetadataFields(fixture(), { gear_make: 'Fender' })
    expect(after).toMatch(/\n {4}"gear_make": "Fender"/)
    // The whole file must still be valid JSON after insertion.
    const parsed = JSON.parse(after)
    expect(parsed.metadata.gear_make).toBe('Fender')
  })

  it('adds a comma when inserting after a field with none, and does not double it when one exists', () => {
    // "date": null has no trailing comma (it's the last field) — insertion must add one.
    const after = patchMetadataFields(fixture(), { extra: 1 })
    expect(after).toContain('"date": null,\n    "extra": 1')
    expect(after).not.toContain('"date": null,,')
  })

  it('applies multiple patches together, each independently correct', () => {
    const after = patchMetadataFields(fixture(), {
      name: 'Multi',
      gain: 1.25,
      modeled_by: null,
      new_field: 'inserted'
    })
    expect(after).toContain('"name": "Multi"')
    expect(after).toContain('"gain": 1.25')
    expect(after).toContain('"modeled_by": null')
    expect(after).toContain('"new_field": "inserted"')
  })

  it('leaves everything before and after the metadata block completely untouched', () => {
    const before = fixture()
    const after = patchMetadataFields(before, { name: 'Changed' })
    const beforeHead = before.slice(0, before.indexOf('"metadata"'))
    const afterHead = after.slice(0, after.indexOf('"metadata"'))
    const beforeTail = before.slice(before.lastIndexOf('}'))
    const afterTail = after.slice(after.lastIndexOf('}'))
    expect(afterHead).toBe(beforeHead)
    expect(afterTail).toBe(beforeTail)
  })

  it('does not touch a same-named key that lives outside the metadata block', () => {
    const content = [
      '{',
      '  "config": { "name": "layer-config-name" },',
      '  "metadata": { "name": "Capture Name" }',
      '}'
    ].join('\n')
    const after = patchMetadataFields(content, { name: 'Renamed' })
    expect(after).toContain('"config": { "name": "layer-config-name" }')
    expect(after).toContain('"metadata": { "name": "Renamed" }')
  })

  it('is not fooled by a string value that itself contains metadata-shaped text', () => {
    const content = [
      '{',
      '  "config": { "note": "see \\"metadata\\": { for details" },',
      '  "metadata": { "name": "Real Capture" }',
      '}'
    ].join('\n')
    const after = patchMetadataFields(content, { name: 'Patched' })
    expect(after).toContain('"metadata": { "name": "Patched" }')
    expect(after).toContain('"note": "see \\"metadata\\": { for details"')
  })

  it('targets the top-level metadata block, not a same-named block nested in config (A2 submodels)', () => {
    const content = [
      '{',
      '  "config": {',
      '    "submodels": [',
      '      { "metadata": { "name": "submodel-A" } },',
      '      { "metadata": { "name": "submodel-B" } }',
      '    ]',
      '  },',
      '  "metadata": { "name": "Top Level" }',
      '}'
    ].join('\n')
    const after = patchMetadataFields(content, { name: 'Patched Top' })
    expect(after).toContain('"metadata": { "name": "Patched Top" }')
    // Submodel metadata is untouched — the whole point of findOuterMetadataMatch.
    expect(after).toContain('"metadata": { "name": "submodel-A" }')
    expect(after).toContain('"metadata": { "name": "submodel-B" }')
  })

  it('throws rather than silently no-op when there is no metadata block', () => {
    expect(() => patchMetadataFields('{ "version": "1.0" }', { name: 'x' })).toThrow(/no "metadata" block/i)
  })

  it('throws on an unbalanced metadata block instead of silently corrupting the file', () => {
    const content = '{ "metadata": { "name": "unterminated"'
    expect(() => patchMetadataFields(content, { name: 'x' })).toThrow(/malformed/i)
  })
})

describe('findOuterMetadataMatch', () => {
  it('returns null when absent', () => {
    expect(findOuterMetadataMatch('{ "version": "1.0" }')).toBeNull()
  })

  it('finds the root-level key even when nested submodel metadata comes first in the text', () => {
    const content = '{ "config": { "submodels": [{ "metadata": {} }] }, "metadata": { "name": "root" } }'
    const match = findOuterMetadataMatch(content)
    expect(match).not.toBeNull()
    // The match found should be the one that starts right before "name": "root", not the earlier
    // nested occurrence.
    expect(content.slice(match!.index)).toMatch(/^"metadata":\s*\{\s*"name":\s*"root"/)
  })
})

describe('findMatchingBrace', () => {
  it('skips braces that appear inside string values', () => {
    const content = '{ "a": "} not a real close {", "b": 1 }'
    const close = findMatchingBrace(content, 0)
    expect(content[close]).toBe('}')
    expect(close).toBe(content.length - 1)
  })

  it('skips escaped quotes inside strings without losing track of depth', () => {
    const content = '{ "a": "she said \\"hi\\"" }'
    const close = findMatchingBrace(content, 0)
    expect(close).toBe(content.length - 1)
  })

  it('returns -1 for an unterminated block', () => {
    expect(findMatchingBrace('{ "a": 1', 0)).toBe(-1)
  })
})

describe('serializeJsonValue', () => {
  it('serializes null and undefined as the JSON literal null', () => {
    expect(serializeJsonValue(null)).toBe('null')
    expect(serializeJsonValue(undefined)).toBe('null')
  })

  it('serializes numbers as bare, unquoted text', () => {
    expect(serializeJsonValue(42)).toBe('42')
    expect(serializeJsonValue(-3.5)).toBe('-3.5')
  })

  it('serializes strings as properly quoted/escaped JSON strings', () => {
    expect(serializeJsonValue('hello')).toBe('"hello"')
    expect(serializeJsonValue('say "hi"')).toBe('"say \\"hi\\""')
  })

  it('coerces non-string, non-number values (e.g. a boolean) to a quoted string rather than crashing', () => {
    // patchMetadataFields' EDITABLE_FIELDS are never booleans in practice, but this function has
    // no way to know that — it should degrade safely rather than emit invalid JSON.
    expect(serializeJsonValue(true)).toBe('"true"')
  })
})

describe('escapeRe', () => {
  it('escapes regex metacharacters so a literal key cannot be misread as a pattern', () => {
    expect(escapeRe('a.b[0]')).toBe('a\\.b\\[0\\]')
    expect(new RegExp(escapeRe('a.b[0]')).test('a.b[0]')).toBe(true)
    expect(new RegExp(escapeRe('a.b[0]')).test('axb0')).toBe(false)
  })
})

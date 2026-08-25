import { describe, it, expect } from 'vitest'
import { ownhammerParser } from './ownhammer'
import { redwirezParser } from './redwirez'
import { genericVocabularyParser } from './genericVocabulary'

describe('ownhammerParser', () => {
  const siblings = [
    'OH 1012 GIBS V10 121-00.wav',
    'OH 1012 GIBS V10 121-EDGE.wav',
    'OH 1012 GIBS V10 160-00.wav'
  ]

  it('recognizes a folder containing OH-prefixed files', () => {
    expect(ownhammerParser.recognizes('1012 GIBS/Atomic/1012 GIBS/V10/Mics', siblings)).toBe(true)
  })

  it('does not recognize an unrelated folder', () => {
    expect(ownhammerParser.recognizes('RedWirez/SVT810/AKG D112', ['SVT810-D112-Cap-0in.wav'])).toBe(false)
  })

  it('parses cabinet/speaker/microphone/position from a real-shaped filename', () => {
    const fields = ownhammerParser.parse(
      '1012 GIBS/Atomic/1012 GIBS/V10/Mics/OH 1012 GIBS V10 121-00.wav',
      '1012 GIBS/Atomic/1012 GIBS/V10/Mics'
    )
    expect(fields).toEqual({ cabinet: '1012 GIBS', speaker: 'V10', microphone: '121', position: '00' })
  })

  it('parses a word position (EDGE) the same way as a numeric one', () => {
    const fields = ownhammerParser.parse(
      '1012 GIBS/Atomic/1012 GIBS/V10/Mics/OH 1012 GIBS V10 121-EDGE.wav',
      '1012 GIBS/Atomic/1012 GIBS/V10/Mics'
    )
    expect(fields.position).toBe('EDGE')
    expect(fields.microphone).toBe('121')
  })

  it('does not guess a speaker for a blend filename (V10+V30)', () => {
    const fields = ownhammerParser.parse('OH 1012 GIBS V10+V30.wav', '1012 GIBS/Summary')
    expect(fields.speaker).toBeUndefined()
  })
})

describe('redwirezParser', () => {
  const folder = 'Bass Cabinets/Ampeg SVT 810  SVT 10s  Cabinet IR Library/BIGBox/44.1 KHz-16bit/SVT810/AKG D112'
  const siblings = ['SVT810-D112-Cap-0in.wav', 'SVT810-D112-CapEdge-0in.wav']

  it('recognizes a sample-rate-labeled folder with cab-mic-position filenames', () => {
    expect(redwirezParser.recognizes(folder, siblings)).toBe(true)
  })

  it('does not recognize the same filenames without a sample-rate folder', () => {
    expect(redwirezParser.recognizes('SVT810/AKG D112', siblings)).toBe(false)
  })

  it('parses cabinet/microphone/position and infers manufacturer from an ancestor folder', () => {
    const fields = redwirezParser.parse(`${folder}/SVT810-D112-Cap-0in.wav`, folder)
    expect(fields.cabinet).toBe('SVT810')
    expect(fields.microphone).toBe('D112')
    expect(fields.position).toBe('Cap-0in')
    expect(fields.manufacturer).toBe('Ampeg')
  })
})

describe('genericVocabularyParser', () => {
  it('always recognizes (no folder-shape precondition)', () => {
    expect(genericVocabularyParser.recognizes('anything', [])).toBe(true)
  })

  it('matches a mic model, speaker, and manufacturer as whole tokens', () => {
    const fields = genericVocabularyParser.parse('Marshall Handwired Greenback G12 SM57.wav', 'Custom/Marshall')
    expect(fields.microphone).toBe('SM57')
    expect(fields.speaker).toBe('Greenback')
    expect(fields.manufacturer).toBe('Marshall')
  })

  it('does not match a substring inside an unrelated word', () => {
    // "SM57" must not match inside "SM5700" or similar — word-boundary guarded.
    const fields = genericVocabularyParser.parse('SM5700-fake-file.wav', 'x')
    expect(fields.microphone).toBeUndefined()
  })

  it('does not match a term flanked by "+" — a blend token, not a standalone word', () => {
    // Regression: found live against a real Ownhammer blend file (V30+V10) — "V30" was matching
    // as if standalone, reintroducing a guess ownhammer.ts deliberately avoids for blends.
    const fields = genericVocabularyParser.parse('OH 1012 GIBS V30+V10 121-00.wav', 'x')
    expect(fields.speaker).toBeUndefined()
  })

  it('matches speaker variants with and without the internal hyphen', () => {
    expect(genericVocabularyParser.parse('Celestion G12T-75 Blend.wav', 'x').speaker).toBe('G12T-75')
    expect(genericVocabularyParser.parse('Celestion G12T75 Blend.wav', 'x').speaker).toBe('G12T75')
  })
})

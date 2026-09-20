import { describe, it, expect } from 'vitest'
import { ownhammerParser } from './ownhammer'
import { redwirezParser } from './redwirez'
import { yorkParser } from './york'
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

describe('yorkParser', () => {
  // Real filenames from F:\Impulse Responses\York Audio\York Audio - 5153 412 VH20\...
  const siblings = [
    'YA 5153 412 VH20 121-1.wav',
    'YA 5153 412 VH20 421m-OA 2.wav',
    'YA 5153 412 VH20 57m-1 .wav',
    'YA 5153 412 VH20 Mix 01.wav'
  ]

  it('recognizes a folder containing YA-prefixed files', () => {
    expect(yorkParser.recognizes('York Audio - 5153 412 VH20/44.1k/Mics', siblings)).toBe(true)
  })

  it('does not recognize an unrelated folder', () => {
    expect(yorkParser.recognizes('RedWirez/SVT810/AKG D112', ['SVT810-D112-Cap-0in.wav'])).toBe(false)
  })

  it('translates a well-known bare mic code and stores position raw', () => {
    const fields = yorkParser.parse('York Audio - 5153 412 VH20/44.1k/YA 5153 412 VH20 121-1.wav', '')
    expect(fields).toEqual({ cabinet: '5153 412 VH20', microphone: 'Royer R-121', position: '1' })
  })

  it('strips an unconfirmed variant letter off the mic code before lookup, appends a trailing take number to position', () => {
    const fields = yorkParser.parse('YA 5153 412 VH20 421m-OA 2.wav', '')
    expect(fields.microphone).toBe('Sennheiser MD421')
    expect(fields.position).toBe('OA 2')
  })

  it('handles a real stray-trailing-space filename without corrupting the result', () => {
    const fields = yorkParser.parse('YA 5153 412 VH20 57m-1 .wav', '')
    expect(fields.microphone).toBe('Shure SM57')
    expect(fields.position).toBe('1')
    expect(fields.cabinet).toBe('5153 412 VH20')
  })

  it('does not guess a microphone for a Mix/blend filename', () => {
    const fields = yorkParser.parse('YA 5153 412 VH20 Mix 01.wav', '')
    expect(fields.microphone).toBeUndefined()
    expect(fields.cabinet).toBe('5153 412 VH20')
  })

  // Real files pulled from a random sample across the whole library, not just one pack folder —
  // these caught the letter-prefixed mic codes (U47, SM7) the first pass of this regex missed
  // entirely (it only matched a leading digit).
  it('translates letter-prefixed mic codes (U47, SM7) the same as bare-numeric ones', () => {
    expect(yorkParser.parse('YA BMAN 410 P10Q U47-3.wav', '').microphone).toBe('Neumann U47')
    expect(yorkParser.parse('YA VH+ 412 P50E SM7-CNT.wav', '').microphone).toBe('Shure SM7')
  })

  it('appends a trailing take/variant token onto position for real multi-token tails', () => {
    const fields = yorkParser.parse('YA BMAN 410 P10Q SM7-CE 2.wav', '')
    expect(fields.microphone).toBe('Shure SM7')
    expect(fields.position).toBe('CE 2')
  })

  it('folds an unrecognized mic-shaped token with no hyphen into the raw cabinet string rather than guessing', () => {
    // Real file: "YA ZILA 212 H75 421-5.wav" — H75 looks mic-related (it even lives in an "H75
    // Singles" folder) but never gets a hyphenated position of its own here, so there's nothing to
    // safely parse it as. Falls into the opaque cabinet string instead of being dropped or guessed.
    const fields = yorkParser.parse('YA ZILA 212 H75 421-5.wav', '')
    expect(fields.cabinet).toBe('ZILA 212 H75')
    expect(fields.microphone).toBe('Sennheiser MD421')
    expect(fields.position).toBe('5')
  })

  it('leaves an unlisted numeric mic code as the raw code rather than guessing', () => {
    const fields = yorkParser.parse('YA MES 212 V30 999-CNT.wav', '')
    expect(fields.microphone).toBe('999')
  })

  it('splits off a Celestion-Vintage-style speaker code (V30) but not a lookalike (VH20)', () => {
    expect(yorkParser.parse('YA MES 212 V30 57-1.wav', '')).toEqual({
      cabinet: 'MES 212',
      speaker: 'V30',
      microphone: 'Shure SM57',
      position: '1'
    })
    expect(yorkParser.parse('YA 5153 412 VH20 57-1.wav', '').speaker).toBeUndefined()
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

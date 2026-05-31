import { describe, it, expect } from 'vitest'
import { parseGoogleTranslate } from './translate'

describe('parseGoogleTranslate', () => {
  it('joins multi-segment translations and reads the source lang', () => {
    const body = [
      [
        ['Hello ', 'مرحبا ', null, null, 10],
        ['world', 'بالعالم', null, null, 3]
      ],
      null,
      'ar'
    ]
    expect(parseGoogleTranslate(body)).toEqual({ text: 'Hello world', sourceLang: 'ar' })
  })

  it('handles a single segment', () => {
    const body = [[['Bonjour', 'Hello', null, null, 1]], null, 'en']
    expect(parseGoogleTranslate(body)).toEqual({ text: 'Bonjour', sourceLang: 'en' })
  })

  it('returns empty text for a malformed body', () => {
    expect(parseGoogleTranslate(null)).toEqual({ text: '' })
    expect(parseGoogleTranslate({})).toEqual({ text: '' })
    expect(parseGoogleTranslate([null, null])).toEqual({ text: '' })
  })

  it('omits sourceLang when absent', () => {
    const body = [[['hi', 'hi', null, null, 0]]]
    expect(parseGoogleTranslate(body)).toEqual({ text: 'hi', sourceLang: undefined })
  })
})

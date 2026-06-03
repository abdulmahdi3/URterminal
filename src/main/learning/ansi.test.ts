import { describe, it, expect } from 'vitest'
import { stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
  })

  it('removes OSC title/hyperlink sequences (BEL- and ST-terminated)', () => {
    expect(stripAnsi('\x1b]0;window title\x07hi')).toBe('hi')
    expect(stripAnsi('\x1b]8;;http://example\x1b\\link\x1b]8;;\x1b\\')).toBe('link')
  })

  it('collapses carriage-return overwrites to the final frame', () => {
    expect(stripAnsi('10%\r50%\r100% done')).toBe('100% done')
  })

  it('keeps tabs and newlines, drops other C0 controls and DEL', () => {
    expect(stripAnsi('a\tb\nc\x00\x7f')).toBe('a\tb\nc')
  })

  it('strips a lone two-char escape', () => {
    expect(stripAnsi('a\x1bMb')).toBe('ab')
  })

  it('passes plain text through unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })
})

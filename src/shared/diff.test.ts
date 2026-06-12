import { describe, it, expect } from 'vitest'
import { parsePatches, applyPatch, newFileContent } from './diff'

describe('parsePatches', () => {
  it('parses a single unified diff with one hunk', () => {
    const text = [
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,3 @@',
      ' line one',
      '-line two',
      '+line TWO',
      ' line three'
    ].join('\n')
    const patches = parsePatches(text)
    expect(patches).toHaveLength(1)
    const p = patches[0]
    expect(p.file).toBe('src/foo.ts')
    expect(p.oldFile).toBe('src/foo.ts')
    expect(p.isNew).toBe(false)
    expect(p.isDelete).toBe(false)
    expect(p.additions).toBe(1)
    expect(p.deletions).toBe(1)
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 })
  })

  it('ignores surrounding prose and ``` fences', () => {
    const text = [
      'Here is the change I made:',
      '```diff',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '```',
      'Let me know if that works.'
    ].join('\n')
    const patches = parsePatches(text)
    expect(patches).toHaveLength(1)
    expect(patches[0].file).toBe('x.txt')
    // no comma in the header → single line counts
    expect(patches[0].hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 })
  })

  it('parses multiple files via diff --git headers', () => {
    const text = [
      'diff --git a/one.ts b/one.ts',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/two.ts b/two.ts',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -1 +1 @@',
      '-c',
      '+d'
    ].join('\n')
    const patches = parsePatches(text)
    expect(patches.map((p) => p.file)).toEqual(['one.ts', 'two.ts'])
  })

  it('flags new files (--- /dev/null) and deletions (+++ /dev/null)', () => {
    const created = parsePatches(
      ['--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,2 @@', '+hello', '+world'].join('\n')
    )[0]
    expect(created.isNew).toBe(true)
    expect(created.file).toBe('new.ts')

    const removed = parsePatches(
      ['--- a/gone.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-hello', '-world'].join('\n')
    )[0]
    expect(removed.isDelete).toBe(true)
    expect(removed.file).toBe('gone.ts') // target keeps the existing path
  })

  it('handles blank context lines inside a hunk', () => {
    const text = ['--- a/f', '+++ b/f', '@@ -1,3 +1,3 @@', ' a', '', '-b', '+B'].join('\n')
    const p = parsePatches(text)[0]
    // 2 context (a + blank) + 1 deletion = 3 old; 2 context + 1 add = 3 new
    expect(p.hunks[0].lines).toEqual([' a', ' ', '-b', '+B'])
  })

  it('returns [] when there is no diff', () => {
    expect(parsePatches('just some normal output\nnothing to see')).toEqual([])
  })
})

describe('applyPatch', () => {
  const original = 'line one\nline two\nline three\n'

  it('applies a simple replacement', () => {
    const hunks = parsePatches(
      ['--- a/f', '+++ b/f', '@@ -1,3 +1,3 @@', ' line one', '-line two', '+line TWO', ' line three'].join(
        '\n'
      )
    )[0].hunks
    const r = applyPatch(original, hunks)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('line one\nline TWO\nline three\n')
  })

  it('tolerates line-number drift (context moved)', () => {
    const shifted = 'PREPENDED\nADDED\n' + original
    const hunks = parsePatches(
      ['--- a/f', '+++ b/f', '@@ -1,3 +1,3 @@', ' line one', '-line two', '+line TWO', ' line three'].join(
        '\n'
      )
    )[0].hunks
    const r = applyPatch(shifted, hunks)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('PREPENDED\nADDED\nline one\nline TWO\nline three\n')
  })

  it('fails (does not corrupt) when context is missing', () => {
    const hunks = parsePatches(
      ['--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', ' nonexistent', '-gone', '+new'].join('\n')
    )[0].hunks
    const r = applyPatch(original, hunks)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/locate context/i)
  })

  it('preserves a missing trailing newline', () => {
    const noNl = 'a\nb'
    const hunks = parsePatches(['--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', ' a', '-b', '+B'].join('\n'))[0]
      .hunks
    const r = applyPatch(noNl, hunks)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('a\nB')
  })

  it('applies multiple hunks with cumulative offset', () => {
    const src = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n'
    const diff = [
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,3 @@',
      ' l1',
      '+inserted',
      ' l2',
      '@@ -9,2 +10,2 @@',
      ' l9',
      '-l10',
      '+L10'
    ].join('\n')
    const r = applyPatch(src, parsePatches(diff)[0].hunks)
    expect(r.ok).toBe(true)
    expect(r.result).toContain('l1\ninserted\nl2')
    expect(r.result).toContain('l9\nL10')
    expect(r.result).not.toContain('l10\n')
  })
})

describe('newFileContent', () => {
  it('reconstructs a created file from its additions', () => {
    const p = parsePatches(['--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,2 @@', '+hello', '+world'].join('\n'))[0]
    expect(newFileContent(p)).toBe('hello\nworld\n')
  })
})

import { describe, it, expect } from 'vitest'
import { builtinShells } from './shells'

describe('builtinShells', () => {
  it('offers PowerShell + cmd on Windows', () => {
    const ids = builtinShells('win32').map((s) => s.id)
    expect(ids).toContain('powershell')
    expect(ids).toContain('powershell-admin')
    expect(ids).toContain('cmd')
    // no POSIX-only shells leak into the Windows list
    expect(ids).not.toContain('zsh')
  })

  it('offers zsh-first POSIX shells on macOS', () => {
    const specs = builtinShells('darwin')
    const ids = specs.map((s) => s.id)
    expect(ids).toEqual(['default', 'zsh', 'bash', 'sh'])
    // the default entry spawns the user's $SHELL (blank file)
    expect(specs.find((s) => s.id === 'default')?.file).toBe('')
    // never PowerShell on a Mac
    expect(ids).not.toContain('powershell')
  })

  it('offers bash-first POSIX shells on Linux', () => {
    const ids = builtinShells('linux').map((s) => s.id)
    expect(ids).toEqual(['default', 'bash', 'zsh', 'sh'])
  })

  it('treats unknown platforms as POSIX (linux defaults)', () => {
    const ids = builtinShells('freebsd' as NodeJS.Platform).map((s) => s.id)
    expect(ids).toContain('bash')
    expect(ids).not.toContain('powershell')
  })
})

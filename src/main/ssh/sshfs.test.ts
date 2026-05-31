import { describe, it, expect } from 'vitest'
import {
  pickFreeDrive,
  buildSshfsArgs,
  sshfsInstalled,
  SSHFS_BIN,
  SSHFS_INSTALL
} from './sshfs'

describe('pickFreeDrive', () => {
  it('returns Z when everything is free (scans high→low)', () => {
    expect(pickFreeDrive(() => false)).toBe('Z')
  })
  it('skips used letters', () => {
    const used = new Set(['Z', 'Y'])
    expect(pickFreeDrive((l) => used.has(l))).toBe('X')
  })
  it('returns null when H..Z are all used', () => {
    expect(pickFreeDrive(() => true)).toBeNull()
  })
  it('falls back to H (its lowest letter) and never below it', () => {
    // everything except H is taken → H is chosen
    expect(pickFreeDrive((l) => l !== 'H')).toBe('H')
    // only G is free (below the H..Z window) → nothing usable
    expect(pickFreeDrive((l) => l !== 'G')).toBeNull()
  })
})

describe('buildSshfsArgs', () => {
  it('mounts the remote home (empty path) to a drive, password via stdin not args', () => {
    const args = buildSshfsArgs({ username: 'me', host: 'host', port: 22, drive: 'Z' })
    expect(args[0]).toBe('-f')
    expect(args).toContain('me@host:') // empty path = remote home
    expect(args).toContain('Z:')
    expect(args).toContain('password_stdin')
    expect(args).toContain('StrictHostKeyChecking=no')
    expect(args).toContain('idmap=user')
    // password must never appear as an argument
    expect(args.join(' ')).not.toMatch(/secret|password=/i)
    // default port 22 → no Port option
    expect(args.join(' ')).not.toContain('Port=')
  })

  it('adds a Port option for a non-default port', () => {
    const args = buildSshfsArgs({ username: 'me', host: 'host', port: 2222, drive: 'Y' })
    const i = args.indexOf('Port=2222')
    expect(i).toBeGreaterThan(0)
    expect(args[i - 1]).toBe('-o')
  })

  it('uses an absolute remote path verbatim', () => {
    const args = buildSshfsArgs({ username: 'me', host: 'h', port: 22, drive: 'Z', remotePath: '/var/www' })
    expect(args).toContain('me@h:/var/www')
  })
})

describe('sshfsInstalled', () => {
  it('is true only when sshfs.exe exists', () => {
    expect(sshfsInstalled((p) => p === SSHFS_BIN)).toBe(true)
    expect(sshfsInstalled(() => false)).toBe(false)
  })
})

describe('SSHFS_INSTALL', () => {
  it('installs WinFsp before SSHFS-Win', () => {
    const c = SSHFS_INSTALL.installCommand
    expect(c.indexOf('WinFsp.WinFsp')).toBeGreaterThanOrEqual(0)
    expect(c.indexOf('WinFsp.WinFsp')).toBeLessThan(c.indexOf('SSHFS-Win.SSHFS-Win'))
    expect(SSHFS_INSTALL.url).toContain('sshfs-win')
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureClaudeConfigHealthy,
  isClaudeCommand,
  prepareClaudeSpawn,
  __resetClaudeChain,
  type ClaudePaths
} from './configGuard'

let root: string
let paths: ClaudePaths

const VALID = JSON.stringify({ oauthAccount: { email: 'a@b.c' }, numStartups: 3 })
const NEWER = JSON.stringify({ oauthAccount: { email: 'a@b.c' }, numStartups: 4 })

function backup(ts: number, content: string): void {
  writeFileSync(join(paths.backupsDir, `.claude.json.backup.${ts}`), content, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'urt-cfgguard-'))
  paths = { config: join(root, '.claude.json'), backupsDir: join(root, 'backups') }
  mkdirSync(paths.backupsDir, { recursive: true })
  __resetClaudeChain()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ensureClaudeConfigHealthy', () => {
  it('leaves a valid config untouched', () => {
    writeFileSync(paths.config, VALID, 'utf8')
    expect(ensureClaudeConfigHealthy(paths)).toEqual({ status: 'ok' })
    expect(readFileSync(paths.config, 'utf8')).toBe(VALID)
  })

  it('does nothing when the config is absent (first run)', () => {
    expect(ensureClaudeConfigHealthy(paths)).toEqual({ status: 'absent' })
    expect(existsSync(paths.config)).toBe(false)
  })

  it('restores the newest valid backup when the live file is corrupt', () => {
    writeFileSync(paths.config, '{ "oauthAccount": ', 'utf8') // truncated, like a torn write
    backup(1000, VALID)
    backup(2000, NEWER)
    const res = ensureClaudeConfigHealthy(paths)
    expect(res.status).toBe('repaired')
    expect(readFileSync(paths.config, 'utf8')).toBe(NEWER) // newest wins
  })

  it('treats an empty/whitespace file as corrupt', () => {
    writeFileSync(paths.config, '   \n', 'utf8')
    backup(1000, VALID)
    expect(ensureClaudeConfigHealthy(paths).status).toBe('repaired')
    expect(readFileSync(paths.config, 'utf8')).toBe(VALID)
  })

  it('skips a truncated newer backup and uses the newest VALID one', () => {
    writeFileSync(paths.config, 'not json', 'utf8')
    backup(1000, VALID)
    backup(3000, '{ "trunc') // 82-byte-style torn backup, newer but invalid
    const res = ensureClaudeConfigHealthy(paths)
    expect(res.status).toBe('repaired')
    expect(readFileSync(paths.config, 'utf8')).toBe(VALID)
  })

  it('preserves the corrupt file alongside for inspection', () => {
    writeFileSync(paths.config, 'broken', 'utf8')
    backup(1000, VALID)
    ensureClaudeConfigHealthy(paths)
    expect(readFileSync(`${paths.config}.urterminal-corrupt`, 'utf8')).toBe('broken')
  })

  it('reports corrupt-no-backup and leaves the file when no valid backup exists', () => {
    writeFileSync(paths.config, 'broken', 'utf8')
    backup(1000, '{ also broken') // only invalid backups
    expect(ensureClaudeConfigHealthy(paths)).toEqual({ status: 'corrupt-no-backup' })
    expect(readFileSync(paths.config, 'utf8')).toBe('broken') // untouched, never made worse
  })
})

describe('isClaudeCommand', () => {
  it('matches claude in its common forms', () => {
    for (const c of ['claude', 'Claude', 'claude.cmd', 'claude.exe', 'C:\\bin\\claude.exe', '/usr/bin/claude'])
      expect(isClaudeCommand(c)).toBe(true)
  })
  it('does not match other agents or shells', () => {
    for (const c of [undefined, '', 'codex', 'gemini', 'powershell.exe', 'claude-code-helper'])
      expect(isClaudeCommand(c)).toBe(false)
  })
})

describe('prepareClaudeSpawn', () => {
  it('resolves immediately and heals before a claude pane starts', async () => {
    process.env.CLAUDE_CONFIG_DIR = root // so the gate's internal heal targets our temp dir
    try {
      writeFileSync(paths.config, 'corrupt', 'utf8')
      backup(1000, VALID)
      await prepareClaudeSpawn('claude', 0)
      expect(readFileSync(paths.config, 'utf8')).toBe(VALID)
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR
    }
  })

  it('is a no-op for non-claude commands', async () => {
    writeFileSync(paths.config, 'corrupt', 'utf8')
    await prepareClaudeSpawn('powershell.exe', 0)
    expect(readFileSync(paths.config, 'utf8')).toBe('corrupt') // untouched
  })
})

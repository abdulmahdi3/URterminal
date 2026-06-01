import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// Mock Electron so the store writes under a throwaway temp dir instead of the
// real userData path. The factory is hoisted above the imports by vitest.
vi.mock('electron', () => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join: j } = require('path')
  const dir = mkdtempSync(j(tmpdir(), 'urt-learn-test-'))
  return { app: { getPath: (): string => dir } }
})

import {
  getLearningConfig,
  setLearningConfig,
  appendTurn,
  learningRoot,
  type TurnRecord
} from './store'

describe('learning store config', () => {
  it('defaults to disabled (opt-in)', () => {
    expect(getLearningConfig().enabled).toBe(false)
    expect(getLearningConfig().capture).toBe(true)
    expect(getLearningConfig().provider).toBe('claude-cli')
  })

  it('merges + persists a patch and reflects it on next read', () => {
    const next = setLearningConfig({ enabled: true, turnIdleMs: 2222 })
    expect(next.enabled).toBe(true)
    expect(next.turnIdleMs).toBe(2222)
    expect(getLearningConfig().enabled).toBe(true)
    const onDisk = JSON.parse(readFileSync(join(learningRoot(), 'config.json'), 'utf8'))
    expect(onDisk.turnIdleMs).toBe(2222)
  })
})

describe('appendTurn', () => {
  it('writes one JSONL line under projects/<hash>/transcripts', () => {
    const rec: TurnRecord = {
      v: 1,
      turnId: 'turn-xyz',
      ts: Date.now(),
      paneId: 'p',
      sessionId: 's',
      agentId: 'claude',
      cwd: '/proj',
      projectHash: 'deadbeef0001',
      turnIndex: 0,
      user: { text: 'hi', ts: Date.now() },
      agent: { text: 'hello', durationMs: 5, exitMarker: 'idle' },
      channel: 'ansi-scrape',
      scrubbed: true,
      truncated: false
    }
    appendTurn(rec)
    const dir = join(learningRoot(), 'projects', 'deadbeef0001', 'transcripts')
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    expect(files).toHaveLength(1)
    const parsed = JSON.parse(readFileSync(join(dir, files[0]), 'utf8').trim())
    expect(parsed.turnId).toBe('turn-xyz')
    expect(parsed.channel).toBe('ansi-scrape')
  })
})

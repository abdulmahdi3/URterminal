import { describe, it, expect } from 'vitest'
import { AGENT_REGISTRY, agentLaunch } from './providers'

describe('agent registry', () => {
  it('declares stream-json support for Claude Code', () => {
    const claude = AGENT_REGISTRY.find((a) => a.id === 'claude')
    expect(claude?.supports?.streamJson).toBe(true)
  })
})

describe('agentLaunch', () => {
  it('spawns the bare id when no host binary is set', () => {
    expect(agentLaunch({ id: 'codex', label: 'Codex' }, 'codex')).toEqual({
      command: 'codex',
      args: []
    })
  })

  it('maps a host-extension agent to bin + launch args', () => {
    expect(
      agentLaunch({ id: 'gh-copilot', label: 'Copilot', bin: 'gh', launchArgs: ['copilot'] }, 'gh-copilot')
    ).toEqual({ command: 'gh', args: ['copilot'] })
  })

  it('falls back to the id when the descriptor is missing', () => {
    expect(agentLaunch(undefined, 'mystery')).toEqual({ command: 'mystery', args: [] })
  })
})

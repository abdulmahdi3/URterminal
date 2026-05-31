import { describe, it, expect } from 'vitest'
import { buildUrsshCmd, buildUrsshSh, buildAgentInstruction } from './ursshHelpers'

describe('buildUrsshCmd', () => {
  it('embeds the port, token and target and uses %~1 + --data-raw', () => {
    const s = buildUrsshCmd({ port: 51234, token: 'abc123', target: 'me@host' })
    expect(s).toContain('http://127.0.0.1:51234/exec')
    expect(s).toContain('x-urssh-token: abc123')
    expect(s).toContain('x-urssh-target: me@host')
    expect(s).toContain('--data-raw "%~1"')
    expect(s.startsWith('@echo off')).toBe(true)
  })
})

describe('buildUrsshSh', () => {
  it('uses $1 and the shebang', () => {
    const s = buildUrsshSh({ port: 5, token: 't', target: 'u@h' })
    expect(s.startsWith('#!/bin/sh')).toBe(true)
    expect(s).toContain('--data-raw "$1"')
    expect(s).toContain('http://127.0.0.1:5/exec')
  })
})

describe('buildAgentInstruction', () => {
  it('quotes the helper path and tells the agent how to run remote commands', () => {
    const ins = buildAgentInstruction('me@host', 'C:\\tmp\\urssh-x\\urssh.cmd')
    expect(ins).toContain('me@host')
    expect(ins).toContain('"C:\\tmp\\urssh-x\\urssh.cmd" "uname -a"')
    expect(ins).toContain('ONE double-quoted argument')
    expect(ins.toLowerCase()).toContain('nothing is installed on the server')
  })
})

import { describe, it, expect } from 'vitest'
import { parseStream, summarizeTool, isEditTool, editPreview, type ToolUseCard } from './streamJson'

// A representative transcript: init → assistant text + a Bash tool_use →
// tool_result → final result.
const TRANSCRIPT = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    model: 'claude-opus-4-8',
    tools: ['Bash', 'Edit', 'Read'],
    cwd: '/home/me/proj',
    session_id: 'sess-1'
  }),
  JSON.stringify({
    type: 'assistant',
    session_id: 'sess-1',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Running the tests.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }
      ]
    }
  }),
  JSON.stringify({
    type: 'user',
    session_id: 'sess-1',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'All tests passed', is_error: false }]
    }
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 4200,
    num_turns: 2,
    total_cost_usd: 0.012,
    usage: { input_tokens: 1500, output_tokens: 300 },
    result: 'Done — all tests pass.',
    session_id: 'sess-1'
  })
].join('\n')

describe('parseStream', () => {
  it('parses a full turn into ordered cards', () => {
    const { cards, sessionId, done } = parseStream(TRANSCRIPT)
    expect(sessionId).toBe('sess-1')
    expect(done).toBe(true)
    expect(cards.map((c) => c.kind)).toEqual(['init', 'text', 'tool_use', 'tool_result', 'result'])

    const init = cards[0]
    expect(init).toMatchObject({ kind: 'init', model: 'claude-opus-4-8', cwd: '/home/me/proj' })
    const tool = cards[2] as ToolUseCard
    expect(tool).toMatchObject({ kind: 'tool_use', name: 'Bash', id: 'toolu_1' })
    expect(tool.input).toEqual({ command: 'npm test' })
    expect(cards[3]).toMatchObject({ kind: 'tool_result', toolUseId: 'toolu_1', isError: false })
    expect(cards[4]).toMatchObject({
      kind: 'result',
      costUsd: 0.012,
      inputTokens: 1500,
      outputTokens: 300,
      text: 'Done — all tests pass.'
    })
  })

  it('is not done until a result event arrives', () => {
    const partial = TRANSCRIPT.split('\n').slice(0, 3).join('\n')
    expect(parseStream(partial).done).toBe(false)
  })

  it('skips non-JSON noise and a half-written trailing line', () => {
    const raw = 'starting…\n' + TRANSCRIPT + '\n{"type":"assist' // truncated last line
    const { cards, done } = parseStream(raw)
    expect(done).toBe(true)
    expect(cards[0].kind).toBe('init')
  })

  it('reads tool_result content given as an array of blocks', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: 'hello' }, { type: 'image' }],
            is_error: true
          }
        ]
      }
    })
    const card = parseStream(raw).cards[0]
    expect(card).toMatchObject({ kind: 'tool_result', text: 'hello\n[image]', isError: true })
  })

  it('captures assistant thinking blocks', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'hmm let me think' }] }
    })
    expect(parseStream(raw).cards[0]).toMatchObject({ kind: 'thinking', text: 'hmm let me think' })
  })

  it('returns no cards for empty input', () => {
    expect(parseStream('').cards).toEqual([])
  })
})

describe('summarizeTool', () => {
  it('pulls the salient field per tool', () => {
    expect(summarizeTool('Bash', { command: 'ls -la' }).detail).toBe('ls -la')
    expect(summarizeTool('Read', { file_path: '/a/b.ts' }).detail).toBe('/a/b.ts')
    expect(summarizeTool('Grep', { pattern: 'TODO' }).detail).toBe('TODO')
    expect(summarizeTool('Unknown', { x: 1 }).detail).toBeUndefined()
  })
})

describe('editPreview', () => {
  it('treats Write as all-added', () => {
    const p = editPreview('Write', { file_path: 'x.ts', content: 'new file' })
    expect(p.file).toBe('x.ts')
    expect(p.edits).toEqual([{ before: '', after: 'new file' }])
  })
  it('maps an Edit to one before/after pair', () => {
    const p = editPreview('Edit', { file_path: 'x.ts', old_string: 'a', new_string: 'b' })
    expect(p.edits).toEqual([{ before: 'a', after: 'b' }])
  })
  it('maps MultiEdit to many pairs', () => {
    const p = editPreview('MultiEdit', {
      file_path: 'x.ts',
      edits: [
        { old_string: 'a', new_string: 'A' },
        { old_string: 'b', new_string: 'B' }
      ]
    })
    expect(p.edits).toHaveLength(2)
    expect(p.edits[1]).toEqual({ before: 'b', after: 'B' })
  })
  it('isEditTool recognizes the file-mutating tools', () => {
    expect(isEditTool('Edit')).toBe(true)
    expect(isEditTool('Write')).toBe(true)
    expect(isEditTool('Bash')).toBe(false)
  })
})

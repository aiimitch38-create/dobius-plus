import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractTranscriptTextMessages, readAgentTranscriptTail } from './terminal-transcript-read'

describe('transcript extraction', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = null
    }
  })

  const claudeLines = [
    JSON.stringify({ type: 'summary', summary: 'ignored' }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-11-22T10:00:00.000Z',
      message: { role: 'user', content: 'Fix the read bug' }
    }),
    JSON.stringify({
      type: 'user',
      isMeta: true,
      message: { role: 'user', content: 'Caveat: harness text' }
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-22T10:00:01.000Z',
      message: {
        id: 'msg_1',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'secret plan' }]
      }
    }),
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Looking now.' }] }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_1',
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x' } }]
      }
    }),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'file body' }] }
    }),
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      message: { id: 'msg_side', role: 'assistant', content: [{ type: 'text', text: 'subagent' }] }
    }),
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] }
    }),
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'Tests pass.' }] }
    }),
    '{"type":"assistant","message":{"id":"msg_3"' // partial line being written
  ]

  it('returns ordered, role-labeled text only (no thinking, tools, meta or sidechain)', () => {
    const messages = extractTranscriptTextMessages('claude', claudeLines)
    expect(messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Fix the read bug' },
      { role: 'assistant', text: 'Looking now.' },
      { role: 'assistant', text: 'Fixed it.\n\nTests pass.' }
    ])
    expect(messages[0]?.timestamp).toBe(Date.parse('2026-11-22T10:00:00.000Z'))
  })

  it('decodes Codex response_item messages', () => {
    const messages = extractTranscriptTextMessages('codex', [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }
      }),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', text: 'hidden' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hello' }]
        }
      })
    ])
    expect(messages.map(({ role, text }) => [role, text])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello']
    ])
  })

  it('decodes Codex event_msg messages and shows a turn recorded both ways once', () => {
    const responseItem = (role: string, text: string): string =>
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role,
          content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
        }
      })
    const event = (type: string, message: string): string =>
      JSON.stringify({ type: 'event_msg', payload: { type, message } })
    const messages = extractTranscriptTextMessages('codex', [
      responseItem('user', 'run the tests'),
      event('user_message', 'run the tests'),
      event('token_count', 'ignored'),
      event('agent_message', 'Running them now.'),
      responseItem('assistant', 'Running them now.'),
      event('agent_message', 'Only in events.'),
      event('user_message', 'again'),
      event('user_message', 'again')
    ])
    expect(messages.map(({ role, text }) => [role, text])).toEqual([
      ['user', 'run the tests'],
      ['assistant', 'Running them now.'],
      ['assistant', 'Only in events.'],
      ['user', 'again'],
      ['user', 'again']
    ])
  })

  it('pairs each Codex copy once and never across a user turn', () => {
    const response = (role: string, text: string): string =>
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role,
          content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
        }
      })
    const event = (type: string, message: string): string =>
      JSON.stringify({ type: 'event_msg', payload: { type, message } })
    const messages = extractTranscriptTextMessages('codex', [
      response('assistant', 'Done.'),
      event('agent_message', 'Done.'),
      event('user_message', 'Do it again'),
      event('agent_message', 'Done.')
    ])
    expect(messages.map(({ role, text }) => [role, text])).toEqual([
      ['assistant', 'Done.'],
      ['user', 'Do it again'],
      ['assistant', 'Done.']
    ])
  })

  it('does not let one Codex original absorb two copies', () => {
    const messages = extractTranscriptTextMessages('codex', [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }]
        }
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'ok' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'ok' } })
    ])
    expect(messages.map(({ text }) => text)).toEqual(['ok', 'ok'])
  })

  it('refuses a transcript path outside the allowed roots', async () => {
    dir = await mkdtemp(join(tmpdir(), 'terminal-read-transcript-'))
    const path = join(dir, 'session.jsonl')
    await writeFile(path, `${claudeLines.join('\n')}\n`)
    const read = await readAgentTranscriptTail({
      agent: 'claude',
      path,
      sessionId: 's1',
      allowedRoots: [join(dir, 'projects')]
    })
    expect(read).toMatchObject({
      available: false,
      reason: 'transcript path is outside the agent session folders'
    })
  })

  it('reads the newest messages from a file with a limit', async () => {
    dir = await mkdtemp(join(tmpdir(), 'terminal-read-transcript-'))
    const path = join(dir, 'session.jsonl')
    await writeFile(path, `${claudeLines.join('\n')}\n`)
    const read = await readAgentTranscriptTail({
      agent: 'claude',
      path,
      sessionId: 's1',
      allowedRoots: [dir],
      limit: 2
    })
    expect(read).toMatchObject({
      available: true,
      source: 'transcript',
      agent: 'claude',
      sessionId: 's1',
      olderMessagesOmitted: true
    })
    if (!read.available) {
      throw new Error('expected available')
    }
    expect(read.messages.map((message) => message.text)).toEqual([
      'Looking now.',
      'Fixed it.\n\nTests pass.'
    ])
    expect(read.scannedBytes).toBe(read.fileBytes)
  })

  it('scans only the tail window and drops the cut-off first record', async () => {
    dir = await mkdtemp(join(tmpdir(), 'terminal-read-transcript-'))
    const path = join(dir, 'session.jsonl')
    const lines = Array.from({ length: 200 }, (_, index) =>
      JSON.stringify({
        type: 'assistant',
        message: { id: `m${index}`, content: [{ type: 'text', text: `reply ${index}` }] }
      })
    )
    await writeFile(path, `${lines.join('\n')}\n`)
    const read = await readAgentTranscriptTail({
      agent: 'claude',
      path,
      sessionId: null,
      allowedRoots: [dir],
      limit: 200,
      maxBytes: 2048
    })
    if (!read.available) {
      throw new Error('expected available')
    }
    expect(read.olderMessagesOmitted).toBe(true)
    expect(read.scannedBytes).toBe(2048)
    expect(read.messages.at(-1)?.text).toBe('reply 199')
    expect(read.messages.length).toBeGreaterThan(5)
    expect(read.messages.length).toBeLessThan(200)
    expect(read.messages.every((message) => /^reply \d+$/.test(message.text))).toBe(true)
  })

  it('clips long messages keeping both ends', async () => {
    dir = await mkdtemp(join(tmpdir(), 'terminal-read-transcript-'))
    const path = join(dir, 'session.jsonl')
    const text = `HEAD${'x'.repeat(10_000)}TAIL`
    await writeFile(
      path,
      `${JSON.stringify({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text }] } })}\n`
    )
    const read = await readAgentTranscriptTail({
      agent: 'claude',
      path,
      sessionId: null,
      allowedRoots: [dir]
    })
    if (!read.available) {
      throw new Error('expected available')
    }
    const [message] = read.messages
    expect(message?.clipped).toBe(true)
    expect(message?.chars).toBe(text.length)
    expect(message?.text.startsWith('HEAD')).toBe(true)
    expect(message?.text.endsWith('TAIL')).toBe(true)
    expect(message?.text).toContain('chars omitted')
  })

  it('reports a missing file instead of returning an empty list', async () => {
    const read = await readAgentTranscriptTail({
      agent: 'claude',
      path: join(tmpdir(), 'definitely-missing-transcript.jsonl'),
      sessionId: 's',
      allowedRoots: [tmpdir()]
    })
    expect(read).toMatchObject({ available: false, reason: 'transcript file not found' })
  })

  it('reports unsupported agents', async () => {
    const read = await readAgentTranscriptTail({
      agent: 'gemini',
      path: '/x.jsonl',
      sessionId: 's',
      allowedRoots: []
    })
    expect(read).toMatchObject({ available: false })
  })
})

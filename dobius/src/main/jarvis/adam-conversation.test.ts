import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdamTurnEvent } from '../../shared/speech-types'
import { ADAM_BUSY_TEXT, AdamConversation } from './adam-conversation'
import { AdamHermesVoice } from './adam-hermes-voice'
import type { HermesDesktopEvent, HermesRpc } from './hermes-desktop-rpc'

const runtime = { python: '/runtime/python', root: '/runtime', profileHome: '/profiles/adam' }
let directory: string
let emit: (event: HermesDesktopEvent) => void
let request: ReturnType<typeof vi.fn<HermesRpc['request']>>
let brain: AdamHermesVoice
let events: AdamTurnEvent[]
let adam: AdamConversation

const submits = (): Record<string, unknown>[] =>
  request.mock.calls.filter(([method]) => method === 'prompt.submit').map(([, params]) => params)
async function reply(text: string, count: number): Promise<void> {
  await vi.waitFor(() => expect(submits()).toHaveLength(count))
  emit({ type: 'message.complete', session_id: 'live-1', payload: { text, status: 'complete' } })
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'adam-conversation-'))
  request = vi.fn(async (method: string): Promise<Record<string, unknown>> =>
    method === 'session.create'
      ? { session_id: 'live-1', stored_session_id: 'saved-1' }
      : { status: 'streaming' }
  )
  brain = new AdamHermesVoice({
    sessionFile: join(directory, 'session.json'),
    runtime: () => runtime,
    connect: (_runtime, onEvent): HermesRpc => {
      emit = onEvent
      return { ready: Promise.resolve(), request, close: async () => undefined }
    }
  })
  events = []
  adam = new AdamConversation(brain, (event) => events.push(event))
})
afterEach(async () => {
  await brain.close()
  await rm(directory, { recursive: true, force: true })
})

describe('AdamConversation: voice and the thread are one conversation', () => {
  it('sends a voice turn and a thread turn to the same Hermes session, announced in order', async () => {
    const spoken = adam.ask('what is running', { source: 'voice', threadId: 'repo-a' })
    await reply('Two consoles.', 1)
    await expect(spoken).resolves.toEqual({ kind: 'answer', text: 'Two consoles.' })
    const typed = adam.ask('and in the other project?', { source: 'thread' })
    await reply('One more there.', 2)
    await expect(typed).resolves.toEqual({ kind: 'answer', text: 'One more there.' })

    expect(submits()).toEqual([
      { session_id: 'live-1', text: 'what is running' },
      { session_id: 'live-1', text: 'and in the other project?' }
    ])
    expect(request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(1)
    expect(events.map((e) => [e.source, e.phase, e.phase === 'asked' ? e.text : e.result.text])).toEqual([
      ['voice', 'asked', 'what is running'],
      ['voice', 'answered', 'Two consoles.'],
      ['thread', 'asked', 'and in the other project?'],
      ['thread', 'answered', 'One more there.']
    ])
    // The thread is fixed at submit and carried in both events.
    expect(events.map((e) => e.threadId)).toEqual(['repo-a', 'repo-a', null, null])
    expect(events[0].turnId).toBe(events[1].turnId)
    expect(events[2].turnId).not.toBe(events[0].turnId)
  })

  it('never runs two turns at once: the second is told ADAM is busy and reaches nothing', async () => {
    const typed = adam.ask('long question', { source: 'thread' })
    await expect(adam.ask('hey adam', { source: 'voice' })).resolves.toEqual({
      kind: 'error',
      text: ADAM_BUSY_TEXT
    })
    await reply('Done.', 1)
    await typed
    expect(submits()).toHaveLength(1)
    expect(events.map((e) => `${e.source}:${e.phase}`)).toEqual(['thread:asked', 'thread:answered'])
    // Free again once the first turn is over.
    const next = adam.ask('hey adam', { source: 'voice' })
    await reply('Here.', 2)
    await expect(next).resolves.toEqual({ kind: 'answer', text: 'Here.' })
  })

  it('announces a failed turn and frees ADAM for the next one', async () => {
    const failing = new AdamConversation(
      { ask: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ kind: 'answer', text: 'ok' }) },
      (event) => events.push(event)
    )
    await expect(failing.ask('one', { source: 'voice' })).resolves.toMatchObject({ kind: 'error' })
    await expect(failing.ask('two', { source: 'voice' })).resolves.toEqual({ kind: 'answer', text: 'ok' })
    expect(events.map((e) => e.phase)).toEqual(['asked', 'answered', 'asked', 'answered'])
  })
})

import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADAM_COMPACTION_TIMEOUT_TEXT,
  ADAM_TURN_TIMEOUT_TEXT,
  AdamHermesVoice
} from './adam-hermes-voice'
import type { AdamHermesRuntime } from './adam-hermes-runtime'
import {
  HermesDesktopRpc,
  HermesRpcError,
  type HermesDesktopEvent,
  type HermesRpc
} from './hermes-desktop-rpc'
import { saveAdamVoiceSession } from './adam-hermes-session'

const runtime = { python: '/runtime/python', root: '/runtime', profileHome: '/profiles/adam' }
let directory: string
let sessionFile: string
let emit: (event: HermesDesktopEvent) => void
let disconnect: () => void
let request: ReturnType<typeof vi.fn<HermesRpc['request']>>
let close: ReturnType<typeof vi.fn<HermesRpc['close']>>
let connect: ReturnType<
  typeof vi.fn<
    (
      runtime: AdamHermesRuntime,
      onEvent: (event: HermesDesktopEvent) => void,
      onDisconnect: () => void
    ) => HermesRpc
  >
>
let client: AdamHermesVoice

function complete(text = 'Hello from Adam', status = 'complete', session_id = 'voice-1'): void {
  emit({ type: 'message.complete', session_id, payload: { text, status } })
}
async function submitted(count = 1): Promise<void> {
  await vi.waitFor(() =>
    expect(request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(count)
  )
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'adam-voice-'))
  sessionFile = join(directory, 'session.json')
  request = vi.fn(async (method: string): Promise<Record<string, unknown>> => {
    if (method === 'session.create') {
      return { session_id: 'voice-1', stored_session_id: 'owned-session' }
    }
    if (method === 'session.resume') {
      return { session_id: 'voice-1', resumed: 'owned-session' }
    }
    return { status: 'streaming' }
  })
  close = vi.fn(async () => undefined)
  connect = vi.fn((_runtime, onEvent, onDisconnect): HermesRpc => {
    emit = onEvent
    disconnect = onDisconnect
    return { ready: Promise.resolve(), request, close }
  })
  client = new AdamHermesVoice({ sessionFile, runtime: () => runtime, connect })
})
afterEach(async () => {
  await client.close()
  await rm(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('Adam Hermes voice session', () => {
  it('uses the Adam profile and reuses one session for subsequent voice turns', async () => {
    const first = client.ask(' hello ')
    await submitted()
    complete()
    await expect(first).resolves.toEqual({ kind: 'answer', text: 'Hello from Adam' })
    expect(request).toHaveBeenCalledWith('session.create', {
      title: 'Dobius voice — Adam',
      profile: 'adam'
    })
    expect(request).toHaveBeenCalledWith('prompt.submit', { session_id: 'voice-1', text: 'hello' })
    const second = client.ask('remember what I said?')
    await submitted(2)
    complete('Yes')
    await expect(second).resolves.toEqual({ kind: 'answer', text: 'Yes' })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(1)
    expect(JSON.parse(await readFile(sessionFile, 'utf8'))).toEqual({
      profileHome: runtime.profileHome,
      sessionId: 'owned-session'
    })
  })

  it('resumes only its saved voice session, not the most recent TUI or Telegram session', async () => {
    await saveAdamVoiceSession(sessionFile, runtime.profileHome, 'owned-session')
    const pending = client.ask('continue')
    await submitted()
    expect(request).toHaveBeenCalledWith('session.resume', {
      profile: 'adam',
      session_id: 'owned-session'
    })
    expect(request.mock.calls.some(([method]) => method === 'session.create')).toBe(false)
    complete()
    await pending
  })

  it('creates a new session when its previously saved session was deleted', async () => {
    await saveAdamVoiceSession(sessionFile, runtime.profileHome, 'deleted')
    request.mockImplementation(async (method: string) => {
      if (method === 'session.resume') {
        throw new HermesRpcError(4007)
      }
      if (method === 'session.create') {
        return { session_id: 'voice-1', stored_session_id: 'new-session' }
      }
      return {}
    })
    const pending = client.ask('hello')
    await submitted()
    complete()
    await pending
  })

  it('rejects overlapping requests and ignores other sessions and token deltas', async () => {
    const pending = client.ask('first')
    await submitted()
    await expect(client.ask('second')).resolves.toMatchObject({ kind: 'error' })
    complete('other conversation', 'complete', 'someone-else')
    emit({ type: 'message.delta', session_id: 'voice-1', payload: { text: 'partial' } })
    complete('the actual final reply')
    await expect(pending).resolves.toEqual({ kind: 'answer', text: 'the actual final reply' })
    expect(request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
  })

  it('cancels and retires its own session, ignoring late replies', async () => {
    const pending = client.ask('first')
    await submitted()
    const staleEmit = emit
    client.cancel()
    await expect(pending).resolves.toEqual({ kind: 'cancelled', text: '' })
    await client.close()
    expect(request).toHaveBeenCalledWith('session.interrupt', { session_id: 'voice-1' }, 1_000)
    expect(request).toHaveBeenCalledWith('session.close', { session_id: 'voice-1' }, 1_000)
    expect(close).toHaveBeenCalledTimes(1)
    const next = client.ask('fresh')
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    staleEmit({
      type: 'message.complete',
      session_id: 'voice-1',
      payload: { status: 'complete', text: 'stale' }
    })
    await submitted(2)
    complete('fresh reply')
    await expect(next).resolves.toEqual({ kind: 'answer', text: 'fresh reply' })
  })

  it('does not open an orphaned connection after cancellation during startup', async () => {
    let ready!: () => void
    connect.mockImplementation((_runtime, onEvent, onDisconnect) => {
      emit = onEvent
      disconnect = onDisconnect
      return {
        ready: new Promise<void>((resolve) => {
          ready = resolve
        }),
        request,
        close
      }
    })
    const pending = client.ask('hello')
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    client.cancel()
    ready()
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled' })
    await client.close()
    expect(request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'interrupted'] as const)(
    'does not treat %s completion as an answer',
    async (status) => {
      const pending = client.ask('hello')
      await submitted()
      complete('partial text', status)
      await expect(pending).resolves.toMatchObject({ kind: 'error' })
    }
  )

  it('fails visibly on disconnection without leaking provider errors', async () => {
    const pending = client.ask('hello')
    await submitted()
    disconnect()
    await expect(pending).resolves.toMatchObject({ kind: 'error' })
  })

  it('returns an installation error without launching anything when Adam is unavailable', async () => {
    client = new AdamHermesVoice({ sessionFile, runtime: () => null, connect })
    await expect(client.ask('hello')).resolves.toMatchObject({ kind: 'error' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('ends requests for additional interactive input instead of leaving voice thinking forever', async () => {
    const pending = client.ask('hello')
    await submitted()
    emit({ type: 'secret.request', session_id: 'voice-1', payload: { request_id: 'secret' } })
    await expect(pending).resolves.toMatchObject({
      kind: 'error',
      text: expect.stringContaining('Hermes terminal')
    })
    await client.close()
    expect(close).toHaveBeenCalled()
  })

  it('requires explicit approval and grants it only once', async () => {
    const approve = vi.fn(async () => true)
    client = new AdamHermesVoice({ sessionFile, runtime: () => runtime, connect, approve })
    const pending = client.ask('do the task')
    await submitted()
    emit({
      type: 'approval.request',
      session_id: 'voice-1',
      payload: { command: 'test command', description: 'Review this action' }
    })
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('approval.respond', {
        session_id: 'voice-1',
        choice: 'once'
      })
    )
    expect(approve).toHaveBeenCalledWith('test command', 'Review this action')
    complete()
    await pending
  })
})

describe('Adam Hermes voice: context compaction', () => {
  const status = (kind: string, text = 'x'): void =>
    emit({ type: 'status.update', session_id: 'voice-1', payload: { kind, text } })
  const interrupts = (): unknown[] =>
    request.mock.calls.filter(([method]) => method === 'session.interrupt')

  it('never times out or interrupts a turn while Hermes compacts, and resumes the turn budget after', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onCompacting = vi.fn()
    client = new AdamHermesVoice({
      sessionFile,
      runtime: () => runtime,
      connect,
      turnTimeoutMs: 1_000,
      compactionTimeoutMs: 60_000,
      onCompacting
    })
    const pending = client.ask('hello')
    await submitted()
    status('compacting', '📦 Preflight compression: ~98,027 tokens >= 96,000 threshold.')
    expect(client.compacting).toBe(true)
    expect(onCompacting).toHaveBeenLastCalledWith(true)
    // Far past the turn budget, as the 2–3 minute summary call is.
    await vi.advanceTimersByTimeAsync(30_000)
    status('compacting', '🗜️ Compacting context — still summarizing…')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(interrupts()).toHaveLength(0)
    status('compacted', '✓ Context compaction complete — continuing turn...')
    expect(client.compacting).toBe(false)
    expect(onCompacting).toHaveBeenLastCalledWith(false)
    // A fresh turn budget, not what was left before compacting.
    await vi.advanceTimersByTimeAsync(900)
    complete('After the tidy')
    await expect(pending).resolves.toEqual({ kind: 'answer', text: 'After the tidy' })
    expect(interrupts()).toHaveLength(0)
    expect(onCompacting).toHaveBeenCalledTimes(2)
  })

  it('still times out a compaction that runs past its own budget, saying so plainly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onCompacting = vi.fn()
    client = new AdamHermesVoice({
      sessionFile,
      runtime: () => runtime,
      connect,
      turnTimeoutMs: 1_000,
      compactionTimeoutMs: 5_000,
      onCompacting
    })
    const pending = client.ask('hello')
    await submitted()
    status('compacting')
    await vi.advanceTimersByTimeAsync(5_001)
    await expect(pending).resolves.toEqual({ kind: 'error', text: ADAM_COMPACTION_TIMEOUT_TEXT })
    expect(onCompacting).toHaveBeenLastCalledWith(false)
    vi.useRealTimers()
    await client.close()
    expect(interrupts()).toHaveLength(1)
  })

  it('times out an ordinary turn with plain words', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    client = new AdamHermesVoice({ sessionFile, runtime: () => runtime, connect, turnTimeoutMs: 1_000 })
    const pending = client.ask('hello')
    await submitted()
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(pending).resolves.toEqual({ kind: 'error', text: ADAM_TURN_TIMEOUT_TEXT })
  })

  it('an explicit stop during compaction still interrupts the session', async () => {
    const onCompacting = vi.fn()
    client = new AdamHermesVoice({ sessionFile, runtime: () => runtime, connect, onCompacting })
    const pending = client.ask('hello')
    await submitted()
    status('compacting')
    client.cancel()
    await expect(pending).resolves.toEqual({ kind: 'cancelled', text: '' })
    await client.close()
    expect(request).toHaveBeenCalledWith('session.interrupt', { session_id: 'voice-1' }, 1_000)
    expect(onCompacting).toHaveBeenLastCalledWith(false)
  })

  it('ignores status lines that are not compaction, and a streamed reply ends compaction', async () => {
    client = new AdamHermesVoice({ sessionFile, runtime: () => runtime, connect })
    const pending = client.ask('hello')
    await submitted()
    status('loop', 'loop notice')
    expect(client.compacting).toBe(false)
    status('compacting')
    emit({ type: 'message.delta', session_id: 'voice-1', payload: { text: 'Hi' } })
    expect(client.compacting).toBe(false)
    complete()
    await pending
  })
})

it('answers modern approval requests only for the current voice session', async () => {
  const approve = vi.fn(async () => true)
  client = new AdamHermesVoice({ sessionFile, runtime: () => runtime, connect, approve })
  const pending = client.ask('hello')
  await submitted()
  const respond = vi.fn()
  emit({
    type: 'approval.request',
    session_id: 'voice-1',
    payload: { command: 'review me' },
    respond
  })
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ choice: 'once' }))
  respond.mockClear()
  emit({
    type: 'approval.request',
    session_id: 'another-session',
    payload: { command: 'other' },
    respond
  })
  expect(respond).toHaveBeenCalledWith({ choice: 'deny' })
  expect(approve).toHaveBeenCalledTimes(1)
  complete()
  await pending
})

it.skipIf(process.env.DOBIUS_TEST_ADAM_HERMES_LIVE !== '1')(
  'connects to the installed Adam profile and completes a real voice request',
  async () => {
    client = new AdamHermesVoice({
      sessionFile,
      connect: (runtime, onEvent, onDisconnect) => {
        const rpc = new HermesDesktopRpc(runtime, {
          onEvent: (event) => {
            if (event.type === 'error' || event.type === 'message.complete') {
              const payload = event.payload ?? {}
              const text = String(payload.message ?? payload.text ?? '')
              const categories = [
                'expired',
                'signed out',
                'unavailable',
                'allowance',
                'usage',
                'quota',
                'timeout',
                'timed out',
                'budget',
                'interrupted',
                'provider',
                'model',
                'context',
                'invalid',
                'error',
                'failed',
                '401',
                '403',
                '429',
                'rate',
                'limit',
                'loopback'
              ].filter((word) => text.toLowerCase().includes(word))
              console.info('Adam live result:', event.type, payload.status, categories)
            }
            onEvent(event)
          },
          onDisconnect
        })
        return rpc
      }
    })
    const result = await client.ask('Reply with exactly ADAM_VOICE_CONNECTED. Do not use tools.')
    expect(result).toEqual({ kind: 'answer', text: 'ADAM_VOICE_CONNECTED' })
  },
  180_000
)

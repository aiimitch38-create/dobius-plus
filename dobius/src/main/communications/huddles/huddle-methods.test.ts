import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why mocked here: huddle-speech-synthesis.ts's default runner shells out via
// node:child_process. The RPC-level test below exercises `huddle.speak`
// through the real dispatcher + real (non-injected) speech queue, so the
// process spawn itself must be faked — this is the module boundary the task
// requires, just applied at the child_process layer instead of re-injecting
// a fake runner through the RPC params.
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_command: string, _args: string[], callback: (error: Error | null) => void) => {
    callback(null)
  })
}))

import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import { HUDDLE_METHODS } from './index'
import { resetHuddleSessionStoreForTests } from './huddle-session-store'
import { resetHuddleSpeechQueueForTests } from './huddle-speech-synthesis'

function dispatcher(): RpcDispatcher {
  return new RpcDispatcher({
    runtime: { getRuntimeId: () => 'test-runtime' } as never,
    methods: HUDDLE_METHODS
  })
}

async function call(method: string, params: unknown = {}) {
  return dispatcher().dispatch({ id: '1', authToken: 'test', method, params })
}

describe('huddle RPC methods', () => {
  beforeEach(() => {
    resetHuddleSessionStoreForTests()
    resetHuddleSpeechQueueForTests()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('runs the full start -> addAgent -> confirmActive -> leave lifecycle', async () => {
    const started = await call('huddle.start', {
      parentChannelId: 'parent-1',
      memberPubkeys: [],
      callerPubkey: 'caller-1'
    })
    expect(started.ok).toBe(true)
    const ephemeralChannelId = (started as { result: { ephemeral_channel_id: string } }).result
      .ephemeral_channel_id

    const added = await call('huddle.addAgent', { pubkey: 'agent-pubkey-1' })
    expect(added).toMatchObject({ ok: true, result: { agent_pubkeys: ['agent-pubkey-1'] } })

    const pubkeys = await call('huddle.getAgentPubkeys')
    expect(pubkeys).toMatchObject({ ok: true, result: ['agent-pubkey-1'] })

    const active = await call('huddle.confirmActive')
    expect(active).toMatchObject({ ok: true, result: { phase: 'active' } })

    const state = await call('huddle.getState')
    expect(state).toMatchObject({
      ok: true,
      result: { phase: 'active', ephemeral_channel_id: ephemeralChannelId }
    })

    const left = await call('huddle.leave')
    expect(left).toMatchObject({ ok: true, result: { phase: 'idle' } })
  })

  it('surfaces a redundant start as a plain runtime_error with the exact Rust-compatible message', async () => {
    await call('huddle.start', { parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
    const second = await call('huddle.start', {
      parentChannelId: 'p',
      memberPubkeys: [],
      callerPubkey: 'c'
    })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe('runtime_error')
      expect(second.error.message).toBe('cannot start huddle: already in phase creating')
    }
  })

  it('joins, reconnects audio, and ends the huddle', async () => {
    await call('huddle.join', {
      parentChannelId: 'p',
      ephemeralChannelId: 'huddle-existing',
      callerPubkey: 'caller-2'
    })
    await call('huddle.confirmActive')

    const reconnected = await call('huddle.reconnectAudio')
    expect(reconnected).toMatchObject({ ok: true, result: { phase: 'active' } })

    const ended = await call('huddle.end')
    expect(ended).toMatchObject({ ok: true, result: { phase: 'idle' } })
  })

  it('rejects invalid voice input mode values via zod, without reaching the store', async () => {
    const result = await call('huddle.setVoiceInputMode', { mode: 'telepathy' })
    expect(result.ok).toBe(false)
  })

  it('round-trips voice input mode and survives a leave', async () => {
    await call('huddle.setVoiceInputMode', { mode: 'push_to_talk' })
    await call('huddle.start', { parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
    await call('huddle.leave')
    const mode = await call('huddle.getVoiceInputMode')
    expect(mode).toMatchObject({ ok: true, result: 'push_to_talk' })
  })

  it('toggles transcription and TTS only while a huddle is active', async () => {
    const beforeStart = await call('huddle.setTtsEnabled', { enabled: false })
    expect(beforeStart.ok).toBe(false)

    await call('huddle.start', { parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
    const toggled = await call('huddle.setTranscriptionEnabled', { enabled: false })
    expect(toggled).toMatchObject({ ok: true, result: { transcription_enabled: false } })
  })

  it('speaks through the real (mocked child_process) speech queue', async () => {
    await call('huddle.start', { parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
    const result = await call('huddle.speak', { text: 'hello from the agent' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toMatchObject({ played: true })
    }
  })

  it('skips synthesis entirely when TTS is toggled off, without calling the engine', async () => {
    const { execFile } = await import('node:child_process')
    await call('huddle.start', { parentChannelId: 'p', memberPubkeys: [], callerPubkey: 'c' })
    await call('huddle.setTtsEnabled', { enabled: false })

    const result = await call('huddle.speak', { text: 'muted' })
    expect(result).toMatchObject({ ok: true, result: { played: false, reason: 'tts_disabled' } })
    expect(execFile).not.toHaveBeenCalled()
  })
})

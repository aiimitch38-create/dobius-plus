import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveDelegateResult, OpenAiLiveSessionResult } from '../../../../shared/speech-types'
import {
  LIVE_RECYCLE_FORCE_AFTER_MS,
  LIVE_RECYCLE_MIN_MS
} from './live-voice-reconnect'
import {
  LIVE_DROPPED_TEXT,
  LIVE_CAP_HANG_UP_GRACE_MS,
  LIVE_IDLE_HANGUP_MS,
  LiveVoiceCall,
  type LiveVoiceApi,
  type LiveVoiceSnapshot
} from './live-voice-call'
import { LIVE_DATA_CHANNEL } from './live-voice-wire'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

class FakeChannel {
  readyState = 'open'
  sent: Record<string, unknown>[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  emit(event: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

class FakePeer {
  connectionState = 'new'
  label = ''
  channel = new FakeChannel()
  ontrack: ((event: { streams: readonly unknown[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addTrack = vi.fn()
  createOffer = vi.fn(async () => ({ sdp: 'v=0\r\nm=audio 9' }))
  setLocalDescription = vi.fn(async () => undefined)
  setRemoteDescription = vi.fn(async () => undefined)
  close = vi.fn()
  createDataChannel(label: string): FakeChannel {
    this.label = label
    return this.channel
  }
}

let peers: FakePeer[] = []
let track = { enabled: true, stop: vi.fn() }
let connect: Deferred<OpenAiLiveSessionResult>
let delegateReply: Deferred<LiveDelegateResult>
let api: { [K in keyof LiveVoiceApi]: ReturnType<typeof vi.fn> }
let snapshots: LiveVoiceSnapshot[] = []

const OK: OpenAiLiveSessionResult = { ok: true, answerSdp: 'v=0\r\nanswer', sessionId: 's1' }

function makeCall(): LiveVoiceCall {
  return new LiveVoiceCall(
    {
      api: api as unknown as LiveVoiceApi,
      createPeer: () => {
        const peer = new FakePeer()
        peers.push(peer)
        return peer
      },
      getMicrophone: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }),
      playRemote: () => () => undefined,
      setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
      clearTimeout: (timer) => clearTimeout(timer)
    },
    (snapshot) => snapshots.push(snapshot)
  )
}

const peer = (): FakePeer => peers.at(-1) as FakePeer
const sentTypes = (): unknown[] => peer().channel.sent.map((event) => event.type)

async function connected(call: LiveVoiceCall): Promise<void> {
  void call.start()
  await vi.advanceTimersByTimeAsync(0)
  connect.resolve(OK)
  await vi.advanceTimersByTimeAsync(0)
  peer().channel.emit({ type: 'session.started', expires_at: Date.now() / 1000 + 7200 })
}

beforeEach(() => {
  vi.useFakeTimers()
  peers = []
  snapshots = []
  track = { enabled: true, stop: vi.fn() }
  connect = deferred()
  delegateReply = deferred()
  api = {
    liveSessionConnect: vi.fn(() => connect.promise),
    liveSessionReport: vi.fn(async () => ({ ok: true })),
    liveDelegate: vi.fn(() => delegateReply.promise),
    liveCancel: vi.fn(async () => ({ ok: true })),
    liveTranscript: vi.fn(async () => ({ ok: true }))
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('call state machine', () => {
  it('connects through main and listens once the session starts', async () => {
    const call = makeCall()
    void call.start()
    expect(call.getSnapshot().state).toBe('connecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(peer().label).toBe(LIVE_DATA_CHANNEL)
    expect(api.liveSessionConnect).toHaveBeenCalledWith('v=0\r\nm=audio 9')
    connect.resolve(OK)
    await vi.advanceTimersByTimeAsync(0)
    expect(peer().setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'v=0\r\nanswer' })
    expect(call.getSnapshot().state).toBe('connecting')
    peer().channel.emit({ type: 'session.started' })
    expect(call.getSnapshot().state).toBe('listening')
  })

  it('shows speaking while the voice talks, then listening after it goes quiet', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.output_transcript.delta', delta: 'Hi' })
    expect(call.getSnapshot().state).toBe('speaking')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(call.getSnapshot().state).toBe('listening')
  })

  it('goes to standby on pause and tells the meter', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.paused' })
    expect(call.getSnapshot().state).toBe('standby')
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'paused' })
    peer().channel.emit({ type: 'session.resumed' })
    expect(call.getSnapshot().state).toBe('listening')
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'resumed' })
  })

  it('push-to-talk presses mute and unmute instead of hanging up', async () => {
    const call = makeCall()
    await connected(call)
    call.press('push-to-talk')
    expect(call.getSnapshot().muted).toBe(true)
    expect(track.enabled).toBe(false)
    expect(sentTypes()).toContain('session.input_audio.mute')
    call.press('push-to-talk')
    expect(call.getSnapshot().muted).toBe(false)
    expect(track.enabled).toBe(true)
    expect(sentTypes()).toContain('session.input_audio.unmute')
    expect(peer().close).not.toHaveBeenCalled()
  })

  it('hands-free press hangs up, closes audio and stops the meter', async () => {
    const call = makeCall()
    await connected(call)
    call.press('hands-free')
    await vi.advanceTimersByTimeAsync(0)
    expect(call.getSnapshot().state).toBe('idle')
    expect(peer().close).toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'closed' })
  })

  it('a hang-up during connect closes the session main opened for it', async () => {
    const call = makeCall()
    void call.start()
    await vi.advanceTimersByTimeAsync(0)
    void call.hangUp()
    connect.resolve(OK)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'closed' })
    expect(peer().close).toHaveBeenCalled()
    expect(peer().setRemoteDescription).not.toHaveBeenCalled()
    expect(call.getSnapshot().state).toBe('idle')
  })

  it('shows main’s refusal as an error', async () => {
    const call = makeCall()
    void call.start()
    await vi.advanceTimersByTimeAsync(0)
    connect.resolve({ ok: false, kind: 'over-cap', error: 'cap reached' })
    await vi.advanceTimersByTimeAsync(0)
    expect(call.getSnapshot()).toMatchObject({ state: 'error', errorText: 'cap reached' })
    expect(api.liveSessionReport).not.toHaveBeenCalled()
  })

  it('hangs up after twenty idle minutes', async () => {
    const call = makeCall()
    await connected(call)
    await vi.advanceTimersByTimeAsync(LIVE_IDLE_HANGUP_MS + 10)
    expect(call.getSnapshot().state).toBe('idle')
    expect(peer().close).toHaveBeenCalled()
  })

  it('hangs up when Carson says goodbye', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Okay, goodbye Adam.' })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(call.getSnapshot().state).toBe('idle')
  })
})

describe('delegation bridge', () => {
  it('sends what Carson said to ADAM and speaks the reply', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'What is ' })
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'running?' })
    peer().channel.emit({ type: 'session.delegation.created', delegation_id: 'd1' })
    expect(call.getSnapshot().state).toBe('thinking')
    await vi.advanceTimersByTimeAsync(600)
    expect(api.liveDelegate).toHaveBeenCalledWith({ request: 'What is running?', callLines: [] })
    delegateReply.resolve({ ok: true, kind: 'answer', speak: 'Two agents are running.' })
    await vi.advanceTimersByTimeAsync(0)
    expect(peer().channel.sent.at(-1)).toEqual({
      type: 'session.commentary.append',
      text: 'Two agents are running.',
      delegation_id: 'd1'
    })
    expect(call.getSnapshot().state).toBe('listening')
  })

  it('waits for the last words before taking the request', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Check the' })
    peer().channel.emit({ type: 'session.delegation.created', id: 'd2' })
    await vi.advanceTimersByTimeAsync(300)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: ' build' })
    await vi.advanceTimersByTimeAsync(700)
    expect(api.liveDelegate).toHaveBeenCalledWith({ request: 'Check the build', callLines: [] })
  })

  it('"stop" while ADAM works cancels the ADAM turn', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Run the tests' })
    peer().channel.emit({ type: 'session.delegation.created' })
    await vi.advanceTimersByTimeAsync(600)
    expect(api.liveDelegate).toHaveBeenCalledTimes(1)
    peer().channel.emit({ type: 'session.output_transcript.delta', delta: 'On it.' })
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Stop.' })
    await vi.advanceTimersByTimeAsync(800)
    expect(api.liveCancel).toHaveBeenCalledTimes(1)
    delegateReply.resolve({ ok: true, kind: 'cancelled', speak: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(sentTypes()).not.toContain('session.commentary.append')
  })

  it('a "stop" handed over as a request cancels instead of asking ADAM', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'never mind' })
    peer().channel.emit({ type: 'session.delegation.created' })
    await vi.advanceTimersByTimeAsync(600)
    expect(api.liveDelegate).not.toHaveBeenCalled()
    expect(api.liveCancel).toHaveBeenCalled()
  })

  it('hanging up while ADAM works cancels the turn and drops the late reply', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Do a thing' })
    peer().channel.emit({ type: 'session.delegation.created' })
    await vi.advanceTimersByTimeAsync(600)
    const channel = peer().channel
    void call.hangUp()
    expect(api.liveCancel).toHaveBeenCalled()
    delegateReply.resolve({ ok: true, kind: 'answer', speak: 'Done.' })
    await vi.advanceTimersByTimeAsync(0)
    expect(channel.sent.map((event) => event.type)).not.toContain('session.commentary.append')
  })
})

describe('transcripts in the ADAM thread', () => {
  it('saves small talk the voice answered itself, and not delegated turns', async () => {
    const call = makeCall()
    await connected(call)
    const emit = (type: string, delta: string): void =>
      peer().channel.emit({ type: `session.${type}_transcript.delta`, delta })
    emit('input', 'Can you hear me?')
    emit('output', 'Loud and clear.')
    emit('input', 'What is running?')
    expect(api.liveTranscript).toHaveBeenCalledWith({
      role: 'user',
      text: 'Can you hear me?',
      itemId: '1'
    })
    expect(api.liveTranscript).toHaveBeenCalledWith({
      role: 'assistant',
      text: 'Loud and clear.',
      itemId: '1'
    })
    peer().channel.emit({ type: 'session.delegation.created' })
    await vi.advanceTimersByTimeAsync(600)
    expect(api.liveDelegate).toHaveBeenCalledWith({
      request: 'What is running?',
      callLines: ['Carson: Can you hear me?', "ADAM's voice: Loud and clear."]
    })
    delegateReply.resolve({ ok: true, kind: 'answer', speak: 'Two.' })
    await vi.advanceTimersByTimeAsync(0)
    emit('output', 'Two agents.')
    void call.hangUp()
    expect(api.liveTranscript).toHaveBeenCalledTimes(2)
  })
})

describe('spending cap', () => {
  it('speaks the cap notice, then hangs up and shows why', async () => {
    const call = makeCall()
    await connected(call)
    call.notice({ kind: 'cap-warning', text: 'eighty percent' })
    call.notice({ kind: 'cap-warning', text: 'eighty percent' })
    expect(sentTypes().filter((type) => type === 'session.commentary.append')).toHaveLength(1)
    call.notice({ kind: 'cap-reached', text: 'cap reached' })
    expect(peer().channel.sent.at(-1)).toMatchObject({ text: 'cap reached' })
    await vi.advanceTimersByTimeAsync(LIVE_CAP_HANG_UP_GRACE_MS + 10)
    expect(call.getSnapshot()).toMatchObject({ state: 'error', errorText: 'cap reached' })
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'closed' })
  })
})

describe('reconnect', () => {
  it('reopens a dropped call with a fresh session, then gives up after three tries', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.emit({ type: 'session.closed', reason: 'expired' })
    expect(call.getSnapshot().state).toBe('connecting')
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'closed' })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(peers).toHaveLength(2)
    expect(api.liveSessionConnect).toHaveBeenCalledTimes(2)
    // Drops without a successful start keep counting toward the limit.
    peer().channel.onclose?.()
    await vi.advanceTimersByTimeAsync(3_000)
    peer().channel.onclose?.()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(peers).toHaveLength(4)
    peer().channel.onclose?.()
    expect(call.getSnapshot()).toMatchObject({ state: 'error', errorText: LIVE_DROPPED_TEXT })
  })

  it('a press while waiting to reconnect hangs up instead', async () => {
    const call = makeCall()
    await connected(call)
    peer().channel.onclose?.()
    call.press('push-to-talk')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(peers).toHaveLength(1)
    expect(call.getSnapshot().state).toBe('idle')
  })

  it('waits for ADAM to finish before recycling, but not past the forced deadline', async () => {
    const call = makeCall()
    void call.start()
    await vi.advanceTimersByTimeAsync(0)
    connect.resolve(OK)
    await vi.advanceTimersByTimeAsync(0)
    // Expires in 6 minutes: recycle is due in 1 minute (the minimum).
    peer().channel.emit({ type: 'session.started', expires_at: (Date.now() + 6 * 60_000) / 1000 })
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Run the build' })
    peer().channel.emit({ type: 'session.delegation.created' })
    await vi.advanceTimersByTimeAsync(LIVE_RECYCLE_MIN_MS + 1_000)
    expect(peers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(LIVE_RECYCLE_FORCE_AFTER_MS)
    expect(peers).toHaveLength(2)
    expect(api.liveCancel).toHaveBeenCalled()
  })

  it('recycles right away when the call is quiet', async () => {
    const call = makeCall()
    void call.start()
    await vi.advanceTimersByTimeAsync(0)
    connect.resolve(OK)
    await vi.advanceTimersByTimeAsync(0)
    peer().channel.emit({ type: 'session.input_transcript.delta', delta: 'Can you hear me?' })
    peer().channel.emit({ type: 'session.output_transcript.delta', delta: 'Yes.' })
    peer().channel.emit({ type: 'session.started', expires_at: (Date.now() + 6 * 60_000) / 1000 })
    await vi.advanceTimersByTimeAsync(LIVE_RECYCLE_MIN_MS + 1_000)
    expect(peers).toHaveLength(2)
    const saved = api.liveTranscript.mock.invocationCallOrder[0]
    const closed = api.liveSessionReport.mock.invocationCallOrder[0]
    expect(saved).toBeLessThan(closed)
    expect(call.getSnapshot().state).toBe('connecting')
    peer().channel.emit({ type: 'session.started' })
    expect(call.getSnapshot().state).toBe('listening')
  })
})

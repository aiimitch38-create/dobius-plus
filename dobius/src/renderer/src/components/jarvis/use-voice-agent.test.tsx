// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceAgent, type VoiceAgent } from './use-voice-agent'

type SessionOptions = {
  onStatusChange: (event: { status: string }) => void
  onModeChange: (event: { mode: string }) => void
  onMessage: () => void
  onError: (message: string) => void
}
type FakeConversation = {
  endSession: ReturnType<typeof vi.fn>
  getInputVolume: () => number
  getOutputVolume: () => number
  sendContextualUpdate: ReturnType<typeof vi.fn>
}

const startSession = vi.hoisted(() => vi.fn())
vi.mock('@elevenlabs/client', () => ({ Conversation: { startSession } }))

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function fakeConversation(): FakeConversation {
  return {
    endSession: vi.fn(async () => undefined),
    getInputVolume: () => 0,
    getOutputVolume: () => 0,
    sendContextualUpdate: vi.fn()
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: VoiceAgent | null = null
let signedUrl: Deferred<{ ok: true; url: string }>

function Probe(): null {
  latest = useVoiceAgent()
  return null
}

beforeEach(async () => {
  signedUrl = deferred()
  ;(window as unknown as { api: unknown }).api = {
    jarvis: {
      agentSignedUrl: vi.fn(() => signedUrl.promise),
      agentOpening: vi.fn(async () => ''),
      agentContext: vi.fn(async () => 'context'),
      conversationMemory: vi.fn(async () => '')
    }
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<Probe />)
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  startSession.mockReset()
  vi.clearAllMocks()
})

describe('useVoiceAgent stop during connect (#83)', () => {
  it('never opens a session when stopped during the signed-URL fetch', async () => {
    await act(async () => {
      latest?.toggle()
    })
    expect(latest?.state).toBe('connecting')

    await act(async () => {
      latest?.toggle()
    })
    expect(latest?.state).toBe('idle')

    await act(async () => {
      signedUrl.resolve({ ok: true, url: 'wss://signed' })
    })

    // The canceled start goes no further: no greeting fetch, no SDK connect.
    const api = (window as unknown as { api: { jarvis: { agentOpening: unknown } } }).api
    expect(api.jarvis.agentOpening).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(latest?.state).toBe('idle')
    expect(latest?.active).toBe(false)
  })

  it('hangs up a session that finishes connecting after the user stopped', async () => {
    const connect = deferred<FakeConversation>()
    let options: SessionOptions | null = null
    startSession.mockImplementation((opts: SessionOptions) => {
      options = opts
      return connect.promise
    })

    await act(async () => {
      latest?.toggle()
    })
    await act(async () => {
      signedUrl.resolve({ ok: true, url: 'wss://signed' })
    })
    expect(startSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      latest?.toggle()
    })
    expect(latest?.state).toBe('idle')

    // The SDK reports the late connection, then the start promise resolves.
    const conversation = fakeConversation()
    await act(async () => {
      options?.onStatusChange({ status: 'connected' })
      connect.resolve(conversation)
    })

    expect(conversation.endSession).toHaveBeenCalledTimes(1)
    expect(latest?.state).toBe('idle')
    expect(latest?.active).toBe(false)
    expect(latest?.getAudioLevel()).toBe(0)

    // Late SDK callbacks from the orphaned session change nothing and arm no
    // idle-hangup timer.
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    await act(async () => {
      options?.onModeChange({ mode: 'speaking' })
      options?.onMessage()
    })
    expect(latest?.state).toBe('idle')
    expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === 60_000)).toBe(false)
    setTimeoutSpy.mockRestore()
  })

  it('allows a fresh start after a canceled one without the stale start interfering', async () => {
    const staleConnect = deferred<FakeConversation>()
    const freshConnect = deferred<FakeConversation>()
    let staleOptions: SessionOptions | null = null
    startSession
      .mockImplementationOnce((opts: SessionOptions) => {
        staleOptions = opts
        return staleConnect.promise
      })
      .mockImplementationOnce(() => freshConnect.promise)

    await act(async () => {
      latest?.toggle()
    })
    await act(async () => {
      signedUrl.resolve({ ok: true, url: 'wss://signed' })
    })
    await act(async () => {
      latest?.toggle()
    })
    await act(async () => {
      latest?.toggle()
    })
    expect(latest?.state).toBe('connecting')
    expect(startSession).toHaveBeenCalledTimes(2)

    const stale = fakeConversation()
    const fresh = fakeConversation()
    await act(async () => {
      staleConnect.resolve(stale)
    })
    await act(async () => {
      freshConnect.resolve(fresh)
    })

    expect(stale.endSession).toHaveBeenCalledTimes(1)
    expect(fresh.endSession).not.toHaveBeenCalled()
    expect(latest?.active).toBe(true)

    // The orphaned session hanging up or erroring must not reset the live one.
    await act(async () => {
      staleOptions?.onStatusChange({ status: 'disconnected' })
      staleOptions?.onError('stale socket closed')
    })
    expect(latest?.state).toBe('connecting')
    expect(latest?.errorText).toBeNull()
    expect(latest?.active).toBe(true)

    await act(async () => {
      latest?.toggle()
    })
    expect(fresh.endSession).toHaveBeenCalledTimes(1)
    expect(latest?.state).toBe('idle')
  })
})

// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveVoiceNotice } from '../../../../shared/speech-types'
import type { LiveVoiceCallDeps, PeerLike } from './live-voice-call-types'
import { useLiveVoice, type LiveVoice } from './use-live-voice'

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: LiveVoice | null = null
let noticeListener: ((notice: LiveVoiceNotice) => void) | null = null
const unsubscribe = vi.fn()
const channel = {
  readyState: 'open',
  sent: [] as string[],
  send(data: string) {
    this.sent.push(data)
  },
  close: vi.fn(),
  onmessage: null as ((event: { data: unknown }) => void) | null,
  onclose: null as (() => void) | null
}
const peer = {
  connectionState: 'new',
  addTrack: vi.fn(),
  createDataChannel: () => channel,
  createOffer: async () => ({ sdp: 'v=0\r\nm=audio' }),
  setLocalDescription: async () => undefined,
  setRemoteDescription: async () => undefined,
  close: vi.fn(),
  ontrack: null,
  onconnectionstatechange: null
}
const api = {
  liveSessionConnect: vi.fn(async () => ({
    ok: true as const,
    answerSdp: 'v=0',
    sessionId: null,
    callToken: 't1'
  })),
  liveSessionReport: vi.fn(async () => ({ ok: true })),
  liveDelegate: vi.fn(),
  liveCancel: vi.fn(async () => ({ ok: true })),
  liveTranscript: vi.fn(async () => ({ ok: true }))
}
const track = { enabled: true, stop: vi.fn() }
const deps = (): LiveVoiceCallDeps => ({
  api: api as unknown as LiveVoiceCallDeps['api'],
  createPeer: () => peer as unknown as PeerLike,
  getMicrophone: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }),
  playRemote: () => () => undefined
})

function Probe(): null {
  latest = useLiveVoice('hands-free', deps)
  return null
}

beforeEach(async () => {
  channel.sent = []
  ;(window as unknown as { api: unknown }).api = {
    jarvis: {
      onLiveNotice: vi.fn((listener: (notice: LiveVoiceNotice) => void) => {
        noticeListener = listener
        return unsubscribe
      })
    }
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<Probe />)
  })
})

afterEach(() => {
  container?.remove()
  container = null
  root = null
  latest = null
  vi.clearAllMocks()
})

describe('useLiveVoice', () => {
  it('starts a call on press, follows its state, and hangs up on unmount', async () => {
    expect(latest?.state).toBe('idle')
    await act(async () => {
      latest?.press()
    })
    expect(api.liveSessionConnect).toHaveBeenCalledTimes(1)
    await act(async () => {
      channel.onmessage?.({ data: JSON.stringify({ type: 'session.started' }) })
    })
    expect(latest?.state).toBe('listening')
    expect(latest?.active).toBe(true)
    await act(async () => {
      noticeListener?.({ kind: 'cap-warning', text: 'eighty percent' })
    })
    expect(channel.sent.map((data) => JSON.parse(data).content)).toContain('eighty percent')
    await act(async () => {
      root?.unmount()
    })
    expect(unsubscribe).toHaveBeenCalled()
    expect(peer.close).toHaveBeenCalled()
    expect(api.liveSessionReport).toHaveBeenCalledWith({ type: 'closed', callToken: 't1' })
  })
})

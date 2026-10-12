// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAudioCapture } from './use-audio-capture'

type Capture = ReturnType<typeof useAudioCapture>

let root: Root | null = null
let container: HTMLDivElement | null = null
const seen: Capture[] = []
let bump: (() => void) | null = null

function Probe(): null {
  const [, setTick] = useState(0)
  bump = () => setTick((tick) => tick + 1)
  seen.push(useAudioCapture())
  return null
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  seen.length = 0
  bump = null
})

describe('useAudioCapture', () => {
  it('returns the same controls object across re-renders (#82)', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<Probe />)
    })
    await act(async () => {
      bump?.()
    })
    await act(async () => {
      bump?.()
    })

    expect(seen.length).toBeGreaterThanOrEqual(3)
    for (const capture of seen) {
      expect(capture).toBe(seen[0])
    }
  })
})

type FakeProcessor = {
  connect: () => void
  disconnect: () => void
  onaudioprocess: ((event: unknown) => void) | null
}

const processors: FakeProcessor[] = []

class FakeAudioContext {
  state = 'running'
  sampleRate = 48_000
  destination = {}
  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    return { connect: () => undefined, disconnect: () => undefined }
  }
  createScriptProcessor(): FakeProcessor {
    const processor: FakeProcessor = {
      connect: () => undefined,
      disconnect: () => undefined,
      onaudioprocess: null
    }
    processors.push(processor)
    return processor
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

function emitAudio(processor: FakeProcessor): void {
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096) } })
}

describe('useAudioCapture live feed failures (#85)', () => {
  it('reports the first rejected live chunk once instead of swallowing it', async () => {
    const limitError = new Error('Cloud transcription is limited to 10 minutes per dictation')
    const feedAudio = vi.fn(async () => {
      throw limitError
    })
    ;(window as unknown as { api: unknown }).api = { speech: { feedAudio } }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) }
    })
    vi.stubGlobal('AudioContext', FakeAudioContext)
    processors.length = 0
    try {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(<Probe />)
      })
      const capture = seen.at(-1)!
      const onFeedError = vi.fn()

      await capture.start({ sessionId: 's1', onFeedError })
      const processor = processors.at(-1)!
      emitAudio(processor)
      emitAudio(processor)
      await flushMicrotasks()

      expect(feedAudio).toHaveBeenCalledTimes(2)
      expect(onFeedError).toHaveBeenCalledOnce()
      expect(onFeedError).toHaveBeenCalledWith(limitError)

      // A rejection that lands after stop() belongs to a finished capture.
      capture.stop()
      const lateFeed = vi.fn()
      await capture.start({ sessionId: 's2', onFeedError: lateFeed })
      const second = processors.at(-1)!
      expect(second).not.toBe(processor)
      emitAudio(second)
      capture.stop()
      await flushMicrotasks()
      expect(lateFeed).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

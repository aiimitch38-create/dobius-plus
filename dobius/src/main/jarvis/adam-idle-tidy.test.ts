import { describe, expect, it, vi } from 'vitest'
import {
  ADAM_IDLE_TIDY_AFTER_MS,
  ADAM_IDLE_TIDY_MIN_PERCENT,
  AdamIdleTidy,
  compactNow
} from './adam-idle-tidy'
import type { HermesRpc } from './hermes-desktop-rpc'

function make(over: { busy?: boolean; percent?: number | null } = {}) {
  let now = 1_000
  const state = { busy: over.busy ?? false, percent: over.percent === undefined ? 60 : over.percent }
  const tidy = vi.fn(async () => true)
  const watcher = new AdamIdleTidy({
    busy: () => state.busy,
    contextPercent: () => state.percent,
    tidy,
    now: () => now,
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn()
  })
  return {
    watcher,
    tidy,
    state,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('AdamIdleTidy', () => {
  it('tidies once after 10 quiet minutes when the context is near the threshold', () => {
    const t = make()
    t.advance(ADAM_IDLE_TIDY_AFTER_MS - 1)
    t.watcher.tick()
    expect(t.tidy).not.toHaveBeenCalled()
    t.advance(1)
    t.watcher.tick()
    t.advance(ADAM_IDLE_TIDY_AFTER_MS * 3)
    t.watcher.tick()
    expect(t.tidy).toHaveBeenCalledTimes(1)
  })

  it('never tidies during a turn or a live call, and a busy reading restarts the wait', () => {
    const t = make({ busy: true })
    t.advance(ADAM_IDLE_TIDY_AFTER_MS * 2)
    t.watcher.tick()
    expect(t.tidy).not.toHaveBeenCalled()
    t.state.busy = false
    t.advance(ADAM_IDLE_TIDY_AFTER_MS - 1)
    t.watcher.tick()
    expect(t.tidy).not.toHaveBeenCalled()
    t.advance(1)
    t.watcher.tick()
    expect(t.tidy).toHaveBeenCalledTimes(1)
  })

  it('skips when the context is far from the threshold or never reported', () => {
    for (const percent of [ADAM_IDLE_TIDY_MIN_PERCENT - 1, null]) {
      const t = make({ percent })
      t.advance(ADAM_IDLE_TIDY_AFTER_MS)
      t.watcher.tick()
      expect(t.tidy).not.toHaveBeenCalled()
    }
  })

  it('gets one try per idle stretch, and a new stretch after activity', () => {
    const t = make()
    t.tidy.mockRejectedValueOnce(new Error('busy'))
    t.advance(ADAM_IDLE_TIDY_AFTER_MS)
    t.watcher.tick()
    t.watcher.tick()
    expect(t.tidy).toHaveBeenCalledTimes(1)
    t.watcher.activity()
    t.advance(ADAM_IDLE_TIDY_AFTER_MS)
    t.watcher.tick()
    expect(t.tidy).toHaveBeenCalledTimes(2)
  })
})

describe('compactNow', () => {
  it('calls session.compress and reports the new context use, with the status edges', async () => {
    const onCompacting = vi.fn()
    const request = vi.fn(async () => ({ status: 'compressed', info: { usage: { context_percent: 9 } } }))
    const rpc = { ready: Promise.resolve(), request, close: vi.fn() } as unknown as HermesRpc
    await expect(compactNow(rpc, 'voice-1', { sessionFile: 'x', onCompacting })).resolves.toBe(9)
    expect(request).toHaveBeenCalledWith('session.compress', { session_id: 'voice-1' }, 720_000)
    expect(onCompacting.mock.calls).toEqual([[true], [false]])
  })
})

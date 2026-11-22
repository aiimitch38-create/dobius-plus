/**
 * Memory-leak regression: the deferred PTY side-effect queue must stay bounded.
 *
 * Titles, agent-status payloads and bells are applied on a setTimeout(0)
 * drain, 64 per tick. In a hidden window Chromium throttles that timer (down
 * to once a minute), so a busy agent's spinner titles piled up without limit.
 * The queue now applies its backlog synchronously past 1024 pending facts and
 * collapses same-status titles once it is behind. Nothing data-bearing drops.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPtyOutputProcessor } from './pty-transport'

const CAP = 1024
const EVENTS = 10_000

describe('PTY side-effect queue memory bound', () => {
  it('keeps at most 1024 facts pending when the drain timer never fires', () => {
    vi.useFakeTimers()
    try {
      const onTitleChange = vi.fn()
      const processor = createPtyOutputProcessor({ onTitleChange })
      const callbacks = { onData: vi.fn() }
      for (let i = 0; i < EVENTS; i += 1) {
        // Alternating statuses never collapse, so every title stays a separate fact.
        const title = i % 2 === 0 ? `. Claude working ${i}` : `* Claude done ${i}`
        processor.processData(`\x1b]0;${title}\x07`, callbacks)
      }
      expect(EVENTS - onTitleChange.mock.calls.length).toBeLessThanOrEqual(CAP)
      processor.flushPendingSideEffects()
      expect(onTitleChange).toHaveBeenCalledTimes(EVENTS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never drops agent-status payloads while bounding the queue', () => {
    vi.useFakeTimers()
    try {
      const onAgentStatus = vi.fn()
      const processor = createPtyOutputProcessor({ onAgentStatus })
      const callbacks = { onData: vi.fn() }
      for (let i = 0; i < EVENTS; i += 1) {
        processor.processData(`\x1b]9999;{"state":"working","prompt":"p${i}"}\x07`, callbacks)
      }
      expect(EVENTS - onAgentStatus.mock.calls.length).toBeLessThanOrEqual(CAP)
      processor.flushPendingSideEffects()
      expect(onAgentStatus).toHaveBeenCalledTimes(EVENTS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('collapses a backlog of same-status spinner titles to the newest, keeping transitions', () => {
    vi.useFakeTimers()
    try {
      const onTitleChange = vi.fn()
      const onAgentBecameWorking = vi.fn()
      const onAgentBecameIdle = vi.fn()
      const processor = createPtyOutputProcessor({
        onTitleChange,
        onAgentBecameWorking,
        onAgentBecameIdle
      })
      const callbacks = { onData: vi.fn() }
      for (let i = 0; i < EVENTS; i += 1) {
        processor.processData(`\x1b]0;. Claude working ${i}\x07`, callbacks)
      }
      processor.processData('\x1b]0;* Claude done\x07', callbacks)
      // Collapsing kept the backlog under the cap, so nothing was forced through yet.
      expect(onTitleChange.mock.calls.length).toBe(0)
      processor.flushPendingSideEffects()
      expect(onTitleChange.mock.calls.length).toBeLessThanOrEqual(CAP)
      const titles = onTitleChange.mock.calls.map((c) => c[1])
      expect(titles).toContain(`. Claude working ${EVENTS - 1}`)
      expect(titles.at(-1)).toBe('* Claude done')
      expect(onAgentBecameWorking).toHaveBeenCalledTimes(1)
      expect(onAgentBecameIdle).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

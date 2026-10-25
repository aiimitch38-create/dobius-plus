// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as TailModule from './console-output-tail'
import type { ConsoleScreen } from './console-output-tail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const hoisted = vi.hoisted(() => ({
  parses: 0,
  outputWatchers: new Map<string, Set<() => void>>()
}))

vi.mock('@/store', () => ({ useAppStore: { subscribe: () => () => {} } }))

vi.mock('@/components/terminal-pane/pty-data-sidecar-subscriptions', () => ({
  subscribeToPtyData: (ptyId: string, watcher: () => void) => {
    let set = hoisted.outputWatchers.get(ptyId)
    if (!set) {
      set = new Set()
      hoisted.outputWatchers.set(ptyId, set)
    }
    set.add(watcher)
    return () => set?.delete(watcher)
  }
}))

// A stand-in xterm: write() just remembers the text; the parse step below
// counts how often the hook asked for a screen.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols: number
    rows: number
    buffer = { active: { text: '' } }
    constructor(opts: { cols: number; rows: number }) {
      this.cols = opts.cols
      this.rows = opts.rows
    }
    resize(cols: number, rows: number): void {
      this.cols = cols
      this.rows = rows
    }
    reset(): void {}
    write(data: string, cb: () => void): void {
      this.buffer.active.text = data
      cb()
    }
    dispose(): void {}
  }
}))

vi.mock('./console-output-tail', async (importOriginal) => {
  const actual = await importOriginal<typeof TailModule>()
  return {
    ...actual,
    consoleScreenRuns: (buffer: { text: string }) => {
      hoisted.parses += 1
      return [[{ ...plainRun, text: buffer.text }]]
    }
  }
})

const plainRun = {
  text: '',
  fg: { mode: 'default' as const },
  bg: { mode: 'default' as const },
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
  invisible: false
}

import { markBoardMotion, useConsoleOutputTail } from './use-console-output-tail'

type Snap = { data: string; cols: number; rows: number; seq?: number }
let snapshotFor: (ptyId: string) => Snap | null
const getMainBufferSnapshot = vi.fn((ptyId: string) => Promise.resolve(snapshotFor(ptyId)))
let visibility: 'visible' | 'hidden' = 'visible'
let focused = true

let container: HTMLDivElement
let root: Root
let lastScreen: ConsoleScreen | null = null

function Probe({ ptyId, enabled }: { ptyId: string; enabled: boolean }): null {
  lastScreen = useConsoleOutputTail(ptyId, enabled)
  return null
}

function mount(node: React.ReactNode): void {
  act(() => root.render(node))
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function emitOutput(ptyId: string): void {
  for (const watcher of hoisted.outputWatchers.get(ptyId) ?? []) {
    watcher()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  hoisted.parses = 0
  hoisted.outputWatchers.clear()
  getMainBufferSnapshot.mockClear()
  snapshotFor = () => ({ data: 'hello', cols: 80, rows: 24, seq: 5 })
  visibility = 'visible'
  focused = true
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
  Object.defineProperty(document, 'hasFocus', { value: () => focused, configurable: true })
  ;(window as unknown as { api: unknown }).api = { pty: { getMainBufferSnapshot } }
  markBoardMotion(0)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  lastScreen = null
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useConsoleOutputTail polling', () => {
  it('does not poll while the card is off screen (disabled)', async () => {
    mount(<Probe ptyId="p1" enabled={false} />)
    await advance(60_000)
    expect(getMainBufferSnapshot).not.toHaveBeenCalled()
    expect(lastScreen).toBeNull()
  })

  it('backs off 1s -> 2s -> 5s -> 10s on identical snapshots and parses only once', async () => {
    mount(<Probe ptyId="p1" enabled />)
    await advance(0)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(1)
    expect(hoisted.parses).toBe(1)
    expect(lastScreen?.lines[0][0].text).toBe('hello')
    // Polls land at 0, 1, 3, 8, 18, 28, 38, 48, 58 s.
    await advance(59_999)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(9)
    expect(hoisted.parses).toBe(1)
  })

  it('parses a changed snapshot and returns to the 1s cadence', async () => {
    mount(<Probe ptyId="p1" enabled />)
    await advance(20_000) // polled at 0,1,3,8,18; next due at 28
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(5)
    snapshotFor = () => ({ data: 'world', cols: 80, rows: 24, seq: 6 })
    await advance(8_000) // 28 s: change seen
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(6)
    expect(hoisted.parses).toBe(2)
    expect(lastScreen?.lines[0][0].text).toBe('world')
    await advance(1_000) // 29 s: back to 1 s
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(7)
  })

  it('skips the parse when the raw snapshot is identical even without a seq', async () => {
    snapshotFor = () => ({ data: 'same', cols: 80, rows: 24 })
    mount(<Probe ptyId="p1" enabled />)
    await advance(10_000)
    expect(getMainBufferSnapshot.mock.calls.length).toBeGreaterThan(2)
    expect(hoisted.parses).toBe(1)
  })

  it('wakes a backed-off card shortly after PTY output arrives', async () => {
    mount(<Probe ptyId="p1" enabled />)
    await advance(10_000) // polled at 0,1,3,8; next due 18
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(4)
    emitOutput('p1')
    await advance(300)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(5)
  })

  it('leaves a card that is already polling every second alone when output is chatty', async () => {
    let seq = 1
    snapshotFor = () => ({ data: `line ${seq}`, cols: 80, rows: 24, seq })
    mount(<Probe ptyId="p1" enabled />)
    await advance(0)
    for (let t = 0; t < 5_000; t += 100) {
      seq += 1
      emitOutput('p1')
      await advance(100)
    }
    // 1 initial + one per second for 5 s; never faster than GLANCE_REFRESH_MS.
    expect(getMainBufferSnapshot.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('pauses entirely while the document is hidden and resumes on visibilitychange', async () => {
    mount(<Probe ptyId="p1" enabled />)
    await advance(0)
    visibility = 'hidden'
    await advance(30_000)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(0)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(2)
  })

  it('sleeps once an unfocused window has gone idle and wakes on focus', async () => {
    focused = false
    mount(<Probe ptyId="p1" enabled />)
    await advance(60_000) // 0,1,3,8 then asleep at the slowest step
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(4)
    focused = true
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await advance(0)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(5)
  })

  it('holds off while the board camera is moving', async () => {
    mount(<Probe ptyId="p1" enabled />)
    await advance(900)
    markBoardMotion(Date.now())
    await advance(100) // 1 s: due, but moving
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(1)
    await advance(400) // retried after the quiet window
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not re-parse an unchanged screen after an off-screen/on-screen flip', async () => {
    mount(<Probe ptyId="p1" enabled />)
    await advance(0)
    mount(<Probe ptyId="p1" enabled={false} />)
    await advance(5_000)
    mount(<Probe ptyId="p1" enabled />)
    await advance(1_000)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(2)
    expect(hoisted.parses).toBe(1)
    expect(lastScreen?.lines[0][0].text).toBe('hello')
  })

  it('measures: 20 idle glance cards issue 180 snapshot IPCs and 20 parses per minute', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`)
    mount(
      <>
        {ids.map((id) => (
          <Probe key={id} ptyId={id} enabled />
        ))}
      </>
    )
    await advance(59_999)
    // Before this change: 20 cards x 60 polls x 60 parses = 1200 / 1200 per minute.
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(20 * 9)
    expect(hoisted.parses).toBe(20)
  })
})

/**
 * Memory-leak regression: the glance-card screen cache must stay bounded.
 *
 * Every console ever shown as a glance card left its parsed screen in a
 * module map forever. Entries now go when their PTY exits, and an LRU cap of
 * 64 bounds consoles that never exit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleScreen } from './console-output-tail'

const exitWatchers = vi.hoisted(() => new Map<string, Set<() => void>>())

vi.mock('@/components/terminal-pane/pty-data-sidecar-subscriptions', () => ({
  subscribeToPtyExit: (ptyId: string, watcher: () => void) => {
    let set = exitWatchers.get(ptyId)
    if (!set) {
      set = new Set()
      exitWatchers.set(ptyId, set)
    }
    set.add(watcher)
    return () => {
      set?.delete(watcher)
      if (set?.size === 0) {
        exitWatchers.delete(ptyId)
      }
    }
  }
}))

import {
  MAX_CACHED_CONSOLE_SCREENS,
  cachedConsoleScreenCount,
  forgetConsoleScreen,
  lastConsoleScreen,
  rememberConsoleScreen
} from './console-screen-cache'

const screen = (text: string): ConsoleScreen =>
  ({ cols: 80, rows: 24, lines: [[{ text }]] }) as unknown as ConsoleScreen

function exitPty(ptyId: string): void {
  for (const w of [...(exitWatchers.get(ptyId) ?? [])]) {
    w()
  }
}

describe('console screen cache memory bound', () => {
  beforeEach(() => {
    for (let i = 0; i < 20_000; i += 1) {
      forgetConsoleScreen(`pty-${i}`)
    }
    forgetConsoleScreen('keep')
  })

  it('holds at most 64 screens (and exit watchers) across 10,000 consoles', () => {
    for (let i = 0; i < 10_000; i += 1) {
      rememberConsoleScreen(`pty-${i}`, screen(`screen ${i}`))
    }
    expect(MAX_CACHED_CONSOLE_SCREENS).toBe(64)
    expect(cachedConsoleScreenCount()).toBeLessThanOrEqual(64)
    expect(exitWatchers.size).toBeLessThanOrEqual(64)
    expect(lastConsoleScreen('pty-9999')).toEqual(screen('screen 9999'))
    expect(lastConsoleScreen('pty-0')).toBeNull()
  })

  it('keeps the most recently updated console when others pour in', () => {
    rememberConsoleScreen('keep', screen('first'))
    for (let i = 0; i < 10_000; i += 1) {
      rememberConsoleScreen(`pty-${i}`, screen(`screen ${i}`))
      if (i % 32 === 0) {
        rememberConsoleScreen('keep', screen(`keep ${i}`))
      }
    }
    expect(lastConsoleScreen('keep')).toEqual(screen('keep 9984'))
  })

  it('drops a screen when its PTY exits', () => {
    rememberConsoleScreen('pty-1', screen('a'))
    rememberConsoleScreen('pty-1', screen('b'))
    expect(exitWatchers.get('pty-1')?.size).toBe(1)
    exitPty('pty-1')
    expect(lastConsoleScreen('pty-1')).toBeNull()
    expect(cachedConsoleScreenCount()).toBe(0)
  })
})

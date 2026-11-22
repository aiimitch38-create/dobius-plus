import { subscribeToPtyExit } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import type { ConsoleScreen } from './console-output-tail'

// Why: the last real screen per console, kept across glance-card mounts so a
// live->glance switch never flashes blank (see use-console-output-tail.ts).
// Entries go when their PTY exits; the LRU cap bounds consoles that never do.
export const MAX_CACHED_CONSOLE_SCREENS = 64

type Entry = { screen: ConsoleScreen; offExit: () => void }
const screens = new Map<string, Entry>()

export function lastConsoleScreen(ptyId: string): ConsoleScreen | null {
  return screens.get(ptyId)?.screen ?? null
}

export function rememberConsoleScreen(ptyId: string, screen: ConsoleScreen): void {
  const prior = screens.get(ptyId)
  if (prior) {
    // Re-insert so Map order tracks recency.
    screens.delete(ptyId)
    screens.set(ptyId, { screen, offExit: prior.offExit })
    return
  }
  const offExit = subscribeToPtyExit(ptyId, () => forgetConsoleScreen(ptyId))
  screens.set(ptyId, { screen, offExit })
  while (screens.size > MAX_CACHED_CONSOLE_SCREENS) {
    const oldest = screens.keys().next().value as string
    forgetConsoleScreen(oldest)
  }
}

export function forgetConsoleScreen(ptyId: string): void {
  const entry = screens.get(ptyId)
  if (!entry) {
    return
  }
  screens.delete(ptyId)
  entry.offExit()
}

export function cachedConsoleScreenCount(): number {
  return screens.size
}

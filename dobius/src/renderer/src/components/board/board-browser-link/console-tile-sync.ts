// Mirrors the console ↔ web tile driver links into main (agents:syncConsoleTiles)
// so a console's agent id may act only in its own tile. Runs for the whole app
// session (App root, not the Board), so links pruned while the Board is closed
// (console removed, worktree gone, snapshot restored) still reach main.
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { BoardCard } from '@/store/slices/board'
import { consoleDriverAgentId, driverConsoleOf } from './browser-link'

export type ConsoleTileBinding = { agentId: string; tileId: string }

/** Every live link across boards: a tile whose driver console is on the same board. */
export function consoleTileBindings(
  boards: Record<string, { cards: readonly BoardCard[] }>
): ConsoleTileBinding[] {
  const out: ConsoleTileBinding[] = []
  for (const board of Object.values(boards)) {
    for (const card of board.cards) {
      if (card.kind !== 'web') {
        continue
      }
      const driver = driverConsoleOf(board.cards, card)
      if (driver) {
        out.push({ agentId: consoleDriverAgentId(driver.id), tileId: card.id })
      }
    }
  }
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.tileId.localeCompare(b.tileId))
}

let lastSyncedKey = ''

function sync(force: boolean): void {
  const bindings = consoleTileBindings(useAppStore.getState().boardsByWorktree)
  const key = JSON.stringify(bindings)
  if (!force && key === lastSyncedKey) {
    return
  }
  lastSyncedKey = key
  void window.api?.agents?.syncConsoleTiles?.({ bindings }).catch((error: unknown) => {
    // Why: retried on the next change; a failed sync leaves main's set unchanged (never wider).
    lastSyncedKey = ''
    console.warn('[browser-link] agents.syncConsoleTiles failed', error)
  })
}

/** Re-sends the set even when unchanged: main drops a tile's binding when its guest unregisters. */
export function resyncConsoleTiles(): void {
  sync(true)
}

export function installConsoleTileSync(): () => void {
  lastSyncedKey = ''
  sync(true)
  return useAppStore.subscribe((state, previous) => {
    if (state.boardsByWorktree !== previous.boardsByWorktree) {
      sync(false)
    }
  })
}

/** Mounted once at the App root. */
export function useConsoleTileSync(): void {
  useEffect(() => installConsoleTileSync(), [])
}

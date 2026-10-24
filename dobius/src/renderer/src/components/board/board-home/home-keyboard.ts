export type HomeKeyAction = 'up' | 'down' | 'open' | 'openFolder' | 'switch'

export type HomeKeyInput = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Maps a keydown to a Home action. The modifier is Cmd on Mac and Ctrl
 * elsewhere (STYLEGUIDE cross-platform rule); the other one must be up so
 * Ctrl+O on a Mac stays free for the system.
 */
export function resolveHomeKey(e: HomeKeyInput, isMac: boolean): HomeKeyAction | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  const noMods = !e.metaKey && !e.ctrlKey && !e.altKey
  if (noMods && !e.shiftKey) {
    if (e.key === 'ArrowUp') {
      return 'up'
    }
    if (e.key === 'ArrowDown') {
      return 'down'
    }
    if (e.key === 'Enter') {
      return 'open'
    }
    return null
  }
  if (!mod || e.altKey) {
    return null
  }
  const key = e.key.toLowerCase()
  if (key === 'o' && !e.shiftKey) {
    return 'openFolder'
  }
  if (key === 'l' && e.shiftKey) {
    return 'switch'
  }
  return null
}

/** Moves the selection by one row, clamped to the list (no wrap); -1 for an empty list. */
export function moveHomeSelection(index: number, delta: -1 | 1, count: number): number {
  if (count <= 0) {
    return -1
  }
  if (index < 0) {
    return delta > 0 ? 0 : count - 1
  }
  return Math.min(count - 1, Math.max(0, index + delta))
}

/** Keeps the selection on the same repo when rows reorder; falls back to the first row. */
export function reconcileHomeSelection(
  selectedRepoId: string | null,
  rowRepoIds: readonly string[]
): string | null {
  if (selectedRepoId && rowRepoIds.includes(selectedRepoId)) {
    return selectedRepoId
  }
  return rowRepoIds[0] ?? null
}

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAppStore } from '@/store'
import { getBoard, sanitizeBoardsByWorktree } from '@/store/slices/board'
import { mergeSnapshotBoard } from '@/store/slices/board-persistence'
import type { BoardSnapshotMeta } from '../../../../../shared/board-snapshot-types'

// "Restore a snapshot…": one dialog mounted on first use in its own root, so
// any Board entry point (canvas menu, planner) can open it with a worktree id.

let openFor: string | null = null
const listeners = new Set<() => void>()
let mounted = false

export function subscribeSnapshotRestore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function snapshotRestoreWorktree(): string | null {
  return openFor
}

function setOpenFor(worktreeId: string | null): void {
  openFor = worktreeId
  for (const listener of listeners) {
    listener()
  }
}

export function closeBoardSnapshotRestore(): void {
  setOpenFor(null)
}

export function openBoardSnapshotRestore(worktreeId: string): void {
  setOpenFor(worktreeId)
  if (mounted) {
    return
  }
  mounted = true
  void import('./BoardSnapshotRestoreDialog')
    .then(({ BoardSnapshotRestoreDialog }) => {
      const host = document.createElement('div')
      host.dataset.boardSnapshotRestoreHost = ''
      document.body.appendChild(host)
      createRoot(host).render(createElement(BoardSnapshotRestoreDialog))
    })
    .catch((error: unknown) => {
      mounted = false
      setOpenFor(null)
      console.error('[board-snapshots] restore dialog failed to load', error)
    })
}

/**
 * Restores `meta` into `worktreeId`'s board. The current board is saved as a
 * snapshot first, and the merge never closes or hides a live terminal.
 */
export async function restoreBoardSnapshot(
  worktreeId: string,
  meta: Pick<BoardSnapshotMeta, 'worktreeId' | 'id'>
): Promise<boolean> {
  const file = await window.api.boardSnapshots.read({ worktreeId: meta.worktreeId, id: meta.id })
  const snapshot = file ? sanitizeBoardsByWorktree({ restored: file.board }).restored : undefined
  if (!snapshot) {
    return false
  }
  await window.api.boardSnapshots.capture({ worktreeId, reason: 'manual' })
  useAppStore.setState((s) => ({
    boardsByWorktree: {
      ...s.boardsByWorktree,
      [worktreeId]: mergeSnapshotBoard(getBoard(s, worktreeId), snapshot)
    }
  }))
  return true
}

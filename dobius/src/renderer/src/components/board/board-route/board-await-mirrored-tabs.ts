import { useAppStore } from '@/store'
import type { NewBoardCard } from '@/store/slices/board'
import { pickMirroredTabs } from './board-mirrored-tabs'

const MIRROR_WAIT_MS = 60 * 1000

type PendingConsole = Omit<Extract<NewBoardCard, { kind: 'console' }>, 'tabId'>

/**
 * Binds host-backed launches to cards as their mirrored tabs arrive. Returns
 * nothing; calls `onUnbound(n)` if some tabs never appeared within the wait.
 */
export function awaitMirroredConsoleTabs(args: {
  worktreeId: string
  agent: string
  knownBefore: ReadonlySet<string>
  pending: PendingConsole[]
  onUnbound: (count: number) => void
}): void {
  const queue = [...args.pending]
  const bind = (): void => {
    const state = useAppStore.getState()
    const claimed = new Set(
      Object.values(state.boardsByWorktree).flatMap((b) =>
        b.cards.flatMap((c) => (c.kind === 'console' ? [c.tabId] : []))
      )
    )
    const ids = pickMirroredTabs(
      state.tabsByWorktree[args.worktreeId] ?? [],
      args.knownBefore,
      claimed,
      args.agent,
      queue.length
    )
    for (const tabId of ids) {
      const card = queue.shift()
      if (card) {
        state.addCard(args.worktreeId, { ...card, tabId })
      }
    }
  }
  bind()
  if (queue.length === 0) {
    return
  }
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.tabsByWorktree === prev.tabsByWorktree) {
      return
    }
    bind()
    if (queue.length === 0) {
      stop()
    }
  })
  const timer = setTimeout(() => {
    stop()
    if (queue.length > 0) {
      args.onUnbound(queue.length)
    }
  }, MIRROR_WAIT_MS)
  const stop = (): void => {
    unsubscribe()
    clearTimeout(timer)
  }
}

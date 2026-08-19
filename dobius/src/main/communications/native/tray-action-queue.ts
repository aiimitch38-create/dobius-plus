// Backs take_tray_actions / requeue_tray_actions.
//
// Buzz's macOS menu-bar item lets a user pick "New channel" or a recent
// channel while the app window isn't focused. The renderer polls this queue
// (take) and, if it was torn down mid-processing before it could act on what
// it took, hands the untouched actions back (requeue) so the next mount
// doesn't lose them. This module is the queue only — no Electron API surface
// — so it is fully pure and testable; `agent-activity-tray.ts` is what
// actually enqueues an action when a real tray menu item is clicked.

export type TrayAction = { kind: 'newChannel' } | { kind: 'openChannel'; channelId: string }

export type TrayActionQueue = {
  enqueue: (action: TrayAction) => void
  takeAll: () => TrayAction[]
  requeue: (actions: TrayAction[]) => void
  size: () => number
}

export function createTrayActionQueue(): TrayActionQueue {
  let queue: TrayAction[] = []

  return {
    enqueue(action) {
      queue.push(action)
    },
    takeAll() {
      const taken = queue
      queue = []
      return taken
    },
    // Why: requeued actions were already pending before the batch that took
    // them, so they must be replayed before anything enqueued since —
    // prepend, don't append.
    requeue(actions) {
      if (actions.length === 0) {
        return
      }
      queue = [...actions, ...queue]
    },
    size() {
      return queue.length
    }
  }
}

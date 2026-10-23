import {
  INITIAL_IDLE_WATCH,
  idleWatchDue,
  stepIdleWatch,
  type IdleWatch
} from '../../shared/automation-loops'

// Why: the Board view reports itself visible with a short lease per window, so
// a crashed or closed window can never leave loops "visible" forever.
export const BOARD_VISIBLE_LEASE_MS = 75_000

/**
 * Which worktrees' Boards are on screen right now, from the renderer's
 * heartbeats. Loops with "Keep running behind other tabs" off only fire while
 * their Board is visible; on-idle loops with it on are watched here while the
 * Board (and its renderer-side idle observer) is hidden.
 */
export class LoopBoardVisibility {
  private readonly leases = new Map<string, Map<string, number>>()
  private readonly idleWatches = new Map<string, IdleWatch>()

  report(worktreeId: string, senderId: string, visible: boolean, now: number): void {
    const byWindow = this.leases.get(worktreeId) ?? new Map<string, number>()
    if (visible) {
      byWindow.set(senderId, now + BOARD_VISIBLE_LEASE_MS)
    } else {
      byWindow.delete(senderId)
    }
    if (byWindow.size > 0) {
      this.leases.set(worktreeId, byWindow)
    } else {
      this.leases.delete(worktreeId)
    }
  }

  isVisible(worktreeId: string, now: number): boolean {
    const byWindow = this.leases.get(worktreeId)
    if (!byWindow) {
      return false
    }
    for (const [senderId, expiresAt] of byWindow) {
      if (expiresAt > now) {
        return true
      }
      byWindow.delete(senderId)
    }
    return false
  }

  /**
   * One main-side on-idle sample while the Board is hidden; true when the loop
   * should fire. Same arm/debounce rules as the renderer observer.
   */
  stepIdle(automationId: string, working: boolean, now: number, debounceMs: number): boolean {
    const next = stepIdleWatch(
      this.idleWatches.get(automationId) ?? INITIAL_IDLE_WATCH,
      working,
      now
    )
    if (idleWatchDue(next, now, debounceMs)) {
      this.idleWatches.set(automationId, INITIAL_IDLE_WATCH)
      return true
    }
    this.idleWatches.set(automationId, next)
    return false
  }

  /** The renderer observer owns on-idle while the Board is visible; forget main's watch. */
  resetIdle(automationId: string): void {
    this.idleWatches.delete(automationId)
  }
}

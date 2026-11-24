/* The kitchen manager's watch over running cooks (see kitchen.ts): finish,
 * waiting on Carson, one restart, then blocked. Only a cook's status and
 * last-output time are read; never its text. */

import type { VertexTask, VertexTaskKitchen, VertexTaskPatch } from '../../shared/vertex-task-types'
import { buildCookPrompt } from './kitchen-prompt'
import {
  KITCHEN_IDLE_PUMPS_TO_FINISH,
  KITCHEN_NEEDS_CARSON_AFTER_MS,
  KITCHEN_REASON_LIMIT,
  KITCHEN_STUCK_MS,
  type KitchenCookStatus,
  type KitchenDeps,
  type KitchenEvent
} from './kitchen-types'

type Watch = {
  /** When this attempt (or this session's watch of it) began. */
  since: number
  lastSeenAt: number
  /** Time spent waiting for Carson: never counted toward the cap. */
  waitedMs: number
  waitingSince: number | null
  toldWaiting: boolean
  idlePumps: number
}

/** The helpers kitchen.ts shares with the watch. */
export type KitchenTools = {
  now: () => number
  graceMs: number
  log: (message: string, error?: unknown) => void
  maxMinutes: () => number
  /** On, crew running and not quitting: a (re)start is allowed. */
  mayStart: () => boolean
  listTasks: () => VertexTask[] | null
  mark: (
    task: VertexTask,
    record: Omit<VertexTaskKitchen, 'markedAt' | 'updatedAt'>,
    extra?: VertexTaskPatch
  ) => VertexTask | null
  tell: (event: KitchenEvent, task: VertexTask) => void
}

export function createKitchenWatch(deps: KitchenDeps, tools: KitchenTools) {
  const { now, graceMs, log, maxMinutes, mayStart, listTasks, mark, tell } = tools
  const watches = new Map<string, Watch>()
  /** Cooks seen this session, so a deleted card's cook is still stopped. */
  const cooks = new Map<string, string>()

  /** False when the cook could not be stopped: it may still be running. */
  const stop = async (worktreeId: string | undefined): Promise<boolean> => {
    if (!worktreeId) {
      return true
    }
    try {
      await deps.stopCook(worktreeId)
      return true
    } catch (error) {
      log(`[kitchen] could not stop the cook in ${worktreeId}; it keeps its slot and is retried`, error)
      return false
    }
  }

  const forget = (taskId: string): void => {
    watches.delete(taskId)
    cooks.delete(taskId)
  }

  /** The card as it is now, if this cook still owns it. */
  const stillCooking = (task: VertexTask): VertexTask | null => {
    const fresh = listTasks()?.find((candidate) => candidate.id === task.id)
    return fresh?.status === 'in-progress' &&
      fresh.kitchen?.status === 'cooking' &&
      fresh.kitchen.worktreeId === task.kitchen?.worktreeId
      ? fresh
      : null
  }

  /** Stops the cook, parks the card in Blocked and tells ADAM. */
  const block = async (task: VertexTask, why: string): Promise<void> => {
    const reason = why.slice(0, KITCHEN_REASON_LIMIT)
    // Why the card is left as it is: a cook that may still run keeps its
    // slot, and every pump comes back here until the stop works.
    if (!(await stop(task.kitchen?.worktreeId))) {
      if (task.kitchen && task.kitchen.stopPending !== reason) {
        mark(task, { ...task.kitchen, stopPending: reason })
      }
      return
    }
    forget(task.id)
    if (mark(
        task,
        { ...task.kitchen, status: 'blocked', reason, stopPending: undefined },
        { status: 'blocked', blockedReason: reason }
      )
    ) {
      tell('blocked', task)
    }
  }

  const fail = async (task: VertexTask, why: string): Promise<void> => {
    const kitchen = task.kitchen
    const repo = deps.findRepos(task.projectId ?? '').find((candidate) => candidate.id === kitchen?.repoId)
    const attempt = kitchen?.attempt ?? 1
    // Why not while off or paused: a restart is a launch.
    if (!kitchen?.worktreeId || attempt >= 2 || !repo || !mayStart()) {
      await block(task, attempt >= 2 ? `${why} It was already restarted once.` : why)
      return
    }
    // Why written first: a crash mid-restart must never restart it again.
    const restarted = mark(task, {
      ...kitchen,
      attempt: attempt + 1,
      startedAt: now(),
      reason: `Restarted once. ${why}`.slice(0, KITCHEN_REASON_LIMIT)
    })
    if (!restarted) {
      return
    }
    watches.delete(task.id)
    try {
      await deps.restartCook({
        worktreeId: kitchen.worktreeId,
        prompt: buildCookPrompt(restarted, repo, true)
      })
    } catch (error) {
      log(`[kitchen] could not restart the cook for card ${task.id}`, error)
      await block(restarted, `${why} The restart failed.`)
    }
  }

  const watchOne = async (task: VertexTask): Promise<void> => {
    const worktreeId = task.kitchen?.worktreeId
    if (!worktreeId) {
      return
    }
    cooks.set(task.id, worktreeId)
    // Why: moving the card out of In Progress is Carson's stop for one cook.
    if (task.status !== 'in-progress') {
      // Why only once stopped: a cook that may still run keeps its slot.
      if (await stop(worktreeId)) {
        forget(task.id)
        mark(task, {
          ...task.kitchen,
          status: 'stopped',
          stopPending: undefined,
          reason: 'The card was moved out of In Progress, so its cook was stopped.'
        })
      }
      return
    }
    if (task.kitchen?.stopPending) {
      await block(task, task.kitchen.stopPending)
      return
    }
    let cook: KitchenCookStatus
    try {
      cook = await deps.cookStatus(worktreeId)
    } catch (error) {
      log(`[kitchen] could not check the cook in ${worktreeId}`, error)
      return
    }
    const at = now()
    const watch: Watch = watches.get(task.id) ?? {
      since: at,
      lastSeenAt: at,
      waitedMs: 0,
      waitingSince: null,
      toldWaiting: false,
      idlePumps: 0
    }
    watches.set(task.id, watch)
    const sinceLast = at - watch.lastSeenAt
    watch.lastSeenAt = at
    if (cook.state === 'permission') {
      watch.idlePumps = 0
      if (watch.waitingSince === null) {
        watch.waitingSince = at
      } else {
        watch.waitedMs += sinceLast
      }
      if (!watch.toldWaiting && at - watch.waitingSince >= KITCHEN_NEEDS_CARSON_AFTER_MS) {
        watch.toldWaiting = true
        tell('needs-carson', task)
      }
      return
    }
    watch.waitingSince = null
    watch.toldWaiting = false
    if (at - watch.since < graceMs) {
      return
    }
    if (cook.state === 'idle') {
      watch.idlePumps += 1
      const current = watch.idlePumps >= KITCHEN_IDLE_PUMPS_TO_FINISH ? stillCooking(task) : null
      if (current) {
        forget(task.id)
        // Why Review: Done is Carson's call.
        if (mark(current, { ...current.kitchen, status: 'review' }, { status: 'review' })) {
          tell('finished', current)
        }
      }
      return
    }
    watch.idlePumps = 0
    const cap = maxMinutes()
    const why =
      cook.state === 'gone'
        ? 'Its agent stopped running before it finished.'
        : at - watch.since - watch.waitedMs >= cap * 60_000
          ? `It hit the ${cap} minute time cap.`
          : cook.lastOutputAt !== null && at - cook.lastOutputAt >= KITCHEN_STUCK_MS
            ? `It showed no progress for ${Math.floor((at - cook.lastOutputAt) / 60_000)} minutes.`
            : null
    const current = why ? stillCooking(task) : null
    if (why && current) {
      await fail(current, why)
    }
  }

  /** Runs even while off or paused: stopping and finishing are always safe. */
  const watchCooks = async (): Promise<void> => {
    const tasks = listTasks()
    if (!tasks) {
      return
    }
    const ids = new Set(tasks.map((task) => task.id))
    for (const [taskId, worktreeId] of cooks) {
      // Why kept until stopped: a deleted card's cook still holds its slot.
      if (!ids.has(taskId) && (await stop(worktreeId))) {
        forget(taskId)
      }
    }
    for (const task of tasks) {
      if (task.kitchen?.status === 'cooking') {
        await watchOne(task)
      }
    }
  }

  const noteCook = (taskId: string, worktreeId: string): void => {
    cooks.set(taskId, worktreeId)
  }

  /** Cards whose cook may be running (deleted cards included): each holds a slot. */
  const cookIds = (): string[] => [...cooks.keys()]

  return { watchCooks, block, noteCook, cookIds }
}

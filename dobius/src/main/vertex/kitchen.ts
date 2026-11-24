/* The kitchen manager (build plan 7.15): plain code that runs the work loop
 * and never builds anything itself. No model is called here; ADAM stays the
 * brain and only hears what matters (finished, blocked, needs Carson).
 *
 * Tickets: only cards Carson marked for the kitchen (`task.kitchen`, created
 * by the operator IPC alone). Unmarked cards are never touched.
 *
 * Cook: a restricted Claude agent in its own git worktree and branch, the
 * same launch and profile as bug auto-fix (shared/bug-fix-agent-profile.ts).
 *
 * Limits: the setting is off unless Carson turns it on; at most
 * KITCHEN_MAX_COOKS at once; a per-card time cap; nothing new starts while the
 * crew is paused or the setting is off. Every decision is written to the card
 * before anything starts, so a restart or a second pump never starts a second
 * cook for one card and never restarts a cook twice.
 *
 * Watch: a cook past its cap, gone, or showing no progress is restarted once.
 * The second failure stops it, moves the card to Blocked and tells ADAM. Time
 * spent waiting for Carson's click in the console is not counted and is never
 * "stuck". A cook that finishes moves its card to Review, never Done.
 *
 * Only a cook's status and last-output time are read; never its text. */

import type {
  VertexTask,
  VertexTaskKitchen,
  VertexTaskPatch
} from '../../shared/vertex-task-types'
import type { BugAutoFixRepo, BugAutoFixWorktree } from './bug-autofix'
import { buildCookPrompt, cookWorktreeName } from './kitchen-prompt'
import {
  KITCHEN_DEFAULT_MAX_MINUTES,
  KITCHEN_GRACE_MS,
  KITCHEN_MAX_COOKS,
  KITCHEN_PUMP_MS,
  KITCHEN_REASON_LIMIT,
  type KitchenDeps,
  type KitchenEvent,
  type KitchenStatus
} from './kitchen-types'
import { createKitchenWatch } from './kitchen-watch'

export * from './kitchen-types'
export { buildCookPrompt, kitchenMarkPatch } from './kitchen-prompt'

/** Starts awaiting their workspace, by card id (module-wide, see bug-autofix.ts). */
const pending = new Set<string>()

/** Test seam. */
export function resetKitchenPendingForTest(): void {
  pending.clear()
}

export function createKitchen(deps: KitchenDeps) {
  const now = deps.now ?? Date.now
  const graceMs = deps.graceMs ?? KITCHEN_GRACE_MS
  const log = deps.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''))
  let pumping = false
  let disposed = false
  const maxMinutes = (): number => {
    const minutes = Math.floor(deps.maxMinutes())
    return Number.isFinite(minutes) && minutes >= 1 ? minutes : KITCHEN_DEFAULT_MAX_MINUTES
  }
  const mayStart = (): boolean => !disposed && deps.isEnabled() && deps.admission().allowed

  const listTasks = (): VertexTask[] | null => {
    try {
      return deps.listTasks()
    } catch (error) {
      log('[kitchen] could not read the Kanban', error)
      return null
    }
  }

  const mark = (
    task: VertexTask,
    record: Omit<VertexTaskKitchen, 'markedAt' | 'updatedAt'>,
    extra: VertexTaskPatch = {}
  ): VertexTask | null => {
    try {
      return deps.updateTask(task.id, {
        ...extra,
        kitchen: { markedAt: task.kitchen?.markedAt ?? now(), ...record, updatedAt: now() }
      })
    } catch (error) {
      log(`[kitchen] could not update card ${task.id}`, error)
      return null
    }
  }

  const tell = (event: KitchenEvent, task: VertexTask): void => {
    try {
      deps.tellAdam({ event, taskId: task.id, title: task.title, at: now() })
    } catch (error) {
      log(`[kitchen] could not tell ADAM about card ${task.id}`, error)
    }
  }

  const { watchCooks, block, noteCook } = createKitchenWatch(deps, {
    now,
    graceMs,
    log,
    maxMinutes,
    mayStart,
    listTasks,
    mark,
    tell
  })

  const start = async (task: VertexTask, repo: BugAutoFixRepo): Promise<void> => {
    const worktreeName = cookWorktreeName(task)
    // Why claim first: In Progress keeps a lead from also claiming the card,
    // and 'starting' on disk means a crash can never start it twice.
    const claimed = mark(
      task,
      { status: 'starting', repoId: repo.id, worktreeName, attempt: 1 },
      { status: 'in-progress' }
    )
    if (!claimed) {
      return
    }
    pending.add(task.id)
    try {
      const created = await deps.createWorktree({
        repoId: repo.id,
        name: worktreeName,
        prompt: buildCookPrompt(claimed, repo),
        comment: `Kitchen cook for Kanban card: ${task.title}`.slice(0, 200)
      })
      noteCook(task.id, created.worktreeId)
      mark(claimed, {
        ...claimed.kitchen,
        status: 'cooking',
        worktreeId: created.worktreeId,
        worktreePath: created.worktreePath,
        branch: created.branch,
        startedAt: now(),
        reason: created.warning
      })
    } catch (error) {
      log(`[kitchen] could not start a cook for card ${task.id}`, error)
      const message = error instanceof Error ? error.message : String(error)
      await block(claimed, `The cook could not be started: ${message}`)
    } finally {
      pending.delete(task.id)
    }
  }

  /** Why a marked card cannot be cooked at all, or the one repo to cook it in. */
  const repoFor = (task: VertexTask): BugAutoFixRepo | string => {
    const unsupported = deps.unsupportedReason?.() ?? null
    if (unsupported) {
      return unsupported
    }
    if (task.autoFix) {
      return 'Bug auto-fix already has this card.'
    }
    if (!task.projectId) {
      return 'The card has no project, so there is no repo to cook it in.'
    }
    const repos = deps.findRepos(task.projectId)
    return repos.length === 1
      ? repos[0]
      : repos.length === 0
        ? `No repo in Dobius+ belongs to project "${task.projectId}".`
        : `More than one repo belongs to project "${task.projectId}".`
  }

  const dispatch = (): Promise<void>[] => {
    const tasks = mayStart() ? listTasks() : null
    if (!tasks) {
      return []
    }
    const busy = new Set<string>(pending)
    for (const task of tasks) {
      if (task.kitchen?.status === 'starting' || task.kitchen?.status === 'cooking') {
        busy.add(task.id)
      }
    }
    const marked = tasks
      .filter((task) => task.kitchen?.status === 'marked')
      .sort((a, b) => (a.kitchen?.markedAt ?? 0) - (b.kitchen?.markedAt ?? 0))
    const started: Promise<void>[] = []
    for (const task of marked) {
      if (busy.size >= KITCHEN_MAX_COOKS) {
        break
      }
      // Why skipped, not failed: Carson or a lead holds it; it cooks if it comes back.
      if (
        (task.status !== 'backlog' && task.status !== 'todo') ||
        task.lease ||
        task.assignee?.kind === 'agent'
      ) {
        continue
      }
      const repo = repoFor(task)
      if (typeof repo === 'string') {
        mark(task, { status: 'failed', reason: repo.slice(0, KITCHEN_REASON_LIMIT) })
        continue
      }
      busy.add(task.id)
      started.push(start(task, repo))
    }
    return started
  }

  /** A 'starting' with no live start behind it (the last session died
   *  mid-start): a found workspace becomes 'cooking' (the watch restarts it
   *  once if no agent runs there), an absent one is blocked, and an
   *  unavailable lookup is left for the next pump. */
  const reconcileInterrupted = async (): Promise<void> => {
    for (const task of listTasks() ?? []) {
      const kitchen = task.kitchen
      if (kitchen?.status !== 'starting' || pending.has(task.id)) {
        continue
      }
      let found: BugAutoFixWorktree | null | 'unknown' = null
      try {
        found =
          kitchen.repoId && kitchen.worktreeName
            ? await deps.findWorktree(kitchen.repoId, kitchen.worktreeName)
            : null
      } catch (error) {
        log(`[kitchen] could not look for ${kitchen.worktreeName}`, error)
        found = 'unknown'
      }
      if (found === 'unknown' || pending.has(task.id)) {
        continue
      }
      if (found) {
        mark(task, {
          ...kitchen,
          status: 'cooking',
          worktreeId: found.worktreeId,
          worktreePath: found.worktreePath,
          branch: found.branch,
          startedAt: now()
        })
      } else {
        await block(task, 'Dobius+ closed before this cook started. No workspace was created.')
      }
    }
  }

  const pump = async (): Promise<void> => {
    if (disposed || pumping) {
      return
    }
    pumping = true
    let started: Promise<void>[] = []
    try {
      await reconcileInterrupted()
      await watchCooks()
      // Why checked last: a pause or the stop switch during the awaits above wins.
      started = dispatch()
    } finally {
      pumping = false
    }
    await Promise.all(started)
  }

  const status = (): KitchenStatus => {
    const tasks = listTasks() ?? []
    const count = (...statuses: VertexTaskKitchen['status'][]): number =>
      tasks.filter((task) => task.kitchen && statuses.includes(task.kitchen.status)).length
    return {
      enabled: deps.isEnabled(),
      crewRunning: deps.admission().allowed,
      cooking: count('starting', 'cooking'),
      waiting: count('marked'),
      maxCooks: KITCHEN_MAX_COOKS,
      maxMinutes: maxMinutes()
    }
  }

  const dispose = (): void => {
    disposed = true
  }

  return { pump, status, dispose }
}

export type Kitchen = ReturnType<typeof createKitchen>

let active: Kitchen | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** Installs the app-wide kitchen and starts its pump; later calls only swap deps. */
export function configureKitchen(deps: KitchenDeps): void {
  active?.dispose()
  active = createKitchen(deps)
  if (!timer) {
    timer = setInterval(() => void active?.pump(), KITCHEN_PUMP_MS)
    timer.unref?.()
  }
}

/** App quit: no new pump, no new start (see blockExecutionOrigin). */
export function disposeKitchen(): void {
  active?.dispose()
  active = null
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Carson marked a card: look now instead of at the next pump. */
export function pumpKitchenSoon(): void {
  void active?.pump()
}

/** Null until configureKitchen ran. */
export function kitchenStatus(): KitchenStatus | null {
  return active?.status() ?? null
}

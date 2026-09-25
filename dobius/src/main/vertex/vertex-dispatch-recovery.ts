/* Recovery for Kanban dispatch claims (#94). The renderer claims a card
 * ('running') before launching a paid run and settles it afterwards; a crash
 * in between leaves the claim behind. The store stamps each claim with the
 * main process that holds it so a later read can tell a dead claim from a
 * live one. */

import { randomUUID } from 'node:crypto'

import {
  VERTEX_DISPATCH_MAX_ATTEMPTS,
  type VertexTask,
  type VertexTaskDispatch,
  type VertexTaskPatch,
} from '../../shared/vertex-task-types'
import type { AgentRun } from '../../shared/agents'
import { getStoredAgentRun, listStoredAgentRuns } from '../agents/agent-runs-store'
import { isPidAlive } from '../lib/is-pid-alive'

const INTERRUPTED = 'Interrupted: Dobius stopped before this run finished.'
const LOST = 'Interrupted: the window that started this run reloaded or lost track of it.'

/* Why 6 hours: a board run is capped by budget ($3) and turns (30), not by
 * time, and no such run is expected to take more than an hour or two. A
 * claim this old held by another pid is far more likely a crashed instance
 * whose pid the OS gave to an unrelated process than a run still going. */
export const CLAIM_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Which window is asking, and which claims its dispatcher is still awaiting. */
export type DispatcherClaimCheck = {
  webContentsId: number
  activeTaskIds: ReadonlySet<string>
  isWebContentsLive: (id: number) => boolean
}

// Why the session id: it tells this process apart from an earlier one that
// crashed and whose pid the OS has since handed back to us.
const PROCESS_OWNER = { pid: process.pid, sessionId: randomUUID() }

/** A 'running' claim whose main process is gone. Dev instances share
 *  userData with no single-instance lock, so a live other process's claim is
 *  left alone. Claims with no owner predate owner stamping and are treated as
 *  orphaned, as are claims of an earlier process that had this same pid. */
function isOrphanedClaim(dispatch: VertexTaskDispatch): boolean {
  if (dispatch.status !== 'running') {
    return false
  }
  const pid = dispatch.ownerPid
  if (pid === PROCESS_OWNER.pid) {
    return dispatch.ownerSessionId !== PROCESS_OWNER.sessionId
  }
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return true
  }
  return !isPidAlive(pid) || !(Date.now() - dispatch.updatedAt < CLAIM_MAX_AGE_MS)
}

/* The board run executes in main (agent.run), so it outlives a reloaded or
 * closed window. For a lost claim: while its run is still going, keep the
 * card running (ending it would invite a second paid run); once the run has
 * settled, end the card with the run's real outcome. The run is found by the
 * id stamped at launch; a claim lost before that stamp landed is kept while
 * any run of its agent started since the claim is still going. Only this
 * process's runs are trusted: the runs store is per process. */
function lostClaimEnd(dispatch: VertexTaskDispatch): string | AgentRun | null {
  const run = dispatch.runId ? getStoredAgentRun(dispatch.runId) : null
  if (run) {
    return run.status === 'running' ? null : run
  }
  const busy = listStoredAgentRuns().some(
    (candidate) =>
      candidate.status === 'running' &&
      candidate.agentId === dispatch.agentId &&
      candidate.startedAt >= dispatch.updatedAt,
  )
  return busy ? null : LOST
}

/* Claims of THIS process whose renderer promise is gone: the window's
 * dispatcher no longer awaits the task (the window reloaded, so its in-flight
 * set started empty, or the settle write failed), or the window that claimed
 * it is gone. Only the process's own claims: another process's are
 * isOrphanedClaim's job. */
function isLostDispatcherClaim(
  task: VertexTask,
  dispatch: VertexTaskDispatch,
  check: DispatcherClaimCheck,
): boolean {
  if (
    dispatch.status !== 'running' ||
    dispatch.ownerPid !== PROCESS_OWNER.pid ||
    dispatch.ownerSessionId !== PROCESS_OWNER.sessionId ||
    typeof dispatch.ownerWebContentsId !== 'number'
  ) {
    return false
  }
  if (dispatch.ownerWebContentsId !== check.webContentsId) {
    return !check.isWebContentsLive(dispatch.ownerWebContentsId)
  }
  return !check.activeTaskIds.has(task.id)
}

function withoutOwner(dispatch: VertexTaskDispatch): VertexTaskDispatch {
  const next = { ...dispatch }
  delete next.ownerPid
  delete next.ownerSessionId
  delete next.ownerWebContentsId
  return next
}

/** Window whose IPC update is being applied; see withClaimingWindow. */
let claimingWebContentsId: number | undefined
/** Window asking for its lost claims to be ended; see withLostClaimCheck. */
let lostClaimCheck: DispatcherClaimCheck | undefined

/** Run a store update on behalf of a renderer window, so a claim it makes
 *  records that window. Synchronous, so no other update can interleave. */
export function withClaimingWindow<T>(webContentsId: number, update: () => T): T {
  claimingWebContentsId = webContentsId
  try {
    return update()
  } finally {
    claimingWebContentsId = undefined
  }
}

/** Run a store read that also ends this process's claims the asking window's
 *  dispatcher has lost. Synchronous, like withClaimingWindow. */
export function withLostClaimCheck<T>(check: DispatcherClaimCheck, read: () => T): T {
  lostClaimCheck = check
  try {
    return read()
  } finally {
    lostClaimCheck = undefined
  }
}

/** Only main stamps ownership: whatever the renderer sent is replaced. The
 *  window is unset for in-process callers. */
export function stampClaimOwner(patch: VertexTaskPatch): void {
  if (!patch.dispatch) {
    return
  }
  const next = withoutOwner(patch.dispatch)
  patch.dispatch =
    next.status === 'running'
      ? {
          ...next,
          ownerPid: PROCESS_OWNER.pid,
          ownerSessionId: PROCESS_OWNER.sessionId,
          ownerWebContentsId: claimingWebContentsId,
        }
      : next
}

/* A crash between claim and settle leaves the card "Agent is working" forever,
 * and the dispatcher only picks up failed cards. End such a claim exactly the
 * way a failed run ends: failed (or dead once the attempts are spent) and out
 * of To Do, so only an operator move re-dispatches it. Never relaunches. */
function releaseClaims(
  tasks: VertexTask[],
  orderGap: number,
  endFor: (task: VertexTask, dispatch: VertexTaskDispatch) => string | AgentRun | null,
): boolean {
  const now = Date.now()
  const moveTo = (task: VertexTask, status: VertexTask['status']): void => {
    const column = tasks.filter((t) => t.status === status).map((t) => t.order)
    task.order = Math.max(0, ...column) + orderGap
    task.status = status
  }
  let changed = false
  for (const task of tasks) {
    const end = task.dispatch ? endFor(task, task.dispatch) : null
    if (!task.dispatch || !end) {
      continue
    }
    const owned = withoutOwner(task.dispatch)
    if (typeof end !== 'string' && end.status === 'success') {
      // Same record the dispatcher writes on success. Review, never Done.
      task.dispatch = {
        ...owned,
        status: 'succeeded',
        report: (end.summary ?? '').slice(0, 4000),
        costUsd: end.costUsd ?? null,
        updatedAt: now,
      }
      moveTo(task, 'review')
    } else {
      const reason =
        typeof end === 'string'
          ? end
          : `The run ended (${end.status}): ${end.summary ?? ''}`.slice(0, 240).trim()
      const spent = task.dispatch.attempts >= VERTEX_DISPATCH_MAX_ATTEMPTS
      task.dispatch = {
        ...owned,
        status: spent ? 'dead' : 'failed',
        error: spent ? `${reason} No attempts left.` : `${reason} Move to To Do to retry.`,
        updatedAt: now,
      }
      if (task.status === 'todo') {
        moveTo(task, 'in-progress')
      }
    }
    task.updatedAt = now
    changed = true
  }
  return changed
}

/** The store's read with orphaned claims released and saved first. Inside
 *  withLostClaimCheck, also this process's claims that window has lost. */
export function readReleasingOrphanedClaims(
  read: () => VertexTask[],
  save: (tasks: VertexTask[]) => void,
  orderGap: number,
): VertexTask[] {
  const check = lostClaimCheck
  const tasks = read()
  const released = releaseClaims(tasks, orderGap, (task, dispatch) => {
    if (isOrphanedClaim(dispatch)) {
      return INTERRUPTED
    }
    return check && isLostDispatcherClaim(task, dispatch, check) ? lostClaimEnd(dispatch) : null
  })
  if (!released) {
    return tasks
  }
  try {
    save(tasks)
    return tasks
  } catch (error) {
    // Why: a failed recovery write must not hide the board. Show what is on
    // disk (save dropped the cache); the next read tries the release again.
    console.warn('[vertex] could not release interrupted board claims:', error)
    return read()
  }
}

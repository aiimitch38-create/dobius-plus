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
import { isPidAlive } from '../runtime/process-liveness'

const INTERRUPTED = 'Interrupted: Dobius stopped before this run finished.'

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
  return !isPidAlive(pid)
}

function withoutOwner(dispatch: VertexTaskDispatch): VertexTaskDispatch {
  const next = { ...dispatch }
  delete next.ownerPid
  delete next.ownerSessionId
  return next
}

/** Only the store stamps ownership: whatever the renderer sent is replaced. */
export function stampClaimOwner(patch: VertexTaskPatch): void {
  if (!patch.dispatch) {
    return
  }
  const next = withoutOwner(patch.dispatch)
  patch.dispatch =
    next.status === 'running'
      ? { ...next, ownerPid: PROCESS_OWNER.pid, ownerSessionId: PROCESS_OWNER.sessionId }
      : next
}

/* A crash between claim and settle leaves the card "Agent is working" forever,
 * and the dispatcher only picks up failed cards. End such a claim exactly the
 * way a failed run ends: failed (or dead once the attempts are spent) and out
 * of To Do, so only an operator move re-dispatches it. Never relaunches. */
function releaseOrphanedClaims(tasks: VertexTask[], orderGap: number): boolean {
  const now = Date.now()
  let changed = false
  for (const task of tasks) {
    if (!task.dispatch || !isOrphanedClaim(task.dispatch)) {
      continue
    }
    const spent = task.dispatch.attempts >= VERTEX_DISPATCH_MAX_ATTEMPTS
    task.dispatch = {
      ...withoutOwner(task.dispatch),
      status: spent ? 'dead' : 'failed',
      error: spent ? `${INTERRUPTED} No attempts left.` : `${INTERRUPTED} Move to To Do to retry.`,
      updatedAt: now,
    }
    if (task.status === 'todo') {
      const column = tasks.filter((t) => t.status === 'in-progress').map((t) => t.order)
      task.order = Math.max(0, ...column) + orderGap
      task.status = 'in-progress'
    }
    task.updatedAt = now
    changed = true
  }
  return changed
}

/** The store's read with orphaned claims released and saved first. */
export function readReleasingOrphanedClaims(
  read: () => VertexTask[],
  save: (tasks: VertexTask[]) => void,
  orderGap: number,
): VertexTask[] {
  const tasks = read()
  if (!releaseOrphanedClaims(tasks, orderGap)) {
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

import {
  WorkerStartPermit,
  type QueuePort,
  type WorkerJob,
  type WorkerLease,
  type WorkerStartBinding
} from '../../../shared/workstation-worker'
import { resolveExecution, type WorkerRegistry } from './registry'

export async function authorizeExecution(args: {
  queue: QueuePort
  lease: WorkerLease
  job: WorkerJob
  registry: WorkerRegistry
  expectedExecution: ReturnType<typeof resolveExecution>
  now: () => number
}) {
  const { queue, lease, job, registry, expectedExecution, now } = args
  const binding: WorkerStartBinding = {
    attemptId: job.attemptId,
    workerId: lease.workerId,
    deviceId: job.deviceId,
    profileId: job.profileId,
    rootId: job.rootId,
    worktreeId: job.worktreeId,
    recipeId: job.recipeId,
    sourceRevision: job.sourceRevision,
    caps: job.caps
  }
  const permit = WorkerStartPermit.parse(await queue.authorizeStart(lease, binding))
  if (
    permit.attemptId !== binding.attemptId ||
    permit.workerId !== binding.workerId ||
    permit.deviceId !== binding.deviceId ||
    permit.profileId !== binding.profileId ||
    permit.rootId !== binding.rootId ||
    permit.worktreeId !== binding.worktreeId ||
    permit.recipeId !== binding.recipeId ||
    permit.sourceRevision !== binding.sourceRevision ||
    JSON.stringify(permit.caps) !== JSON.stringify(binding.caps) ||
    permit.expiresAt > lease.expiresAt ||
    permit.expiresAt <= now()
  ) {
    throw new Error('Authenticated start permit does not match this attempt or is expired.')
  }

  const execution = resolveExecution(registry, job)
  if (
    execution.root !== expectedExecution.root ||
    execution.worktree !== expectedExecution.worktree ||
    JSON.stringify(execution.identity) !== JSON.stringify(expectedExecution.identity)
  ) {
    throw new Error(
      'Enrolled root, worktree or profile-home identity changed during authorization.'
    )
  }
  return {
    permit,
    execution,
    recheck: () => {
      const current = resolveExecution(registry, job)
      if (
        permit.expiresAt <= now() ||
        current.root !== execution.root ||
        current.worktree !== execution.worktree ||
        current.recipe.executable !== execution.recipe.executable ||
        current.recipe.hermesProfileId !== execution.recipe.hermesProfileId ||
        current.profileHome !== execution.profileHome ||
        JSON.stringify(current.identity) !== JSON.stringify(execution.identity) ||
        JSON.stringify(current.argv) !== JSON.stringify(execution.argv)
      ) {
        throw new Error(
          'Start permit expired or enrolled execution identity changed before launch.'
        )
      }
      return current
    }
  }
}

import {
  CloudWorkerProcessIdentity,
  CloudWorkerStartBinding
} from '../../../shared/cloud-worker-enrollment'
import { WorkerStartPermit } from '../../../shared/workstation-worker'
import type { CloudJob } from '../../../shared/cloud-jobs'
import { createHash } from 'node:crypto'
import type { CloudWorkerLedgerContext } from './cloud-worker-start-ledger'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function getWorkerAttemptJob(
  context: CloudWorkerLedgerContext,
  args: { attemptId: string; workerId: string; token: string }
): CloudJob {
  return context.lease(args.attemptId, args.workerId, args.token)
}

export function getWorkerPermit(
  context: CloudWorkerLedgerContext,
  args: { attemptId: string; workerId: string; token: string }
) {
  const attempt = context.db.prepare('SELECT * FROM cloud_attempts WHERE id=?').get(args.attemptId)
  const row = context.db
    .prepare('SELECT * FROM cloud_worker_permits WHERE attempt_id=?')
    .get(args.attemptId)
  if (
    !attempt ||
    attempt.worker !== args.workerId ||
    attempt.lease_hash !== hash(args.token) ||
    !row ||
    row.worker !== args.workerId
  ) {
    throw new Error('Worker permit is unavailable for this authenticated lease.')
  }
  return WorkerStartPermit.parse({
    ...CloudWorkerStartBinding.parse(JSON.parse(String(row.binding_json))),
    permitId: row.permit_id,
    expiresAt: Number(row.expires_at)
  })
}

export function getWorkerStartRecord(
  context: CloudWorkerLedgerContext,
  attemptId: string,
  workerId: string,
  token: string
) {
  const attempt = context.db.prepare('SELECT * FROM cloud_attempts WHERE id=?').get(attemptId)
  const permit = context.db
    .prepare('SELECT * FROM cloud_worker_permits WHERE attempt_id=?')
    .get(attemptId)
  const started = context.db
    .prepare('SELECT * FROM cloud_worker_starts WHERE attempt_id=?')
    .get(attemptId)
  if (
    !attempt ||
    attempt.worker !== workerId ||
    attempt.lease_hash !== hash(token) ||
    !permit ||
    !started
  ) {
    throw new Error('Worker start receipt is unavailable for this authenticated lease.')
  }
  return {
    binding: CloudWorkerStartBinding.parse(JSON.parse(String(permit.binding_json))),
    bindingHash: String(permit.binding_hash),
    identity: CloudWorkerProcessIdentity.parse({
      pid: Number(started.pid),
      processStart: String(started.process_start),
      processGroupId: Number(started.process_group_id),
      bootId: String(started.boot_id),
      incarnation: String(started.incarnation)
    })
  }
}

export function projectRootIsFresh(
  context: CloudWorkerLedgerContext,
  projectId: string,
  deviceId: string
): boolean {
  const project = context.project(projectId)
  return project.deviceId === deviceId && context.projectRootStillTrusted(project)
}

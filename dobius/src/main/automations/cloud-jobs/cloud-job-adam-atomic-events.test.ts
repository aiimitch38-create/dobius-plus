import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CloudJobInput } from '../../../shared/cloud-jobs'
import { canonicalCloudJobAdamSha256 } from '../../../shared/cloud-job-adam-receipts'
import { CloudJobStore } from './store'
import { admitCloudJobSubmission } from '../cloud-job-submit-admission'

let directory: string
let store: CloudJobStore
const input = CloudJobInput.parse({
  requestKey: 'request-1',
  taskId: 'task',
  projectId: 'project',
  workspaceId: 'workspace',
  targetDeviceId: 'device',
  recipeId: 'verify',
  title: 'Synthetic job',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes: 0,
  dependencies: []
})
function binding(request = input) {
  const identity = {
    schemaVersion: 1 as const,
    bindingId: randomUUID(),
    adamInstanceId: 'adam',
    parentObjectiveId: 'parent',
    parentObjectiveVersion: 1,
    projectId: input.projectId,
    contextDigest: 'c'.repeat(64),
    requestFingerprint: canonicalCloudJobAdamSha256(request),
    expiresAtMs: 2000
  }
  return {
    schemaVersion: 1 as const,
    consumed: true as const,
    binding: identity,
    boundAtMs: 900,
    bindingDigest: canonicalCloudJobAdamSha256(identity)
  }
}
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-adam-atomic-')))
  store = new CloudJobStore(join(directory, 'jobs.sqlite'), () => 1000, { localDeviceId: 'device' })
  store.registerProject({
    id: 'project',
    deviceId: 'device',
    root: directory,
    recipes: ['verify'],
    capability: 'macos'
  })
})
afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('ADAM child event transaction composition', () => {
  it('commits job, exact parent link and submitted receipt together; replay adds nothing', () => {
    const parent = binding()
    const job = store.submitAdamBound(input, 'phone', parent)
    expect(store.submitAdamBound(input, 'phone', parent)).toEqual(job)
    const rows = store.db.prepare('SELECT payload_json FROM cloud_job_adam_receipt_outbox').all()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(String(rows[0].payload_json)).receipt).toMatchObject({
      cloudJobId: job.id,
      eventKind: 'submitted',
      cloudJobVersion: 1,
      cloudEventSequence: store.events()[0].sequence,
      attemptId: null,
      evidenceDigests: []
    })
    const cancelled = store.cancel(job.id, job.version)
    expect(cancelled.state).toBe('cancelled')
    expect(store.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(2)
  })

  it('rolls back the job, parent link and event if receipt persistence fails', () => {
    store.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON cloud_job_adam_receipt_outbox BEGIN SELECT RAISE(ABORT, 'synthetic write refusal'); END"
    )
    expect(() => store.submitAdamBound(input, 'phone', binding())).toThrow(
      'synthetic write refusal'
    )
    for (const table of [
      'cloud_jobs',
      'cloud_job_adam_bindings',
      'cloud_events',
      'cloud_job_adam_receipt_outbox'
    ]) {
      expect(store.db.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(0)
    }
  })

  it('rolls back cancellation if its receipt fails and preserves the original submitted receipt', () => {
    const job = store.submitAdamBound(input, 'phone', binding())
    store.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON cloud_job_adam_receipt_outbox BEGIN SELECT RAISE(ABORT, 'synthetic write refusal'); END"
    )
    expect(() => store.cancel(job.id, job.version)).toThrow('synthetic write refusal')
    expect(store.get(job.id)).toEqual(job)
    expect(store.events()).toHaveLength(1)
    expect(store.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(1)
  })

  it('refuses late attachment and duplicate use of one binding for another child', () => {
    store.submit(input, 'unbound')
    expect(() => store.submitAdamBound(input, 'unbound', binding())).toThrow('existing unbound')
    const parent = binding()
    const bound = store.submitAdamBound(input, 'phone', parent)
    expect(() => store.submitAdamBound(input, 'other-creator', parent)).toThrow('conflicts')
    expect(store.list()).toHaveLength(2)
    expect(store.get(bound.id).version).toBe(1)
  })

  it('checks workspace permission before consuming a grant and refuses unsupported parents', async () => {
    let calls = 0
    const authority = {
      readStore: () => store,
      canUseWorkspace: async () => false,
      adamClient: {
        consumeBinding: async () => {
          calls++
          return { state: 'accepted' as const, value: binding() }
        }
      }
    }
    await expect(
      admitCloudJobSubmission(authority, { kind: 'paired', id: 'phone' }, input, {})
    ).rejects.toThrow('access denied')
    expect(calls).toBe(0)
    await expect(
      admitCloudJobSubmission(
        {
          ...authority,
          canUseWorkspace: async () => true,
          adamClient: {
            consumeBinding: async () => ({
              state: 'unavailable' as const,
              reason: 'unsupported' as const
            })
          }
        },
        { kind: 'paired', id: 'phone' },
        input,
        {}
      )
    ).rejects.toThrow('unavailable')
    expect(store.list()).toHaveLength(0)
  })

  it('normalizes dependencies before the authenticated grant fingerprint and atomic submission', async () => {
    const a = store.submit({ ...input, requestKey: 'dependency-a' }, 'phone')
    const b = store.submit({ ...input, requestKey: 'dependency-b' }, 'phone')
    const expected = { ...input, dependencies: [a.id, b.id].sort() }
    const job = await admitCloudJobSubmission(
      {
        readStore: () => store,
        canUseWorkspace: async () => true,
        adamClient: {
          consumeBinding: async (_grant, received) => {
            expect(received).toEqual(expected)
            return { state: 'accepted', value: binding(expected) }
          }
        }
      },
      { kind: 'paired', id: 'phone' },
      { ...input, dependencies: [b.id, a.id, b.id] },
      {}
    )
    expect(job.dependencies).toEqual(expected.dependencies)
  })

  it('refuses local persistence when authority is revoked during remote consumption', async () => {
    let enabled = true
    await expect(
      admitCloudJobSubmission(
        {
          readStore: () => {
            if (!enabled) {
              throw new Error('revoked')
            }
            return store
          },
          canUseWorkspace: async () => true,
          adamClient: {
            consumeBinding: async () => {
              queueMicrotask(() => {
                enabled = false
              })
              return { state: 'accepted', value: binding() }
            }
          }
        },
        { kind: 'paired', id: 'phone' },
        input,
        {}
      )
    ).rejects.toThrow('revoked')
    expect(store.list()).toHaveLength(0)
    expect(store.events()).toHaveLength(0)
  })
})

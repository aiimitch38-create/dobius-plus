import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudJobAuthority } from './cloud-job-authority'
import type { CloudJobStore } from './cloud-jobs/store'
import { randomUUID } from 'node:crypto'
import { canonicalCloudJobAdamSha256 } from '../../shared/cloud-job-adam-receipts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((close) => close()))
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-authority-')))
  const base = join(root, 'cloud-workstation')
  mkdirSync(base, { mode: 0o700 })
  const config = {
    schemaVersion: 1,
    enabled: true,
    adamReceiptBridgeEnabled: false,
    deviceId: 'vps',
    projects: [{ id: 'project', deviceId: 'vps', root, recipes: ['test'], capability: 'linux' }],
    workspaceAccess: [{ workspaceId: 'workspace', projectId: 'project', deviceIds: ['phone'] }]
  }
  const save = () =>
    writeFileSync(join(base, 'authority.json'), JSON.stringify(config), { mode: 0o600 })
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const input = {
    requestKey: 'r',
    taskId: 'task',
    projectId: 'project',
    workspaceId: 'workspace',
    targetDeviceId: 'vps',
    recipeId: 'test',
    title: 'Job',
    sourceRevision: 'a'.repeat(40),
    estimatedBytes: 1,
    dependencies: []
  }
  return { root, base, config, save, input }
}
describe('cloud jobs explicit authority startup', () => {
  it('never creates a second queue on a desktop or unconfigured host', () => {
    const f = fixture()
    expect(createCloudJobAuthority(f.root, true)).toBeUndefined()
    f.save()
    expect(createCloudJobAuthority(f.root, false)).toBeUndefined()
    expect(existsSync(join(f.base, 'jobs.sqlite'))).toBe(false)
  })

  it('shares one durable paused queue and rechecks revoked device/workspace configuration', async () => {
    const f = fixture()
    f.save()
    const service = createCloudJobAuthority(f.root, true)!
    cleanups.unshift(() => service.close())
    expect(service.status()).toMatchObject({
      configured: true,
      dispatchEnabled: false,
      liveDispatchReady: false
    })
    const job = await service.submit({ kind: 'paired', id: 'phone' }, f.input)
    expect(job.createdBy).toBe('phone')
    await expect(service.get({ kind: 'paired', id: 'other' }, job.id)).rejects.toThrow('denied')
    f.config.workspaceAccess[0]!.deviceIds = []
    f.save()
    await expect(service.get({ kind: 'paired', id: 'phone' }, job.id)).rejects.toThrow('disabled')
    f.config.enabled = false
    f.save()
    expect(service.status()).toMatchObject({ configured: false, dispatchEnabled: false })
    await expect(service.submit({ kind: 'local', id: 'local' }, f.input)).rejects.toThrow(
      'disabled'
    )
  })

  it('fails closed on nonprivate configuration and future schemas without opening a database', () => {
    const f = fixture()
    f.save()
    chmodSync(join(f.base, 'authority.json'), 0o644)
    expect(() => createCloudJobAuthority(f.root, true)).toThrow('untrusted')
    chmodSync(join(f.base, 'authority.json'), 0o600)
    writeFileSync(join(f.base, 'authority.json'), JSON.stringify({ ...f.config, schemaVersion: 2 }))
    expect(() => createCloudJobAuthority(f.root, true)).toThrow('invalid')
    expect(existsSync(join(f.base, 'jobs.sqlite'))).toBe(false)
  })

  it('rejects a revoked grant read before an asynchronous submission resumes', async () => {
    const f = fixture()
    f.save()
    const service = createCloudJobAuthority(f.root, true)!
    const pending = service.submit({ kind: 'paired', id: 'phone' }, f.input)
    f.config.workspaceAccess[0]!.deviceIds = []
    f.save()
    await expect(pending).rejects.toThrow('disabled')
    service.close()
    // Restoring the original registration permits inspection after a fresh authority startup.
    f.config.workspaceAccess[0]!.deviceIds = ['phone']
    f.save()
    const restarted = createCloudJobAuthority(f.root, true)!
    cleanups.unshift(() => restarted.close())
    expect(await restarted.list({ kind: 'local', id: 'local' })).toEqual([])
  })

  it('requires a restart for same-device project registration changes', () => {
    const f = fixture()
    f.save()
    const service = createCloudJobAuthority(f.root, true)!
    cleanups.unshift(() => service.close())
    expect(service.status().configured).toBe(true)
    f.config.projects[0]!.recipes = ['test', 'new-recipe']
    f.save()
    expect(service.status().configured).toBe(false)
    expect(() =>
      service.registerProject({ kind: 'local', id: 'local' }, f.config.projects[0]! as never)
    ).toThrow('disabled')
  })

  it('composes trusted bootstrap on the same lazy authority store without enabling dispatch', async () => {
    const f = fixture()
    f.save()
    let available!: () => boolean
    const start = vi.fn(async () => undefined)
    const stop = vi.fn(async () => ({ drained: true }))
    const attach = vi.fn((store: CloudJobStore) => {
      expect(store.project('project').root).toBe(f.root)
      expect(store.isDispatchEnabled()).toBe(false)
      return { start, stop, executorEligibility: true }
    })
    const service = createCloudJobAuthority(f.root, true, {
      workerHostFactory: (context) => {
        expect(context.baseDirectory).toBe(f.base)
        expect(context.deviceId).toBe('vps')
        available = context.authorityAvailable
        return attach
      }
    })!
    expect(attach).not.toHaveBeenCalled()
    expect(service.status().liveDispatchReady).toBe(false)
    await Promise.resolve()
    expect(service.status()).toMatchObject({ liveDispatchReady: true, dispatchEnabled: false })
    service.setDispatchEnabled({ kind: 'local', id: 'local' }, true)
    expect(attach).toHaveBeenCalledTimes(1)
    f.config.workspaceAccess[0]!.deviceIds = []
    f.save()
    expect(available()).toBe(false)
    expect(service.status().configured).toBe(false)
    expect(await service.shutdown()).toMatchObject({ drained: true })
    expect(stop).toHaveBeenCalledWith(5000)
  })

  it('keeps missing worker enrollment unready after authority registration', () => {
    const f = fixture()
    f.save()
    const service = createCloudJobAuthority(f.root, true, { workerHostFactory: () => undefined })!
    cleanups.unshift(() => service.close())
    expect(service.status()).toMatchObject({ liveDispatchReady: false, dispatchEnabled: false })
    expect(() => service.setDispatchEnabled({ kind: 'local', id: 'local' }, true)).toThrow(
      'prerequisites'
    )
  })

  it('does not construct a receipt client unless the private bridge policy enables it', async () => {
    const f = fixture()
    f.save()
    const factory = vi.fn()
    const service = createCloudJobAuthority(f.root, true, { adamClientFactory: factory })!
    cleanups.unshift(() => service.close())
    expect(factory).not.toHaveBeenCalled()
    await expect(
      service.submitAdamBound({ kind: 'paired', id: 'phone' }, f.input, {})
    ).rejects.toThrow('unavailable')
    expect(await service.list({ kind: 'local', id: 'local' })).toEqual([])
  })

  it('refuses an enabled bridge without a trusted client before opening the queue', () => {
    const f = fixture()
    f.config.adamReceiptBridgeEnabled = true
    f.save()
    expect(() => createCloudJobAuthority(f.root, true)).toThrow('trusted client')
    expect(existsSync(join(f.base, 'jobs.sqlite'))).toBe(false)
  })

  it('delivers a bound child receipt from the same lazy queue without enabling workers', async () => {
    const f = fixture()
    f.config.adamReceiptBridgeEnabled = true
    f.save()
    const now = Date.now()
    const identity = {
      schemaVersion: 1 as const,
      bindingId: randomUUID(),
      adamInstanceId: 'adam',
      parentObjectiveId: 'parent',
      parentObjectiveVersion: 1,
      projectId: 'project',
      contextDigest: 'a'.repeat(64),
      requestFingerprint: canonicalCloudJobAdamSha256(f.input),
      expiresAtMs: now + 60_000
    }
    const submitReceipt = vi.fn(async (_binding, receipt) => ({
      state: 'accepted' as const,
      value: {
        schemaVersion: 1 as const,
        ok: true as const,
        receiptId: receipt.receiptId,
        payloadSha256: canonicalCloudJobAdamSha256(receipt),
        accepted: 'inserted' as const,
        storedAtMs: Date.now(),
        parentStateChanged: false as const
      }
    }))
    const service = createCloudJobAuthority(f.root, true, {
      adamClientFactory: () => ({
        consumeBinding: async () => ({
          state: 'accepted',
          value: {
            schemaVersion: 1,
            consumed: true,
            binding: identity,
            boundAtMs: now,
            bindingDigest: canonicalCloudJobAdamSha256(identity)
          }
        }),
        submitReceipt
      })
    })!
    try {
      const job = await service.submitAdamBound({ kind: 'paired', id: 'phone' }, f.input, {})
      const store = (service as unknown as { currentStore: CloudJobStore }).currentStore
      await vi.waitFor(
        () =>
          expect(
            store.db.prepare('SELECT state FROM cloud_job_adam_receipt_outbox').get()?.state
          ).toBe('acked'),
        { timeout: 3000 }
      )
      expect(submitReceipt).toHaveBeenCalledTimes(1)
      expect(store.get(job.id).state).toBe('queued')
      expect(service.status().liveDispatchReady).toBe(false)
      expect(store.isDispatchEnabled()).toBe(false)
      f.config.adamReceiptBridgeEnabled = false
      f.save()
      expect(service.status().configured).toBe(false)
    } finally {
      expect(await service.shutdown()).toMatchObject({ drained: true })
    }
  })
})

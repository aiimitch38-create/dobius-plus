import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CloudJobAdamResult } from './cloud-jobs/cloud-job-adam-transport'
import {
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingResponse
} from '../../shared/cloud-job-adam-receipts'
import { CloudJobInput } from '../../shared/cloud-jobs'
import { admitCloudJobSubmission } from './cloud-job-submit-admission'
import { CloudJobStore } from './cloud-jobs/store'
import {
  adamBindingGrant,
  adamBindingResponse,
  adamJobInput
} from './cloud-jobs/cloud-job-adam-client.fixtures'

const planner = { kind: 'local', id: 'adam-parent-planner' } as const
const verifiedAdam = { assertCurrent: () => {} }
const adamPrincipal = { kind: 'local', id: 'adam' } as const
const paired = { kind: 'paired', id: 'paired-client' } as const
const directories: string[] = []
const stores: CloudJobStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function setup(now = 6_000) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-adam-admission-recovery-')))
  directories.push(directory)
  const clock = { now }
  const openStore = () => {
    const store = new CloudJobStore(join(directory, 'jobs.sqlite'), () => clock.now, {
      localDeviceId: 'worker-1'
    })
    stores.push(store)
    return store
  }
  const store = openStore()
  store.registerProject({
    id: 'project-1',
    deviceId: 'worker-1',
    root: directory,
    recipes: ['recipe-1'],
    capability: 'macos'
  })
  return { directory, clock, store, openStore }
}

const input = () => CloudJobInput.parse(adamJobInput())

function accepted(value: CloudJobAdamBindingResponse = adamBindingResponse()) {
  return { state: 'accepted', value } as const
}

function freshAccepted() {
  const response = adamBindingResponse()
  const binding = { ...response.binding, expiresAtMs: Date.now() + 60_000 }
  return accepted({ ...response, binding, bindingDigest: canonicalCloudJobAdamSha256(binding) })
}

function authority(
  store: CloudJobStore,
  adamClient: {
    consumeBinding: (
      grant: unknown,
      input: unknown
    ) => Promise<CloudJobAdamResult<CloudJobAdamBindingResponse>>
    consumeBindingForRecovery?: (
      grant: unknown,
      input: unknown
    ) => Promise<CloudJobAdamResult<CloudJobAdamBindingResponse>>
  }
) {
  return {
    readStore: () => store,
    canUseWorkspace: async () => true,
    adamClient
  }
}

function rows(store: CloudJobStore) {
  return {
    jobs: store.db.prepare('SELECT * FROM cloud_jobs ORDER BY id').all(),
    bindings: store.db.prepare('SELECT * FROM cloud_job_adam_bindings ORDER BY job_id').all(),
    events: store.db.prepare('SELECT * FROM cloud_events ORDER BY sequence').all(),
    outbox: store.db
      .prepare('SELECT * FROM cloud_job_adam_receipt_outbox ORDER BY receipt_id')
      .all()
  }
}

function unavailable(
  reason:
    | 'remote-error'
    | 'endpoint-changed'
    | 'auth-unavailable'
    | 'timeout'
    | 'malformed-response'
    | 'expired-binding'
) {
  return { state: 'unavailable', reason } as const
}

describe('ADAM child admission recovery', () => {
  it('returns the committed child after lost acknowledgement, reopen, and expiry without writes', async () => {
    const f = setup()
    const child = f.store.submitAdamBound(input(), adamPrincipal.id, adamBindingResponse())
    const before = rows(f.store)
    f.store.close()
    stores.splice(stores.indexOf(f.store), 1)
    f.clock.now = 10_000
    const reopened = f.openStore()
    const consumeBinding = vi.fn(async () => {
      throw new Error('normal consume must not be used')
    })
    const consumeBindingForRecovery = vi.fn(async () => accepted())
    const lookup = vi.spyOn(reopened, 'findAdamBoundChild')
    const submit = vi.spyOn(reopened, 'submitAdamBound')

    const result = await admitCloudJobSubmission(
      authority(reopened, { consumeBinding, consumeBindingForRecovery }),
      adamPrincipal,
      input(),
      adamBindingGrant(),
      verifiedAdam
    )

    expect(result).toEqual(child)
    expect(consumeBindingForRecovery).toHaveBeenCalledTimes(1)
    expect(consumeBinding).not.toHaveBeenCalled()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    expect(rows(reopened)).toEqual(before)
  })

  it('refuses an expired consumed binding with no child at the store-clock final gate', async () => {
    const f = setup(10_000)
    const before = rows(f.store)
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const recovery = vi.fn(async () => accepted())
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(1_000)

    try {
      await expect(
        admitCloudJobSubmission(
          authority(f.store, { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }),
          adamPrincipal,
          input(),
          adamBindingGrant(),
          verifiedAdam
        )
      ).rejects.toThrow('Expired ADAM intent has no previously committed child.')
    } finally {
      wallClock.mockRestore()
    }

    expect(recovery).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    expect(rows(f.store)).toEqual(before)
  })

  it('uses the store clock when ambient wall time has advanced past a fresh binding', async () => {
    const f = setup(6_000)
    const response = adamBindingResponse()
    const binding = { ...response.binding, expiresAtMs: 10_000 }
    const grantResponse = accepted({
      ...response,
      binding,
      bindingDigest: canonicalCloudJobAdamSha256(binding)
    })
    const recovery = vi.fn(async () => grantResponse)
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(20_000)

    try {
      const result = await admitCloudJobSubmission(
        authority(f.store, { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }),
        adamPrincipal,
        input(),
        adamBindingGrant(),
        verifiedAdam
      )
      expect(result.createdBy).toBe(adamPrincipal.id)
    } finally {
      wallClock.mockRestore()
    }

    expect(recovery).toHaveBeenCalledOnce()
    expect(rows(f.store).jobs).toHaveLength(1)
    expect(rows(f.store).bindings).toHaveLength(1)
    expect(rows(f.store).outbox).toHaveLength(1)
  })

  it('submits once after a fresh exact binding lookup returns null', async () => {
    const f = setup()
    const recovery = vi.fn(async () => freshAccepted())
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const result = await admitCloudJobSubmission(
      authority(f.store, { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }),
      adamPrincipal,
      input(),
      adamBindingGrant(),
      verifiedAdam
    )

    expect(result.createdBy).toBe(adamPrincipal.id)
    expect(recovery).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(rows(f.store).jobs).toHaveLength(1)
    expect(rows(f.store).bindings).toHaveLength(1)
    expect(rows(f.store).events).toHaveLength(1)
    expect(rows(f.store).outbox).toHaveLength(1)
  })

  it('does not look up or submit when the existing server refuses an expired unconsumed grant', async () => {
    const f = setup(10_000)
    const lookup = vi.spyOn(f.store, 'findAdamBoundChild')
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const recovery = vi.fn(async () => unavailable('remote-error'))

    await expect(
      admitCloudJobSubmission(
        authority(f.store, { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }),
        adamPrincipal,
        input(),
        adamBindingGrant(),
        verifiedAdam
      )
    ).rejects.toThrow('binding is unavailable')

    expect(recovery).toHaveBeenCalledTimes(1)
    expect(lookup).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    expect(rows(f.store).jobs).toHaveLength(0)
  })

  it('does not let a legacy consume-only client fall through after expiry', async () => {
    const f = setup(10_000)
    const lookup = vi.spyOn(f.store, 'findAdamBoundChild')
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const consume = vi.fn(async () => unavailable('expired-binding'))
    const recovery = vi.fn(async () => freshAccepted())

    await expect(
      admitCloudJobSubmission(
        authority(f.store, { consumeBinding: consume, consumeBindingForRecovery: recovery }),
        planner,
        input(),
        adamBindingGrant()
      )
    ).rejects.toThrow('binding is unavailable')

    expect(consume).toHaveBeenCalledTimes(1)
    expect(recovery).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    expect(rows(f.store).jobs).toHaveLength(0)
  })

  it('does not fall through to lookup or submit after malformed recovery transport', async () => {
    const f = setup(10_000)
    const lookup = vi.spyOn(f.store, 'findAdamBoundChild')
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const recovery = vi.fn(async () => unavailable('malformed-response'))

    await expect(
      admitCloudJobSubmission(
        authority(f.store, { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }),
        adamPrincipal,
        input(),
        adamBindingGrant(),
        verifiedAdam
      )
    ).rejects.toThrow('binding is unavailable')

    expect(recovery).toHaveBeenCalledTimes(1)
    expect(lookup).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    expect(rows(f.store).jobs).toHaveLength(0)
  })

  it('treats a wrong-creator binding lookup as refusal and never falls through to submit', async () => {
    const f = setup()
    f.store.submitAdamBound(input(), 'other-creator', adamBindingResponse())
    const before = rows(f.store)
    const submit = vi.spyOn(f.store, 'submitAdamBound')

    await expect(
      admitCloudJobSubmission(
        authority(f.store, {
          consumeBinding: vi.fn(),
          consumeBindingForRecovery: vi.fn(async () => accepted())
        }),
        adamPrincipal,
        input(),
        adamBindingGrant(),
        verifiedAdam
      )
    ).rejects.toThrow(/does not match/)

    expect(submit).not.toHaveBeenCalled()
    expect(rows(f.store)).toEqual(before)
  })

  it('does not expose a planner child to a paired caller or run planner recovery lookup', async () => {
    const f = setup()
    const child = f.store.submitAdamBound(input(), planner.id, adamBindingResponse())
    const before = rows(f.store)
    const lookup = vi.spyOn(f.store, 'findAdamBoundChild')
    const recovery = vi.fn(async () => accepted())
    const consume = vi.fn(async () => accepted())

    await expect(
      admitCloudJobSubmission(
        authority(f.store, { consumeBinding: consume, consumeBindingForRecovery: recovery }),
        paired,
        input(),
        adamBindingGrant()
      )
    ).rejects.toThrow(/conflicts with an existing immutable link/)

    expect(recovery).not.toHaveBeenCalled()
    expect(consume).toHaveBeenCalledTimes(1)
    expect(lookup).not.toHaveBeenCalled()
    expect(rows(f.store)).toEqual(before)
    expect(f.store.get(child.id)).toEqual(child)
  })

  it('refuses project authority changed while exact binding consume is pending', async () => {
    const f = setup()
    let resolve!: (result: CloudJobAdamResult<CloudJobAdamBindingResponse>) => void
    const recovery = vi.fn(
      () => new Promise<CloudJobAdamResult<CloudJobAdamBindingResponse>>((done) => (resolve = done))
    )
    const lookup = vi.spyOn(f.store, 'findAdamBoundChild')
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const pending = admitCloudJobSubmission(
      authority(f.store, { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }),
      adamPrincipal,
      input(),
      adamBindingGrant(),
      verifiedAdam
    )
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    f.store.registerProject({
      id: 'project-1',
      deviceId: 'worker-1',
      root: f.directory,
      recipes: ['recipe-1', 'recipe-2'],
      capability: 'macos'
    })
    resolve(accepted())

    await expect(pending).rejects.toThrow('Project changed')
    expect(lookup).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('refuses store authority replaced while exact binding consume is pending', async () => {
    const f = setup()
    const replacement = f.openStore()
    let selected = f.store
    let resolve!: (result: CloudJobAdamResult<CloudJobAdamBindingResponse>) => void
    const recovery = vi.fn(
      () => new Promise<CloudJobAdamResult<CloudJobAdamBindingResponse>>((done) => (resolve = done))
    )
    const lookup = vi.spyOn(f.store, 'findAdamBoundChild')
    const submit = vi.spyOn(f.store, 'submitAdamBound')
    const pending = admitCloudJobSubmission(
      {
        readStore: () => selected,
        canUseWorkspace: async () => true,
        adamClient: { consumeBinding: vi.fn(), consumeBindingForRecovery: recovery }
      },
      adamPrincipal,
      input(),
      adamBindingGrant(),
      verifiedAdam
    )
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    selected = replacement
    resolve(accepted())

    await expect(pending).rejects.toThrow('Project changed')
    expect(lookup).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
})

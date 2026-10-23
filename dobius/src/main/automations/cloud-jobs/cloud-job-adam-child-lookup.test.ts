import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type SyncDatabase from '../../sqlite/sync-database'
import {
  CloudJobAdamBindingGrant,
  CloudJobAdamBindingResponse,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingResponse as BindingResponse
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJobInput, type CloudJobInput as JobInput } from '../../../shared/cloud-jobs'
import { CloudJobCatalog } from './cloud-job-catalog'
import {
  findCloudJobAdamChild,
  findCloudJobAdamChildByGrant
} from './cloud-job-adam-child-lookup'

const ADAM_PARENT_PLANNER = 'adam-parent-planner'
const fixtures: { directory: string; stores: CloudJobCatalog[] }[] = []

function request(requestKey = 'child-request'): JobInput {
  return {
    requestKey,
    taskId: 'task-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    targetDeviceId: 'worker-1',
    recipeId: 'recipe-1',
    title: 'Synthetic child task',
    sourceRevision: 'a'.repeat(40),
    estimatedBytes: 100,
    dependencies: []
  }
}

function bindingFor(input: JobInput, nowMs = 1_000): BindingResponse {
  const canonicalInput = CloudJobInput.parse({
    ...input,
    dependencies: [...new Set(input.dependencies)].sort()
  })
  const binding = {
    schemaVersion: 1 as const,
    bindingId: 'b318dc55-1f52-4eaf-9e77-9b5ca269cf97',
    adamInstanceId: 'adam-local',
    parentObjectiveId: 'objective-1',
    parentObjectiveVersion: 2,
    projectId: canonicalInput.projectId,
    contextDigest: 'c'.repeat(64),
    requestFingerprint: canonicalCloudJobAdamSha256(canonicalInput),
    expiresAtMs: nowMs + 100
  }
  return CloudJobAdamBindingResponse.parse({
    schemaVersion: 1,
    consumed: true,
    binding,
    boundAtMs: nowMs,
    bindingDigest: canonicalCloudJobAdamSha256(binding)
  })
}

function setup(nowMs = 1_000) {
  const directory = mkdtempSync(join(tmpdir(), 'dobius-adam-child-lookup-'))
  const root = realpathSync(directory)
  const file = join(directory, 'cloud.sqlite')
  const stores: CloudJobCatalog[] = []
  const open = (at = nowMs) => {
    const store = new CloudJobCatalog(file, () => at, { localDeviceId: 'worker-1' })
    stores.push(store)
    return store
  }
  const store = open()
  store.registerProject({
    id: 'project-1',
    deviceId: 'worker-1',
    root,
    recipes: ['recipe-1'],
    capability: 'macos'
  })
  fixtures.push({ directory, stores })
  return { directory, file, open, store, stores }
}

function snapshot(db: SyncDatabase) {
  return {
    jobs: db.prepare('SELECT * FROM cloud_jobs ORDER BY id').all(),
    bindings: db.prepare('SELECT * FROM cloud_job_adam_bindings ORDER BY job_id').all(),
    events: db.prepare('SELECT * FROM cloud_events ORDER BY sequence').all(),
    outbox: db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox ORDER BY receipt_id').all()
  }
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    for (const store of fixture.stores) {
      store.close()
    }
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

describe('findCloudJobAdamChild', () => {
  it('finds an exact committed child after reopen even when its binding has expired', () => {
    const f = setup()
    const dependencyA = f.store.submit(
      { ...request('dep-a'), title: 'Dependency A' },
      'fixture-parent'
    )
    const dependencyB = f.store.submit(
      { ...request('dep-b'), title: 'Dependency B' },
      'fixture-parent'
    )
    const rawInput = {
      ...request(),
      dependencies: [dependencyB.id, dependencyA.id, dependencyB.id]
    }
    const grant = bindingFor(rawInput)
    const created = f.store.submitAdamBound(rawInput, ADAM_PARENT_PLANNER, grant)
    f.stores.splice(f.stores.indexOf(f.store), 1)
    f.store.close()

    const reopened = f.open(5_000)
    expect(grant.binding.expiresAtMs).toBeLessThan(5_000)
    expect(findCloudJobAdamChild(reopened.db, rawInput, grant)).toEqual(created)
    expect(reopened.get(created.id)).toEqual(created)
  })

  it('returns null only when the request key has no committed row', () => {
    const { store } = setup()
    const absent = request('not-yet-created')
    expect(findCloudJobAdamChild(store.db, absent, bindingFor(absent))).toBeNull()
  })

  it('refuses changed request fields, project, fingerprint, and parent identity', () => {
    const { store } = setup()
    const input = request()
    const grant = bindingFor(input)
    store.submitAdamBound(input, ADAM_PARENT_PLANNER, grant)

    expect(() =>
      findCloudJobAdamChild(store.db, { ...input, title: 'Changed request' }, grant)
    ).toThrow(/does not match/)
    const changedKeyInput = { ...input, requestKey: 'changed-key' }
    const changedKeyGrant = withBinding(grant, {
      requestFingerprint: canonicalCloudJobAdamSha256(changedKeyInput)
    })
    expect(() => findCloudJobAdamChild(store.db, changedKeyInput, changedKeyGrant)).toThrow(
      /does not match/
    )
    expect(() =>
      findCloudJobAdamChild(store.db, { ...input, projectId: 'other-project' }, grant)
    ).toThrow(/does not match/)
    expect(() =>
      findCloudJobAdamChild(
        store.db,
        input,
        withBinding(grant, { requestFingerprint: 'd'.repeat(64) })
      )
    ).toThrow(/does not match/)
    expect(() =>
      findCloudJobAdamChild(
        store.db,
        input,
        withBinding(grant, { parentObjectiveId: 'other-parent' })
      )
    ).toThrow(/does not match/)
    expect(() =>
      findCloudJobAdamChild(store.db, input, withBinding(grant, { contextDigest: 'e'.repeat(64) }))
    ).toThrow(/does not match/)
  })

  it('returns the exact planner child despite another creator using the same request key', () => {
    const { store } = setup()
    const input = request()
    const grant = bindingFor(input)
    store.submit(input, 'some-other-creator')
    const child = store.submitAdamBound(input, ADAM_PARENT_PLANNER, grant)
    expect(findCloudJobAdamChild(store.db, input, grant)).toEqual(child)
  })

  it('returns null when the same request key exists only for another creator', () => {
    const { store } = setup()
    const input = request()
    store.submit(input, 'some-other-creator')
    expect(findCloudJobAdamChild(store.db, input, bindingFor(input))).toBeNull()
  })

  it('refuses an exact binding ID attached to a job owned by another creator', () => {
    const { store } = setup()
    const input = request()
    const grant = bindingFor(input)
    store.submitAdamBound(input, 'some-other-creator', grant)
    expect(() => findCloudJobAdamChild(store.db, input, grant)).toThrow(/does not match/)
  })

  it('fails closed when the persisted binding identity is corrupt', () => {
    const f = setup()
    const input = request()
    const validGrant = bindingFor(input)
    const job = f.store.submitAdamBound(input, ADAM_PARENT_PLANNER, validGrant)
    f.store.db
      .prepare('UPDATE cloud_job_adam_bindings SET context_digest=? WHERE job_id=?')
      .run('f'.repeat(64), job.id)
    expect(() => findCloudJobAdamChild(f.store.db, input, validGrant)).toThrow(/does not match/)
  })

  it('uses admission dependency deduplication and sorting without writing lookup state', () => {
    const { store } = setup()
    const dependencyA = store.submit(
      { ...request('dep-a'), title: 'Dependency A' },
      'fixture-parent'
    )
    const dependencyB = store.submit(
      { ...request('dep-b'), title: 'Dependency B' },
      'fixture-parent'
    )
    const rawInput = {
      ...request(),
      dependencies: [dependencyB.id, dependencyA.id, dependencyB.id]
    }
    const grant = bindingFor(rawInput)
    const created = store.submitAdamBound(rawInput, ADAM_PARENT_PLANNER, grant)
    const before = snapshot(store.db)

    expect(created.dependencies).toEqual([dependencyA.id, dependencyB.id].sort())
    expect(findCloudJobAdamChild(store.db, rawInput, grant)).toEqual(created)
    expect(snapshot(store.db)).toEqual(before)
  })

  it('looks up an expired sealed grant by exact stored identity without writing', () => {
    const f = setup()
    const input = request()
    const stored = bindingFor(input)
    const grant = CloudJobAdamBindingGrant.parse({
      ...stored.binding,
      capability: 'synthetic-read-only-capability-123456789'
    })
    const child = f.store.submitAdamBound(input, 'adam', stored)
    const before = snapshot(f.store.db)
    f.stores.splice(f.stores.indexOf(f.store), 1)
    f.store.close()
    const reopened = f.open(5_000)

    expect(grant.expiresAtMs).toBeLessThan(5_000)
    expect(findCloudJobAdamChildByGrant(reopened.db, input, grant, 'adam')).toEqual(child)
    expect(snapshot(reopened.db)).toEqual(before)
  })

  it('returns null for an absent exact grant and rejects a mismatched persisted child', () => {
    const { store } = setup()
    const input = request('absent-child')
    const binding = bindingFor(input)
    const grant = CloudJobAdamBindingGrant.parse({
      ...binding.binding,
      capability: 'synthetic-read-only-capability-123456789'
    })
    const before = snapshot(store.db)
    expect(findCloudJobAdamChildByGrant(store.db, input, grant, 'adam')).toBeNull()
    expect(snapshot(store.db)).toEqual(before)

    const actualInput = request('other-request')
    const actualBinding = bindingFor(actualInput)
    store.submitAdamBound(actualInput, 'adam', actualBinding)
    const wrongBinding = CloudJobAdamBindingGrant.parse({
      ...bindingFor(actualInput).binding,
      bindingId: 'f782b91c-739c-4b57-a1b9-64931c5c79d3',
      capability: 'synthetic-read-only-capability-123456789'
    })
    expect(() => findCloudJobAdamChildByGrant(store.db, actualInput, wrongBinding, 'adam')).toThrow(
      /does not match/
    )
  })
})

function withBinding(
  response: BindingResponse,
  patch: Partial<BindingResponse['binding']>
): BindingResponse {
  const binding = { ...response.binding, ...patch }
  return CloudJobAdamBindingResponse.parse({
    ...response,
    binding,
    bindingDigest: canonicalCloudJobAdamSha256(binding)
  })
}

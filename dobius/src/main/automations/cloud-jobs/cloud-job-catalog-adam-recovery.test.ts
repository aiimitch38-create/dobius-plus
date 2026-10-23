import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CloudJobAdamBindingResponse,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingResponse as BindingResponse
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJobInput, type CloudJobInput as JobInput } from '../../../shared/cloud-jobs'
import { CloudJobCatalog } from './cloud-job-catalog'
import type SyncDatabase from '../../sqlite/sync-database'

const ADAM_PARENT_PLANNER = 'adam-parent-planner'
const fixtures: { directory: string; catalogs: CloudJobCatalog[] }[] = []

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

function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-catalog-adam-recovery-')))
  const file = join(directory, 'jobs.sqlite')
  const catalogs: CloudJobCatalog[] = []
  let nowMs = 1_000
  const open = () => {
    const catalog = new CloudJobCatalog(file, () => nowMs, { localDeviceId: 'worker-1' })
    catalogs.push(catalog)
    return catalog
  }
  const catalog = open()
  catalog.registerProject({
    id: 'project-1',
    deviceId: 'worker-1',
    root: directory,
    recipes: ['recipe-1'],
    capability: 'macos'
  })
  fixtures.push({ directory, catalogs })
  return {
    catalog,
    open,
    setNow(value: number) {
      nowMs = value
    },
    close(catalogToClose: CloudJobCatalog) {
      const index = catalogs.indexOf(catalogToClose)
      if (index >= 0) {
        catalogs.splice(index, 1)
      }
      catalogToClose.close()
    }
  }
}

function snapshot(db: SyncDatabase) {
  return {
    bindings: db.prepare('SELECT * FROM cloud_job_adam_bindings ORDER BY job_id').all(),
    events: db.prepare('SELECT * FROM cloud_events ORDER BY sequence').all(),
    outbox: db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox ORDER BY receipt_id').all()
  }
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.catalogs.forEach((catalog) => catalog.close())
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

describe('CloudJobCatalog.findAdamBoundChild', () => {
  it('recovers an exact child after binding expiry and database reopen', () => {
    const f = setup()
    const input = request()
    const binding = bindingFor(input)
    const child = f.catalog.submitAdamBound(input, ADAM_PARENT_PLANNER, binding)
    f.close(f.catalog)
    f.setNow(5_000)

    const reopened = f.open()
    const before = snapshot(reopened.db)
    expect(binding.binding.expiresAtMs).toBeLessThan(5_000)
    expect(reopened.findAdamBoundChild(input, binding)).toEqual(child)
    expect(snapshot(reopened.db)).toEqual(before)
  })

  it('finds the ADAM child when another creator has the same request key', () => {
    const { catalog } = setup()
    const input = request()
    const binding = bindingFor(input)
    catalog.submit(input, 'other-creator')
    const child = catalog.submitAdamBound(input, ADAM_PARENT_PLANNER, binding)

    expect(catalog.findAdamBoundChild(input, binding)).toEqual(child)
  })

  it('returns null when the same request key belongs only to another creator', () => {
    const { catalog } = setup()
    const input = request()
    catalog.submit(input, 'other-creator')

    expect(catalog.findAdamBoundChild(input, bindingFor(input))).toBeNull()
  })

  it('refuses an exact binding ID linked to a job owned by another creator', () => {
    const { catalog } = setup()
    const input = request()
    const binding = bindingFor(input)
    catalog.submitAdamBound(input, 'other-creator', binding)
    const before = snapshot(catalog.db)

    expect(() => catalog.findAdamBoundChild(input, binding)).toThrow(/does not match/)
    expect(snapshot(catalog.db)).toEqual(before)
  })

  it('refuses mismatched approved input without changing binding or receipt ledgers', () => {
    const { catalog } = setup()
    const input = request()
    const binding = bindingFor(input)
    catalog.submitAdamBound(input, ADAM_PARENT_PLANNER, binding)
    const before = snapshot(catalog.db)

    expect(() =>
      catalog.findAdamBoundChild({ ...input, title: 'Changed after approval' }, binding)
    ).toThrow(/does not match/)
    expect(snapshot(catalog.db)).toEqual(before)
  })
})

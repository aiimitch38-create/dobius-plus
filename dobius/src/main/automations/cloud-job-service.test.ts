import { mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudJobService, type CloudJobServiceOptions } from './cloud-job-service'
import { CloudJobStore } from './cloud-jobs/store'
import type { CloudJobInput, CloudProject } from '../../shared/cloud-jobs'

const local = { kind: 'local', id: 'local' } as const
const phone = { kind: 'paired', id: 'phone-device' } as const
const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

function fixture(overrides: Partial<CloudJobServiceOptions> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-job-service-')))
  let store: CloudJobStore
  let opens = 0
  const service = new CloudJobService({
    openStore: () => {
      opens++
      store = new CloudJobStore(':memory:', () => 100_000, { localDeviceId: 'laptop' })
      return store
    },
    canUseWorkspace: async (_principal, workspace) => workspace === 'allowed-workspace',
    ...overrides
  })
  const project: CloudProject = {
    id: 'project',
    deviceId: 'laptop',
    root,
    recipes: ['test'],
    capability: 'portable'
  }
  const input: CloudJobInput = {
    requestKey: 'request',
    taskId: 'task',
    projectId: project.id,
    workspaceId: 'allowed-workspace',
    targetDeviceId: project.deviceId,
    recipeId: 'test',
    title: 'Reviewed test job',
    sourceRevision: 'a'.repeat(40),
    estimatedBytes: 20,
    dependencies: []
  }
  cleanups.push(() => {
    service.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    service,
    project,
    input,
    root,
    get store() {
      return store!
    },
    get opens() {
      return opens
    }
  }
}

describe('cloud job API authority', () => {
  it('opens state lazily and preserves default dispatch pause', () => {
    const f = fixture()
    expect(f.opens).toBe(0)
    expect(f.service.status()).toEqual({
      configured: true,
      generation: expect.any(String),
      dispatchEnabled: false,
      liveDispatchReady: false
    })
    expect(f.opens).toBe(1)
    f.service.close()
    expect(f.service.status().dispatchEnabled).toBe(false)
    expect(f.opens).toBe(2)
  })

  it('rejects paired registration and dispatch changes before they mutate state', () => {
    const f = fixture()
    expect(() => f.service.registerProject(phone, f.project)).toThrow('administrative authority')
    expect(() => f.service.setDispatchEnabled(phone, true)).toThrow('administrative authority')
    expect(f.opens).toBe(0)
  })

  it('does not enable unverified dispatch even for local administration', () => {
    const f = fixture()
    expect(() => f.service.setDispatchEnabled(local, true)).toThrow('prerequisites')
    expect(f.service.status().dispatchEnabled).toBe(false)
  })

  it('derives creator from authenticated principal and keeps submits idempotent', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    const one = await f.service.submit(phone, f.input)
    expect(one.createdBy).toBe(phone.id)
    expect(await f.service.submit(phone, f.input)).toEqual(one)
    expect(f.store.events()).toHaveLength(1)
    await expect(
      f.service.submit(phone, { ...f.input, createdBy: 'local' } as CloudJobInput)
    ).rejects.toThrow()
  })

  it('refuses unauthorized submission without writing an event or job', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    await expect(
      f.service.submit(phone, { ...f.input, workspaceId: 'private-workspace' })
    ).rejects.toThrow('access denied')
    expect(f.store.list()).toEqual([])
    expect(f.store.events()).toEqual([])
  })

  it('refuses a project changed while asynchronous submission authorization was pending', async () => {
    let resolve: (value: boolean) => void = () => {}
    const f = fixture({
      canUseWorkspace: () =>
        new Promise<boolean>((done) => {
          resolve = done
        })
    })
    f.service.registerProject(local, f.project)
    const pending = f.service.submit(phone, f.input)
    f.service.registerProject(local, { ...f.project, recipes: ['test', 'other'] })
    resolve(true)
    await expect(pending).rejects.toThrow('Project changed')
    expect(f.store.list()).toEqual([])
  })

  it('filters private jobs and events while advancing a reconnect cursor', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    const visible = await f.service.submit(local, f.input)
    await f.service.submit(local, {
      ...f.input,
      requestKey: 'second',
      workspaceId: 'private-workspace'
    })
    expect((await f.service.list(phone)).map((job) => job.id)).toEqual([visible.id])
    const page = await f.service.events(phone)
    expect(page.events.map((event) => event.jobId)).toEqual([visible.id])
    expect(page.nextCursor).toBe(2)
    expect(await f.service.events(phone, page.nextCursor)).toMatchObject({
      events: [],
      nextCursor: 2,
      resetRequired: false,
      generation: page.generation
    })
  })

  it('rejects cancellation of inaccessible jobs and stale versions', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    const secret = await f.service.submit(local, { ...f.input, workspaceId: 'private-workspace' })
    await expect(f.service.cancel(phone, secret.id, secret.version)).rejects.toThrow(
      'access denied'
    )
    const cancelled = await f.service.cancel(local, secret.id, secret.version)
    expect(cancelled.state).toBe('cancelled')
    await expect(f.service.cancel(local, secret.id, secret.version)).rejects.toThrow()
  })

  it('refuses a read authorization invalidated by registered root replacement', async () => {
    let resolve: (value: boolean) => void = () => {}
    const f = fixture({
      canUseWorkspace: () =>
        new Promise<boolean>((done) => {
          resolve = done
        })
    })
    f.service.registerProject(local, f.project)
    const job = await f.service.submit(local, f.input)
    const pending = f.service.get(phone, job.id)
    const replacement = join(f.root, 'replacement')
    mkdirSync(replacement)
    f.service.registerProject(local, { ...f.project, root: replacement })
    resolve(true)
    await expect(pending).rejects.toThrow('access denied')
  })

  it('refuses worker prose as completion without a trusted verification receipt', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    const job = await f.service.submit(local, f.input)
    await expect(f.service.accept(local, job.id, job.version, 'looks-fine')).rejects.toThrow(
      'verification receipt'
    )
    await expect(f.service.accept(phone, job.id, job.version, 'looks-fine')).rejects.toThrow(
      'administrative'
    )
    expect(f.store.get(job.id).state).toBe('queued')
  })

  it('pages through denied rows without leaking them or losing older accessible jobs', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    const visible = await f.service.submit(local, f.input)
    await f.service.submit(local, {
      ...f.input,
      requestKey: 'hidden',
      workspaceId: 'private-workspace'
    })
    const first = await f.service.snapshot(phone, 1)
    expect(first.jobs).toEqual([])
    expect(first.nextCursor).toEqual(expect.any(String))
    const newJob = await f.service.submit(local, { ...f.input, requestKey: 'after-snapshot' })
    const last = await f.service.snapshot(phone, 1, first.nextCursor!)
    expect(last.jobs.map((job) => job.id)).toEqual([visible.id])
    expect(last.nextCursor).toBeNull()
    expect(last.eventCursor).toBe(first.eventCursor)
    expect(last.generation).toBe(first.generation)
    const events = await f.service.events(phone, first.eventCursor)
    expect(events.events.map((event) => event.jobId)).toContain(newJob.id)
  })

  it('refuses forged or cross-principal snapshot cursors and resets future event cursors', async () => {
    const f = fixture()
    f.service.registerProject(local, f.project)
    await f.service.submit(local, f.input)
    await f.service.submit(local, { ...f.input, requestKey: 'second' })
    const page = await f.service.snapshot(phone, 1)
    await expect(f.service.snapshot(local, 1, page.nextCursor!)).rejects.toThrow(
      'another authority'
    )
    await expect(f.service.snapshot(phone, 1, 'forged')).rejects.toThrow('Invalid')
    expect(await f.service.events(phone, 1000)).toMatchObject({
      generation: page.generation,
      resetRequired: true,
      events: [],
      nextCursor: 0
    })
  })

  it('expires snapshots rather than mixing an old partial scan with a new authority', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const f = fixture()
    f.service.registerProject(local, f.project)
    await f.service.submit(local, f.input)
    await f.service.submit(local, { ...f.input, requestKey: 'second' })
    const page = await f.service.snapshot(phone, 1)
    clock.mockReturnValue(400_000)
    await expect(f.service.snapshot(phone, 1, page.nextCursor!)).rejects.toThrow('expired')
    const other = fixture()
    await expect(other.service.snapshot(phone, 1, page.nextCursor!)).rejects.toThrow('Invalid')
  })
})

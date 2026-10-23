import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudJobService } from './cloud-job-service'
import type { CloudJobWorkerHost } from './cloud-job-worker-lifecycle'
import { CloudJobStore } from './cloud-jobs/store'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function fixture(overrides: Partial<CloudJobWorkerHost> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'queue-host-lifecycle-')))
  const store = new CloudJobStore(join(root, 'queue.sqlite'), Date.now, { localDeviceId: 'vps' })
  const close = vi.spyOn(store, 'close')
  const openStore = vi.fn(() => store)
  const recovered = deferred()
  const host: CloudJobWorkerHost = {
    start: vi.fn(() => recovered.promise),
    stop: vi.fn(async () => ({ drained: true })),
    executorEligibility: true,
    ...overrides
  }
  const createWorkerHost = vi.fn((sameStore: CloudJobStore) => {
    expect(sameStore).toBe(store)
    return host
  })
  const service = new CloudJobService({
    openStore,
    createWorkerHost,
    canUseWorkspace: async () => true
  })
  cleanups.push(() => {
    recovered.resolve()
    if (!close.mock.calls.length) {
      store.close()
    }
    rmSync(root, { recursive: true, force: true })
  })
  return { service, store, host, close, openStore, createWorkerHost, recovered, root }
}

const local = { kind: 'local', id: 'local' } as const

describe('single-store job service worker lifecycle', () => {
  it('still requests exact host drain when persisting the dispatch pause fails', async () => {
    const f = fixture({ stop: vi.fn(async () => ({ drained: false })) })
    f.service.status()
    f.recovered.resolve()
    const pause = vi.spyOn(f.store, 'setDispatchEnabled').mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    expect(await f.service.shutdown()).toEqual({ drained: false, dispatchPausePersisted: false })
    expect(f.host.stop).toHaveBeenCalledTimes(1)
    expect(f.close).not.toHaveBeenCalled()
    expect(f.service.status().configured).toBe(false)
    pause.mockRestore()
  })

  it('reports failed pause persistence separately from a proven worker drain', async () => {
    const f = fixture()
    f.service.status()
    f.recovered.resolve()
    vi.spyOn(f.store, 'setDispatchEnabled').mockImplementation(() => {
      throw new Error('SQLITE_IOERR')
    })
    expect(await f.service.shutdown()).toEqual({ drained: true, dispatchPausePersisted: false })
    expect(f.host.stop).toHaveBeenCalledTimes(1)
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('closes a newly opened store when a side-effect-free host constructor refuses', () => {
    const f = fixture()
    const service = new CloudJobService({
      openStore: f.openStore,
      createWorkerHost: () => {
        throw new Error('Invalid enrollment')
      },
      canUseWorkspace: async () => false
    })
    expect(() => service.status()).toThrow('Invalid enrollment')
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.host.start).not.toHaveBeenCalled()
  })

  it('attaches exactly once to the API store and waits for recovery before dispatch', async () => {
    const f = fixture()
    expect(f.openStore).not.toHaveBeenCalled()
    expect(f.service.status().liveDispatchReady).toBe(false)
    f.service.status()
    expect(f.openStore).toHaveBeenCalledTimes(1)
    expect(f.createWorkerHost).toHaveBeenCalledTimes(1)
    expect(() => f.service.setDispatchEnabled(local, true)).toThrow('prerequisites')
    f.recovered.resolve()
    await f.recovered.promise
    expect(f.service.status()).toMatchObject({ liveDispatchReady: true, dispatchEnabled: false })
    f.service.setDispatchEnabled(local, true)
    expect(f.store.isDispatchEnabled()).toBe(true)
    await f.service.shutdown()
  })

  it('rechecks executor eligibility instead of keeping a successful startup latch', async () => {
    const f = fixture()
    f.service.status()
    f.recovered.resolve()
    await f.recovered.promise
    expect(f.service.status().liveDispatchReady).toBe(true)
    Object.defineProperty(f.host, 'executorEligibility', { value: false })
    expect(() => f.service.setDispatchEnabled(local, true)).toThrow('prerequisites')
    expect(f.store.isDispatchEnabled()).toBe(false)
    await f.service.shutdown()
  })

  it('refuses synchronous store close while a worker host owns it', async () => {
    const f = fixture()
    f.service.status()
    expect(() => f.service.close()).toThrow('drain')
    expect(f.close).not.toHaveBeenCalled()
    expect(f.store.list()).toEqual([])
    f.recovered.resolve()
    await f.service.shutdown()
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('retains the store if delayed startup outlives a positive stop receipt', async () => {
    const f = fixture()
    f.service.status()
    f.store.setDispatchEnabled(true)
    const shutdown = f.service.shutdown(10)
    expect(f.host.stop).toHaveBeenCalledWith(10)
    expect(f.store.isDispatchEnabled()).toBe(false)
    expect(await shutdown).toMatchObject({ drained: false })
    expect(f.close).not.toHaveBeenCalled()
    expect(f.store.list()).toEqual([])
    expect(f.service.status()).toMatchObject({ configured: false, liveDispatchReady: false })
    f.recovered.resolve()
    expect(await f.service.shutdown(100)).toMatchObject({ drained: true })
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(() => f.service.registerProject(local, {} as never)).toThrow('shutting down')
    expect(f.openStore).toHaveBeenCalledTimes(1)
  })

  it('retains store ownership on an unresolved drain and allows a later bounded retry', async () => {
    const stop = vi
      .fn()
      .mockResolvedValueOnce({ drained: false })
      .mockResolvedValue({ drained: true })
    const f = fixture({ stop })
    f.service.status()
    f.recovered.resolve()
    expect(await f.service.shutdown()).toMatchObject({ drained: false })
    expect(f.close).not.toHaveBeenCalled()
    expect(await f.service.shutdown()).toMatchObject({ drained: true })
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent drain requests and does not reopen after shutdown', async () => {
    const finished = deferred()
    const stop = vi.fn(async () => {
      await finished.promise
      return { drained: true }
    })
    const f = fixture({ stop })
    f.service.status()
    f.recovered.resolve()
    const one = f.service.shutdown()
    const two = f.service.shutdown()
    expect(stop).toHaveBeenCalledTimes(1)
    finished.resolve()
    expect(await one).toMatchObject({ drained: true })
    expect(await two).toMatchObject({ drained: true })
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.service.status().configured).toBe(false)
    expect(f.openStore).toHaveBeenCalledTimes(1)
  })

  it('failed recovery cannot expose dispatch readiness and still drains before close', async () => {
    const f = fixture({
      start: vi.fn(async () => {
        throw new Error('uncertain journal')
      })
    })
    f.service.status()
    await Promise.resolve()
    expect(f.service.status().liveDispatchReady).toBe(false)
    expect(() => f.service.setDispatchEnabled(local, true)).toThrow('prerequisites')
    expect(await f.service.shutdown()).toMatchObject({ drained: true })
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('does not reopen the database for a submission authorized after shutdown', async () => {
    const authorization = deferred()
    const f = fixture()
    const service = new CloudJobService({
      openStore: f.openStore,
      createWorkerHost: f.createWorkerHost,
      canUseWorkspace: async () => {
        await authorization.promise
        return true
      }
    })
    service.registerProject(local, {
      id: 'project',
      deviceId: 'vps',
      root: f.root,
      recipes: ['test'],
      capability: 'portable'
    })
    f.recovered.resolve()
    const submit = service.submit(
      { kind: 'paired', id: 'phone' },
      {
        requestKey: 'request',
        taskId: 'task',
        projectId: 'project',
        workspaceId: 'workspace',
        targetDeviceId: 'vps',
        recipeId: 'test',
        title: 'Synthetic lifecycle job',
        sourceRevision: 'a'.repeat(40),
        estimatedBytes: 20,
        dependencies: []
      }
    )
    const rejected = expect(submit).rejects.toThrow('shutting down')
    expect(await service.shutdown()).toMatchObject({ drained: true })
    authorization.resolve()
    await rejected
    expect(f.openStore).toHaveBeenCalledTimes(1)
  })
})

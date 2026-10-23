import { describe, expect, it, vi } from 'vitest'
import {
  CloudJobBoardController,
  CLOUD_JOB_LABELS,
  cloudJobBoardNotice,
  emptyCloudJobBoard,
  type CloudJobReadSource
} from './cloud-job-projection'
import type { CloudJob } from './cloud-jobs'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const job = (version = 1, state: CloudJob['state'] = 'queued'): CloudJob => ({
  id: 'job',
  taskId: 'task',
  requestKey: 'intent',
  projectId: 'project',
  workspaceId: 'workspace',
  targetDeviceId: 'laptop',
  recipeId: 'build',
  title: 'Actual job',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes: 1,
  dependencies: [],
  createdBy: 'phone',
  state,
  version,
  createdAt: 1,
  updatedAt: 1,
  attemptCount: 0,
  waitingReason: null,
  evidence: [],
  outcome: null
})
const status = {
  configured: true,
  generation: 'g1',
  dispatchEnabled: false,
  liveDispatchReady: false
}
const page = (jobs = [job()], nextCursor: string | null = null) => ({
  generation: 'g1',
  eventCursor: 5,
  jobs,
  nextCursor
})
const events = (after: number) => ({
  generation: 'g1',
  resetRequired: false,
  events: [],
  nextCursor: after
})
function source(read?: CloudJobReadSource['read']) {
  const call = vi.fn(
    read ??
      (async (method, params) =>
        method === 'jobs.status'
          ? status
          : method === 'jobs.snapshot'
            ? page()
            : events((params as { after: number }).after))
  )
  return { reader: new CloudJobBoardController({ key: 'host:one', read: call }), call }
}
describe('shared cloud job board projection', () => {
  it('projects the same persisted identity through real RPC for desktop and paired phone', async () => {
    // Host modules stay outside the renderer type graph; the test still exercises
    // the real store, permissions, snapshot cursor and RPC envelope.
    const servicePath = '../main/automations/cloud-job-service'
    const storePath = '../main/automations/cloud-jobs/store'
    const dispatcherPath = '../main/runtime/rpc/dispatcher'
    const methodsPath = '../main/runtime/rpc/methods/cloud-jobs'
    const { CloudJobService } = await import(servicePath)
    const { CloudJobStore } = await import(storePath)
    const { RpcDispatcher } = await import(dispatcherPath)
    const { CLOUD_JOB_METHODS } = await import(methodsPath)
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-board-boundary-')))
    const service = new CloudJobService({
      openStore: () => new CloudJobStore(':memory:', Date.now, { localDeviceId: 'vps' }),
      canUseWorkspace: async (_caller: unknown, workspace: string) => workspace === 'workspace'
    })
    try {
      service.registerProject(
        { kind: 'local', id: 'local' },
        {
          id: 'project',
          deviceId: 'vps',
          root,
          capability: 'portable',
          recipes: ['build']
        }
      )
      const {
        id: _id,
        state: _state,
        version: _version,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        createdBy: _creator,
        attemptCount: _attempt,
        waitingReason: _reason,
        evidence: _evidence,
        outcome: _outcome,
        ...input
      } = job()
      const persisted = await service.submit(
        { kind: 'paired', id: 'phone' },
        { ...input, targetDeviceId: 'vps' }
      )
      const dispatcher = new RpcDispatcher({
        runtime: { getRuntimeId: () => 'test-runtime' },
        cloudJobs: service,
        methods: CLOUD_JOB_METHODS
      })
      const calls: string[] = []
      const read = (paired: boolean) => async (method: string, params?: unknown) => {
        calls.push(method)
        const request = { id: 'read', authToken: 'test-only', method, params }
        let response
        if (paired) {
          const replies: string[] = []
          await dispatcher.dispatchStreaming(request, (reply: string) => replies.push(reply), {
            clientId: 'test-connection',
            clientDeviceId: 'phone',
            clientKind: 'mobile'
          })
          response = JSON.parse(replies[0]!)
        } else {
          response = await dispatcher.dispatch(request, { authenticatedLocal: true })
        }
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        return response.result
      }
      const desktop = new CloudJobBoardController({ key: 'environment:vps', read: read(false) })
      const phone = new CloudJobBoardController({ key: 'host:vps', read: read(true) })
      await desktop.refresh()
      await phone.refresh()
      expect(desktop.state.phase).toBe('ready')
      expect(phone.state.jobs).toEqual(desktop.state.jobs)
      expect(phone.state.jobs[0]).toMatchObject({
        id: persisted.id,
        taskId: 'task',
        state: 'queued',
        createdBy: 'phone'
      })
      expect(cloudJobBoardNotice(phone.state)).toBe('Dispatch is paused.')
      expect(
        calls.every((method) =>
          ['jobs.status', 'jobs.snapshot', 'jobs.events', 'jobs.get'].includes(method)
        )
      ).toBe(true)
      desktop.dispose()
      phone.dispose()
    } finally {
      service.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('labels all eight execution states without treating review/failure as Done', () => {
    expect(CLOUD_JOB_LABELS).toEqual({
      queued: 'Queued',
      waiting_for_worker: 'Waiting',
      running: 'Running',
      needs_review: 'Needs review',
      completed: 'Done',
      failed: 'Failed',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted'
    })
    expect(cloudJobBoardNotice(emptyCloudJobBoard())).toContain('Choose')
  })
  it('continues empty permission-filtered snapshot pages and applies events only after the full snapshot', async () => {
    const order: string[] = []
    const { reader } = source(async (method, params) => {
      order.push(method)
      if (method === 'jobs.status') {
        return status
      }
      if (method === 'jobs.snapshot') {
        return (params as { cursor?: string }).cursor ? page([job()]) : page([], 'opaque:next')
      }
      return events((params as { after: number }).after)
    })
    await reader.refresh()
    expect(reader.state.jobs[0]?.id).toBe('job')
    expect(order).toEqual(['jobs.status', 'jobs.snapshot', 'jobs.snapshot', 'jobs.events'])
    expect(reader.state.phase).toBe('ready')
    expect(cloudJobBoardNotice(reader.state)).toBe('Dispatch is paused.')
  })
  it('uses the captured watermark and drains denied-only event batches without stalling', async () => {
    const { reader, call } = source(async (method, params) => {
      if (method === 'jobs.status') {
        return status
      }
      if (method === 'jobs.snapshot') {
        return page()
      }
      const after = (params as { after: number }).after
      return { ...events(after), nextCursor: after === 5 ? 8 : after }
    })
    await reader.refresh()
    expect(call).toHaveBeenCalledWith('jobs.events', { after: 5, limit: 200 })
    expect(call).toHaveBeenCalledWith('jobs.events', { after: 8, limit: 200 })
  })
  it('converges repeated/out-of-order job versions to the newer job', async () => {
    const { reader } = source(async (method, params) => {
      if (method === 'jobs.status') {
        return status
      }
      if (method === 'jobs.snapshot') {
        return page()
      }
      if (method === 'jobs.get') {
        return { job: job(3, 'needs_review') }
      }
      const after = (params as { after: number }).after
      return after === 5
        ? {
            ...events(8),
            events: [
              { sequence: 6, jobId: 'job', version: 2, state: 'running', at: 6, reason: 'started' },
              { sequence: 7, jobId: 'job', version: 1, state: 'queued', at: 5, reason: 'old' },
              {
                sequence: 8,
                jobId: 'job',
                version: 3,
                state: 'needs_review',
                at: 8,
                reason: 'ready'
              }
            ]
          }
        : events(after)
    })
    await reader.refresh()
    expect(reader.state.jobs).toEqual([job(3, 'needs_review')])
  })
  it.each(['generation', 'resetRequired'])(
    'restarts snapshot when events signal %s',
    async (signal) => {
      let first = true
      const { reader, call } = source(async (method, params) => {
        if (method === 'jobs.status') {
          return status
        }
        if (method === 'jobs.snapshot') {
          return page()
        }
        const after = (params as { after: number }).after
        if (first) {
          first = false
          return { ...events(after), [signal]: signal === 'generation' ? 'restored' : true }
        }
        return events(after)
      })
      await reader.refresh()
      expect(call.mock.calls.filter(([method]) => method === 'jobs.snapshot')).toHaveLength(2)
      expect(reader.state.phase).toBe('ready')
    }
  )
  it('discards late old-host replies after disposal without issuing further calls', async () => {
    let release!: (value: unknown) => void
    const { reader, call } = source(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const publish = vi.fn()
    reader.subscribe(publish)
    const request = reader.refresh()
    reader.dispose()
    release(status)
    await request
    expect(publish).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('clears a revoked job even when revocation produces no job event', async () => {
    let allowed = true
    const { reader } = source(async (method, params) =>
      method === 'jobs.status'
        ? status
        : method === 'jobs.snapshot'
          ? page(allowed ? [job()] : [])
          : events((params as { after: number }).after)
    )
    await reader.refresh()
    allowed = false
    await reader.refresh()
    expect(reader.state.jobs).toEqual([])
  })
  it('clears all cached data after denied get/access and distinguishes stale from offline', async () => {
    const { reader, call } = source()
    await reader.refresh()
    call.mockRejectedValueOnce(new Error('Network disconnected'))
    await reader.refresh()
    expect(reader.state.phase).toBe('stale')
    expect(reader.state.jobs).toHaveLength(1)
    call.mockRejectedValueOnce(
      Object.assign(new Error('Cloud job access denied'), { code: 'forbidden' })
    )
    await reader.refresh()
    expect(reader.state.phase).toBe('denied')
    expect(reader.state.jobs).toEqual([])
    const other = source()
    other.call.mockRejectedValueOnce(new Error('Network disconnected'))
    await other.reader.refresh()
    expect(other.reader.state.phase).toBe('offline')
  })
  it.each([
    { generation: 'g1', eventCursor: -1, jobs: [], nextCursor: null },
    page([], 'x'.repeat(1025)),
    page([{ ...job(), state: 'fake-done' }] as never)
  ])('refuses malformed snapshots instead of presenting an empty healthy board', async (bad) => {
    const { reader } = source(async (method) => (method === 'jobs.status' ? status : bad))
    await reader.refresh()
    expect(reader.state.phase).toBe('unavailable')
    expect(reader.state.jobs).toEqual([])
  })
  it('accepts opaque 1024-character cursors without decoding or rewriting them', async () => {
    const cursor = 'x'.repeat(1024)
    const { reader, call } = source(async (method, params) =>
      method === 'jobs.status'
        ? status
        : method === 'jobs.snapshot'
          ? (params as { cursor?: string }).cursor
            ? page()
            : page([], cursor)
          : events((params as { after: number }).after)
    )
    await reader.refresh()
    expect(reader.state.phase).toBe('ready')
    expect(call).toHaveBeenCalledWith('jobs.snapshot', { limit: 200, cursor })
  })
  it('clears unconfigured authority data and refuses repeated paging cursors', async () => {
    const { reader, call } = source()
    await reader.refresh()
    call.mockResolvedValueOnce({
      configured: false,
      dispatchEnabled: false,
      liveDispatchReady: false
    })
    await reader.refresh()
    expect(reader.state.phase).toBe('unconfigured')
    expect(reader.state.jobs).toEqual([])
    const repeated = source(async (method) =>
      method === 'jobs.status' ? status : page([], 'repeat')
    )
    await repeated.reader.refresh()
    expect(repeated.reader.state.phase).toBe('unavailable')
  })
})

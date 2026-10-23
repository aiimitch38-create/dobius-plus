import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudJobService } from '../../../automations/cloud-job-service'
import { CloudJobStore } from '../../../automations/cloud-jobs/store'
import { RpcDispatcher } from '../dispatcher'
import { CLOUD_JOB_METHODS } from './cloud-jobs'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcContext } from '../core'

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})
const runtime = { getRuntimeId: () => 'test-runtime' } as DobiusRuntimeService
const request = (method: string, params?: unknown) => ({
  id: 'r',
  authToken: 'transport-auth',
  method,
  params
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-job-rpc-')))
  const service = new CloudJobService({
    openStore: () => new CloudJobStore(':memory:', Date.now, { localDeviceId: 'laptop' }),
    canUseWorkspace: async (_caller, workspace) => workspace === 'workspace'
  })
  service.registerProject(
    { kind: 'local', id: 'local' },
    {
      id: 'project',
      deviceId: 'laptop',
      root,
      capability: 'portable',
      recipes: ['test']
    }
  )
  const dispatcher = new RpcDispatcher({ runtime, cloudJobs: service, methods: CLOUD_JOB_METHODS })
  cleanups.push(() => {
    service.close()
    rmSync(root, { recursive: true, force: true })
  })
  const input = {
    requestKey: 'request',
    taskId: 'task',
    projectId: 'project',
    workspaceId: 'workspace',
    targetDeviceId: 'laptop',
    recipeId: 'test',
    title: 'Job',
    sourceRevision: 'a'.repeat(40),
    estimatedBytes: 1,
    dependencies: []
  }
  return { dispatcher, input, service }
}

async function paired(
  dispatcher: RpcDispatcher,
  method: string,
  params?: unknown,
  deviceId: string | null = 'phone'
) {
  const replies: string[] = []
  await dispatcher.dispatchStreaming(
    request(method, params),
    (r) => {
      replies.push(r)
    },
    {
      clientId: 'private-device-token',
      clientDeviceId: deviceId ?? undefined,
      clientKind: 'mobile'
    }
  )
  return JSON.parse(replies[0]!)
}

describe('cloud job RPC boundary', () => {
  it('reports unavailable authority instead of creating a competing queue', async () => {
    const dispatcher = new RpcDispatcher({ runtime, methods: CLOUD_JOB_METHODS })
    expect(await dispatcher.dispatch(request('jobs.status'))).toMatchObject({
      ok: true,
      result: { configured: false }
    })
    expect(await dispatcher.dispatch(request('jobs.list', {}))).toMatchObject({ ok: false })
  })

  it('never stores a bearer token as creator and rejects creator spoofing', async () => {
    const f = fixture()
    expect(await paired(f.dispatcher, 'jobs.submit', f.input)).toMatchObject({
      ok: true,
      result: { job: { createdBy: 'phone' } }
    })
    expect(
      await paired(f.dispatcher, 'jobs.submit', { ...f.input, createdBy: 'local' })
    ).toMatchObject({ ok: false })
    const response = await f.dispatcher.dispatch(request('jobs.list', {}), {
      authenticatedLocal: true
    })
    expect(JSON.stringify(response)).not.toContain('private-device-token')
  })

  it('refuses paired identity without the authenticated registry device id', async () => {
    const f = fixture()
    expect(await paired(f.dispatcher, 'jobs.submit', f.input, null)).toMatchObject({ ok: false })
  })

  it('does not promote either half-paired identity or an unmarked local call', async () => {
    const registerProject = vi.fn()
    const handler = CLOUD_JOB_METHODS.find((method) => method.name === 'jobs.registerProject')!
    const f = fixture()
    const project = {
      id: 'other',
      deviceId: 'laptop',
      root: '/',
      capability: 'portable',
      recipes: ['test']
    }
    for (const identity of [{ clientId: 'token' }, { clientDeviceId: 'device' }, {}]) {
      const context = {
        runtime,
        cloudJobs: { registerProject },
        ...identity
      } as unknown as RpcContext
      await expect(
        Promise.resolve().then(() => handler.handler(project, context))
      ).rejects.toThrow()
    }
    expect(registerProject).not.toHaveBeenCalled()
    expect(
      await f.dispatcher.dispatch(request('jobs.setDispatch', { enabled: false }))
    ).toMatchObject({ ok: false })
    expect(
      await f.dispatcher.dispatch(request('jobs.setDispatch', { enabled: false }), {
        authenticatedLocal: true
      })
    ).toMatchObject({ ok: true })
  })

  it('rejects transport-identity spoofing in request parameters', async () => {
    const f = fixture()
    expect(
      await paired(f.dispatcher, 'jobs.setDispatch', { enabled: false, authenticatedLocal: true })
    ).toMatchObject({ ok: false })
  })

  it('does not accept registration, dispatch or completion authority from paired clients', async () => {
    const f = fixture()
    expect(await paired(f.dispatcher, 'jobs.setDispatch', { enabled: true })).toMatchObject({
      ok: false
    })
    expect(
      await paired(f.dispatcher, 'jobs.accept', { id: 'job', version: 1, receiptId: 'fake' })
    ).toMatchObject({ ok: false })
  })

  it('bounds snapshot/event requests and refuses extra target parameters', async () => {
    const f = fixture()
    expect(await f.dispatcher.dispatch(request('jobs.events', { limit: 201 }))).toMatchObject({
      ok: false
    })
    expect(
      await f.dispatcher.dispatch(request('jobs.list', { creator: 'someone-else' }))
    ).toMatchObject({ ok: false })
    expect(await f.dispatcher.dispatch(request('jobs.events', { after: -1 }))).toMatchObject({
      ok: false
    })
  })
})

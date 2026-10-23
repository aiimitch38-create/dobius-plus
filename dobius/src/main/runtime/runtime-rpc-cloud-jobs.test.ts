import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CloudJobService } from '../automations/cloud-job-service'
import { CloudJobStore } from '../automations/cloud-jobs/store'
import type { DobiusRuntimeService } from './dobius-runtime'
import { DobiusRuntimeRpcServer } from './runtime-rpc'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((close) => close()))

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-job-transport-')))
  const service = new CloudJobService({
    openStore: () => new CloudJobStore(':memory:', Date.now, { localDeviceId: 'laptop' }),
    canUseWorkspace: async () => false
  })
  const runtime = { getRuntimeId: () => 'test-runtime' } as DobiusRuntimeService
  const server = new DobiusRuntimeRpcServer({ runtime, userDataPath: root, cloudJobs: service })
  cleanup.push(() => {
    service.close()
    rmSync(root, { recursive: true, force: true })
  })
  const project = {
    id: 'project',
    deviceId: 'laptop',
    root,
    recipes: ['test'],
    capability: 'portable'
  }
  const send = (method: string, params: unknown, authToken = server['authToken']) =>
    server['handleMessage'](JSON.stringify({ id: 'request', method, params, authToken }))
  return { server, service, project, send }
}

describe('cloud jobs authenticated local transport', () => {
  it('passes local authority only after the private runtime token is verified', async () => {
    const f = fixture()
    expect(await f.send('jobs.registerProject', f.project, 'wrong-token')).toMatchObject({
      ok: false
    })
    expect(await f.send('jobs.registerProject', f.project)).toMatchObject({
      ok: true,
      result: { registered: true }
    })
    expect(await f.send('jobs.setDispatch', { enabled: true })).toMatchObject({ ok: false })
    expect(await f.send('jobs.setDispatch', { enabled: false })).toMatchObject({
      ok: true,
      result: { dispatchEnabled: false, liveDispatchReady: false }
    })
  })

  it('does not accept a local marker from untrusted request fields', async () => {
    const f = fixture()
    expect(
      await f.server['handleMessage'](
        JSON.stringify({
          id: 'request',
          method: 'jobs.registerProject',
          params: f.project,
          authToken: 'wrong-token',
          authenticatedLocal: true
        })
      )
    ).toMatchObject({ ok: false })
    expect(
      await f.send('jobs.registerProject', { ...f.project, authenticatedLocal: true })
    ).toMatchObject({ ok: false })
    expect(await f.send('jobs.list', {})).toMatchObject({ ok: true, result: { jobs: [] } })
  })
})

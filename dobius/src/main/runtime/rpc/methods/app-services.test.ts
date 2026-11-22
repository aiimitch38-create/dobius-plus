import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

// Why: these modules import electron (or the updater) at module scope.
vi.mock('electron', () => ({ app: { getVersion: () => '2.1.9' } }))
vi.mock('./crew-confirm', () => ({ appConfirmationGate: vi.fn() }))
vi.mock('../../../updater-status-access', () => ({
  updateStatusForRuntime: vi.fn(() => ({ state: 'idle' }))
}))
vi.mock('../../../ipc/feedback', () => ({ submitFeedback: vi.fn() }))
vi.mock('../../../imessage-bridge/bridge-service', () => ({
  getImessageBridgeStatus: vi.fn(() => ({ enabled: true, selfHandle: '+15550001111' }))
}))
const backup = vi.hoisted(() => ({ getStatus: vi.fn(), start: vi.fn() }))
vi.mock('../../../cloud-backup/desktop-controller', () => ({
  desktopCloudBackupController: () => backup
}))
vi.mock('../../../ipc/knowledge-access', () => ({
  knowledgeTreeForRuntime: vi.fn(() => ({ branches: [] })),
  readKnowledgeFileForRuntime: vi.fn((path: string) => ({ content: 'x', filePath: path }))
}))
vi.mock('../../../ipc/usage-access', () => ({
  usageSummaryForRuntime: vi.fn(async () => ({ summary: {} })),
  rateLimitsForRuntime: vi.fn(async () => ({ claude: null }))
}))

import { rateLimitsForRuntime, usageSummaryForRuntime } from '../../../ipc/usage-access'
import { buildAppServiceMethods } from './app-services'
import { createConfirmationGate } from './confirm-gate'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
const confirm = vi.fn<(request: { detail: string }, signal: AbortSignal) => Promise<boolean>>()
const submitFeedback = vi.fn()
const methods = buildAppServiceMethods(createConfirmationGate(confirm, { cooldownMs: 0 }), {
  submitFeedback
})

function call(method: string, params?: unknown, agentKey = false) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request, {
    ...(agentKey ? { agentKey: true as const } : {})
  })
}

const CONFIGURED = {
  supported: true,
  configured: true,
  enabled: true,
  health: 'healthy',
  detail: '',
  bucket: 'my-bucket',
  region: 'us-east-1'
}

describe('app service RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
    backup.getStatus.mockReturnValue(CONFIGURED)
    backup.start.mockResolvedValue({ ...CONFIGURED, health: 'running' })
    submitFeedback.mockResolvedValue({ ok: true })
  })

  it('reads usage with defaults and limits without a refresh unless asked', async () => {
    await call('usage.summary', {})
    expect(usageSummaryForRuntime).toHaveBeenCalledWith('claude', 'all', '7d')
    await call('usage.rateLimits', { refresh: true })
    expect(rateLimitsForRuntime).toHaveBeenCalledWith(true)
    expect(await call('usage.summary', { provider: 'gpt' })).toMatchObject({ ok: false })
  })

  it('reports version and update status only', async () => {
    expect(await call('app.updateStatus')).toMatchObject({
      ok: true,
      result: { version: '2.1.9', update: { state: 'idle' } }
    })
  })

  it('hides Carson’s own iMessage handle from the agent key', async () => {
    expect(await call('imessage.status')).toMatchObject({ result: { selfHandle: '+15550001111' } })
    expect(await call('imessage.status', undefined, true)).toMatchObject({
      result: { selfHandle: 'set' }
    })
  })

  it('starts a backup only after the human confirms', async () => {
    expect(await call('backup.run')).toMatchObject({ ok: true, result: { health: 'running' } })
    expect(confirm.mock.calls[0][0].detail).toContain('my-bucket')
    confirm.mockResolvedValue(false)
    backup.start.mockClear()
    expect(await call('backup.run')).toMatchObject({ ok: false })
    expect(backup.start).not.toHaveBeenCalled()
  })

  it('does not ask to back up when backups are not connected or already running', async () => {
    backup.getStatus.mockReturnValue({ ...CONFIGURED, configured: false, detail: 'Connect AWS.' })
    expect(JSON.stringify(await call('backup.run'))).toContain('Connect AWS.')
    backup.getStatus.mockReturnValue({ ...CONFIGURED, health: 'running' })
    expect(JSON.stringify(await call('backup.run'))).toContain('already running')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not start a backup whose destination changed while the dialog was open', async () => {
    confirm.mockImplementation(async () => {
      backup.getStatus.mockReturnValue({ ...CONFIGURED, bucket: 'other-bucket' })
      return true
    })
    expect(JSON.stringify(await call('backup.run'))).toContain('settings changed')
    expect(backup.start).not.toHaveBeenCalled()
  })

  it('refuses feedback with hidden characters before any dialog', async () => {
    for (const text of ['hi\u200b', 'tag\u{E0041}', 'rtl\u202e']) {
      expect(JSON.stringify(await call('feedback.submit', { text }))).toContain('hidden')
    }
    expect(confirm).not.toHaveBeenCalled()
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it('sends feedback only after confirming, and reports a failed send', async () => {
    expect(await call('feedback.submit', { text: 'Board froze' })).toMatchObject({
      ok: true,
      result: { sent: true }
    })
    expect(submitFeedback).toHaveBeenCalledWith('Board froze')
    submitFeedback.mockResolvedValue({ ok: false, status: 500, error: 'status 500' })
    expect(JSON.stringify(await call('feedback.submit', { text: 'again' }))).toContain(
      'could not be sent'
    )
    confirm.mockResolvedValue(false)
    submitFeedback.mockClear()
    expect(await call('feedback.submit', { text: 'no' })).toMatchObject({ ok: false })
    expect(submitFeedback).not.toHaveBeenCalled()
    expect(await call('feedback.submit', { text: 'x'.repeat(1501) })).toMatchObject({ ok: false })
  })
})

import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelegramAccountApi } from '../../shared/telegram-account-api'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => Promise<unknown>>()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: never) => mocks.handlers.set(name, handler) }
}))
import {
  registerTelegramAccountHandlers,
  setTrustedTelegramAccountRenderer
} from './telegram-account'

function event(id = 42): IpcMainInvokeEvent {
  const frame = { detached: false }
  return {
    sender: { id, mainFrame: frame, isDestroyed: () => false },
    senderFrame: frame
  } as unknown as IpcMainInvokeEvent
}

function api() {
  return {
    getSnapshot: vi.fn(async () => ({ account: { phase: 'disconnected' }, groups: [], audit: [] })),
    beginSignIn: vi.fn(async () => {}),
    submitCode: vi.fn(async () => {}),
    submitPassword: vi.fn(async () => {}),
    cancelSignIn: vi.fn(async () => {}),
    refreshGroups: vi.fn(async () => []),
    saveGroups: vi.fn(async () => {}),
    getParticipants: vi.fn(async () => []),
    grantConsent: vi.fn(async () => undefined),
    revokeConsent: vi.fn(async () => undefined),
    startReplies: vi.fn(async () => undefined),
    stopReplies: vi.fn(async () => undefined),
    approveDraft: vi.fn(async () => {}),
    sendDraft: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    revoke: vi.fn(async () => {})
  }
}

function invoke(name: keyof TelegramAccountApi, input?: unknown, sender = event()) {
  return mocks.handlers.get(`telegramAccount:${name}`)!(sender, input)
}

beforeEach(() => {
  mocks.handlers.clear()
  setTrustedTelegramAccountRenderer(42)
})

describe('desktop-only Telegram account IPC', () => {
  it('refuses every control from other windows before touching the account service', async () => {
    const service = api()
    registerTelegramAccountHandlers(service as unknown as TelegramAccountApi)
    for (const name of Object.keys(service) as (keyof TelegramAccountApi)[]) {
      await expect(invoke(name, undefined, event(99))).rejects.toThrow('desktop settings')
      expect(service[name]).not.toHaveBeenCalled()
    }
  })

  it('validates auth and group requests before invoking the service', async () => {
    const service = api()
    registerTelegramAccountHandlers(service as unknown as TelegramAccountApi)
    await expect(
      invoke('beginSignIn', { phoneNumber: 'x', session: 'must-not-cross' })
    ).rejects.toThrow('invalid-input')
    await expect(invoke('submitCode', { code: 123 })).rejects.toThrow('invalid-input')
    await expect(invoke('submitPassword', null)).rejects.toThrow('invalid-input')
    await expect(invoke('saveGroups', { groupIds: ['-1', '-2'] })).rejects.toThrow(
      'group-selection-required'
    )
    await expect(invoke('sendDraft', { draftId: 'x', expectedRevision: 1.5 })).rejects.toThrow(
      'invalid-input'
    )
    expect(service.beginSignIn).not.toHaveBeenCalled()
    expect(service.saveGroups).not.toHaveBeenCalled()
    expect(service.sendDraft).not.toHaveBeenCalled()
  })

  it('validates individual participant requests and refuses blanket or renderer-supplied identities', async () => {
    const service = api()
    registerTelegramAccountHandlers(service as unknown as TelegramAccountApi)
    await expect(invoke('getParticipants', { groupId: 'all' })).rejects.toThrow('invalid-input')
    await expect(
      invoke('grantConsent', {
        groupId: '-101',
        senderId: '88',
        evidence: 'Explicit participant consent',
        expiresAt: Date.now() + 10000,
        displayName: 'Forged name'
      })
    ).rejects.toThrow('invalid-input')
    await expect(
      invoke('grantConsent', {
        groupId: '-101',
        senderId: '*',
        evidence: 'Explicit participant consent',
        expiresAt: Date.now() + 10000
      })
    ).rejects.toThrow('invalid-input')
    await expect(
      invoke('grantConsent', {
        groupId: '-101',
        senderId: '88',
        evidence: 'yes',
        expiresAt: Date.now() + 10000
      })
    ).rejects.toThrow('invalid-input')
    await expect(
      invoke('grantConsent', {
        groupId: '-101',
        senderId: '88',
        evidence: 'Explicit participant consent',
        expiresAt: 1
      })
    ).rejects.toThrow('invalid-input')
    await expect(invoke('revokeConsent', { groupId: '-101', senderId: 'all' })).rejects.toThrow(
      'invalid-input'
    )
    expect(service.grantConsent).not.toHaveBeenCalled()
    const grant = {
      groupId: '-101',
      senderId: '88',
      evidence: 'Explicit participant consent',
      expiresAt: Date.now() + 10000
    }
    await invoke('getParticipants', { groupId: '-101' })
    await invoke('grantConsent', grant)
    await invoke('revokeConsent', { groupId: '-101', senderId: '88' })
    await invoke('startReplies')
    await invoke('stopReplies')
    expect(service.grantConsent).toHaveBeenCalledWith(grant)
    expect(service.revokeConsent).toHaveBeenCalledWith({ groupId: '-101', senderId: '88' })
    expect(service.startReplies).toHaveBeenCalledOnce()
    expect(service.stopReplies).toHaveBeenCalledOnce()
  })

  it('redacts arbitrary transport exceptions and permits only known error codes', async () => {
    const service = api()
    service.submitCode.mockRejectedValueOnce(new Error('secret-otp-or-session'))
    service.submitCode.mockRejectedValueOnce(new Error('stale-operation'))
    registerTelegramAccountHandlers(service as unknown as TelegramAccountApi)
    await expect(invoke('submitCode', { code: 'fake' })).rejects.toThrow(/^authorization-failed$/)
    await expect(invoke('submitCode', { code: 'fake' })).rejects.toThrow(/^stale-operation$/)
  })

  it('does not serialize pause/disconnect behind a pending sign-in', async () => {
    let finish!: () => void
    const service = api()
    service.beginSignIn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    registerTelegramAccountHandlers(service as unknown as TelegramAccountApi)
    const signingIn = invoke('beginSignIn', { phoneNumber: '+15555550123' })
    await invoke('pause')
    await invoke('cancelSignIn')
    await invoke('disconnect')
    await invoke('revoke')
    expect(service.pause).toHaveBeenCalledOnce()
    expect(service.cancelSignIn).toHaveBeenCalledOnce()
    expect(service.disconnect).toHaveBeenCalledOnce()
    expect(service.revoke).toHaveBeenCalledOnce()
    finish()
    await signingIn
  })

  it('does not return a result to a replaced renderer after awaiting', async () => {
    let finish!: () => void
    const service = api()
    service.submitPassword.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    registerTelegramAccountHandlers(service as unknown as TelegramAccountApi)
    const pending = invoke('submitPassword', { password: 'fake-transient' })
    setTrustedTelegramAccountRenderer(null)
    finish()
    await expect(pending).rejects.toThrow('desktop settings')
  })
})

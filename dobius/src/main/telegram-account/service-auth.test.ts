import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

import { TelegramAccountService } from './service'
import {
  MemoryTelegramVault,
  FakeTelegramClient,
  TEST_CODE,
  TEST_PASSWORD,
  TEST_SESSION
} from './test-support'

describe('Telegram personal account authentication', () => {
  it('is disabled by default and refuses unavailable secure storage before requesting a code', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    const disabled = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null
    })
    expect((await disabled.beginSignIn('+15555550123')).ok).toBe(false)
    expect(client.requestCode).not.toHaveBeenCalled()

    vault.available = false
    const enabled = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    expect(await enabled.beginSignIn('+15555550123')).toEqual({
      ok: false,
      error: 'secure-storage-unavailable'
    })
    expect(client.requestCode).not.toHaveBeenCalled()
  })

  it('keeps code handles, OTP, 2FA password, and session out of snapshots and audits', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    client.authOutcome = { kind: 'password-required' }
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })

    expect((await service.beginSignIn('+15555550123')).ok).toBe(true)
    expect(await service.submitCode(TEST_CODE)).toEqual({ ok: true, value: undefined })
    expect(service.snapshot().phase).toBe('awaiting-password')
    client.authOutcome = { kind: 'authorized', identity: { userId: '77' }, session: TEST_SESSION }
    expect(await service.submitPassword(TEST_PASSWORD)).toEqual({ ok: true, value: undefined })
    const exposed = JSON.stringify({ snapshot: service.snapshot(), audit: service.auditSnapshot() })
    for (const secret of [
      '+15555550123',
      'ephemeral-handle',
      TEST_CODE,
      TEST_PASSWORD,
      TEST_SESSION
    ]) {
      expect(exposed).not.toContain(secret)
    }
    expect(vault.state.session).toBe(TEST_SESSION)
    expect(client.submitCode).toHaveBeenCalledWith(
      'ephemeral-handle',
      TEST_CODE,
      expect.any(AbortSignal)
    )
    expect(client.submitPassword).toHaveBeenCalledWith(TEST_PASSWORD, expect.any(AbortSignal))
  })

  it('limits sign-in retries and expires the transient authorization flow', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    const now = vi.fn(() => 1_000)
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true,
      now
    })
    await service.beginSignIn('+15555550123')
    now.mockReturnValue(700_000)
    expect(await service.submitCode(TEST_CODE)).toEqual({ ok: false, error: 'invalid-input' })
    expect(client.submitCode).not.toHaveBeenCalled()
  })

  it('cancels a pending login and rejects its late code-handle result after pause', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    const deferred: { resolve?: (value: { codeHandle: string }) => void } = {}
    client.requestCode = vi.fn(
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve
        })
    )
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    const pending = service.beginSignIn('+15555550123')
    await service.pause()
    deferred.resolve?.({ codeHandle: 'late-private-handle' })
    expect(await pending).toEqual({ ok: false, error: 'stale-operation' })
    expect(service.snapshot().phase).toBe('disconnected')
    expect(vault.state.session).toBeNull()
  })

  it('rejects saved-session identity mismatch without reporting connected', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    vault.state = {
      schemaVersion: 2,
      account: { userId: '77' },
      session: TEST_SESSION,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: []
    }
    client.identity = { userId: '999' }
    client.connect.mockResolvedValue(client.identity)
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    expect(await service.restore()).toEqual({ ok: false, error: 'account-mismatch' })
    expect(service.snapshot().connected).toBe(false)
    expect(vault.state.session).toBeNull()
  })

  it('selects exactly three server-verified groups, never a DM or channel', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    vault.state = {
      schemaVersion: 2,
      account: { userId: '77' },
      session: TEST_SESSION,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: []
    }
    expect((await service.restore()).ok).toBe(true)
    expect(await service.selectGroups(['-1001', '-1002', '44'])).toEqual({
      ok: false,
      error: 'group-selection-required'
    })
    expect(await service.selectGroups(['-1001', '-1001', '-1003'])).toEqual({
      ok: false,
      error: 'invalid-input'
    })
    expect((await service.selectGroups(['-1001', '-1002', '-1003'])).ok).toBe(true)
    expect(service.snapshot().selectedGroups.map((group) => group.id)).toEqual([
      '-1001',
      '-1002',
      '-1003'
    ])
    expect(service.snapshot().selectedGroups).toHaveLength(3)
  })

  it('lists only server-verified groups and reconnects a paused saved account', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    vault.state = {
      schemaVersion: 2,
      account: { userId: '77' },
      session: TEST_SESSION,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: []
    }
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    expect(await service.restore()).toEqual({ ok: true, value: undefined })
    const listed = await service.listGroups()
    expect(listed).toEqual({
      ok: true,
      value: [
        { id: '-1001', title: 'Build', kind: 'supergroup' },
        { id: '-1002', title: 'Design', kind: 'group' },
        { id: '-1003', title: 'Support', kind: 'supergroup' }
      ]
    })
    await service.pause()
    expect(service.snapshot().connected).toBe(false)
    expect(await service.resume()).toEqual({ ok: true, value: undefined })
    expect(service.snapshot().connected).toBe(true)
  })

  it('cancels an in-flight sign-in and refuses its late authorization handle', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    const deferred: { resolve?: (value: { codeHandle: string }) => void } = {}
    client.requestCode = vi.fn(
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve
        })
    )
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    const pending = service.beginSignIn('+15555550123')
    await service.cancelSignIn()
    deferred.resolve?.({ codeHandle: 'late-private-handle' })
    expect(await pending).toEqual({ ok: false, error: 'stale-operation' })
    expect(service.snapshot().phase).toBe('disconnected')
    expect(client.disconnected).toBe(1)
  })

  it('remotely revokes through the client before clearing the encrypted session', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    vault.state = {
      schemaVersion: 2,
      account: { userId: '77' },
      session: TEST_SESSION,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: []
    }
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    await service.restore()
    expect(await service.revoke()).toEqual({ ok: true, value: undefined })
    expect(client.revokeAuthorization).toHaveBeenCalledOnce()
    expect(vault.state).toMatchObject({ account: null, session: null, groups: [] })
    expect(service.snapshot().phase).toBe('disconnected')
  })

  it('retains the local session if remote revocation is not confirmed', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    client.revokeOutcome = false
    vault.state = {
      schemaVersion: 2,
      account: { userId: '77' },
      session: TEST_SESSION,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: []
    }
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    await service.restore()
    expect(await service.revoke()).toEqual({ ok: false, error: 'authorization-failed' })
    expect(vault.state.session).toBe(TEST_SESSION)
    expect(service.snapshot().connected).toBe(false)
  })

  it('refuses remote revocation when the concrete adapter does not expose it', async () => {
    const vault = new MemoryTelegramVault()
    const client = new FakeTelegramClient()
    Reflect.deleteProperty(client, 'revokeAuthorization')
    vault.state = {
      schemaVersion: 2,
      account: { userId: '77' },
      session: TEST_SESSION,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: []
    }
    const service = new TelegramAccountService({
      vault,
      createClient: () => client,
      replyToAdam: null,
      readConsent: null,
      enabled: true
    })
    await service.restore()
    expect(await service.revoke()).toEqual({ ok: false, error: 'client-unavailable' })
    expect(vault.state.session).toBe(TEST_SESSION)
  })
})

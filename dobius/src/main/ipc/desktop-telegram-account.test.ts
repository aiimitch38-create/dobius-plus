import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeTelegramClient,
  GROUPS,
  TEST_CODE,
  TEST_SESSION
} from '../telegram-account/test-support'

const mocks = vi.hoisted(() => ({ directory: '', factory: vi.fn(), quitting: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory, once: mocks.quitting },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    // Synthetic encryption only; no OS credential store is touched by these tests.
    encryptString: (input: string) => Buffer.from(Buffer.from(input).toString('base64')),
    decryptString: (input: Buffer) => Buffer.from(input.toString(), 'base64').toString()
  }
}))
vi.mock('../telegram-account-mtproto', () => ({
  createGramJsPersonalTelegramClientFactory: (...args: unknown[]) => mocks.factory(...args)
}))
import { createDesktopTelegramAccountApi } from './desktop-telegram-account'

const application = { apiId: 456789, apiHash: '1234567890abcdef1234567890abcdef' }
let client: FakeTelegramClient
beforeEach(() => {
  mocks.directory = mkdtempSync(join(tmpdir(), 'telegram-desktop-integration-'))
  client = new FakeTelegramClient()
  mocks.factory.mockReset().mockImplementation(() => () => client)
  mocks.quitting.mockReset()
})
afterEach(() => rmSync(mocks.directory, { recursive: true, force: true }))

async function connect() {
  const api = createDesktopTelegramAccountApi()
  await api.beginSignIn({ phoneNumber: '+15555550123', ...application })
  await api.submitCode({ code: TEST_CODE })
  return api
}

describe('desktop Telegram account composition', () => {
  it('does not open a transport or read credentials for a new installation', async () => {
    const api = createDesktopTelegramAccountApi()
    expect((await api.getSnapshot()).account.phase).toBe('disconnected')
    expect(mocks.factory).not.toHaveBeenCalled()
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('connects through the protected credential/session boundary without enabling Adam ingestion', async () => {
    const api = await connect()
    expect(mocks.factory).toHaveBeenCalledWith(application)
    const snapshot = await api.getSnapshot()
    expect(snapshot.account.connected).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain(application.apiHash)
    expect(JSON.stringify(snapshot)).not.toContain(TEST_SESSION)
    for (const name of ['application.enc', 'account.enc']) {
      const raw = readFileSync(join(mocks.directory, 'telegram-personal-account', name), 'utf8')
      expect(raw).not.toContain(application.apiHash)
      expect(raw).not.toContain(TEST_SESSION)
    }
    expect(client.subscribe).not.toHaveBeenCalled()
    expect(client.sendText).not.toHaveBeenCalled()
    await expect(api.beginSignIn({ phoneNumber: '+15555550123' })).rejects.toThrow(
      'stale-operation'
    )
    await api.resume()
    expect(mocks.factory).toHaveBeenCalledOnce()
  })

  it('lists only verified groups and persists exactly three selected group identities', async () => {
    const api = await connect()
    expect(await api.refreshGroups()).toEqual(GROUPS.slice(0, 3))
    await api.saveGroups({ groupIds: GROUPS.slice(0, 3).map((group) => group.id) })
    expect((await api.getSnapshot()).account.selectedGroups).toEqual(GROUPS.slice(0, 3))
    await expect(api.saveGroups({ groupIds: ['44', '-1001', '-1002'] })).rejects.toThrow()
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('does not return group metadata after pause interrupts a pending refresh', async () => {
    const api = await connect()
    let finish!: (groups: typeof GROUPS) => void
    client.listDialogs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = api.refreshGroups()
    const refused = expect(pending).rejects.toThrow('stale-operation')
    await api.pause()
    finish(GROUPS)
    await refused
    expect((await api.getSnapshot()).groups).toEqual([])
  })

  it('restores a saved account after restart without re-requesting a login code or starting replies', async () => {
    await connect()
    const closing = mocks.quitting.mock.calls[0][1] as () => void
    closing()
    await vi.waitFor(() => expect(client.disconnect).toHaveBeenCalledOnce())
    client = new FakeTelegramClient()
    const restored = createDesktopTelegramAccountApi()
    await vi.waitFor(async () =>
      expect((await restored.getSnapshot()).account.connected).toBe(true)
    )
    expect(client.connect).toHaveBeenCalledWith(TEST_SESSION, expect.any(AbortSignal))
    expect(client.requestCode).not.toHaveBeenCalled()
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('keeps an explicit pause across restart until the user resumes', async () => {
    const first = await connect()
    await first.pause()
    client = new FakeTelegramClient()
    const restored = createDesktopTelegramAccountApi()
    expect((await restored.getSnapshot()).account.phase).toBe('paused')
    expect(client.connect).not.toHaveBeenCalled()
    await restored.resume()
    expect((await restored.getSnapshot()).account.connected).toBe(true)
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('performs actual adapter session revocation before reporting disconnection', async () => {
    const api = await connect()
    await api.revoke()
    expect(client.revokeAuthorization).toHaveBeenCalledOnce()
    expect((await api.getSnapshot()).account.phase).toBe('disconnected')
  })

  it('does not let a newer pause supersede a connected revoke during client shutdown', async () => {
    const api = await connect()
    let finishDisconnect!: () => void
    client.disconnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDisconnect = resolve
        })
    )

    const pendingRevoke = api.revoke()
    await vi.waitFor(() => expect(client.disconnect).toHaveBeenCalledOnce())
    const pendingPause = api.pause()
    await pendingPause
    finishDisconnect()

    await expect(pendingRevoke).rejects.toThrow('stale-operation')
    expect((await api.getSnapshot()).account.phase).toBe('paused')
    expect(
      readFileSync(join(mocks.directory, 'telegram-personal-account', 'reconnect.state'), 'utf8')
    ).toBe('paused-v1')
    expect(
      readFileSync(join(mocks.directory, 'telegram-personal-account', 'account.enc'), 'utf8')
    ).not.toContain(TEST_SESSION)
    expect(client.subscribe).not.toHaveBeenCalled()
    expect(client.sendText).not.toHaveBeenCalled()

    client = new FakeTelegramClient()
    const restarted = createDesktopTelegramAccountApi()
    expect((await restarted.getSnapshot()).account.phase).toBe('paused')
    expect(client.connect).not.toHaveBeenCalled()
  })

  it('can revoke a paused saved account after restart without enabling replies', async () => {
    const first = await connect()
    await first.pause()
    client = new FakeTelegramClient()
    const paused = createDesktopTelegramAccountApi()
    await paused.revoke()
    expect(client.connect).toHaveBeenCalledWith(TEST_SESSION, expect.any(AbortSignal))
    expect(client.revokeAuthorization).toHaveBeenCalledOnce()
    expect(client.subscribe).not.toHaveBeenCalled()
    expect((await paused.getSnapshot()).account.phase).toBe('disconnected')
    expect(
      readFileSync(join(mocks.directory, 'telegram-personal-account', 'reconnect.state'), 'utf8')
    ).toBe('disconnected-v1')
  })

  it('revokes after same-process pause without resuming message ingestion', async () => {
    const api = await connect()
    await api.pause()
    client = new FakeTelegramClient()
    await api.revoke()
    expect(client.connect).toHaveBeenCalledWith(TEST_SESSION, expect.any(AbortSignal))
    expect(client.revokeAuthorization).toHaveBeenCalledOnce()
    expect(client.subscribe).not.toHaveBeenCalled()
    expect(client.sendText).not.toHaveBeenCalled()
    expect(
      readFileSync(join(mocks.directory, 'telegram-personal-account', 'reconnect.state'), 'utf8')
    ).toBe('disconnected-v1')
  })

  it.each(['false', 'throws', 'connect-fails'] as const)(
    'preserves paused preference and encrypted session when paused revoke %s',
    async (failure) => {
      const api = await connect()
      await api.pause()
      const pausedClient = new FakeTelegramClient()
      if (failure === 'false') {
        pausedClient.revokeOutcome = false
      } else if (failure === 'throws') {
        pausedClient.revokeAuthorization.mockRejectedValue(new Error('synthetic logout failure'))
      } else {
        pausedClient.connect.mockRejectedValue(new Error('synthetic reconnect failure'))
      }
      client = pausedClient
      await expect(api.revoke()).rejects.toThrow('authorization-failed')
      expect(
        readFileSync(join(mocks.directory, 'telegram-personal-account', 'reconnect.state'), 'utf8')
      ).toBe('paused-v1')
      expect(
        readFileSync(join(mocks.directory, 'telegram-personal-account', 'account.enc'), 'utf8')
      ).not.toContain(TEST_SESSION)
      expect(pausedClient.subscribe).not.toHaveBeenCalled()
      expect(pausedClient.sendText).not.toHaveBeenCalled()

      client = new FakeTelegramClient()
      const restarted = createDesktopTelegramAccountApi()
      expect((await restarted.getSnapshot()).account.phase).toBe('paused')
      expect(client.connect).not.toHaveBeenCalled()
    }
  )

  it('does not let a superseded paused revoke overwrite a newer pause or attach a late client', async () => {
    const api = await connect()
    await api.pause()
    const lateClient = new FakeTelegramClient()
    let completeConnect!: (identity: typeof lateClient.identity) => void
    lateClient.connect.mockImplementation(
      () => new Promise((resolve) => (completeConnect = resolve))
    )
    client = lateClient
    const pendingRevoke = api.revoke()
    await vi.waitFor(() => expect(lateClient.connect).toHaveBeenCalledOnce())
    const pendingPause = api.pause()
    await expect(pendingRevoke).rejects.toThrow('stale-operation')
    await pendingPause
    const disconnectsBeforeLateConnect = lateClient.disconnect.mock.calls.length
    completeConnect(lateClient.identity)
    await vi.waitFor(() =>
      expect(lateClient.disconnect.mock.calls.length).toBeGreaterThan(disconnectsBeforeLateConnect)
    )
    expect(
      readFileSync(join(mocks.directory, 'telegram-personal-account', 'reconnect.state'), 'utf8')
    ).toBe('paused-v1')
    expect(lateClient.revokeAuthorization).not.toHaveBeenCalled()
    expect(lateClient.subscribe).not.toHaveBeenCalled()
    expect(lateClient.sendText).not.toHaveBeenCalled()
    expect((await api.getSnapshot()).account.phase).toBe('paused')
  })
})

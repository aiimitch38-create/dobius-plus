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
    encryptString: (input: string) => Buffer.from(Buffer.from(input).toString('base64')),
    decryptString: (input: Buffer) => Buffer.from(input.toString(), 'base64').toString()
  }
}))
vi.mock('../telegram-account-mtproto', () => ({
  createGramJsPersonalTelegramClientFactory: (...args: unknown[]) => mocks.factory(...args)
}))
import { createDesktopTelegramAccountApi } from './desktop-telegram-account'
let client: FakeTelegramClient
beforeEach(() => {
  mocks.directory = mkdtempSync(join(tmpdir(), 'telegram-restore-retry-'))
  client = new FakeTelegramClient()
  mocks.factory.mockReset().mockImplementation(() => () => client)
  mocks.quitting.mockReset()
})
afterEach(() => rmSync(mocks.directory, { recursive: true, force: true }))

describe('desktop saved Telegram restore recovery', () => {
  it('advertises saved-session retry after startup failure and retains exact groups and session', async () => {
    const first = createDesktopTelegramAccountApi()
    await first.beginSignIn({
      phoneNumber: '+15555550123',
      apiId: 456789,
      apiHash: '1234567890abcdef1234567890abcdef'
    })
    await first.submitCode({ code: TEST_CODE })
    await first.saveGroups({ groupIds: GROUPS.slice(0, 3).map((group) => group.id) })
    const oldClient = client
    const closing = mocks.quitting.mock.calls[0][1] as () => void
    closing()
    await vi.waitFor(() => expect(oldClient.disconnect).toHaveBeenCalled())
    client = new FakeTelegramClient()
    client.connect.mockRejectedValueOnce(new Error('synthetic restore failure'))
    const restored = createDesktopTelegramAccountApi()
    await vi.waitFor(async () => expect((await restored.getSnapshot()).account.phase).toBe('error'))
    const failed = await restored.getSnapshot()
    expect(failed.account.canResume).toBe(true)
    expect(failed.account.selectedGroups).toEqual(GROUPS.slice(0, 3))
    await restored.resume()
    const ready = await restored.getSnapshot()
    expect(ready.account.connected).toBe(true)
    expect(ready.account.canResume).toBe(true)
    expect(ready.account.selectedGroups).toEqual(GROUPS.slice(0, 3))
    expect(client.connect).toHaveBeenLastCalledWith(TEST_SESSION, expect.any(AbortSignal))
    expect(client.requestCode).not.toHaveBeenCalled()
    expect(client.subscribe).not.toHaveBeenCalled()
    expect(client.sendText).not.toHaveBeenCalled()
    const raw = readFileSync(
      join(mocks.directory, 'telegram-personal-account', 'account.enc'),
      'utf8'
    )
    expect(raw).not.toContain(TEST_SESSION)
    expect(JSON.parse(Buffer.from(raw, 'base64').toString()).session).toBe(TEST_SESSION)
  })

  it('does not advertise a saved-session retry for a new or disconnected account', async () => {
    const api = createDesktopTelegramAccountApi()
    expect((await api.getSnapshot()).account.canResume).toBe(false)
    await api.disconnect()
    expect((await api.getSnapshot()).account.canResume).toBe(false)
    expect(client.connect).not.toHaveBeenCalled()
  })
})

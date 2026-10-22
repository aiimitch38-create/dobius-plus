import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeTelegramClient,
  GROUPS,
  TEST_CODE,
  TEST_SESSION
} from '../telegram-account/test-support'

const mocks = vi.hoisted(() => ({ directory: '', factory: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory, once: vi.fn() },
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

class ParticipantClient extends FakeTelegramClient {
  listParticipants = vi.fn(async (groupId: string) => [
    { groupId, senderId: '88', displayName: 'Verified client' }
  ])
}
let client: ParticipantClient
beforeEach(() => {
  mocks.directory = mkdtempSync(join(tmpdir(), 'telegram-paused-consent-'))
  client = new ParticipantClient()
  mocks.factory.mockReset().mockImplementation(() => () => client)
})
afterEach(() => rmSync(mocks.directory, { recursive: true, force: true }))

async function savedAccount() {
  const api = createDesktopTelegramAccountApi()
  await api.beginSignIn({
    phoneNumber: '+15555550123',
    apiId: 456789,
    apiHash: '1234567890abcdef1234567890abcdef'
  })
  await api.submitCode({ code: TEST_CODE })
  await api.saveGroups({ groupIds: GROUPS.slice(0, 3).map((group) => group.id) })
  await api.grantConsent({
    groupId: '-1001',
    senderId: '88',
    evidence: 'Participant consent reference123',
    expiresAt: Date.now() + 86400000
  })
  return api
}

describe('desktop paused Telegram consent persistence', () => {
  it('reopens saved consent and withdraws it locally without restoring Telegram or losing login', async () => {
    const first = await savedAccount()
    expect((await first.getSnapshot()).consents).toHaveLength(1)
    await first.pause()
    client = new ParticipantClient()
    mocks.factory.mockClear()
    const reopened = createDesktopTelegramAccountApi()
    const view = await reopened.getSnapshot()
    expect(view.account.phase).toBe('paused')
    expect(view.consents?.[0]).toMatchObject({
      groupId: '-1001',
      senderId: '88',
      displayName: 'Verified client'
    })
    expect(mocks.factory).not.toHaveBeenCalled()
    await reopened.revokeConsent({ groupId: '-1001', senderId: '88' })
    expect((await reopened.getSnapshot()).consents).toEqual([])
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.listParticipants).not.toHaveBeenCalled()
    expect(client.subscribe).not.toHaveBeenCalled()
    expect(client.sendText).not.toHaveBeenCalled()
    expect(
      readFileSync(join(mocks.directory, 'telegram-personal-account', 'reconnect.state'), 'utf8')
    ).toBe('paused-v1')
    const rawSession = readFileSync(
      join(mocks.directory, 'telegram-personal-account', 'account.enc')
    )
    expect(rawSession.toString()).not.toContain(TEST_SESSION)
    expect(JSON.parse(Buffer.from(rawSession.toString(), 'base64').toString()).session).toBe(
      TEST_SESSION
    )
    await reopened.resume()
    expect(client.connect).toHaveBeenCalledWith(TEST_SESSION, expect.any(AbortSignal))
    expect((await reopened.getSnapshot()).account.connected).toBe(true)
    expect((await reopened.getSnapshot()).consents).toEqual([])
  })

  it('does not use disconnected session state as authority for consent mutation', async () => {
    const first = await savedAccount()
    await first.pause()
    const otherClient = new ParticipantClient()
    client = otherClient
    const reopened = createDesktopTelegramAccountApi()
    await reopened.disconnect()
    await expect(reopened.revokeConsent({ groupId: '-1001', senderId: '88' })).rejects.toThrow(
      'client-unavailable'
    )
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.sendText).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ safeStorage: {} }))
import { TelegramAccountService } from './service'
import { MemoryTelegramVault, FakeTelegramClient, TEST_SESSION, GROUPS } from './test-support'

function fixture() {
  const vault = new MemoryTelegramVault()
  const client = new FakeTelegramClient()
  const service = new TelegramAccountService({
    vault,
    createClient: () => client,
    replyToAdam: null,
    readConsent: null,
    enabled: true
  })
  return { vault, client, service }
}

describe('Telegram sign-in recovery controls', () => {
  it('returns a failed first sign-in to phone entry when explicitly restarted', async () => {
    const f = fixture()
    f.client.requestCode.mockRejectedValueOnce(new Error('synthetic failure'))
    await f.service.beginSignIn('+15555550123')
    expect(f.service.snapshot().phase).toBe('error')
    await f.service.cancelSignIn()
    expect(f.service.snapshot().phase).toBe('disconnected')
    expect(f.service.snapshot().lastError).toBeNull()
  })

  it('does not erase saved session or groups when leaving a reconnect error', async () => {
    const f = fixture()
    f.vault.state.account = { userId: '77' }
    f.vault.state.session = TEST_SESSION
    f.vault.state.groups = GROUPS.slice(0, 3).map((group) => ({
      ...group,
      kind: group.kind as 'group' | 'supergroup'
    }))
    const saved = structuredClone(f.vault.state)
    f.client.connect.mockRejectedValueOnce(new Error('synthetic restore failure'))
    await f.service.restore()
    expect(f.service.snapshot().phase).toBe('error')
    await f.service.cancelSignIn()
    expect(f.service.snapshot().phase).toBe('disconnected')
    expect(f.vault.state).toEqual(saved)
  })
})

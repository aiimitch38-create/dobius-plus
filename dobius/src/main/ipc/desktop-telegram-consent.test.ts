import { describe, expect, it, vi } from 'vitest'
import type { TelegramAccountService } from '../telegram-account/service'
import type { TelegramConsentAuthority } from '../telegram-account/consent-authority'
import type {
  TelegramParticipantSummary,
  TelegramGrantConsentInput
} from '../../shared/telegram-account-api'
import { createDesktopTelegramConsentControls } from './desktop-telegram-consent'

const participant = { groupId: '-101', senderId: '88', displayName: 'Name returned by Telegram' }
function grantInput(): TelegramGrantConsentInput {
  return {
    groupId: '-101',
    senderId: '88',
    evidence: 'Participant agreed in message123',
    expiresAt: Date.now() + 86400000
  }
}
function fixture() {
  let accountId: string | null = '77'
  let connected = true
  const service = {
    getAccountId: () => accountId,
    snapshot: () => ({ connected }),
    listParticipants: vi.fn(
      async (_groupId: string): Promise<TelegramParticipantSummary[]> => [participant]
    ),
    stopReplies: vi.fn(async () => undefined)
  }
  const authority = { grant: vi.fn(), revoke: vi.fn() }
  const api = createDesktopTelegramConsentControls(
    service as unknown as TelegramAccountService,
    authority as unknown as TelegramConsentAuthority
  )
  return {
    service,
    authority,
    api,
    switchAccount: (id: string | null) => {
      accountId = id
    },
    pause: () => {
      connected = false
    }
  }
}

describe('main-owned Telegram participant consent controls', () => {
  it('sources the participant name from a fresh listing and ignores a forged renderer name', async () => {
    const f = fixture()
    const input = { ...grantInput(), displayName: 'Forged renderer name' }
    await f.api.grantConsent(input)
    expect(f.service.listParticipants).toHaveBeenCalledWith('-101')
    expect(f.authority.grant).toHaveBeenCalledWith({
      ...input,
      accountId: '77',
      displayName: participant.displayName
    })
  })

  it('refuses a participant no longer returned by the fresh Telegram membership query', async () => {
    const f = fixture()
    expect(await f.api.getParticipants({ groupId: '-101' })).toEqual([participant])
    f.service.listParticipants.mockResolvedValueOnce([])
    await expect(f.api.grantConsent(grantInput())).rejects.toThrow('invalid-input')
    expect(f.authority.grant).not.toHaveBeenCalled()
    expect(f.service.listParticipants).toHaveBeenCalledTimes(2)
  })

  it.each(['account-change', 'pause'] as const)(
    'rejects a membership result superseded by %s',
    async (change) => {
      const f = fixture()
      let finish!: (value: TelegramParticipantSummary[]) => void
      f.service.listParticipants.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      const pending = f.api.grantConsent(grantInput())
      const refused = expect(pending).rejects.toThrow()
      if (change === 'pause') {
        f.pause()
      } else {
        f.switchAccount('78')
      }
      finish([participant])
      await refused
      expect(f.authority.grant).not.toHaveBeenCalled()
    }
  )

  it('withdraws local consent while paused without querying Telegram or reconnecting', async () => {
    const f = fixture()
    f.pause()
    await f.api.revokeConsent({ groupId: '-101', senderId: '88' })
    expect(f.authority.revoke).toHaveBeenCalledWith({
      accountId: '77',
      groupId: '-101',
      senderId: '88'
    })
    expect(f.service.stopReplies).toHaveBeenCalledOnce()
    expect(f.service.listParticipants).not.toHaveBeenCalled()
    await expect(f.api.grantConsent(grantInput())).rejects.toThrow('client-unavailable')
  })

  it('uses a separately bound saved account for local revoke after a paused restart', async () => {
    const f = fixture()
    f.pause()
    f.switchAccount(null)
    const api = createDesktopTelegramConsentControls(
      f.service as unknown as TelegramAccountService,
      f.authority as unknown as TelegramConsentAuthority,
      () => '77'
    )
    await api.revokeConsent({ groupId: '-101', senderId: '88' })
    expect(f.authority.revoke).toHaveBeenCalledWith({
      accountId: '77',
      groupId: '-101',
      senderId: '88'
    })
    expect(f.service.listParticipants).not.toHaveBeenCalled()
  })

  it('does not let an earlier pending grant re-authorize a participant after newer revocation', async () => {
    const f = fixture()
    let finish!: (value: TelegramParticipantSummary[]) => void
    f.service.listParticipants.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const pending = f.api.grantConsent(grantInput())
    const refused = expect(pending).rejects.toThrow('stale-operation')
    await f.api.revokeConsent({ groupId: '-101', senderId: '88' })
    finish([participant])
    await refused
    expect(f.authority.grant).not.toHaveBeenCalled()
  })

  it('stops inference even if durable revocation fails instead of continuing under old proof', async () => {
    const f = fixture()
    f.authority.revoke.mockImplementationOnce(() => {
      throw new Error('storage-failed')
    })
    await expect(f.api.revokeConsent({ groupId: '-101', senderId: '88' })).rejects.toThrow(
      'storage-failed'
    )
    expect(f.service.stopReplies).toHaveBeenCalledOnce()
  })

  it('rejects a matching sender returned for a different group', async () => {
    const f = fixture()
    f.service.listParticipants.mockResolvedValueOnce([{ ...participant, groupId: '-102' }])
    await expect(f.api.grantConsent(grantInput())).rejects.toThrow('invalid-input')
    expect(f.authority.grant).not.toHaveBeenCalled()
  })

  it('does not let an older delayed revoke overwrite a newer grant', async () => {
    const f = fixture()
    let release!: () => void
    f.service.stopReplies.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(undefined)
      })
    )
    const pending = f.api.revokeConsent({ groupId: '-101', senderId: '88' })
    const refused = expect(pending).rejects.toThrow('stale-operation')
    await f.api.grantConsent(grantInput())
    release()
    await refused
    expect(f.authority.revoke).not.toHaveBeenCalled()
    expect(f.authority.grant).toHaveBeenCalledOnce()
  })

  it('keeps independent participant mutations separate', async () => {
    const f = fixture()
    let finish!: (value: TelegramParticipantSummary[]) => void
    f.service.listParticipants.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const pending = f.api.grantConsent(grantInput())
    await f.api.revokeConsent({ groupId: '-101', senderId: '89' })
    finish([participant])
    await pending
    expect(f.authority.grant).toHaveBeenCalledOnce()
    expect(f.authority.revoke).toHaveBeenCalledWith({
      accountId: '77',
      groupId: '-101',
      senderId: '89'
    })
  })
})

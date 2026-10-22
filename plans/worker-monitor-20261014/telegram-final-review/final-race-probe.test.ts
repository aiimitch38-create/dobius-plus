import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')),
    decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString()
  }
}))

import { makeConnectedService, incoming } from '../../../dobius/src/main/telegram-account/test-support'
import { FakeTelegramClient } from '../../../dobius/src/main/telegram-account/test-support'
import { TelegramAccountService } from '../../../dobius/src/main/telegram-account/service'
import type { AdamTelegramReplyRequest } from '../../../dobius/src/main/telegram-account/types'

describe('independent Telegram final race probes', () => {
  it('reproduces failed same-process paused-account revocation recovery', async () => {
    const setup = makeConnectedService()
    expect((await setup.service.restore()).ok).toBe(true)
    await setup.service.pause()

    expect(await setup.service.restore()).toEqual({ ok: false, error: 'stale-operation' })
    expect(setup.client.connect).toHaveBeenCalledTimes(2)
    expect(await setup.service.revoke()).toEqual({ ok: false, error: 'client-unavailable' })
    expect(setup.client.revokeAuthorization).not.toHaveBeenCalled()
  })

  it('keeps the inbound identity ledger authoritative after draft-window pruning and restart', async () => {
    const setup = makeConnectedService({ reply: async () => 'safe draft' })
    expect((await setup.service.restore()).ok).toBe(true)
    expect((await setup.service.startReplies()).ok).toBe(true)

    for (let index = 0; index < 101; index += 1) {
      setup.client.emit(incoming({ messageId: String(1000 + index) }))
    }
    await vi.waitFor(() => expect(setup.vault.state.inboundEvents).toHaveLength(101))
    await vi.waitFor(() =>
      expect(setup.vault.state.inboundEvents.every((event) => event.state === 'draft-created')).toBe(
        true
      )
    )
    expect(setup.service.snapshot().drafts).toHaveLength(100)
    expect(setup.service.snapshot().drafts.some((draft) => draft.id.endsWith('.1000'))).toBe(false)

    const replayClient = new FakeTelegramClient()
    const replay = vi.fn(async () => 'must not run')
    const restarted = new TelegramAccountService({
      vault: setup.vault,
      createClient: () => replayClient,
      replyToAdam: replay,
      readConsent: () => ({ allowed: true, revision: 'consent-v1' }),
      enabled: true
    })
    expect((await restarted.restore()).ok).toBe(true)
    expect((await restarted.startReplies()).ok).toBe(true)
    replayClient.emit(incoming({ messageId: '1000' }))
    await Promise.resolve()
    expect(replay).not.toHaveBeenCalled()
    expect(restarted.snapshot().drafts).toHaveLength(100)
    expect(setup.vault.state.inboundEvents).toHaveLength(101)
  })

  it('merges reverse-completed replies and rejects deselect/reselect ABA publication', async () => {
    const pending = new Map<string, (body: string) => void>()
    const reply = vi.fn(
      (request: AdamTelegramReplyRequest) =>
        new Promise<string>((resolve) => pending.set(request.messageId, resolve))
    )
    const setup = makeConnectedService({ reply })
    setup.client.dialogs = [
      ...setup.client.dialogs,
      { id: '-1005', title: 'Research', kind: 'supergroup' }
    ]
    expect((await setup.service.restore()).ok).toBe(true)
    expect((await setup.service.startReplies()).ok).toBe(true)

    setup.client.emit(incoming({ messageId: '2001' }))
    setup.client.emit(incoming({ messageId: '2002' }))
    await vi.waitFor(() => expect(pending.size).toBe(2))
    pending.get('2002')?.('second completed first')
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(1))
    pending.get('2001')?.('first completed second')
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(2))
    expect(setup.vault.state.drafts.map((draft) => draft.sourceMessageId).sort()).toEqual([
      '2001',
      '2002'
    ])

    setup.client.emit(incoming({ messageId: '2003' }))
    await vi.waitFor(() => expect(pending.has('2003')).toBe(true))
    expect((await setup.service.selectGroups(['-1002', '-1003', '-1005'])).ok).toBe(true)
    expect((await setup.service.selectGroups(['-1001', '-1002', '-1003'])).ok).toBe(true)
    pending.get('2003')?.('must not publish after ABA')
    await vi.waitFor(() =>
      expect(setup.vault.state.inboundEvents.find((event) => event.messageId === '2003')?.state).toBe(
        'manual-review'
      )
    )
    expect(setup.service.snapshot().selectedGroups.map((group) => group.id)).toEqual([
      '-1001',
      '-1002',
      '-1003'
    ])
    expect(setup.service.snapshot().drafts.some((draft) => draft.sourceMessageId === '2003')).toBe(
      false
    )
  })
})

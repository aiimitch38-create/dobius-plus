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
import type { AdamTelegramReplyRequest } from './types'
import { FakeTelegramClient, incoming, makeConnectedService } from './test-support'
import { TELEGRAM_INBOUND_EVENT_LIMIT } from './types'

async function connectedAndSubscribed(args: Parameters<typeof makeConnectedService>[0] = {}) {
  const setup = makeConnectedService(args)
  expect((await setup.service.restore()).ok).toBe(true)
  expect((await setup.service.startReplies()).ok).toBe(true)
  return setup
}

describe('Telegram scoped replies and approval outbox', () => {
  it('filters nonselected chats and nonconsenting senders before the Adam reply port', async () => {
    const reply = vi.fn(async (_request: AdamTelegramReplyRequest) => 'draft')
    const setup = await connectedAndSubscribed({
      reply,
      consent: (_groupId, senderId) => ({ allowed: senderId === '88', revision: 'v1' })
    })
    setup.client.emit(incoming({ groupId: '-1004', groupKind: 'channel' }))
    setup.client.emit(incoming({ senderId: '89' }))
    await vi.waitFor(() =>
      expect(
        setup.service.auditSnapshot().filter((entry) => entry.code === 'message-filtered')
      ).toHaveLength(2)
    )
    expect(reply).not.toHaveBeenCalled()
    expect(setup.service.snapshot().drafts).toEqual([])
  })

  it('creates an approval-required Adam draft only after per-author consent and rechecks after the await', async () => {
    const reply = vi.fn(async (request: AdamTelegramReplyRequest) => {
      expect(request.agentId).toBe('adam')
      return 'Proposed answer'
    })
    const setup = await connectedAndSubscribed({ reply })
    setup.client.emit(incoming())
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(1))
    const draft = setup.service.snapshot().drafts[0]
    expect(draft).toMatchObject({
      groupId: '-1001',
      state: 'awaiting-approval',
      body: 'Proposed answer',
      revision: 1
    })
    expect(setup.client.sendText).not.toHaveBeenCalled()
  })

  it('drops an in-flight reply if consent is revoked before the provider response', async () => {
    const deferred: { resolve?: (value: string) => void } = {}
    let allowed = true
    const reply = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          deferred.resolve = resolve
        })
    )
    const setup = await connectedAndSubscribed({
      reply,
      consent: () => ({ allowed, revision: allowed ? 'v1' : 'v2' })
    })
    setup.client.emit(incoming())
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    allowed = false
    deferred.resolve?.('must not persist')
    await vi.waitFor(() =>
      expect(setup.service.auditSnapshot().some((entry) => entry.code === 'message-filtered')).toBe(
        true
      )
    )
    expect(setup.service.snapshot().drafts).toEqual([])
    expect(setup.vault.state.inboundEvents[0].state).toBe('manual-review')
  })

  it('durably reserves an update before inference and deduplicates concurrent callbacks', async () => {
    const deferred: { resolve?: (value: string) => void } = {}
    const vaultSavesAtStart: number[] = []
    const setup = await connectedAndSubscribed({
      reply: vi.fn(() => {
        vaultSavesAtStart.push(setup.vault.saves)
        return new Promise<string>((resolve) => {
          deferred.resolve = resolve
        })
      })
    })
    const savesBefore = setup.vault.saves
    setup.client.emit(incoming())
    setup.client.emit(incoming())
    expect(vaultSavesAtStart).toEqual([savesBefore + 1])
    expect(setup.vault.state.inboundEvents).toHaveLength(1)
    expect(setup.vault.state.inboundEvents[0].state).toBe('processing')
    deferred.resolve?.('one draft')
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(1))
  })

  it('merges concurrent distinct replies against the latest vault state', async () => {
    const pending = new Map<string, (body: string) => void>()
    const setup = await connectedAndSubscribed({
      reply: vi.fn(
        (request: AdamTelegramReplyRequest) =>
          new Promise<string>((resolve) => pending.set(request.messageId, resolve))
      )
    })
    setup.client.emit(incoming({ messageId: '991' }))
    setup.client.emit(incoming({ messageId: '992' }))
    await vi.waitFor(() => expect(pending.size).toBe(2))
    pending.get('992')?.('second')
    pending.get('991')?.('first')
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(2))
    expect(setup.vault.state.drafts.map((draft) => draft.sourceMessageId).sort()).toEqual([
      '991',
      '992'
    ])
  })

  it('rejects a pending result after deselect-and-reselect ABA without restoring state', async () => {
    const deferred: { resolve?: (value: string) => void } = {}
    const setup = await connectedAndSubscribed({
      reply: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            deferred.resolve = resolve
          })
      )
    })
    setup.client.dialogs = [
      ...setup.client.dialogs,
      { id: '-1005', title: 'Research', kind: 'supergroup' }
    ]
    setup.client.emit(incoming())
    await vi.waitFor(() => expect(setup.vault.state.inboundEvents).toHaveLength(1))
    expect((await setup.service.selectGroups(['-1002', '-1003', '-1005'])).ok).toBe(true)
    expect((await setup.service.selectGroups(['-1001', '-1002', '-1003'])).ok).toBe(true)
    deferred.resolve?.('stale selection')
    await vi.waitFor(() => expect(setup.vault.state.inboundEvents[0].state).toBe('manual-review'))
    expect(setup.service.snapshot().selectedGroups.map((group) => group.id)).toEqual([
      '-1001',
      '-1002',
      '-1003'
    ])
    expect(setup.service.snapshot().drafts).toEqual([])
  })

  it('does not infer a replay after restart even when its old draft was pruned', async () => {
    const original = await connectedAndSubscribed()
    original.vault.state.inboundEvents = [
      {
        accountId: '77',
        groupId: '-1001',
        messageId: '991',
        admittedAt: Date.now(),
        state: 'draft-created'
      }
    ]
    original.vault.state.drafts = []
    const replayClient = new FakeTelegramClient()
    const reply = vi.fn(async () => 'must not run')
    const replayed = new TelegramAccountService({
      vault: original.vault,
      createClient: () => replayClient,
      replyToAdam: reply,
      readConsent: () => ({ allowed: true, revision: 'consent-v1' }),
      enabled: true
    })
    expect((await replayed.restore()).ok).toBe(true)
    expect((await replayed.startReplies()).ok).toBe(true)
    replayClient.emit(incoming())
    await Promise.resolve()
    expect(reply).not.toHaveBeenCalled()
    expect(original.vault.state.drafts).toEqual([])
    expect(original.vault.state.inboundEvents).toHaveLength(1)
  })

  it('converts a crash-left processing receipt to manual review on restart', async () => {
    const firstReply = vi.fn(() => new Promise<string>(() => undefined))
    const first = await connectedAndSubscribed({ reply: firstReply })
    first.client.emit(incoming())
    await vi.waitFor(() => expect(firstReply).toHaveBeenCalledOnce())
    const replayClient = new FakeTelegramClient()
    const replayReply = vi.fn(async () => 'must not run')
    const restarted = new TelegramAccountService({
      vault: first.vault,
      createClient: () => replayClient,
      replyToAdam: replayReply,
      readConsent: () => ({ allowed: true, revision: 'consent-v1' }),
      enabled: true
    })
    expect((await restarted.restore()).ok).toBe(true)
    expect(first.vault.state.inboundEvents[0].state).toBe('manual-review')
    expect((await restarted.startReplies()).ok).toBe(true)
    replayClient.emit(incoming())
    await Promise.resolve()
    expect(replayReply).not.toHaveBeenCalled()
  })

  it('fails closed at the admission-ledger limit without invoking inference', async () => {
    const reply = vi.fn(async () => 'must not run')
    const setup = await connectedAndSubscribed({ reply })
    setup.vault.state.inboundEvents = Array.from(
      { length: TELEGRAM_INBOUND_EVENT_LIMIT },
      (_, index) => ({
        accountId: '77',
        groupId: '-1001',
        messageId: String(index + 1),
        admittedAt: index,
        state: 'manual-review' as const
      })
    )
    expect((await setup.service.restore()).ok).toBe(true)
    setup.client.emit(incoming({ messageId: '999999' }))
    await Promise.resolve()
    expect(reply).not.toHaveBeenCalled()
    expect(setup.vault.state.inboundEvents).toHaveLength(TELEGRAM_INBOUND_EVENT_LIMIT)
  })

  it('requires the exact current draft revision and consent to approve or send', async () => {
    const setup = await connectedAndSubscribed()
    setup.client.emit(incoming())
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(1))
    const draft = setup.service.snapshot().drafts[0]
    expect(setup.service.approveDraft(draft.id, draft.revision - 1)).toEqual({
      ok: false,
      error: 'draft-stale'
    })
    expect(setup.service.approveDraft(draft.id, draft.revision)).toEqual({
      ok: true,
      value: undefined
    })
    expect(setup.service.snapshot().drafts[0].state).toBe('approved')
    expect((await setup.service.sendDraft(draft.id, draft.revision)).ok).toBe(false)
    expect(setup.client.sendText).not.toHaveBeenCalled()
  })

  it('preserves random_id through unknown acknowledgement and reconciles without a duplicate send', async () => {
    const client = new FakeTelegramClient()
    client.sendOutcome = 'unknown'
    const setup = await connectedAndSubscribed({ client })
    client.emit(incoming())
    await vi.waitFor(() => expect(setup.service.snapshot().drafts).toHaveLength(1))
    const draft = setup.service.snapshot().drafts[0]
    setup.service.approveDraft(draft.id, draft.revision)
    const approved = setup.service.snapshot().drafts[0]
    expect(await setup.service.sendDraft(draft.id, approved.revision)).toEqual({
      ok: true,
      value: 'unknown'
    })
    const pending = setup.vault.state.outbox[0]
    expect(pending.state).toBe('unknown')
    const restartedClient = new FakeTelegramClient()
    restartedClient.lookupOutcome = 'confirmed'
    const restartedService = new TelegramAccountService({
      vault: setup.vault,
      createClient: () => restartedClient,
      replyToAdam: vi.fn(async () => 'unused'),
      readConsent: () => ({ allowed: true, revision: 'consent-v1' }),
      enabled: true
    })
    expect((await restartedService.restore()).ok).toBe(true)
    const unknownDraft = restartedService.snapshot().drafts[0]
    expect(await restartedService.sendDraft(draft.id, unknownDraft.revision)).toEqual({
      ok: true,
      value: 'sent'
    })
    expect(restartedClient.lookupRandomId).toHaveBeenCalledWith(
      pending.randomId,
      expect.any(AbortSignal)
    )
    expect(client.sent).toHaveLength(1)
    expect(restartedClient.sendText).not.toHaveBeenCalled()
    expect(setup.vault.state.outbox[0].randomId).toBe(pending.randomId)
    expect(restartedService.snapshot().drafts[0].state).toBe('sent')
  })

  it('does not ingest into Adam or send while paused, and releases subscriptions on disconnect', async () => {
    const reply = vi.fn(async () => 'draft')
    const setup = await connectedAndSubscribed({ reply })
    await setup.service.pause()
    setup.client.emit(incoming())
    await Promise.resolve()
    expect(reply).not.toHaveBeenCalled()
    expect(setup.service.snapshot().paused).toBe(true)
    expect(setup.client.onMessage).toBeNull()
    await setup.service.disconnect()
    expect(setup.service.snapshot().phase).toBe('disconnected')
    expect(setup.vault.state.session).toBeNull()
  })

  it('bounds audit entries and excludes message content, IDs, and transport exceptions', async () => {
    const setup = await connectedAndSubscribed()
    for (let index = 0; index < 120; index += 1) {
      setup.client.emit(
        incoming({ groupId: '-9999', messageId: String(index), text: `private-${index}` })
      )
    }
    await vi.waitFor(() => expect(setup.service.auditSnapshot().length).toBe(100))
    const audit = JSON.stringify(setup.service.auditSnapshot())
    expect(setup.service.auditSnapshot().length).toBeLessThanOrEqual(100)
    expect(audit).not.toContain('private-')
    expect(audit).not.toContain('-1001')
    expect(audit).not.toContain('991')
  })
})

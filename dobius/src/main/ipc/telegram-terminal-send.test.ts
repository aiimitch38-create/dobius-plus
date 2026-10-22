import { describe, expect, it, vi } from 'vitest'
import type { TelegramAccountService } from '../telegram-account/service'
import { sendDraftFromTerminal } from './telegram-terminal-send'

function fakeService(state: string) {
  const draft = { id: 'd1', revision: 1, groupTitle: 'NLD', body: 'Hi Anthony', state }
  const service = {
    snapshot: () => ({ drafts: [draft] }),
    approveDraft: vi.fn(() => {
      draft.revision += 1
      draft.state = 'approved'
      return { ok: true }
    }),
    sendDraft: vi.fn(async () => ({ ok: true, value: 'sent' }))
  }
  return { draft, service, typed: service as unknown as TelegramAccountService }
}

describe('terminal draft send', () => {
  it('sends nothing when Carson cancels the dialog', async () => {
    const f = fakeService('awaiting-approval')
    const result = await sendDraftFromTerminal(f.typed, 'd1', async () => false)
    expect(result.outcome).toBe('declined')
    expect(f.service.approveDraft).not.toHaveBeenCalled()
    expect(f.service.sendDraft).not.toHaveBeenCalled()
  })

  it('approves then sends the confirmed draft at its new revision', async () => {
    const f = fakeService('awaiting-approval')
    const confirm = vi.fn(async () => true)
    const result = await sendDraftFromTerminal(f.typed, 'd1', confirm)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ body: 'Hi Anthony' }))
    expect(f.service.approveDraft).toHaveBeenCalledWith('d1', 1)
    expect(f.service.sendDraft).toHaveBeenCalledWith('d1', 2)
    expect(result.outcome).toBe('sent')
  })

  it('refuses when the draft text changed while the dialog was open', async () => {
    const f = fakeService('awaiting-approval')
    await expect(
      sendDraftFromTerminal(f.typed, 'd1', async () => {
        f.draft.body = 'Different text'
        return true
      })
    ).rejects.toThrow('stale-operation')
    expect(f.service.sendDraft).not.toHaveBeenCalled()
  })

  it('refuses drafts that were already sent', async () => {
    const f = fakeService('sent')
    const confirm = vi.fn(async () => true)
    await expect(sendDraftFromTerminal(f.typed, 'd1', confirm)).rejects.toThrow(
      'draft-not-sendable'
    )
    expect(confirm).not.toHaveBeenCalled()
  })
})

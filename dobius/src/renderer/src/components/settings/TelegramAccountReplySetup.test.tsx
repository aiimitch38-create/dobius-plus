// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import { connectedTelegramView, telegramViewApi } from './telegram-account-view-test-fixtures'

function consent() {
  return {
    groupId: '-101',
    senderId: '88',
    displayName: 'Alex Client',
    evidence: 'Explicit consent recorded in message 123',
    grantedAt: Date.now() - 1000,
    expiresAt: Date.now() + 86400000,
    revision: 'proof-1'
  }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Telegram participant consent and Adam reply setup', () => {
  it('loads actual participant metadata and records only individually supplied evidence', async () => {
    const state = connectedTelegramView()
    const api = telegramViewApi(() => state)
    render(<TelegramAccountSection api={api} />)
    expect(await screen.findByText('Participant consent')).toBeTruthy()
    expect(screen.queryByLabelText('Consent evidence for Alex Client')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load participants in Client one' }))
    const evidence = await screen.findByLabelText('Consent evidence for Alex Client')
    expect(api.getParticipants).toHaveBeenCalledWith({ groupId: '-101' })
    const grant = screen.getByRole('button', { name: 'Record consent for Alex Client' })
    expect((grant as HTMLButtonElement).disabled).toBe(true)
    expect(api.grantConsent).not.toHaveBeenCalled()
    fireEvent.change(evidence, {
      target: { value: 'Agreed to Adam replies in message 123 on this date.' }
    })
    fireEvent.click(grant)
    await waitFor(() => expect(api.grantConsent).toHaveBeenCalledOnce())
    expect(api.grantConsent).toHaveBeenCalledWith({
      groupId: '-101',
      senderId: '88',
      evidence: 'Agreed to Adam replies in message 123 on this date.',
      expiresAt: expect.any(Number)
    })
    expect(api.sendDraft).not.toHaveBeenCalled()
  })

  it('displays expiry and evidence, and revokes only the named participant', async () => {
    const state = connectedTelegramView()
    state.consents = [consent()]
    const api = telegramViewApi(() => state)
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load participants in Client one' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke consent for Alex Client' }))
    await waitFor(() =>
      expect(api.revokeConsent).toHaveBeenCalledWith({ groupId: '-101', senderId: '88' })
    )
    expect(screen.getByText(/Recorded consent expires/)).toBeTruthy()
    expect(screen.getByText(/Evidence: Explicit consent/)).toBeTruthy()
  })

  it('connects only with saved groups and active consent, and exposes a stop action while listening', async () => {
    let state = connectedTelegramView()
    const api = telegramViewApi(() => state)
    const view = render(<TelegramAccountSection api={api} />)
    expect(
      (
        (await screen.findByRole('button', {
          name: 'Connect Adam and start listening'
        })) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    view.unmount()
    state = { ...state, consents: [consent()] }
    vi.mocked(api.startReplies).mockImplementation(async () => {
      state = {
        ...state,
        replyHandling: { bridge: 'ready', listening: true, policy: 'approval-required' }
      }
    })
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Adam and start listening' }))
    expect(await screen.findByText('Listening for new messages')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop listening' }))
    await waitFor(() => expect(api.stopReplies).toHaveBeenCalledOnce())
  })

  it('approves and sends in separate actions with current draft revisions', async () => {
    const state = connectedTelegramView()
    state.consents = [consent()]
    state.account.drafts = [
      {
        id: 'draft-one',
        revision: 4,
        groupId: '-101',
        groupTitle: 'Client one',
        body: 'Draft reply',
        state: 'awaiting-approval',
        createdAt: 10,
        consentAllowed: true
      }
    ]
    const api = telegramViewApi(() => state)
    vi.mocked(api.approveDraft).mockImplementation(async () => {
      state.account.drafts = [{ ...state.account.drafts[0], state: 'approved', revision: 5 }]
    })
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve draft' }))
    expect(api.approveDraft).toHaveBeenCalledWith({ draftId: 'draft-one', expectedRevision: 4 })
    expect(await screen.findByRole('button', { name: 'Send approved reply' })).toBeTruthy()
    expect(api.sendDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send approved reply' }))
    await waitFor(() =>
      expect(api.sendDraft).toHaveBeenCalledWith({ draftId: 'draft-one', expectedRevision: 5 })
    )
  })

  it.each(['missing-consent', 'paused', 'bridge-error'] as const)(
    'refuses draft actions when %s',
    async (condition) => {
      const state = connectedTelegramView()
      state.account.drafts = [
        {
          id: 'd',
          revision: 1,
          groupId: '-101',
          groupTitle: 'Client one',
          body: 'Draft',
          state: 'awaiting-approval',
          createdAt: 10,
          consentAllowed: condition !== 'missing-consent'
        }
      ]
      if (condition === 'paused') {
        state.account.phase = 'paused'
      }
      if (condition === 'bridge-error') {
        state.replyHandling!.bridge = 'error'
      }
      const api = telegramViewApi(() => state)
      render(<TelegramAccountSection api={api} />)
      expect(
        ((await screen.findByRole('button', { name: 'Approve draft' })) as HTMLButtonElement)
          .disabled
      ).toBe(true)
      expect(api.approveDraft).not.toHaveBeenCalled()
    }
  )

  it('polls new drafts without overwriting an unsaved group selection', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const state = connectedTelegramView()
    const api = telegramViewApi(() => state)
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByLabelText('Client two'))
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    state.account.drafts = [
      {
        id: 'd',
        revision: 1,
        groupId: '-101',
        groupTitle: 'Client one',
        body: 'New polled draft',
        state: 'awaiting-approval',
        createdAt: 10
      }
    ]
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    expect(await screen.findByText('New polled draft')).toBeTruthy()
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
  })

  it('persists a group save through closing and reopening the account view', async () => {
    const state = connectedTelegramView()
    state.account.selectedGroups = []
    const api = telegramViewApi(() => state)
    vi.mocked(api.saveGroups).mockImplementation(async ({ groupIds }) => {
      state.account.selectedGroups = state.groups.filter((group) => groupIds.includes(group.id))
    })
    const first = render(<TelegramAccountSection api={api} />)
    for (const title of ['Client one', 'Client two', 'Client three']) {
      fireEvent.click(await screen.findByLabelText(title))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save group selection' }))
    await waitFor(() => expect(api.saveGroups).toHaveBeenCalledOnce())
    first.unmount()
    render(<TelegramAccountSection api={api} />)
    expect(await screen.findByText('3 of 3 selected')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Save group selection' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})

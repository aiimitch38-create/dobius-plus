// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import { connectedTelegramView, telegramViewApi } from './telegram-account-view-test-fixtures'

afterEach(cleanup)
describe('saved Telegram consent after paused restart', () => {
  it('allows local withdrawal without loading participants or reconnecting', async () => {
    const state = connectedTelegramView()
    state.account = {
      ...state.account,
      phase: 'paused',
      connected: false,
      paused: true,
      selectedGroups: []
    }
    state.groups = []
    state.consents = [
      {
        groupId: '-101',
        senderId: '88',
        displayName: 'Saved client',
        evidence: 'Consent originally recorded in message123',
        grantedAt: Date.now() - 1000,
        expiresAt: Date.now() + 86400000,
        revision: 'proof1'
      }
    ]
    const api = telegramViewApi(() => state)
    vi.mocked(api.revokeConsent).mockImplementation(async () => {
      state.consents = []
    })
    render(<TelegramAccountSection api={api} />)
    const revoke = await screen.findByRole('button', {
      name: 'Revoke saved consent for Saved client'
    })
    expect((revoke as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(revoke)
    await waitFor(() =>
      expect(api.revokeConsent).toHaveBeenCalledWith({ groupId: '-101', senderId: '88' })
    )
    await waitFor(() => expect(screen.queryByText('Saved participant consent')).toBeNull())
    expect(api.getParticipants).not.toHaveBeenCalled()
    expect(api.resume).not.toHaveBeenCalled()
    expect(api.startReplies).not.toHaveBeenCalled()
  })

  it('disables fresh membership loading while paused but keeps already recorded consent visible', async () => {
    const state = connectedTelegramView()
    state.account.phase = 'paused'
    state.account.connected = false
    state.account.paused = true
    state.consents = [
      {
        groupId: '-101',
        senderId: '88',
        displayName: 'Saved client',
        evidence: 'Consent originally recorded in message123',
        grantedAt: Date.now() - 1000,
        expiresAt: Date.now() + 86400000,
        revision: 'proof1'
      }
    ]
    render(<TelegramAccountSection api={telegramViewApi(() => state)} />)
    expect(
      (
        (await screen.findByRole('button', {
          name: 'Load participants in Client one'
        })) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Revoke saved consent for Saved client'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import type { TelegramAccountUiApi, TelegramAccountUiSnapshot } from './telegram-account-ui'

function fixture(): { api: TelegramAccountUiApi; state: TelegramAccountUiSnapshot } {
  const state: TelegramAccountUiSnapshot = {
    account: {
      phase: 'disconnected',
      connected: false,
      paused: false,
      selectedGroups: [],
      drafts: [],
      lastError: null,
      revision: 1
    },
    groups: [],
    audit: []
  }
  const api: TelegramAccountUiApi = {
    getSnapshot: vi.fn(async () => state),
    beginSignIn: vi.fn(async () => undefined),
    submitCode: vi.fn(async () => undefined),
    submitPassword: vi.fn(async () => undefined),
    cancelSignIn: vi.fn(async () => undefined),
    refreshGroups: vi.fn(async () => []),
    saveGroups: vi.fn(async () => undefined),
    getParticipants: vi.fn(async () => []),
    grantConsent: vi.fn(async () => undefined),
    revokeConsent: vi.fn(async () => undefined),
    startReplies: vi.fn(async () => undefined),
    stopReplies: vi.fn(async () => undefined),
    approveDraft: vi.fn(async () => undefined),
    sendDraft: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined)
  }
  return { api, state }
}

describe('Telegram sign-in recovery', () => {
  afterEach(cleanup)

  it('requires a country code and normalizes display formatting before sign-in', async () => {
    const { api } = fixture()
    render(<TelegramAccountSection api={api} />)
    const phone = await screen.findByLabelText('Phone number')
    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    fireEvent.change(phone, { target: { value: '5555550123' } })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api.beginSignIn).not.toHaveBeenCalled()
    fireEvent.change(phone, { target: { value: ' +1 (555) 555-0123 ' } })
    fireEvent.change(screen.getByLabelText('Telegram API ID'), { target: { value: '456789' } })
    fireEvent.change(screen.getByLabelText('Telegram API hash'), {
      target: { value: ' synthetic-hash ' }
    })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() =>
      expect(api.beginSignIn).toHaveBeenCalledWith({
        phoneNumber: '+15555550123',
        apiId: 456789,
        apiHash: 'synthetic-hash'
      })
    )
    expect((phone as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Telegram API hash') as HTMLInputElement).value).toBe('')
  })

  it('shows the safe IPC error and leaves phone entry available for retry', async () => {
    const { api } = fixture()
    vi.mocked(api.beginSignIn).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'telegramAccount:beginSignIn': Error: secure-storage-unavailable"
      )
    )
    render(<TelegramAccountSection api={api} />)
    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: '+15555550123' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Secure Telegram storage is unavailable'
    )
    await waitFor(() =>
      expect((screen.getByLabelText('Phone number') as HTMLInputElement).disabled).toBe(false)
    )
  })

  it('can cancel a persisted failed attempt and return to phone entry', async () => {
    const { api, state } = fixture()
    state.account.phase = 'error'
    state.account.lastError = 'authorization-failed'
    vi.mocked(api.cancelSignIn).mockImplementation(async () => {
      state.account.phase = 'disconnected'
    })
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restart sign-in' }))
    await screen.findByLabelText('Phone number')
    expect(api.cancelSignIn).toHaveBeenCalledTimes(1)
  })
})

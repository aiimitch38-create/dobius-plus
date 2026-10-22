// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import type {
  TelegramAccountUiApi,
  TelegramAccountUiSnapshot,
  TelegramAccountUiStatus
} from './telegram-account-ui'
import { getAgentsPaneSearchEntries } from './agents-search'
import { matchesSettingsSearch } from './settings-search'

function snapshot(status: TelegramAccountUiStatus = 'disconnected'): TelegramAccountUiSnapshot {
  return {
    account: {
      phase: status,
      connected: status === 'connected',
      paused: status === 'paused',
      selectedGroups: [],
      drafts: [],
      lastError: null,
      revision: 1
    },
    groups: [
      { id: '-101', title: 'Research team', kind: 'group' },
      { id: '-102', title: 'Release notes', kind: 'supergroup' },
      { id: '-103', title: 'Support circle', kind: 'group' }
    ],
    audit: []
  }
}

function createApi(state = snapshot()): TelegramAccountUiApi {
  return {
    getSnapshot: vi.fn(async () => state),
    beginSignIn: vi.fn(async () => undefined),
    submitCode: vi.fn(async () => undefined),
    submitPassword: vi.fn(async () => undefined),
    cancelSignIn: vi.fn(async () => undefined),
    refreshGroups: vi.fn(async () => state.groups),
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
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('TelegramAccountSection', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('shows unavailable without inventing a connection or sign-in controls', async () => {
    render(<TelegramAccountSection api={null} />)
    expect(await screen.findByText(/service is unavailable/i)).toBeTruthy()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
    expect(screen.getByText('Unavailable')).toBeTruthy()
  })

  it('shows an unavailable service snapshot without exposing sign-in fields', async () => {
    const api = createApi(snapshot('unavailable'))
    render(<TelegramAccountSection api={api} />)
    expect(await screen.findByText(/service is unavailable/i)).toBeTruthy()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
  })

  it('moves from phone entry to a code step and clears submitted credentials', async () => {
    let current = snapshot()
    const api = createApi(current)
    vi.mocked(api.getSnapshot).mockImplementation(async () => current)
    const beginPending = deferred()
    vi.mocked(api.beginSignIn).mockImplementation(async () => {
      await beginPending.promise
      current = snapshot('awaiting-code')
    })
    render(<TelegramAccountSection api={api} />)

    const phone = (await screen.findByLabelText('Phone number')) as HTMLInputElement
    const apiId = screen.getByLabelText('Telegram API ID') as HTMLInputElement
    const apiHash = screen.getByLabelText('Telegram API hash') as HTMLInputElement
    fireEvent.change(phone, { target: { value: '+15555550123' } })
    fireEvent.change(apiId, { target: { value: '456789' } })
    fireEvent.change(apiHash, { target: { value: 'synthetic-api-hash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(phone.value).toBe('')
      expect(apiId.value).toBe('')
      expect(apiHash.value).toBe('')
    })
    expect(api.beginSignIn).toHaveBeenCalledWith({
      phoneNumber: '+15555550123',
      apiId: 456789,
      apiHash: 'synthetic-api-hash'
    })
    beginPending.resolve()
    await screen.findByLabelText('Sign-in code')

    const code = screen.getByLabelText('Sign-in code') as HTMLInputElement
    fireEvent.change(code, { target: { value: '123456' } })
    const pending = deferred()
    vi.mocked(api.submitCode).mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Submit code' }))
    await waitFor(() => expect(code.value).toBe(''))
    current = snapshot('connected')
    pending.resolve()
    await waitFor(() => expect(api.submitCode).toHaveBeenCalledWith({ code: '123456' }))
    await waitFor(() => expect(api.getSnapshot).toHaveBeenCalledTimes(3))
    expect(api.cancelSignIn).not.toHaveBeenCalled()
  })

  it('cancels a pending sign-in attempt when its UI unmounts', async () => {
    const api = createApi()
    const pending = deferred()
    vi.mocked(api.beginSignIn).mockReturnValue(pending.promise)
    const view = render(<TelegramAccountSection api={api} />)
    const phone = await screen.findByLabelText('Phone number')
    fireEvent.change(phone, { target: { value: '+15555550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(api.beginSignIn).toHaveBeenCalledTimes(1)
    view.unmount()
    await waitFor(() => expect(api.cancelSignIn).toHaveBeenCalledTimes(1))
    pending.resolve()
  })

  it('clears the sign-in code when the user cancels', async () => {
    const api = createApi(snapshot('awaiting-code'))
    render(<TelegramAccountSection api={api} />)
    const code = (await screen.findByLabelText('Sign-in code')) as HTMLInputElement
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
    await waitFor(() => expect(code.value).toBe(''))
    await waitFor(() => expect(api.cancelSignIn).toHaveBeenCalledTimes(1))
  })

  it('clears a submitted password before the service result returns', async () => {
    const state = snapshot('awaiting-password')
    const api = createApi(state)
    const pending = deferred()
    vi.mocked(api.submitPassword).mockReturnValueOnce(pending.promise)
    render(<TelegramAccountSection api={api} />)
    const input = (await screen.findByLabelText(
      'Two-step verification password'
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'synthetic-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit password' }))
    await waitFor(() => expect(input.value).toBe(''))
    pending.resolve()
    await waitFor(() =>
      expect(api.submitPassword).toHaveBeenCalledWith({ password: 'synthetic-secret' })
    )
  })

  it('requires exactly three selectable server-listed groups', async () => {
    const state = snapshot('connected')
    state.account.selectedGroups = state.groups
    const api = createApi(state)
    render(<TelegramAccountSection api={api} />)

    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText('3 of 3 selected')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save group selection' })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Research team'))
    expect(screen.getByText('2 of 3 selected')).toBeTruthy()
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Research team'))
    expect(screen.getByText('3 of 3 selected')).toBeTruthy()
  })

  it('saves only an exact three-group selection', async () => {
    const state = snapshot('connected')
    const api = createApi(state)
    render(<TelegramAccountSection api={api} />)

    for (const name of ['Research team', 'Release notes', 'Support circle']) {
      fireEvent.click(await screen.findByLabelText(name))
    }
    expect(screen.getByText('3 of 3 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save group selection' }))
    await waitFor(() =>
      expect(api.saveGroups).toHaveBeenCalledWith({
        groupIds: ['-101', '-102', '-103']
      })
    )
  })

  it('keeps drafts approval-required and does not enable actions without consent provenance', async () => {
    const state = snapshot('connected')
    state.account.drafts = [
      {
        id: 'draft-1',
        revision: 3,
        groupId: '-101',
        groupTitle: 'Research team',
        body: 'Synthetic draft body',
        state: 'awaiting-approval',
        createdAt: 10
      }
    ]
    const api = createApi(state)
    render(<TelegramAccountSection api={api} />)

    expect(await screen.findByText('Synthetic draft body')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Approve draft' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(screen.getByText(/verify current individual consent/)).toBeTruthy()
    expect(api.sendDraft).not.toHaveBeenCalled()
  })

  it('keeps pause and disconnect available and uses redacted error copy', async () => {
    const api = createApi(snapshot('connected'))
    vi.mocked(api.pause).mockRejectedValueOnce(new Error('private phone +15555550123'))
    render(<TelegramAccountSection api={api} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Pause replies' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Telegram could not complete that request'
    )
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeTruthy()
    expect(screen.queryByText(/15555550123/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledTimes(1))
  })

  it.each(['pause', 'disconnect', 'revoke'] as const)(
    'lets %s interrupt a pending refresh without accepting its stale result',
    async (control) => {
      let current = snapshot('connected')
      const api = createApi(current)
      vi.mocked(api.getSnapshot).mockImplementation(async () => current)
      let resolveRefresh!: (groups: TelegramAccountUiSnapshot['groups']) => void
      const refreshPending = new Promise<TelegramAccountUiSnapshot['groups']>((resolve) => {
        resolveRefresh = resolve
      })
      vi.mocked(api.refreshGroups).mockReturnValueOnce(refreshPending)
      const controlPending = deferred()
      const next = snapshot(control === 'pause' ? 'paused' : 'disconnected')
      if (control === 'pause') {
        next.groups = [{ id: '-201', title: 'Current group metadata', kind: 'group' }]
      }
      vi.mocked(api[control]).mockImplementation(async () => {
        await controlPending.promise
        current = next
      })
      render(<TelegramAccountSection api={api} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Refresh groups' }))
      await waitFor(() => expect(api.refreshGroups).toHaveBeenCalledTimes(1))
      const controlName =
        control === 'pause'
          ? 'Pause replies'
          : control === 'disconnect'
            ? 'Disconnect'
            : 'Revoke access'
      const controlButton = await screen.findByRole('button', { name: controlName })
      expect((controlButton as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(controlButton)
      await waitFor(() => expect(api[control]).toHaveBeenCalledTimes(1))
      expect((controlButton as HTMLButtonElement).disabled).toBe(true)

      resolveRefresh([{ id: '-101', title: 'Stale refresh metadata', kind: 'group' }])
      await Promise.resolve()
      await Promise.resolve()
      fireEvent.click(controlButton)
      expect(api[control]).toHaveBeenCalledTimes(1)
      expect((controlButton as HTMLButtonElement).disabled).toBe(true)

      controlPending.resolve()
      await waitFor(() => expect(screen.getByText(control === 'pause' ? 'Paused' : 'Disconnected')))
      expect(screen.queryByText('Stale refresh metadata')).toBeNull()
      if (control === 'pause') {
        expect(screen.getByText('Current group metadata')).toBeTruthy()
      }
    }
  )

  it('uses remote revoke while paused and never falls back to local disconnect', async () => {
    const api = createApi(snapshot('paused'))
    vi.mocked(api.revoke).mockRejectedValueOnce(new Error('remote authorization unavailable'))
    render(<TelegramAccountSection api={api} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Telegram could not complete that request'
    )
    expect(api.revoke).toHaveBeenCalledTimes(1)
    expect(api.disconnect).not.toHaveBeenCalled()
  })

  it('offers resume while paused', async () => {
    const api = createApi(snapshot('paused'))
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(api.resume).toHaveBeenCalledTimes(1))
  })

  it('makes Telegram discoverable through Agents settings search', () => {
    expect(matchesSettingsSearch('telegram personal account', getAgentsPaneSearchEntries())).toBe(
      true
    )
  })

  it('prevents duplicate sign-in submission while a request is pending', async () => {
    const api = createApi(snapshot())
    const pending = deferred()
    vi.mocked(api.beginSignIn).mockReturnValue(pending.promise)
    render(<TelegramAccountSection api={api} />)
    const phone = await screen.findByLabelText('Phone number')
    fireEvent.change(phone, { target: { value: '+15555550123' } })
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(continueButton)
    fireEvent.click(continueButton)
    expect(api.beginSignIn).toHaveBeenCalledTimes(1)
    pending.resolve()
  })
})

// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import type { TelegramAccountView } from '../../../../shared/telegram-account-api'
import { connectedTelegramView, telegramViewApi } from './telegram-account-view-test-fixtures'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Telegram idle snapshot polling fences', () => {
  it('lets urgent pause supersede a pending poll and rejects its stale connection result', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let state = connectedTelegramView()
    const api = telegramViewApi(() => state)
    vi.mocked(api.pause).mockImplementation(async () => {
      state = {
        ...state,
        account: { ...state.account, phase: 'paused', paused: true, connected: false }
      }
    })
    render(<TelegramAccountSection api={api} />)
    await screen.findByText('Connected')
    let finishPoll!: (value: TelegramAccountView) => void
    vi.mocked(api.getSnapshot).mockReturnValueOnce(
      new Promise((resolve) => {
        finishPoll = resolve
      })
    )
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    expect(api.getSnapshot).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Pause replies' }))
    await screen.findByText('Paused')
    await act(async () => {
      finishPoll(connectedTelegramView())
    })
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.queryByText('Connected')).toBeNull()
  })

  it('never polls while an ordinary group refresh is waiting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const state = connectedTelegramView()
    const api = telegramViewApi(() => state)
    let finishRefresh!: (groups: TelegramAccountView['groups']) => void
    vi.mocked(api.refreshGroups).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRefresh = resolve
      })
    )
    render(<TelegramAccountSection api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh groups' }))
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(api.getSnapshot).toHaveBeenCalledTimes(1)
    await act(async () => {
      finishRefresh(state.groups)
    })
    await waitFor(() => expect(api.getSnapshot).toHaveBeenCalledTimes(2))
  })
})

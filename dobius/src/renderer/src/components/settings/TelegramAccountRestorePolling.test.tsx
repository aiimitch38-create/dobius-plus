// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import { connectedTelegramView, telegramViewApi } from './telegram-account-view-test-fixtures'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
describe('observing an asynchronous saved Telegram connection', () => {
  it('observes startup completion without navigating, initiating auth or resetting typed phone input', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const state = connectedTelegramView()
    state.account = { ...state.account, phase: 'disconnected', connected: false, canResume: true }
    const api = telegramViewApi(() => state)
    render(<TelegramAccountSection api={api} />)
    const phone = (await screen.findByLabelText('Phone number')) as HTMLInputElement
    fireEvent.change(phone, { target: { value: '+15555550123' } })
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    expect(phone.value).toBe('+15555550123')
    state.account.phase = 'connected'
    state.account.connected = true
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText('3 of 3 selected')).toBeTruthy()
    expect(api.resume).not.toHaveBeenCalled()
    expect(api.beginSignIn).not.toHaveBeenCalled()
    expect(api.cancelSignIn).not.toHaveBeenCalled()
  })

  it('observes startup failure and displays contextual recovery without requesting another code', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const state = connectedTelegramView()
    state.account = { ...state.account, phase: 'disconnected', connected: false, canResume: true }
    const api = telegramViewApi(() => state)
    render(<TelegramAccountSection api={api} />)
    await screen.findByLabelText('Phone number')
    state.account.phase = 'error'
    state.account.lastError = 'authorization-failed'
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    expect(await screen.findByRole('button', { name: 'Retry saved connection' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(
      'could not restore the saved connection'
    )
    expect(screen.queryByText(/Check the code or password/)).toBeNull()
    expect(api.resume).not.toHaveBeenCalled()
    expect(api.beginSignIn).not.toHaveBeenCalled()
    expect(api.cancelSignIn).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountSection } from './TelegramAccountSection'
import { connectedTelegramView, telegramViewApi } from './telegram-account-view-test-fixtures'

afterEach(cleanup)
describe('saved Telegram connection recovery', () => {
  it('retries the saved connection without clearing login or three saved group choices', async () => {
    const state = connectedTelegramView()
    state.account = {
      ...state.account,
      phase: 'error',
      connected: false,
      canResume: true,
      lastError: 'authorization-failed'
    }
    const api = telegramViewApi(() => state)
    vi.mocked(api.resume).mockImplementation(async () => {
      state.account.phase = 'connected'
      state.account.connected = true
      state.account.lastError = null
    })
    render(<TelegramAccountSection api={api} />)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not restore the saved connection'
    )
    expect(screen.queryByText(/Check the code or password/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved connection' }))
    await screen.findByText('Connected')
    expect(screen.getByText('3 of 3 selected')).toBeTruthy()
    expect(api.resume).toHaveBeenCalledOnce()
    expect(api.cancelSignIn).not.toHaveBeenCalled()
    expect(api.beginSignIn).not.toHaveBeenCalled()
    expect(api.disconnect).not.toHaveBeenCalled()
    expect(api.saveGroups).not.toHaveBeenCalled()
  })

  it('prevents duplicate retry and retains contextual safe error text on failed restore', async () => {
    const state = connectedTelegramView()
    state.account = {
      ...state.account,
      phase: 'error',
      connected: false,
      canResume: true,
      lastError: 'authorization-failed'
    }
    const api = telegramViewApi(() => state)
    let reject!: (error: Error) => void
    vi.mocked(api.resume).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      })
    )
    render(<TelegramAccountSection api={api} />)
    const retry = await screen.findByRole('button', { name: 'Retry saved connection' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(api.resume).toHaveBeenCalledOnce()
    expect((retry as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Restart sign-in' }) as HTMLButtonElement).disabled
    ).toBe(true)
    reject(
      new Error(
        "Error invoking remote method 'telegramAccount:resume': Error: authorization-failed"
      )
    )
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('alert').textContent).toContain(
      'could not restore the saved connection'
    )
    expect(api.cancelSignIn).not.toHaveBeenCalled()
  })

  it.each([false, undefined])(
    'does not invent a resumable saved session when canResume is %s',
    async (canResume) => {
      const state = connectedTelegramView()
      state.account = {
        ...state.account,
        phase: 'error',
        connected: false,
        canResume,
        lastError: 'authorization-failed'
      }
      render(<TelegramAccountSection api={telegramViewApi(() => state)} />)
      await screen.findByRole('button', { name: 'Restart sign-in' })
      expect(screen.queryByRole('button', { name: 'Retry saved connection' })).toBeNull()
    }
  )
})

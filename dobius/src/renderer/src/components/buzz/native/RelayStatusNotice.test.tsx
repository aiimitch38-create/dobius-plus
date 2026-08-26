// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelayStatusNotice } from './RelayStatusNotice'
import type { CommunicationsRelayStatus } from '../../../../../shared/communications-relay-status'

const relayStatus = vi.fn<() => Promise<CommunicationsRelayStatus>>()

function setBridge(): void {
  ;(window as unknown as { dobiusCommunications: unknown }).dobiusCommunications = { relayStatus }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { dobiusCommunications?: unknown }).dobiusCommunications
  relayStatus.mockReset()
})

describe('RelayStatusNotice', () => {
  it('renders nothing while the relay is running', async () => {
    setBridge()
    relayStatus.mockResolvedValue({ state: 'running', port: 3300 })
    const onConnected = vi.fn()
    const { container } = render(<RelayStatusNotice onConnected={onConnected} />)
    await waitFor(() => {
      expect(relayStatus).toHaveBeenCalledTimes(1)
    })
    expect(container.textContent).toBe('')
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('shows the plain-language reason when the relay failed to start', async () => {
    setBridge()
    relayStatus.mockResolvedValue({
      state: 'failed',
      reason: 'Port 3300 is held by another process',
      port: 3300
    })
    render(<RelayStatusNotice onConnected={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Port 3300 is held by another process')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it("falls back to its own copy when the relay hasn't started", async () => {
    setBridge()
    relayStatus.mockResolvedValue({ state: 'stopped' })
    render(<RelayStatusNotice onConnected={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent("The local relay hasn't started")
  })

  it('renders nothing when the status bridge is unavailable', async () => {
    relayStatus.mockResolvedValue({ state: 'failed', reason: 'unreachable' })
    const { container } = render(<RelayStatusNotice onConnected={vi.fn()} />)
    await waitFor(() => {
      expect(relayStatus).not.toHaveBeenCalled()
    })
    expect(container.textContent).toBe('')
  })

  it('retries the status read and refreshes via onConnected once running', async () => {
    setBridge()
    relayStatus
      .mockResolvedValueOnce({ state: 'failed', reason: 'Relay could not start: boom' })
      .mockResolvedValueOnce({ state: 'running', port: 3300 })
    const onConnected = vi.fn()
    const user = userEvent.setup()
    render(<RelayStatusNotice onConnected={onConnected} />)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(relayStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps showing the fresh reason when a retry still fails', async () => {
    setBridge()
    relayStatus
      .mockResolvedValueOnce({ state: 'failed', reason: 'Relay could not start: boom' })
      .mockResolvedValueOnce({ state: 'stopped' })
    const onConnected = vi.fn()
    const user = userEvent.setup()
    render(<RelayStatusNotice onConnected={onConnected} />)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("The local relay hasn't started")
    expect(onConnected).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { activateAndRevealWorktree, state } = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn((_id: string, _opts?: unknown) => ({})),
  state: { settings: { kitchenEnabled: true } as { kitchenEnabled?: boolean } }
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree }))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((pick: (s: typeof state) => unknown) => pick(state), {
    getState: () => ({ setBoardStudio: vi.fn(), setActiveView: vi.fn() })
  })
}))

import { KitchenMarker } from './KitchenMarker'

const setKitchen = vi.fn()
;(window as unknown as { api: unknown }).api = { vertexTasks: { setKitchen } }

afterEach(() => {
  cleanup()
  setKitchen.mockReset()
  state.settings = { kitchenEnabled: true }
})

describe('KitchenMarker', () => {
  it('offers "Send to kitchen" on a waiting card only while the kitchen is on', async () => {
    setKitchen.mockResolvedValue({ kitchen: { status: 'marked', markedAt: 1, updatedAt: 1 } })
    render(<KitchenMarker task={{ id: 't1', status: 'backlog' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send to kitchen' }))
    expect(setKitchen).toHaveBeenCalledWith('t1', true)
    expect(await screen.findByText(/In the kitchen queue/)).toBeTruthy()
    cleanup()

    render(<KitchenMarker task={{ id: 't2', status: 'in-progress' }} />)
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    state.settings = {}
    render(<KitchenMarker task={{ id: 't3', status: 'backlog' }} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets Carson take back a card that has not started', () => {
    setKitchen.mockResolvedValue(null)
    render(
      <KitchenMarker
        task={{ id: 't1', status: 'backlog', kitchen: { status: 'marked', markedAt: 1, updatedAt: 1 } }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(setKitchen).toHaveBeenCalledWith('t1', false)
  })

  it('shows a working cook and opens its console, with no way to unmark it', () => {
    render(
      <KitchenMarker
        task={{
          id: 't1',
          status: 'in-progress',
          kitchen: { status: 'cooking', markedAt: 1, updatedAt: 2, worktreeId: 'repo::/wt/1', branch: 'cook-1' }
        }}
      />
    )
    expect(screen.getByText('A cook is working on cook-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open console' }))
    expect(activateAndRevealWorktree).toHaveBeenCalledWith('repo::/wt/1', { keepView: true })
  })

  it('says why a cook was stopped', () => {
    render(
      <KitchenMarker
        task={{
          id: 't1',
          status: 'blocked',
          kitchen: { status: 'blocked', markedAt: 1, updatedAt: 2, reason: 'It hit the 45 minute time cap.' }
        }}
      />
    )
    expect(screen.getByText('Cook stopped: It hit the 45 minute time cap.')).toBeTruthy()
  })
})

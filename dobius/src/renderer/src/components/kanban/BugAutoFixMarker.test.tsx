// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { activateAndRevealWorktree } = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn((_id: string, _opts?: unknown) => ({}))
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree }))

import { BugAutoFixMarker } from './BugAutoFixMarker'

afterEach(() => {
  cleanup()
  activateAndRevealWorktree.mockClear()
})

describe('BugAutoFixMarker', () => {
  it('shows a dispatched fix and opens its console', () => {
    render(
      <BugAutoFixMarker
        autoFix={{ status: 'dispatched', queuedAt: 1, updatedAt: 2, worktreeId: 'repo::/wt/1', branch: 'fix-login' }}
      />
    )
    expect(screen.getByText('Fix agent dispatched on fix-login')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open console' }))
    expect(activateAndRevealWorktree).toHaveBeenCalledWith('repo::/wt/1', { keepView: true })
  })

  it('says why a queued card has not started, with no console link', () => {
    render(<BugAutoFixMarker autoFix={{ status: 'queued', queuedAt: 1, updatedAt: 1 }} />)
    expect(screen.getByText(/Fix agent queued/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

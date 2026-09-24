// @vitest-environment happy-dom

/* BUILD-010: the sticky "board could not be loaded" toast must not outlive the
 * board, or it stays on screen after the user navigates away. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

import KanbanBoard from './KanbanBoard'
import type { TaskSource } from './kanban-types'

function failingSource(): TaskSource {
  const fail = (): Promise<never> => Promise.reject(new Error('read-only'))
  return {
    list: fail,
    reload: fail,
    create: fail,
    update: fail,
    move: fail,
    remove: fail
  } as unknown as TaskSource
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('KanbanBoard load-error toast', () => {
  it('shows the sticky error and dismisses it on unmount', async () => {
    const { unmount } = render(<KanbanBoard source={failingSource()} />)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Kanban board could not be loaded',
        expect.objectContaining({ id: 'kanban-load-error', duration: Infinity })
      )
    )
    toast.dismiss.mockClear()

    unmount()

    expect(toast.dismiss).toHaveBeenCalledWith('kanban-load-error')
  })
})

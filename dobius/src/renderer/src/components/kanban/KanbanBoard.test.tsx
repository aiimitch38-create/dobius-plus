// @vitest-environment happy-dom

/* BUILD-010: the sticky "board could not be loaded" toast must not outlive the
 * board, or it stays on screen after the user navigates away. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

/* BUILD-040: the real column needs a DataTransfer drag; this stand-in lists
 * its cards and exposes one button that drops a named card on it, which runs
 * the board's real moveTask. */
vi.mock('./KanbanColumn', () => ({
  KanbanColumn: ({
    status,
    tasks,
    onDrop,
    onOpen
  }: {
    status: string
    tasks: { id: string; title: string }[]
    onDrop: (status: string, index: number, taskId?: string) => void
    onOpen: (taskId: string) => void
  }) => (
    <section data-testid={`column-${status}`}>
      {tasks.map((task) => (
        <button key={task.id} type="button" onClick={() => onOpen(task.id)}>
          {task.title}
        </button>
      ))}
      <button type="button" onClick={() => onDrop(status, 0, 'task-1')}>
        {`drop on ${status}`}
      </button>
    </section>
  )
}))
// The detail panel's status select calls onUpdate({ status }); this stand-in does the same.
vi.mock('./KanbanDetailPanel', () => ({
  KanbanDetailPanel: ({ onUpdate }: { onUpdate: (patch: { status: string }) => void }) => (
    <button type="button" onClick={() => onUpdate({ status: 'done' })}>
      set status done
    </button>
  )
}))

import KanbanBoard from './KanbanBoard'
import type { Task, TaskSource } from './kanban-types'

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

function reviewTask(): Task {
  return {
    id: 'task-1',
    title: 'Ship the login fix',
    description: '',
    status: 'review',
    type: 'bug',
    priority: 'medium',
    destination: 'system',
    order: 0,
    createdAt: 1,
    updatedAt: 1
  } as unknown as Task
}

function memorySource(initial: Task[]): TaskSource & {
  move: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
} {
  let tasks = initial
  const update = vi.fn(async (taskId: string, patch: Partial<Task>) => {
    tasks = tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    return tasks.find((task) => task.id === taskId) ?? null
  })
  const move = vi.fn(async (taskId: string, to: Task['status']) => {
    tasks = tasks.map((task) => (task.id === taskId ? { ...task, status: to } : task))
    return tasks.find((task) => task.id === taskId) ?? null
  })
  return {
    list: async () => tasks,
    create: async () => null,
    remove: async () => false,
    update,
    move
  } as unknown as TaskSource & {
    move: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

describe('KanbanBoard Done move (#93)', () => {
  it('asks for the result note in an app dialog, never window.prompt', async () => {
    // Electron's renderer: window.prompt exists but always returns null.
    const prompt = vi.fn(() => null)
    vi.stubGlobal('prompt', prompt)
    const source = memorySource([reviewTask()])
    render(<KanbanBoard source={source} />)
    await screen.findByText('Ship the login fix')

    fireEvent.click(screen.getByText('drop on done'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Mark as done')).toBeTruthy()
    expect(prompt).not.toHaveBeenCalled()
    // Nothing is written or moved until the note is submitted.
    expect(source.move).not.toHaveBeenCalled()
    expect(source.update).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('column-review')).getByText('Ship the login fix')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('cancel keeps the card in its column and writes nothing', async () => {
    const source = memorySource([reviewTask()])
    render(<KanbanBoard source={source} />)
    await screen.findByText('Ship the login fix')

    fireEvent.click(screen.getByText('drop on done'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(screen.getByTestId('column-review')).getByText('Ship the login fix')).toBeTruthy()
    expect(within(screen.getByTestId('column-done')).queryByText('Ship the login fix')).toBeNull()
    expect(source.move).not.toHaveBeenCalled()
    expect(source.update).not.toHaveBeenCalled()
  })

  it('submitting a note saves it and moves the card to Done', async () => {
    const source = memorySource([reviewTask()])
    render(<KanbanBoard source={source} />)
    await screen.findByText('Ship the login fix')

    fireEvent.click(screen.getByText('drop on done'))
    const dialog = await screen.findByRole('dialog')
    const markDone = within(dialog).getByRole('button', { name: 'Mark done' }) as HTMLButtonElement
    expect(markDone.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '  Fixed the redirect loop  ' }
    })
    fireEvent.click(markDone)

    await waitFor(() =>
      expect(within(screen.getByTestId('column-done')).getByText('Ship the login fix')).toBeTruthy()
    )
    expect(source.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ resultNote: 'Fixed the redirect loop', completedAt: expect.any(Number) })
    )
    expect(source.move).toHaveBeenCalledWith('task-1', 'done', 0)
  })
})

describe('KanbanBoard Done from the detail panel (#93)', () => {
  it('opens the same dialog; cancel writes nothing, a note saves Done', async () => {
    const source = memorySource([reviewTask()])
    render(<KanbanBoard source={source} />)
    fireEvent.click(await screen.findByText('Ship the login fix'))

    fireEvent.click(screen.getByText('set status done'))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(source.update).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('column-review')).getByText('Ship the login fix')).toBeTruthy()

    fireEvent.click(screen.getByText('set status done'))
    dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Verified' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark done' }))

    await waitFor(() =>
      expect(source.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'done',
          resultNote: 'Verified',
          completedAt: expect.any(Number)
        })
      )
    )
  })
})

describe('KanbanBoard analytics completion rate (#95)', () => {
  it('shows a finite 0% on an empty board', async () => {
    render(<KanbanBoard source={memorySource([])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))

    const label = await screen.findByText('Completion rate')
    const value = label.parentElement?.querySelector('p')?.textContent
    expect(value).toBe('0%')
  })
})

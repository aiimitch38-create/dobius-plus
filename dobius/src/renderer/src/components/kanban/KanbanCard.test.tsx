// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import { KanbanCard } from './KanbanCard'
import type { Task } from './kanban-types'

const readAttachment = vi.fn(async () => 'data:image/png;base64,AAAA')

function task(status: Task['status'], attachments?: Task['attachments']): Task {
  return {
    id: 'task-1',
    title: 'Ship the login fix',
    description: '',
    status,
    type: 'bug',
    priority: 'medium',
    destination: 'system',
    order: 0,
    files: [],
    labels: [],
    collaborators: [],
    childTaskIds: [],
    dependencies: [],
    attachments,
    createdAt: 1,
    updatedAt: 1
  } as unknown as Task
}

const shot = { id: 'a-shot', name: 'before.png', path: '/x/a.png', mime: 'image/png', bytes: 1, createdAt: 10, kind: 'screenshot' } as const
const proof = { id: 'a-proof', name: 'after.png', path: '/x/b.png', mime: 'image/png', bytes: 1, createdAt: 5, kind: 'proof', addedBy: 'console-w1' } as const

// Why: happy-dom's IntersectionObserver never fires; this one reports the
// element on screen at once, so the lazy read runs the way it does in the app.
class VisibleObserver {
  constructor(private readonly cb: (entries: { isIntersecting: boolean }[]) => void) {}
  observe(): void {
    this.cb([{ isIntersecting: true }])
  }
  disconnect(): void {}
}

function renderCard(item: Task): void {
  vi.stubGlobal('IntersectionObserver', VisibleObserver)
  vi.stubGlobal('api', { vertexTasks: { readAttachment }, shell: { openFilePath: vi.fn(async () => undefined) } })
  render(
    <KanbanCard task={item} dragging={false} onOpen={() => {}} onDragStart={() => {}} onDragEnd={() => {}} />
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  readAttachment.mockClear()
})

describe('KanbanCard proof thumbnail', () => {
  it.each(['review', 'done'] as const)('shows the proof (not the newer screenshot) in %s', async (status) => {
    // Why a per-case id: reads are cached per attachment id across renders.
    renderCard(task(status, [shot, { ...proof, id: `a-proof-${status}` }]))
    expect(screen.getByTestId('kanban-card-proof')).toBeTruthy()
    const thumb = screen.getByLabelText('Open after.png')
    expect(thumb.getAttribute('title')).toBe('Proof from console-w1')
    await waitFor(() => expect(readAttachment).toHaveBeenCalledWith('task-1', `a-proof-${status}`))
    expect(readAttachment).toHaveBeenCalledTimes(1)
  })

  it('falls back to the newest screenshot when no proof exists', () => {
    renderCard(task('review', [{ ...shot, createdAt: 1, id: 'old', name: 'old.png' }, shot]))
    expect(screen.getByLabelText('Open before.png')).toBeTruthy()
  })

  it.each(['todo', 'in-progress', 'blocked', 'testing'] as const)('shows no thumbnail in %s', (status) => {
    renderCard(task(status, [shot, proof]))
    expect(screen.queryByTestId('kanban-card-proof')).toBeNull()
    expect(readAttachment).not.toHaveBeenCalled()
  })

  it('shows nothing when the card has no attachments', () => {
    renderCard(task('done'))
    expect(screen.queryByTestId('kanban-card-proof')).toBeNull()
  })
})

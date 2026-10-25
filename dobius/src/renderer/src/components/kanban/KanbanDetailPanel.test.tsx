// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('./kanban-people', () => ({ useAssignablePeople: () => [] }))

import { KanbanDetailPanel } from './KanbanDetailPanel'
import type { Task } from './kanban-types'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function task(attachments?: Task['attachments']): Task {
  return {
    id: 'task-1',
    title: 'Ship the login fix',
    description: 'desc',
    status: 'review',
    type: 'bug',
    priority: 'medium',
    destination: 'system',
    order: 0,
    files: [],
    labels: [],
    collaborators: [],
    childTaskIds: [],
    dependencies: [],
    subtasks: [],
    attachments,
    createdAt: 1,
    updatedAt: 1
  } as unknown as Task
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('KanbanDetailPanel screenshots', () => {
  it('pasting an image uploads it with kind screenshot, addedBy carson, and reports it', async () => {
    const stored = { id: 'a1', name: 'shot.png', path: '/p', mime: 'image/png', bytes: 11, createdAt: 2, kind: 'screenshot', addedBy: 'carson' }
    const addAttachment = vi.fn(async () => stored)
    vi.stubGlobal('api', {
      vertexTasks: { addAttachment, readAttachment: vi.fn(async () => null) },
      shell: { openFilePath: vi.fn(async () => undefined) }
    })
    const onAttachmentAdded = vi.fn()
    render(
      <KanbanDetailPanel
        task={task()}
        allTasks={[]}
        onClose={() => {}}
        onUpdate={() => {}}
        onCreateChild={() => {}}
        onDelete={() => {}}
        onAttachmentAdded={onAttachmentAdded}
      />
    )
    expect(screen.getByText('Add screenshot')).toBeTruthy()
    const file = new File([PNG], 'shot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByLabelText('Task details for Ship the login fix'), {
      clipboardData: { files: [file] }
    })
    await waitFor(() => expect(addAttachment).toHaveBeenCalledTimes(1))
    expect(addAttachment).toHaveBeenCalledWith('task-1', {
      name: 'shot.png',
      mime: 'image/png',
      dataBase64: Buffer.from(PNG).toString('base64'),
      kind: 'screenshot',
      addedBy: 'carson'
    })
    await waitFor(() => expect(onAttachmentAdded).toHaveBeenCalledWith(stored))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('refuses a non-image paste without calling main', async () => {
    const addAttachment = vi.fn()
    vi.stubGlobal('api', { vertexTasks: { addAttachment, readAttachment: vi.fn() } })
    render(
      <KanbanDetailPanel task={task()} allTasks={[]} onClose={() => {}} onUpdate={() => {}} onCreateChild={() => {}} onDelete={() => {}} />
    )
    fireEvent.paste(screen.getByLabelText('Task details for Ship the login fix'), {
      clipboardData: { files: [new File(['x'], 'a.svg', { type: 'image/svg+xml' })] }
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(addAttachment).not.toHaveBeenCalled()
  })

  it('lists attachments newest first and labels proof items with who and when', () => {
    vi.stubGlobal('api', { vertexTasks: { readAttachment: vi.fn(async () => null) } })
    render(
      <KanbanDetailPanel
        task={task([
          { id: 'old', name: 'old.png', path: '/o', mime: 'image/png', bytes: 1, createdAt: 1000, kind: 'screenshot', addedBy: 'carson' },
          { id: 'new', name: 'new.png', path: '/n', mime: 'image/png', bytes: 1, createdAt: 2000, kind: 'proof', addedBy: 'console-w1' }
        ])}
        allTasks={[]}
        onClose={() => {}}
        onUpdate={() => {}}
        onCreateChild={() => {}}
        onDelete={() => {}}
      />
    )
    const labels = screen.getAllByLabelText(/^Open /).map((el) => el.getAttribute('aria-label'))
    expect(labels).toEqual(['Open new.png', 'Open old.png'])
    expect(screen.getByText(/^Proof · console-w1 · /)).toBeTruthy()
    expect(screen.getByText(/^Screenshot · carson · /)).toBeTruthy()
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VertexTaskInput } from '../../../../../shared/vertex-task-types'
import { BoardReportDialog } from './BoardReportDialog'

const {
  toastSuccessMock,
  toastWarningMock,
  createMock,
  updateMock,
  addAttachmentMock,
  getVersionMock
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastWarningMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  addAttachmentMock: vi.fn(),
  getVersionMock: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, warning: toastWarningMock } }))

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const PNG_BASE64 = 'iVBORwECAw=='

function pasteImage(name = 'shot.png', type = 'image/png', bytes: BlobPart = PNG_BYTES): void {
  const file = new File([bytes], name, { type })
  fireEvent.paste(screen.getByLabelText('Title'), { clipboardData: { files: [file] } })
}

function renderDialog(): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn()
  render(
    <BoardReportDialog open onOpenChange={onOpenChange} onSendFeedbackInstead={() => {}} />
  )
  return { onOpenChange }
}

function typeTitle(value: string): void {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value } })
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Add to Kanban' })
}

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset().mockResolvedValue({ id: 't1' })
  addAttachmentMock.mockReset()
  getVersionMock.mockReset().mockResolvedValue('2.1.0')
  toastSuccessMock.mockReset()
  toastWarningMock.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      vertexTasks: { create: createMock, update: updateMock, addAttachment: addAttachmentMock },
      updater: { getVersion: getVersionMock }
    }
  })
})

afterEach(cleanup)

describe('BoardReportDialog attachments', () => {
  it('shows a pasted image as a thumbnail and lets it be removed', async () => {
    renderDialog()
    pasteImage()
    const thumb = (await screen.findByAltText('shot.png')) as HTMLImageElement
    expect(thumb.src).toBe(`data:image/png;base64,${PNG_BASE64}`)
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    expect(screen.queryByAltText('shot.png')).toBeNull()
  })

  it('refuses a non-image type and an oversized image inline', async () => {
    renderDialog()
    pasteImage('page.svg', 'image/svg+xml')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only PNG, JPG, WebP or GIF images can be attached.'
    )
    expect(screen.queryByAltText('page.svg')).toBeNull()

    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    fireEvent.paste(screen.getByLabelText('Title'), { clipboardData: { files: [big] } })
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('big.png is larger than 10 MB.')
    )
    expect(screen.queryByAltText('big.png')).toBeNull()
  })

  it('uploads pasted images after the card is created and writes their paths into the body', async () => {
    createMock.mockResolvedValue({ id: 't1', description: 'body\n\nContext\n- App version: 2.1.0' })
    addAttachmentMock.mockResolvedValue({
      id: 'abc',
      path: '/data/vertex-attachments/t1/abc.png',
      name: 'shot.png',
      mime: 'image/png',
      bytes: 7,
      createdAt: 1
    })
    const { onOpenChange } = renderDialog()
    typeTitle('Zoom resets on reload')
    pasteImage()
    await screen.findByAltText('shot.png')
    fireEvent.click(submitButton())

    await waitFor(() => expect(addAttachmentMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.invocationCallOrder[0]).toBeLessThan(
      addAttachmentMock.mock.invocationCallOrder[0]
    )
    expect(addAttachmentMock).toHaveBeenCalledWith('t1', {
      name: 'shot.png',
      mime: 'image/png',
      dataBase64: PNG_BASE64
    })
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock).toHaveBeenCalledWith('t1', {
      description:
        'body\n\nContext\n- App version: 2.1.0\n\nScreenshot: /data/vertex-attachments/t1/abc.png'
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toastWarningMock).not.toHaveBeenCalled()
  })

  it('keeps the card and warns when an upload fails', async () => {
    createMock.mockResolvedValue({ id: 't1', description: 'body' })
    addAttachmentMock.mockRejectedValue(new Error('disk full'))
    const { onOpenChange } = renderDialog()
    typeTitle('Crash on save')
    pasteImage()
    await screen.findByAltText('shot.png')
    fireEvent.click(submitButton())

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledTimes(1))
    expect(toastWarningMock).toHaveBeenCalledWith(
      '1 of 1 images could not be attached. The card was still created.'
    )
    expect(updateMock).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('BoardReportDialog', () => {
  it('files a bug card for the Dobius lead with the context block', async () => {
    createMock.mockResolvedValue({ id: 't1' })
    const { onOpenChange } = renderDialog()
    typeTitle('Zoom resets on reload')
    fireEvent.change(screen.getByLabelText('Details (optional)'), {
      target: { value: 'Open the Board, zoom in, relaunch.' }
    })
    fireEvent.click(submitButton())

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const input = createMock.mock.calls[0][0] as VertexTaskInput
    expect(input).toMatchObject({
      title: 'Zoom resets on reload',
      projectId: 'dobius-plus',
      assignee: { id: 'lead-dobius-plus', kind: 'hermes-profile', name: 'Dobius lead' },
      status: 'todo',
      priority: 'high',
      type: 'bug',
      labels: ['bug', 'from-app'],
      createdBy: 'carson'
    })
    expect(input.description).toBe(
      'Open the Board, zoom in, relaunch.\n\nContext\n- App version: 2.1.0\n- View: Board'
    )
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Added to Kanban', expect.anything()))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('files a change request as medium priority with the change-request label', async () => {
    createMock.mockResolvedValue({ id: 't2' })
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Change request' }))
    typeTitle('Let me pin the zoom control')
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter', metaKey: true })

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0][0]).toMatchObject({
      priority: 'medium',
      type: 'feature',
      labels: ['change-request', 'from-app']
    })
  })

  it('blocks an empty title', () => {
    renderDialog()
    expect(submitButton().disabled).toBe(true)
    typeTitle('   ')
    expect(submitButton().disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter', metaKey: true })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('plain Enter in the title does not submit', () => {
    renderDialog()
    typeTitle('Something')
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('keeps the text and shows an error when create fails', async () => {
    createMock.mockRejectedValue(new Error('store offline'))
    const { onOpenChange } = renderDialog()
    typeTitle('Crash on save')
    fireEvent.change(screen.getByLabelText('Details (optional)'), { target: { value: 'details' } })
    fireEvent.click(submitButton())

    await screen.findByRole('alert')
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Crash on save')
    expect((screen.getByLabelText('Details (optional)') as HTMLTextAreaElement).value).toBe(
      'details'
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })
})

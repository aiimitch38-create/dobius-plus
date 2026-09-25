// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import PromptsPanel from './PromptsPanel'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

// BUILD-009B: prompts.json unreadable -> the main process refuses the save and
// rejects the IPC call. The panel must show that error and must not crash.
const REFUSED = "prompts.json can't be read, so changes are not saved; repair or remove it"
const prompt = { id: 'p1', title: 'Greeting', text: 'hello', createdAt: 1 }

let root: Root | null = null

async function render(): Promise<HTMLDivElement> {
  Object.assign(window, {
    api: {
      prompts: {
        list: vi.fn(async () => [prompt]),
        save: vi.fn(async () => {
          throw new Error(REFUSED)
        }),
        delete: vi.fn(async () => {
          throw new Error(REFUSED)
        }),
        inject: vi.fn()
      }
    }
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PromptsPanel />)
  })
  return container
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!element) {
    throw new Error('element missing')
  }
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('PromptsPanel refused saves (BUILD-009B)', () => {
  it('shows the error and keeps the editor open when a save is refused', async () => {
    const container = await render()
    await click(container.querySelector('button[aria-label="Edit"]'))
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save'
    )

    await click(saveButton)

    expect(toast.error).toHaveBeenCalledWith(REFUSED)
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(container.textContent).toContain('Greeting')
  })

  it('shows the error when a delete is refused', async () => {
    const container = await render()

    await click(container.querySelector('button[aria-label="Delete"]'))

    expect(toast.error).toHaveBeenCalledWith(REFUSED)
    expect(container.textContent).toContain('Greeting')
  })
})

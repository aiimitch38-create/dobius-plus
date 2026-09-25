// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { DestinationsSection } from './DestinationsSection'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

// BUILD-009B: destinations.json unreadable -> the delete is refused and the IPC
// call rejects. The section must show that error and must not crash.
const REFUSED = "destinations.json can't be read, so changes are not saved; repair or remove it"
const destination = {
  id: 'd1',
  name: 'Phone',
  type: 'system',
  config: {},
  createdAt: 1,
  updatedAt: 1
}

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DestinationsSection refused delete (BUILD-009B)', () => {
  it('shows the error and keeps the destination listed', async () => {
    Object.assign(window, {
      api: {
        destinations: {
          list: vi.fn(async () => [destination]),
          save: vi.fn(),
          delete: vi.fn(async () => {
            throw new Error(REFUSED)
          }),
          test: vi.fn()
        }
      }
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<DestinationsSection />)
    })
    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.innerHTML.includes('lucide-trash')
    )
    if (!deleteButton) {
      throw new Error('delete button missing')
    }

    await act(async () => {
      deleteButton.click()
    })

    expect(toast.error).toHaveBeenCalledWith(REFUSED)
    expect(container.textContent).toContain('Phone')
  })
})

// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ImessageBridgeSetting } from './ImessageBridgeSetting'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

// BUILD-009C review F1: imessage-bridge.json unreadable -> main refuses the
// Settings edit and the IPC call rejects. The setting must show that.
const REFUSED = "imessage-bridge.json can't be read, so changes are not saved; repair or remove it"
const config = {
  enabled: false,
  triggerPrefix: 'd:',
  selfHandle: null,
  lastSeenRowid: 0
}
const status = {
  enabled: false,
  isRunning: false,
  triggerPrefix: 'd:',
  selfHandle: null,
  lastSeenRowid: 0,
  chatDbReadable: { ok: false, error: 'no access' },
  outboundLastMin: 0,
  unreadableDetail: 'invalid JSON'
}

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ImessageBridgeSetting refused save (BUILD-009C F1)', () => {
  it('shows the refusal and the unreadable-file notice', async () => {
    const updateConfig = vi.fn(async () => {
      throw new Error(REFUSED)
    })
    Object.assign(window, {
      api: {
        imessageBridge: {
          getConfig: vi.fn(async () => config),
          status: vi.fn(async () => status),
          updateConfig,
          testSend: vi.fn(),
          openFullDiskAccess: vi.fn()
        }
      }
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ImessageBridgeSetting />)
    })
    const toggle = container.querySelector('[role="switch"]') as HTMLElement | null
    if (!toggle) {
      throw new Error('toggle missing')
    }

    await act(async () => {
      toggle.click()
    })

    expect(updateConfig).toHaveBeenCalledWith({ enabled: true })
    expect(toast.error).toHaveBeenCalledWith(REFUSED)
    expect(container.textContent).toContain("imessage-bridge.json can't be read (invalid JSON)")
  })
})

// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../../../shared/agents'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentMemoryView } from './AgentMemoryView'
import { useAgentDetailActions } from './use-agent-detail-actions'

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))

const SCOPE =
  'All conversations for this agent, including channels, will start fresh on the next run'

let container: HTMLDivElement
let root: Root
const resetSession = vi.fn(async () => [])

beforeEach(() => {
  mocks.success.mockClear()
  resetSession.mockClear()
  Object.assign(window, { api: { agents: { resetSession } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const agent = { id: 'a1', name: 'Atlas', updatedAt: 1 } as CustomAgent

function newSessionButton(): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((node) =>
    /New session/.test(node.textContent ?? '')
  )
  if (!button) {
    throw new Error('New session button not rendered')
  }
  return button
}

describe('New session scope copy (#57 review F3)', () => {
  it('explains in a tooltip that every conversation, including channels, starts fresh', async () => {
    act(() => {
      root.render(
        <TooltipProvider delayDuration={0}>
          <AgentMemoryView
            agent={agent}
            memory=""
            saving={false}
            resetting={false}
            onMemoryChange={vi.fn()}
            onResetSession={vi.fn()}
            onSave={vi.fn()}
          />
        </TooltipProvider>
      )
    })
    await act(async () => {
      newSessionButton().focus()
    })
    expect(document.body.textContent).toContain(SCOPE)
  })

  it('says the same in the toast after a reset', async () => {
    let actions: ReturnType<typeof useAgentDetailActions> | null = null
    function Probe(): null {
      actions = useAgentDetailActions({
        selectedAgentId: 'a1',
        selectedAgent: agent,
        saveMemoryFile: vi.fn(),
        reportSaveError: vi.fn(),
        setAgents: vi.fn()
      })
      return null
    }
    act(() => root.render(<Probe />))
    await act(async () => {
      await actions?.resetSession()
    })
    expect(resetSession).toHaveBeenCalledWith('a1')
    expect(mocks.success).toHaveBeenCalledWith(SCOPE)
  })
})

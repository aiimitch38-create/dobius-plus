// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingAgentDecision } from '../../../../shared/agents'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentDecisionTicketDialog } from './AgentDecisionTicketDialog'

let container: HTMLDivElement
let root: Root
const resolveDecision = vi.fn(async () => ({ ok: true }))

beforeEach(() => {
  resolveDecision.mockClear()
  Object.assign(window, { api: { agents: { resolveDecision } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function decision(overrides: Partial<PendingAgentDecision> = {}): PendingAgentDecision {
  return {
    id: 'd1',
    runId: 'r1',
    agentId: 'a1',
    toolName: 'Bash',
    input: { command: 'ls' },
    cwd: '/repo',
    createdAt: Date.now(),
    ...overrides
  }
}

function renderDialog(pending: PendingAgentDecision): HTMLButtonElement {
  act(() => {
    root.render(
      <TooltipProvider>
        <AgentDecisionTicketDialog
          agents={[]}
          decisions={[pending]}
          openDecisionId={pending.id}
          onOpenDecisionChange={vi.fn()}
          onResolved={vi.fn()}
        />
      </TooltipProvider>
    )
  })
  const button = Array.from(document.body.querySelectorAll('button')).find((node) =>
    /Bypass run/.test(node.textContent ?? '')
  )
  if (!button) {
    throw new Error('Bypass run button not rendered')
  }
  return button
}

describe('AgentDecisionTicketDialog bypass button (#75)', () => {
  it('is disabled when the run cannot switch into bypass', () => {
    const button = renderDialog(decision({ bypassRunUnavailableReason: 'not supported here' }))
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(resolveDecision).not.toHaveBeenCalled()
  })

  it('stays enabled when the run supports bypass', () => {
    const button = renderDialog(decision())
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(resolveDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1', action: 'bypassRun' })
    )
  })
})

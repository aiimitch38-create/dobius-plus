import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  order: null as null | { id: string; text: string; lanes: { tabId: string; name: string }[] },
  consoles: {} as Record<string, { tabId: string; title: string; x: number; y: number; w: number }>,
  missions: [] as {
    orderId: string
    tabId: string
    name: string
    state: string
    reply: string | null
  }[]
}
const deliverOrder = vi.fn(async () => ({ orderId: 'o2', ok: true, text: 'sent', outcomes: [] }))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() })
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ addCard: vi.fn() }) } }))
vi.mock('../board-delivery/board-delivery', () => ({ deliverOrder }))
const orderListeners = new Set<() => void>()
vi.mock('../board-delivery/board-orders', () => ({
  latestOrder: () => state.order,
  onOrdersChanged: (l: () => void) => {
    orderListeners.add(l)
    return () => orderListeners.delete(l)
  }
}))
vi.mock('../board-delivery/console-lifecycle', () => ({
  consoleByName: (_wt: string, name: string) => state.consoles[name.toLowerCase()] ?? null
}))
vi.mock('../board-delivery/mission-tracker', () => ({
  missionsForOrder: () => state.missions,
  onMissionEvent: () => () => {}
}))
vi.stubGlobal('window', { setTimeout, clearTimeout })

const { forwardResults, handoffTask } = await import('./forward-handoff-effects')

beforeEach(() => {
  state.order = null
  state.consoles = {
    'claude 1': { tabId: 't1', title: 'Claude 1', x: 0, y: 0, w: 100 },
    'codex 1': { tabId: 't2', title: 'Codex 1', x: 0, y: 0, w: 100 },
    reviewer: { tabId: 't3', title: 'Reviewer', x: 0, y: 0, w: 100 }
  }
  state.missions = []
  deliverOrder.mockClear()
})

describe('forwardResults', () => {
  it('with no order yet, waits for the next order and forwards once it settles', async () => {
    const r = await forwardResults('wt', {
      to: ['Reviewer'],
      text: 'review',
      source: null,
      mode: 'broadcast'
    })
    expect(r.ok).toBe(true)
    expect(deliverOrder).not.toHaveBeenCalled()
    state.order = { id: 'o9', text: 'Audit', lanes: [{ tabId: 't1', name: 'Claude 1' }] }
    state.missions = [
      { orderId: 'o9', tabId: 't1', name: 'Claude 1', state: 'finished', reply: 'found X' }
    ]
    for (const l of orderListeners) {
      l()
    }
    await vi.waitFor(() => expect(deliverOrder).toHaveBeenCalledTimes(1))
    expect(orderListeners.size).toBe(0)
  })

  it('refuses when no destination console matches', async () => {
    const r = await forwardResults('wt', { to: ['Nobody'], text: 'x', source: null, mode: 'split' })
    expect(r.ok).toBe(false)
  })

  it('arms without sending while a source is still working, then sends once all replied', async () => {
    state.order = {
      id: 'o1',
      text: 'Find bugs',
      lanes: [
        { tabId: 't1', name: 'Claude 1' },
        { tabId: 't2', name: 'Codex 1' }
      ]
    }
    state.missions = [
      { orderId: 'o1', tabId: 't1', name: 'Claude 1', state: 'finished', reply: 'bug A' },
      { orderId: 'o1', tabId: 't2', name: 'Codex 1', state: 'running', reply: null }
    ]
    const armed = await forwardResults('wt', {
      to: ['Reviewer'],
      text: 'fix',
      source: null,
      mode: 'broadcast'
    })
    expect(armed.ok).toBe(true)
    await Promise.resolve()
    expect(deliverOrder).not.toHaveBeenCalled()
  })

  it('sends a digest of every reply right away when the order already settled', async () => {
    state.order = { id: 'o1', text: 'Find bugs', lanes: [{ tabId: 't1', name: 'Claude 1' }] }
    state.missions = [
      { orderId: 'o1', tabId: 't1', name: 'Claude 1', state: 'finished', reply: 'bug A' }
    ]
    await forwardResults('wt', { to: ['Reviewer'], text: 'fix', source: null, mode: 'broadcast' })
    await vi.waitFor(() => expect(deliverOrder).toHaveBeenCalledTimes(1))
    const lanes = (
      deliverOrder.mock.calls[0] as unknown as [{ lanes: { tabId: string; text: string }[] }]
    )[0].lanes
    expect(lanes[0].tabId).toBe('t3')
    expect(lanes[0].text).toContain('bug A')
  })
})

describe('handoffTask', () => {
  it('refuses an unknown agent and an ambiguous source', async () => {
    expect((await handoffTask('wt', { cli: 'not-an-agent', source: 'Claude 1' })).ok).toBe(false)
    state.order = {
      id: 'o1',
      text: 'x',
      lanes: [
        { tabId: 't1', name: 'Claude 1' },
        { tabId: 't2', name: 'Codex 1' }
      ]
    }
    expect((await handoffTask('wt', { cli: 'codex', source: null })).ok).toBe(false)
  })
})

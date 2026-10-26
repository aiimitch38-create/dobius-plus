import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCard, BoardCardOf } from '@/store/slices/board'

const live = vi.hoisted(() => ({
  cards: [] as BoardCard[],
  state: 'idle' as string,
  listeners: new Set<() => void>(),
  deliverOrder: vi.fn(),
  updateCard: vi.fn(),
  toastInfo: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ updateCard: live.updateCard }),
    subscribe: (listener: () => void) => {
      live.listeners.add(listener)
      return () => live.listeners.delete(listener)
    }
  }
}))
vi.mock('@/store/slices/board', () => ({ getBoard: () => ({ cards: live.cards, groups: [] }) }))
vi.mock('../board-delivery/board-delivery', () => ({
  deliverOrder: live.deliverOrder,
  consoleDeliveryState: () => live.state
}))
vi.mock('sonner', () => ({ toast: { info: live.toastInfo, error: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_k: string, fallback: string) => fallback }))

const { connectBrowserLink } = await import('./browser-link-delivery')

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const driver: BoardCardOf<'console'> = {
  ...base,
  id: 'c1',
  kind: 'console',
  tabId: 'tab-1',
  agentKind: 'claude',
  title: 'Claude 1'
}
const tile: BoardCardOf<'web'> = {
  ...base,
  id: 't1',
  kind: 'web',
  url: 'http://localhost:5173/',
  title: 'Preview'
}
const notify = (): void => live.listeners.forEach((l) => l())

beforeEach(() => {
  live.listeners.clear()
  live.state = 'idle'
  live.cards = [driver, { ...tile, driverCardId: 'c1' }]
  live.deliverOrder
    .mockReset()
    .mockResolvedValue({ ok: true, text: '', outcomes: [], orderId: 'o' })
  live.updateCard.mockReset()
  live.toastInfo.mockReset()
})

describe('connectBrowserLink', () => {
  it('links the tile and types the handoff at once when the console is idle', () => {
    connectBrowserLink('wt', tile, 'c1')
    expect(live.updateCard).toHaveBeenCalledWith('wt', 't1', { driverCardId: 'c1' })
    expect(live.deliverOrder).toHaveBeenCalledTimes(1)
    const lane = live.deliverOrder.mock.calls[0][0].lanes[0]
    expect(lane.tabId).toBe('tab-1')
    expect(lane.text).toContain('--page web-tile:t1 --as console-c1')
    expect(live.toastInfo).not.toHaveBeenCalled()
  })

  it('defers the handoff while the console works and sends it once idle', () => {
    live.state = 'working'
    connectBrowserLink('wt', tile, 'c1')
    expect(live.deliverOrder).not.toHaveBeenCalled()
    expect(live.toastInfo).toHaveBeenCalledWith(
      '{{name}} is working. The browser handoff is sent when it is idle.'
    )
    notify()
    expect(live.deliverOrder).not.toHaveBeenCalled()
    live.state = 'idle'
    notify()
    expect(live.deliverOrder).toHaveBeenCalledTimes(1)
    notify()
    expect(live.deliverOrder).toHaveBeenCalledTimes(1)
  })

  it('drops a deferred handoff when the link is removed before the console idles', () => {
    live.state = 'working'
    connectBrowserLink('wt', tile, 'c1')
    live.cards = [driver, tile]
    live.state = 'idle'
    notify()
    expect(live.deliverOrder).not.toHaveBeenCalled()
    expect(live.listeners.size).toBe(0)
  })
})

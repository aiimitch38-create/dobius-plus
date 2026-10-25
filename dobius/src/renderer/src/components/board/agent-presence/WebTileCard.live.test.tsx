// @vitest-environment happy-dom
// A web tile an agent works in stays live (no glance shield / still) even when
// zoomed out, and returns to its glance once the agent has been idle for 10 s.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import type { BoardCardOf } from '@/store/slices/board'
import { WebTileCard } from '../cards/WebTileCard'
import { AGENT_TILE_LIVE_MS, applyAgentCursorEvent, resetAgentPresenceForTest } from './agent-presence-state'

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))
vi.mock('@/store', () => ({
  useAppStore: create(() => ({ browserDefaultSearchEngine: 'google', browserKagiSessionLink: '' }))
}))
vi.mock('@/store/slices/board', () => ({ getBoard: () => ({ cards: [], viewport: {} }) }))
vi.mock('../board-canvas/board-camera-focus', () => ({
  boardCardFocusViewport: () => null,
  focusBoardCard: vi.fn()
}))
vi.mock('../board-web/WebTileExtras', () => ({ WebTileExtras: () => null }))
vi.mock('../board-web/WebTileInspectorDock', () => ({ WebTileInspectorDock: () => null }))
// Why: zoom 0.3 is below the readable threshold, so the tile would normally be a glance.
vi.mock('../cards/use-card-lod', () => ({
  useCardLod: () => ({ lod: 'glance', onScreen: true, settledZoom: 0.3, size: { w: 400, h: 300 } })
}))

const card = {
  id: 'tile-1',
  kind: 'web',
  title: 'Shop',
  url: '',
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  z: 1
} as unknown as BoardCardOf<'web'>

function scroll(seq: number): AgentCursorEvent {
  return {
    agentId: 'adam',
    name: 'Adam',
    color: '',
    kind: 'scroll',
    target: { tileId: 'tile-1', x: 10, y: 10 },
    seq,
    ts: 1_000
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  resetAgentPresenceForTest()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WebTileCard while an agent works in it', () => {
  it('drops the glance shield while the agent is active at zoom 0.3 and restores it when idle', () => {
    const { container } = render(<WebTileCard card={card} onChange={() => {}} zoom={0.3} />)
    expect(container.querySelector('[data-board-web-glance]')).not.toBeNull()
    const webview = container.querySelector('webview') as HTMLElement | null
    expect(webview).not.toBeNull()
    act(() => {
      applyAgentCursorEvent(scroll(1))
    })
    expect(container.querySelector('[data-board-web-glance]')).toBeNull()
    expect(webview?.style.display).not.toBe('none')
    expect(webview?.style.visibility).not.toBe('hidden')
    act(() => {
      vi.advanceTimersByTime(AGENT_TILE_LIVE_MS + 50)
    })
    expect(container.querySelector('[data-board-web-glance]')).not.toBeNull()
  })
})

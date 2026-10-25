// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import {
  applyAgentCursorEvent,
  resetAgentPresenceForTest,
  useAgentPresence
} from './agent-presence-state'
import { attachWebTileYield, WEB_TILE_YIELD_THROTTLE_MS } from './web-tile-yield'

const claimEvent: AgentCursorEvent = {
  agentId: 'adam',
  name: 'Adam',
  color: '',
  kind: 'click',
  target: { tileId: 'tile-1', x: 1, y: 1 },
  seq: 1,
  ts: 1_000
}

let yieldMock: ReturnType<typeof vi.fn<(args: { cardId: string }) => Promise<unknown>>>
let webview: HTMLElement
let chrome: HTMLElement
let detach: (() => void) | null = null

beforeEach(() => {
  resetAgentPresenceForTest()
  yieldMock = vi
    .fn<(args: { cardId: string }) => Promise<unknown>>()
    .mockResolvedValue({ tileId: 'tile-1', until: 99_000 })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { agents: { yield: yieldMock } }
  })
  chrome = document.createElement('div')
  webview = document.createElement('div')
  webview.tabIndex = 0
  chrome.appendChild(webview)
  document.body.appendChild(chrome)
})

afterEach(() => {
  detach?.()
  detach = null
  chrome.remove()
})

describe('attachWebTileYield', () => {
  it('calls agents.yield once when a claimed tile gets focus and stores the hold until', async () => {
    applyAgentCursorEvent(claimEvent)
    detach = attachWebTileYield('tile-1', webview, chrome)
    webview.dispatchEvent(new Event('focus'))
    webview.dispatchEvent(new Event('focus'))
    expect(yieldMock).toHaveBeenCalledTimes(1)
    expect(yieldMock).toHaveBeenCalledWith({ cardId: 'tile-1' })
    await vi.waitFor(() =>
      expect(useAgentPresence.getState().agents.adam.yieldedUntil).toBe(99_000)
    )
    // A plain yield is a hold, not an explicit take over.
    expect(useAgentPresence.getState().agents.adam).toMatchObject({ yielded: false, paused: false })
  })

  it('reports again after the throttle window via the tile chrome', () => {
    applyAgentCursorEvent(claimEvent)
    const yieldTile = vi.fn()
    let now = 10_000
    detach = attachWebTileYield('tile-1', webview, chrome, {
      isClaimed: () => true,
      yieldTile,
      now: () => now
    })
    chrome.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    chrome.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    now += WEB_TILE_YIELD_THROTTLE_MS
    chrome.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(yieldTile).toHaveBeenCalledTimes(2)
  })

  it('stays silent for an unclaimed tile', () => {
    detach = attachWebTileYield('tile-1', webview, chrome)
    webview.dispatchEvent(new Event('focus'))
    chrome.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(yieldMock).not.toHaveBeenCalled()
  })
})

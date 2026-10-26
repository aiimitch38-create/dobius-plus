// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCard, BoardCardOf } from '@/store/slices/board'

const live = vi.hoisted(() => ({
  status: 'idle' as string,
  cards: [] as BoardCard[],
  verify: vi.fn()
}))
vi.mock('../console-card/use-console-card-status', () => ({
  useConsoleCardStatus: () => ({ status: live.status, lastReply: null })
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (s: unknown) => unknown) => selector({}), {
    getState: () => ({})
  })
}))
vi.mock('@/store/slices/board', () => ({ getBoard: () => ({ cards: live.cards, groups: [] }) }))
vi.mock('./browser-link-delivery', () => ({
  verifyInBrowser: live.verify,
  disconnectBrowserLink: vi.fn()
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, vars?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars?.[k] ?? '')
}))

const { WebTileLinkControls, verifyBlockedReason } = await import('./BrowserLinkControls')

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
  title: 'Preview',
  driverCardId: 'c1'
}

beforeEach(() => {
  live.status = 'idle'
  live.cards = [driver, tile]
  live.verify.mockReset().mockResolvedValue(true)
})
afterEach(cleanup)

describe('WebTileLinkControls', () => {
  it('offers Verify + Disconnect for a driven tile and Verify sends the prompt when idle', () => {
    render(<WebTileLinkControls worktreeId="wt" tile={tile} />)
    const verify = screen.getByRole('button', { name: 'Verify with Claude 1' })
    expect((verify as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Disconnect Claude 1' })).toBeTruthy()
    verify.click()
    expect(live.verify).toHaveBeenCalledWith('wt', tile)
  })

  it('disables Verify while the console is busy and says why', () => {
    live.status = 'working'
    render(<WebTileLinkControls worktreeId="wt" tile={tile} />)
    const verify = screen.getByRole('button', { name: 'Verify with Claude 1' })
    expect((verify as HTMLButtonElement).disabled).toBe(true)
    expect(verify.getAttribute('title')).toBe('Claude 1 is working. Verify when it is idle.')
  })

  it('shows Connect terminal when the tile has no (live) driver', () => {
    live.cards = [tile]
    render(<WebTileLinkControls worktreeId="wt" tile={tile} />)
    expect(
      screen.getByRole('button', { name: 'Connect a terminal to drive this tile' })
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Verify/ })).toBeNull()
  })
})

describe('verifyBlockedReason', () => {
  it('only an idle console can take the verify prompt', () => {
    expect(verifyBlockedReason('idle', 'Claude 1')).toBeNull()
    for (const status of ['working', 'waiting', 'paused', 'shell', 'done', 'gone'] as const) {
      expect(verifyBlockedReason(status, 'Claude 1')).toContain('Claude 1')
    }
  })
})

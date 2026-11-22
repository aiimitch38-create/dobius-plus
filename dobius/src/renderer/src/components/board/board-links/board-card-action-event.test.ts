import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCardActionRequest } from '../../../../../shared/board-card-actions'

const WT = 'wt-1'

type Card = Record<string, unknown> & { id: string; kind: string }
const state = {
  boardsByWorktree: {} as Record<string, { cards: Card[]; viewport: { x: number; y: number; zoom: number } }>,
  unifiedTabsByWorktree: {} as Record<string, { id: string; entityId: string; isPinned: boolean }[]>,
  addCard: vi.fn((worktreeId: string, card: Record<string, unknown>) => {
    state.boardsByWorktree[worktreeId].cards.push({ ...card, id: 'note-new', kind: 'note' })
    return 'note-new'
  }),
  updateCard: vi.fn(),
  removeCards: vi.fn((worktreeId: string, ids: readonly string[]) => {
    const board = state.boardsByWorktree[worktreeId]
    board.cards = board.cards.filter((c) => !ids.includes(c.id))
  })
}
const order: string[] = []
const flush = vi.hoisted(() => ({ fail: false }))

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/store/slices/board', () => ({
  getBoard: (s: typeof state, id: string) => s.boardsByWorktree[id] ?? { cards: [], viewport: { x: 0, y: 0, zoom: 1 } },
  flushBoardPersistence: vi.fn(async () => {
    order.push('flush')
    if (flush.fail) {
      throw new Error('disk full')
    }
  })
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({
  closeTerminalTab: vi.fn((tabId: string) => order.push(`close:${tabId}`))
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_k: string, fallback: string) => fallback }))
vi.mock('../board-delivery/board-delivery', () => ({ consoleDeliveryState: vi.fn(() => 'idle') }))
vi.mock('../board-delivery/console-lifecycle', () => ({ restartConsole: vi.fn(() => true) }))
vi.mock('../console-card/board-console-exit', () => ({ clearBoardConsoleEnded: vi.fn() }))
Object.assign(globalThis, { window: { innerWidth: 1440, innerHeight: 900 } })

const { consoleDeliveryState } = await import('../board-delivery/board-delivery')
const { restartConsole } = await import('../board-delivery/console-lifecycle')
const { closeTerminalTab } = await import('@/components/terminal/terminal-tab-actions')
const { handleBoardCardActionEvent, resetBoardCardActionHandlerForTest } = await import(
  './board-card-action-event'
)

const consoleCard: Card = { id: 'c1', kind: 'console', tabId: 'tab-1', title: 'Builder 1', agentKind: 'codex', x: 0, y: 0, w: 640, h: 400, z: 1 }
const orchCard: Card = { id: 'o1', kind: 'orchestrator', title: 'Leads', name: 'Leads', wiredCardIds: [], x: 0, y: 0, w: 300, h: 300, z: 2 }

let seq = 0
function req(over: Partial<BoardCardActionRequest>): BoardCardActionRequest {
  seq += 1
  return { requestId: `req-${seq}`, worktreeId: WT, action: 'close', cardId: 'c1', ...over }
}

describe('handleBoardCardActionEvent', () => {
  beforeEach(() => {
    resetBoardCardActionHandlerForTest()
    order.length = 0
    flush.fail = false
    vi.mocked(consoleDeliveryState).mockReturnValue('idle')
    vi.mocked(restartConsole).mockClear().mockReturnValue(true)
    vi.mocked(closeTerminalTab).mockClear()
    state.removeCards.mockClear()
    state.updateCard.mockClear()
    state.unifiedTabsByWorktree = {}
    state.boardsByWorktree = { [WT]: { cards: [{ ...consoleCard }, { ...orchCard }], viewport: { x: 0, y: 0, zoom: 1 } } }
  })

  it('closes a console by saving the Board first, then closing its terminal', async () => {
    const reply = await handleBoardCardActionEvent(req({}))
    expect(reply.ok).toBe(true)
    expect(state.removeCards).toHaveBeenCalledWith(WT, ['c1'])
    expect(order).toEqual(['flush', 'close:tab-1'])
  })

  it('refuses a pinned tab without force (no dialog, nothing removed) and closes it with force', async () => {
    state.unifiedTabsByWorktree = { [WT]: [{ id: 'u1', entityId: 'tab-1', isPinned: true }] }
    expect(await handleBoardCardActionEvent(req({}))).toMatchObject({ ok: false, code: 'board_card_busy' })
    expect(state.removeCards).not.toHaveBeenCalled()
    expect(await handleBoardCardActionEvent(req({ force: true }))).toMatchObject({ ok: true })
    expect(closeTerminalTab).toHaveBeenCalledWith('tab-1', { force: true })
  })

  it('refuses a second restart of the same card while the first is still starting', async () => {
    expect(await handleBoardCardActionEvent(req({ action: 'restart' }))).toMatchObject({ ok: true })
    expect(await handleBoardCardActionEvent(req({ action: 'restart' }))).toMatchObject({ ok: false, code: 'board_card_busy' })
    expect(restartConsole).toHaveBeenCalledTimes(1)
  })

  it('leaves the terminal open when the save fails', async () => {
    flush.fail = true
    const reply = await handleBoardCardActionEvent(req({}))
    expect(reply).toMatchObject({ ok: false, code: 'board_card_action_failed' })
    expect(closeTerminalTab).not.toHaveBeenCalled()
  })

  it('refuses to close or restart a working console without force', async () => {
    vi.mocked(consoleDeliveryState).mockReturnValue('working')
    expect(await handleBoardCardActionEvent(req({}))).toMatchObject({ ok: false, code: 'board_card_busy' })
    expect(await handleBoardCardActionEvent(req({ action: 'restart' }))).toMatchObject({
      ok: false,
      code: 'board_card_busy'
    })
    expect(state.removeCards).not.toHaveBeenCalled()
    expect(restartConsole).not.toHaveBeenCalled()
    expect(await handleBoardCardActionEvent(req({ action: 'restart', force: true }))).toMatchObject({ ok: true })
  })

  it('restarts through restartConsole (keeps account and restricted launch)', async () => {
    const reply = await handleBoardCardActionEvent(req({ action: 'restart' }))
    expect(reply.ok).toBe(true)
    expect(restartConsole).toHaveBeenCalledWith(WT, expect.objectContaining({ id: 'c1' }))
  })

  it('refuses to restart a non-console card', async () => {
    expect(await handleBoardCardActionEvent(req({ action: 'restart', cardId: 'o1' }))).toMatchObject({
      ok: false,
      code: 'board_card_wrong_kind'
    })
  })

  it('renames an orchestrator by title and name', async () => {
    await handleBoardCardActionEvent(req({ action: 'rename', cardId: 'o1', title: ' Team A ' }))
    expect(state.updateCard).toHaveBeenCalledWith(WT, 'o1', { title: 'Team A', name: 'Team A' })
  })

  it('adds a note next to the anchor card', async () => {
    const reply = await handleBoardCardActionEvent(req({ action: 'note', cardId: 'c1', text: 'hi' }))
    expect(reply).toMatchObject({ ok: true, cardId: 'note-new' })
    expect(state.addCard).toHaveBeenCalledWith(WT, expect.objectContaining({ kind: 'note', text: 'hi', x: 664, y: 0 }))
  })

  it('reports a card that is gone from the live board', async () => {
    expect(await handleBoardCardActionEvent(req({ cardId: 'gone' }))).toMatchObject({
      ok: false,
      code: 'board_card_not_found'
    })
  })

  it('acts once per requestId', async () => {
    const event = req({ action: 'restart' })
    await handleBoardCardActionEvent(event)
    const again = await handleBoardCardActionEvent(event)
    expect(again.ok).toBe(false)
    expect(restartConsole).toHaveBeenCalledTimes(1)
  })
})

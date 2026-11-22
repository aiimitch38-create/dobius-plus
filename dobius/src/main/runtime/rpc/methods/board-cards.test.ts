import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCardActionReply, BoardCardActionRequest } from '../../../../shared/board-card-actions'

const admission = vi.hoisted(() => ({
  value: { allowed: true } as { allowed: true } | { allowed: false; reason: 'paused'; message: string }
}))
vi.mock('../../../agents/execution-gate', () => ({
  checkExecutionAdmission: vi.fn(() => admission.value)
}))

import type { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { BOARD_CARD_METHODS } from './board-cards'

const WT = 'wt-1'

const cards = [
  { id: 'c1', kind: 'console', tabId: 'tab-1', title: 'Builder 1', agentKind: 'codex', role: null },
  { id: 'c2', kind: 'console', tabId: 'tab-2', title: 'Tests', agentKind: 'claude', role: 'tests' },
  { id: 'n1', kind: 'note', title: 'Note', text: 'Remember   to\nship', color: 'yellow' },
  { id: 'o1', kind: 'orchestrator', title: 'Orchestrator', name: 'Leads', wiredCardIds: [] },
  { id: 'd1', kind: 'note', title: 'tests', text: 'dup', color: 'yellow' }
]

function makeRuntime(reply: (event: BoardCardActionRequest) => BoardCardActionReply | null) {
  const requestBoardCardAction = vi.fn(async (event: BoardCardActionRequest) => reply(event))
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showManagedWorktree: vi.fn(async () => ({ id: WT, path: '/repo/wt-1' })),
    listTerminals: vi.fn(async () => ({
      terminals: [{ handle: 'term_a', tabId: 'tab-1', ptyId: 'p1', connected: true }],
      totalCount: 1,
      truncated: false
    })),
    getTerminalTabActiveLeafId: () => null,
    getUIState: () => ({ boardsByWorktree: { [WT]: { cards, groups: [] } } }),
    requestBoardCardAction
  }
  return { runtime: runtime as unknown as DobiusRuntimeService, requestBoardCardAction }
}

const okReply = (event: BoardCardActionRequest): BoardCardActionReply => ({
  requestId: event.requestId,
  ok: true,
  cardId: event.cardId ?? 'new-note',
  message: 'done'
})

async function call(
  method: string,
  params: unknown,
  reply: (event: BoardCardActionRequest) => BoardCardActionReply | null = okReply
) {
  const { runtime, requestBoardCardAction } = makeRuntime(reply)
  const dispatcher = new RpcDispatcher({ runtime, methods: BOARD_CARD_METHODS })
  const request: RpcRequest = { id: 'r1', authToken: 't', method, params }
  const response = (await dispatcher.dispatch(request)) as RpcResponse
  return { response, requestBoardCardAction }
}

const errorCode = (response: RpcResponse) => (response.ok ? null : response.error.code)

describe('board.listCards', () => {
  it('lists every card kind, joins consoles with their live terminal and previews notes', async () => {
    const { response } = await call('board.listCards', { worktree: `id:${WT}` })
    expect(response.ok).toBe(true)
    const result = (response as { result: { cards: Record<string, unknown>[]; truncated: boolean } }).result
    expect(result.truncated).toBe(false)
    expect(result.cards.map((c) => [c.id, c.kind, c.status, c.handle])).toEqual([
      ['c1', 'console', 'running', 'term_a'],
      ['c2', 'console', 'not running', null],
      ['n1', 'note', null, null],
      ['o1', 'orchestrator', null, null],
      ['d1', 'note', null, null]
    ])
    expect(result.cards[2].preview).toBe('Remember to ship')
    expect(result.cards[3].title).toBe('Leads')
  })
})

describe('board.cardAction', () => {
  beforeEach(() => {
    admission.value = { allowed: true }
  })

  it('resolves a title (ignoring case) to the card id and asks the Board window', async () => {
    const { response, requestBoardCardAction } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'rename',
      card: 'builder 1',
      title: 'Builder A'
    })
    expect(response.ok).toBe(true)
    expect(requestBoardCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: WT, action: 'rename', cardId: 'c1', title: 'Builder A' })
    )
  })

  it('refuses an ambiguous title and never asks the window', async () => {
    const { response, requestBoardCardAction } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'close',
      card: 'TESTS'
    })
    expect(errorCode(response)).toBe('board_card_ambiguous')
    expect(requestBoardCardAction).not.toHaveBeenCalled()
  })

  it('still reaches an ambiguous title by its card id', async () => {
    const { response, requestBoardCardAction } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'close',
      card: 'd1'
    })
    expect(response.ok).toBe(true)
    expect(requestBoardCardAction).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'd1' }))
  })

  it('refuses an unknown card', async () => {
    const { response } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'close',
      card: 'nobody'
    })
    expect(errorCode(response)).toBe('board_card_not_found')
  })

  it('refuses a restart while Pause crew is on', async () => {
    admission.value = { allowed: false, reason: 'paused', message: 'Crew is paused.' }
    const { response, requestBoardCardAction } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'restart',
      card: 'c1'
    })
    expect(errorCode(response)).toBe('crew_paused')
    expect(requestBoardCardAction).not.toHaveBeenCalled()
  })

  it('lets a rename through while the crew is paused (it starts nothing)', async () => {
    admission.value = { allowed: false, reason: 'paused', message: 'Crew is paused.' }
    const { response } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'rename',
      card: 'c1',
      title: 'x'
    })
    expect(response.ok).toBe(true)
  })

  it('refuses to restart a card that is not a console', async () => {
    const { response, requestBoardCardAction } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'restart',
      card: 'n1'
    })
    expect(errorCode(response)).toBe('board_card_wrong_kind')
    expect(requestBoardCardAction).not.toHaveBeenCalled()
  })

  it('adds a note without a card', async () => {
    const { response, requestBoardCardAction } = await call('board.cardAction', {
      worktree: `id:${WT}`,
      action: 'note',
      text: 'hello'
    })
    expect(response.ok).toBe(true)
    expect(requestBoardCardAction.mock.calls[0][0].cardId).toBeUndefined()
  })

  it('passes the window refusal code through and maps unknown codes', async () => {
    const busy = await call(
      'board.cardAction',
      { worktree: `id:${WT}`, action: 'close', card: 'c1' },
      (event) => ({ requestId: event.requestId, ok: false, code: 'board_card_busy', message: 'working' })
    )
    expect(errorCode(busy.response)).toBe('board_card_busy')
    const odd = await call(
      'board.cardAction',
      { worktree: `id:${WT}`, action: 'close', card: 'c1' },
      (event) => ({ requestId: event.requestId, ok: false, code: 'rm -rf', message: 'x' })
    )
    expect(errorCode(odd.response)).toBe('board_card_action_failed')
  })

  it('says the window is not open when nobody can answer', async () => {
    const { response } = await call(
      'board.cardAction',
      { worktree: `id:${WT}`, action: 'close', card: 'c1' },
      () => null
    )
    expect(errorCode(response)).toBe('board_window_unavailable')
  })

  it('requires a title for rename and text for note', async () => {
    const rename = await call('board.cardAction', { worktree: `id:${WT}`, action: 'rename', card: 'c1' })
    expect(rename.response.ok).toBe(false)
    const note = await call('board.cardAction', { worktree: `id:${WT}`, action: 'note', text: '   ' })
    expect(note.response.ok).toBe(false)
  })
})

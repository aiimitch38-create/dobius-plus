// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardConductor } from './use-board-conductor'
import type { BoardRouteData } from './use-board-route-data'
import { useBoardCommand } from './use-board-command'

const mocks = vi.hoisted(() => ({
  deliverOrder: vi.fn(async () => ({ ok: true, text: 'Sent to Codex 1.' }))
}))
vi.mock('@/components/confirmation-dialog', () => ({
  useConfirmationDialog: () => vi.fn(async () => true)
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('../board-delivery/board-delivery', () => ({ deliverOrder: mocks.deliverOrder }))
vi.mock('./board-console-activity', () => ({ boardConsoleState: () => 'idle' }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const data = {
  worktreeId: 'wt-1',
  board: { groups: [] },
  consoles: [{ id: 'card-1', tabId: 'tab-1', title: 'Codex 1', agentKind: 'codex' }],
  workspaces: []
} as unknown as BoardRouteData

let root: Root
let container: HTMLDivElement
let rows: { role: string; text: string }[]
let onCommand: (text: string) => void
const planner = vi.fn(async (_text: string) => {})
const askAdamText = vi.fn()

function Harness(): null {
  const conductor = {
    messages: [],
    busy: false,
    append: (message) => rows.push(message),
    appendReport: vi.fn(),
    ask: vi.fn(),
    clearThread: vi.fn(),
    showThinking: () => () => {}
  } satisfies BoardConductor
  onCommand = useBoardCommand(data, conductor, planner)
  return null
}

beforeEach(() => {
  rows = []
  planner.mockClear()
  askAdamText.mockClear()
  mocks.deliverOrder.mockClear()
  ;(window as unknown as { api: unknown }).api = { jarvis: { askAdamText } }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useBoardCommand', () => {
  it('sends "@Codex 1 run the tests" straight to that console, not to the planner or ADAM', async () => {
    await act(async () => {
      onCommand('@Codex 1 run the tests')
      await vi.waitFor(() => expect(rows).toHaveLength(2))
    })
    expect(mocks.deliverOrder).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      summary: 'run the tests',
      lanes: [{ tabId: 'tab-1', name: 'Codex 1', text: 'run the tests' }]
    })
    expect(rows).toEqual([
      { role: 'user', text: '@Codex 1 run the tests' },
      { role: 'system', text: 'Sent to Codex 1.' }
    ])
    expect(planner).not.toHaveBeenCalled()
    expect(askAdamText).not.toHaveBeenCalled()
  })

  it('hands everything else to the planner path, which talks to ADAM', () => {
    act(() => onCommand('i cant heear him speak'))
    expect(planner).toHaveBeenCalledWith('i cant heear him speak')
    expect(mocks.deliverOrder).not.toHaveBeenCalled()
  })
})

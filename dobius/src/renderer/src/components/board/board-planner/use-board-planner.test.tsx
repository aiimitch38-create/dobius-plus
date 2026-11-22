// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JarvisAskResult } from '../../../../../shared/speech-types'
import type { BoardThreadMessage } from '../board-command-bar/BoardThread'
import type { BoardConductor } from '../board-route/use-board-conductor'
import type { BoardRouteData } from '../board-route/use-board-route-data'
import { BOARD } from './plan-fixtures.test-support'
import { useBoardPlanner } from './use-board-planner'

const mocks = vi.hoisted(() => ({
  executePlan: vi.fn(async () => [{ ok: true, text: 'Paused 3 consoles.' }])
}))
vi.mock('@/components/confirmation-dialog', () => ({
  useConfirmationDialog: () => vi.fn(async () => true)
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      repos: [
        { id: 'repo-1', displayName: 'dobius-plus' },
        { id: 'repo-2', displayName: 'pocket-cologne' }
      ],
      boardsByWorktree: {
        'wt-1': { cards: [{ kind: 'console', title: 'Claude 1', tabId: 't1', agentKind: 'claude' }] },
        'wt-9': { cards: [{ kind: 'console', title: 'Codex 7', tabId: 't9', agentKind: 'codex' }] }
      },
      getKnownWorktreeById: (id: string) =>
        id === 'wt-1'
          ? { repoId: 'repo-1', displayName: 'main', branch: 'main', path: '/Users/c/code/dobius-plus' }
          : { repoId: 'repo-2', displayName: 'checkout-fix', branch: 'x', path: '/Users/c/code/pc' }
    })
  }
}))
vi.mock('../board-delivery/board-delivery', () => ({ consoleDeliveryState: () => 'idle' }))
vi.mock('../board-delivery/mission-tracker', () => ({ onMissionEvent: () => () => {} }))
vi.mock('./mission-report', () => ({ missionReport: vi.fn() }))
vi.mock('./plan-effects-board', () => ({ boardEffects: () => ({}) }))
vi.mock('./plan-effects-terminal', () => ({ terminalEffects: () => ({}) }))
vi.mock('./plan-execute', () => ({ executePlan: mocks.executePlan }))
vi.mock('./plan-snapshot', () => ({ buildPlanSnapshot: () => BOARD }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Row = Omit<BoardThreadMessage, 'id'>
const OLD_ERROR = /planner is not answering/i

let root: Root
let container: HTMLDivElement
let rows: Row[]
let rowsByRepo: Record<string, Row[]>
let thinking: string[]
let thinkingRepos: (string | null)[]
let repoId: string
let run: (text: string) => Promise<void>
let busy: boolean
const conductorCommand = vi.fn()
const conductorReply = vi.fn()
const askAdamText = vi.fn<(utterance: string) => Promise<JarvisAskResult>>()

function Harness({ earlier }: { earlier: BoardThreadMessage[] }): null {
  const conductor = {
    messages: earlier,
    busy: false,
    append: (message: Row) => rows.push(message),
    appendReport: vi.fn(),
    ask: vi.fn(),
    clearThread: vi.fn(),
    appendTo: (target: string | null, message: Row) => {
      rows.push(message)
      ;(rowsByRepo[String(target)] ??= []).push(message)
    },
    showThinkingIn: (target: string | null, text: string) => {
      thinking.push(text)
      thinkingRepos.push(target)
      return () => thinking.splice(thinking.indexOf(text), 1)
    }
  } satisfies BoardConductor
  const planner = useBoardPlanner({
    data: { worktreeId: 'wt-1', repoId, board: {}, workspaces: [] } as unknown as BoardRouteData,
    conductor,
    context: {} as Parameters<typeof useBoardPlanner>[0]['context'],
    projectName: 'dobius-plus'
  })
  run = planner.run
  busy = planner.busy
  return null
}

function mount(earlier: BoardThreadMessage[] = []): void {
  act(() => root.render(<Harness earlier={earlier} />))
}

beforeEach(() => {
  rows = []
  rowsByRepo = {}
  thinking = []
  thinkingRepos = []
  repoId = 'repo-1'
  conductorCommand.mockReset()
  conductorReply.mockReset()
  askAdamText.mockReset()
  mocks.executePlan.mockClear()
  // Carson's case: the planner (the Voice Conductor) refuses every request.
  conductorCommand.mockResolvedValue({ ok: false, error: 'Voice Conductor is disabled' })
  ;(window as unknown as { api: unknown }).api = {
    agents: { conductorCommand, conductorReply },
    jarvis: { askAdamText }
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useBoardPlanner: talk goes to Hermes ADAM', () => {
  it('sends a plain message to ADAM with the workspace, and shows his reply', async () => {
    askAdamText.mockResolvedValue({ kind: 'answer', text: 'I can hear you. What is wrong?' })
    mount([{ id: 'a', role: 'user', text: 'i cant heear him speak' }])
    await act(() => run('your TypeScript app'))
    expect(askAdamText).toHaveBeenCalledTimes(1)
    const sent = askAdamText.mock.calls[0][0]
    const block = (tag: string) => JSON.parse(sent.split(`<${tag}>\n`)[1].split(`\n</${tag}>`)[0])
    const context = block('untrusted_context')
    expect(context.carson_is_looking_at).toEqual({
      project: 'dobius-plus',
      workspace: 'main',
      folder: '/Users/c/code/dobius-plus'
    })
    // Every open project's board, not only the one on screen.
    expect(context.open_boards.map((b: { project: string }) => b.project)).toEqual([
      'dobius-plus',
      'pocket-cologne'
    ])
    expect(context.open_boards[1].consoles).toEqual([
      { name: 'Codex 7', agent: 'codex', state: 'idle' }
    ])
    expect(context.earlier_thread_rows).toEqual([{ from: 'carson', text: 'i cant heear him speak' }])
    expect(block('carson_message')).toBe('your TypeScript app')
    expect(rows).toEqual([
      { role: 'user', text: 'your TypeScript app' },
      { role: 'assistant', text: 'I can hear you. What is wrong?' }
    ])
    expect(thinking).toEqual([])
  })

  it('shows "ADAM is thinking…" until he answers', async () => {
    let answer: (result: JarvisAskResult) => void = () => {}
    askAdamText.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    mount()
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = run('hello')
      await vi.waitFor(() => expect(thinking).toEqual(['ADAM is thinking…']))
    })
    await act(async () => {
      answer({ kind: 'answer', text: 'Hi.' })
      await pending
    })
    expect(thinking).toEqual([])
  })

  it('says what to do when Hermes fails, never "the planner is not answering"', async () => {
    askAdamText.mockResolvedValue({
      kind: 'error',
      text: 'Could not connect to Adam’s Hermes profile. Check that Hermes and the adam profile are installed and signed in.'
    })
    mount()
    await act(() => run('hello'))
    const last = rows.at(-1)!
    expect(last).toMatchObject({ role: 'system', tone: 'error' })
    expect(last.text).toContain('ADAM could not answer.')
    expect(last.text).toContain('Check that Hermes and the adam profile are installed')
    expect(rows.some((row) => OLD_ERROR.test(row.text))).toBe(false)
  })

  it('hands a planner reply with no steps to ADAM instead of answering for him', async () => {
    conductorCommand.mockResolvedValue({ ok: true })
    conductorReply.mockResolvedValue({ message: '{"steps":[],"say":"Planner talking."}', ts: 1 })
    askAdamText.mockResolvedValue({ kind: 'answer', text: 'ADAM talking.' })
    mount()
    await act(() => run('how are you'))
    expect(rows.map((row) => row.text)).toEqual(['how are you', 'ADAM talking.'])
  })
})

describe('useBoardPlanner: one message at a time, in the thread it came from', () => {
  it('puts the reply and the thinking row in the thread the message was sent from', async () => {
    let answer: (result: JarvisAskResult) => void = () => {}
    askAdamText.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    mount()
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = run('hello from dobius')
      await vi.waitFor(() => expect(thinking).toHaveLength(1))
    })
    // Carson switches to another project before ADAM answers.
    repoId = 'repo-2'
    mount()
    await act(async () => {
      answer({ kind: 'answer', text: 'Hi.' })
      await pending
    })
    expect(thinkingRepos).toEqual(['repo-1'])
    expect(rowsByRepo['repo-1'].map((row) => row.text)).toEqual(['hello from dobius', 'Hi.'])
    expect(rowsByRepo['repo-2']).toBeUndefined()
  })

  it('is busy from submit until ADAM is done, and refuses a second message in the same tick', async () => {
    let answer: (result: JarvisAskResult) => void = () => {}
    askAdamText.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    mount()
    expect(busy).toBe(false)
    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    await act(async () => {
      first = run('one')
      second = run('two')
      await second
    })
    expect(busy).toBe(true)
    expect(rows.map((row) => row.text)).toEqual([
      'one',
      'ADAM is still working on your last message. Wait for his reply, then send this again.'
    ])
    await act(async () => {
      await vi.waitFor(() => expect(askAdamText).toHaveBeenCalledTimes(1))
      answer({ kind: 'answer', text: 'Done.' })
      await first
    })
    expect(busy).toBe(false)
    expect(conductorCommand).toHaveBeenCalledTimes(1)
    expect(askAdamText).toHaveBeenCalledTimes(1)
    expect(rows.at(-1)).toEqual({ role: 'assistant', text: 'Done.' })
  })
})

describe('useBoardPlanner: board orders stay with the app', () => {
  it('runs a built-in command with the planner down, without asking ADAM', async () => {
    mount()
    await act(() => run('pause all'))
    expect(askAdamText).not.toHaveBeenCalled()
    expect(mocks.executePlan).toHaveBeenCalledTimes(1)
    expect(rows.at(-1)).toEqual({ role: 'system', text: 'Paused 3 consoles.' })
  })

  it('runs a planner plan that has steps, without asking ADAM', async () => {
    conductorCommand.mockResolvedValue({ ok: true })
    conductorReply.mockResolvedValue({
      message: '{"steps":[{"kind":"zoom_in"}],"say":"Zoomed in."}',
      ts: 1
    })
    mount()
    await act(() => run('zoom in a bit'))
    expect(askAdamText).not.toHaveBeenCalled()
    expect(mocks.executePlan).toHaveBeenCalledTimes(1)
    expect(rows.map((row) => row.text)).toEqual([
      'zoom in a bit',
      'Zoomed in.',
      'Paused 3 consoles.'
    ])
  })
})

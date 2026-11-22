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
    getState: () => ({ getKnownWorktreeById: () => ({ path: '/Users/c/code/dobius-plus' }) })
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
let thinking: string[]
let run: (text: string) => Promise<void>
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
    showThinking: (text: string) => {
      thinking.push(text)
      return () => thinking.splice(thinking.indexOf(text), 1)
    }
  } satisfies BoardConductor
  run = useBoardPlanner({
    data: { worktreeId: 'wt-1', board: {}, workspaces: [] } as unknown as BoardRouteData,
    conductor,
    context: {} as Parameters<typeof useBoardPlanner>[0]['context'],
    projectName: 'dobius-plus'
  })
  return null
}

function mount(earlier: BoardThreadMessage[] = []): void {
  act(() => root.render(<Harness earlier={earlier} />))
}

beforeEach(() => {
  rows = []
  thinking = []
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
    expect(sent).toContain('Project: dobius-plus')
    expect(sent).toContain('Workspace: main (folder: /Users/c/code/dobius-plus)')
    expect(sent).toContain('Carson: i cant heear him speak')
    expect(sent.endsWith('Carson: your TypeScript app')).toBe(true)
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

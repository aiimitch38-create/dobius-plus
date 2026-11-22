import { describe, expect, it, vi } from 'vitest'
import { LOOP_PLACEHOLDER_RRULE } from '../../../../shared/automation-loops'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { AUTOMATION_METHODS } from './automations'

const WT = 'wt-1'
const cards = [
  { id: 'c1', kind: 'console', tabId: 'tab-1', title: 'Builder 1' },
  { id: 'o1', kind: 'orchestrator', title: 'Orchestrator', name: 'Leads' },
  { id: 'n1', kind: 'note', title: 'Builder 2', text: 'x' },
  { id: 'n2', kind: 'note', title: 'builder 2', text: 'y' }
]

function goalLoop(over: Record<string, unknown> = {}) {
  return {
    worktreeId: WT,
    trigger: { kind: 'goal', target: { type: 'board' }, goal: 'Old goal', checkEveryMs: 120_000, maxRuns: 3, judge: 'self' },
    state: { paused: false, runCount: 1, lastFiredAt: 5, outputCursor: null, retiredAt: null, lastResult: null, lastVerdict: null },
    stopCommand: 'pnpm test',
    ...over
  }
}

function setup(existing: Record<string, unknown> = { id: 'auto-1', loop: goalLoop() }) {
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showManagedWorktree: vi.fn(async () => ({ id: WT, path: '/repo/wt-1' })),
    getUIState: () => ({ boardsByWorktree: { [WT]: { cards } } }),
    showAutomation: vi.fn(() => existing),
    createAutomation: vi.fn(async () => ({ id: 'auto-new' })),
    updateAutomation: vi.fn(async (id: string) => ({ id })),
    deleteAutomation: vi.fn(() => ({ removed: true, id: 'auto-new' }))
  }
  const dispatcher = new RpcDispatcher({
    runtime: runtime as unknown as DobiusRuntimeService,
    methods: AUTOMATION_METHODS
  })
  const call = async (method: string, params: unknown) =>
    (await dispatcher.dispatch({ id: 'r', authToken: 't', method, params } as RpcRequest)) as RpcResponse
  return { runtime, call }
}

const base = {
  name: 'Loop',
  prompt: 'Reach the goal',
  agentId: 'claude',
  workspace: `id:${WT}`,
  workspaceMode: 'existing',
  rrule: LOOP_PLACEHOLDER_RRULE,
  dtstart: 1
}
const code = (r: RpcResponse) => (r.ok ? null : r.error.code)

describe('automation.create with a loop', () => {
  it('saves disabled first, then adds the goal loop for the named console and enables it', async () => {
    const { runtime, call } = setup()
    const r = await call('automation.create', {
      ...base,
      loop: { goal: 'All tests pass', maxIterations: 5, stopWhen: 'pnpm test', card: 'builder 1' }
    })
    expect(r.ok).toBe(true)
    expect(runtime.createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, rrule: LOOP_PLACEHOLDER_RRULE, workspace: `id:${WT}` })
    )
    const [, updates] = runtime.updateAutomation.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(updates.enabled).toBe(true)
    expect(updates.loop).toMatchObject({
      worktreeId: WT,
      trigger: {
        kind: 'goal',
        target: { type: 'tab', tabId: 'tab-1' },
        goal: 'All tests pass',
        maxRuns: 5,
        judge: 'self'
      },
      stopCommand: 'pnpm test',
      state: { runCount: 0, retiredAt: null }
    })
  })

  it('targets the consoles behind an orchestrator card, or the whole Board without --card', async () => {
    const orch = setup()
    await orch.call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 1, card: 'Leads' } })
    expect((orch.runtime.updateAutomation.mock.calls[0] as unknown as [string, { loop: { trigger: { target: unknown } } }])[1].loop.trigger.target).toEqual({
      type: 'orchestrator',
      cardId: 'o1'
    })
    const board = setup()
    await board.call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 1 } })
    expect((board.runtime.updateAutomation.mock.calls[0] as unknown as [string, { loop: { trigger: { target: unknown } } }])[1].loop.trigger.target).toEqual({
      type: 'board'
    })
  })

  it('refuses more than 50 iterations with loop_iteration_cap and saves nothing', async () => {
    const { runtime, call } = setup()
    const r = await call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 51 } })
    expect(code(r)).toBe('loop_iteration_cap')
    expect(runtime.createAutomation).not.toHaveBeenCalled()
  })

  it('refuses an unsafe stop command, a note card and an ambiguous card title', async () => {
    const { runtime, call } = setup()
    expect(code(await call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 2, stopWhen: 'rm -rf build' } }))).toBe('loop_invalid')
    expect(code(await call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 2, card: 'n1' } }))).toBe('loop_invalid')
    expect(code(await call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 2, card: 'BUILDER 2' } }))).toBe('board_card_ambiguous')
    expect(runtime.createAutomation).not.toHaveBeenCalled()
  })

  it('refuses a loop without a workspace', async () => {
    const { call } = setup()
    const { workspace: _w, ...noWorkspace } = base
    expect(code(await call('automation.create', { ...noWorkspace, repo: 'repo-1', loop: { goal: 'g', maxIterations: 2 } }))).toBe('loop_invalid')
  })

  it('removes the half-made automation when adding the loop fails', async () => {
    const { runtime, call } = setup()
    runtime.updateAutomation.mockRejectedValueOnce(new Error('disk full'))
    const r = await call('automation.create', { ...base, loop: { goal: 'g', maxIterations: 2 } })
    expect(r.ok).toBe(false)
    expect(runtime.deleteAutomation).toHaveBeenCalledWith('auto-new')
  })
})

describe('automation.update with loop fields', () => {
  it('changes the goal and cap, keeps the run state, and clears the stop command on null', async () => {
    const { runtime, call } = setup()
    const r = await call('automation.update', {
      id: 'auto-1',
      updates: { loop: { goal: 'New goal', maxIterations: 9, stopWhen: null } }
    })
    expect(r.ok).toBe(true)
    const [, updates] = runtime.updateAutomation.mock.calls[0] as unknown as [string, { loop: Record<string, unknown> }]
    expect(updates.loop.trigger).toMatchObject({ goal: 'New goal', maxRuns: 9 })
    expect(updates.loop.state).toMatchObject({ runCount: 1 })
    expect(updates.loop).not.toHaveProperty('stopCommand')
  })

  it('refuses the cap and refuses editing a non-loop automation', async () => {
    const capped = setup()
    expect(code(await capped.call('automation.update', { id: 'auto-1', updates: { loop: { maxIterations: 500 } } }))).toBe('loop_iteration_cap')
    const plain = setup({ id: 'auto-1', loop: null })
    expect(code(await plain.call('automation.update', { id: 'auto-1', updates: { loop: { goal: 'x' } } }))).toBe('loop_not_found')
    expect(plain.runtime.updateAutomation).not.toHaveBeenCalled()
  })
})

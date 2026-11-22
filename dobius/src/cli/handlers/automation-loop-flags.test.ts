import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCurrentWorktreeSelectorMock = vi.hoisted(() => vi.fn())
const printResultMock = vi.hoisted(() => vi.fn())

vi.mock('../format', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  printResult: printResultMock
}))
vi.mock('../selectors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCurrentWorktreeSelector: resolveCurrentWorktreeSelectorMock
}))

import { AUTOMATION_HANDLERS } from './automations'

const callMock = vi.fn()
const run = (command: string, flags: Record<string, string | boolean>) =>
  AUTOMATION_HANDLERS[command]({
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: false } as never,
    cwd: '/repo/wt-1',
    json: true
  })

describe('automations create --loop', () => {
  beforeEach(() => {
    printResultMock.mockReset()
    resolveCurrentWorktreeSelectorMock.mockReset().mockResolvedValue('id:wt-1')
    callMock.mockReset().mockResolvedValue({ result: { automation: { id: 'a1' } } })
  })

  it('sends a loop on the current workspace without needing --trigger or --provider', async () => {
    await run('automations create', {
      loop: true,
      goal: 'All tests pass',
      'max-iterations': '5',
      'stop-when': 'pnpm test',
      card: 'card:Builder 1'
    })
    const [method, params] = callMock.mock.calls[0]
    expect(method).toBe('automation.create')
    expect(params).toMatchObject({
      prompt: 'All tests pass',
      agentId: 'claude',
      workspace: 'id:wt-1',
      workspaceMode: 'existing',
      loop: { goal: 'All tests pass', maxIterations: 5, stopWhen: 'pnpm test', card: 'Builder 1' }
    })
  })

  it('refuses more than 50 iterations before calling the app', async () => {
    await expect(
      run('automations create', { loop: true, goal: 'g', 'max-iterations': '51' })
    ).rejects.toMatchObject({ code: 'loop_iteration_cap' })
    expect(callMock).not.toHaveBeenCalled()
  })

  it('requires --goal and --max-iterations, and refuses schedule flags on a loop', async () => {
    await expect(run('automations create', { loop: true, 'max-iterations': '3' })).rejects.toThrow(/--goal/)
    await expect(run('automations create', { loop: true, goal: 'g' })).rejects.toThrow(/--max-iterations/)
    await expect(
      run('automations create', { loop: true, goal: 'g', 'max-iterations': '3', trigger: 'daily' })
    ).rejects.toThrow(/--trigger does not apply/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('refuses an empty --card instead of looping over the whole Board', async () => {
    await expect(
      run('automations create', { loop: true, goal: 'g', 'max-iterations': '3', card: 'card:' })
    ).rejects.toThrow(/--card needs/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('refuses loop flags without --loop', async () => {
    await expect(
      run('automations create', { name: 'x', trigger: 'daily', prompt: 'p', provider: 'codex', goal: 'g' })
    ).rejects.toThrow(/--goal needs --loop/)
  })
})

describe('automations edit on a loop', () => {
  beforeEach(() => {
    callMock.mockReset().mockResolvedValue({ result: { automation: { id: 'a1' } } })
  })

  it('sends only the loop fields given; "" removes the stop command', async () => {
    await run('automations edit', { id: 'a1', 'max-iterations': '7', 'stop-when': '' })
    expect(callMock.mock.calls[0][1].updates.loop).toEqual({ maxIterations: 7, stopWhen: null })
  })

  it('refuses the cap on edit too', async () => {
    await expect(run('automations edit', { id: 'a1', 'max-iterations': '99' })).rejects.toMatchObject({
      code: 'loop_iteration_cap'
    })
  })
})

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MAX_WORKERS_PER_LEAD, MAX_WORKERS_TOTAL } from '../../../../shared/lead-caps'
import type { RuntimeBoardSpawnConsoleEvent } from '../../../../shared/runtime-client-events'
import { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import {
  BOARD_CONSOLE_METHODS,
  MAX_BOARD_CONSOLE_PROMPT_BYTES,
  spawnBoardConsole
} from './board-consoles'

const WT = 'wt-1'

function consoleCard(i: number, role: string | null) {
  return { id: `c${i}`, kind: 'console', tabId: `tab-${i}`, title: `Console ${i}`, role, x: 0, y: 0 }
}

function makeRuntime(cards: unknown[], delivered = true) {
  const emitClientEvent = vi.fn((_event: RuntimeBoardSpawnConsoleEvent) => ({ delivered }))
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showManagedWorktree: vi.fn(async (selector: string) => {
      if (selector === 'id:missing') {
        throw new Error('selector_not_found')
      }
      return { id: WT }
    }),
    getUIState: () => ({ boardsByWorktree: { [WT]: { cards, groups: [] } } }),
    // Why: spawnBoardConsole must go through the runtime's notify path (window
    // IPC + client event), never emitClientEvent alone.
    notifyBoardSpawnConsole: emitClientEvent
  }
  return { runtime: runtime as unknown as DobiusRuntimeService, emitClientEvent }
}

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

const baseSpawn = {
  worktree: `id:${WT}`,
  agent: 'codex',
  title: 'W1 · task-1',
  prompt: 'Do the thing',
  role: 'worker',
  leadId: 'lead-acme',
  taskId: 'task-1'
}

async function spawn(cards: unknown[], params: Record<string, unknown> = {}) {
  const { runtime, emitClientEvent } = makeRuntime(cards)
  const dispatcher = new RpcDispatcher({ runtime, methods: BOARD_CONSOLE_METHODS })
  const response = await dispatcher.dispatch(
    makeRequest('board.spawnConsole', { ...baseSpawn, ...params })
  )
  return { response, emitClientEvent }
}

describe('board.spawnConsole', () => {
  it('hands one boardSpawnConsole event to the runtime notify path and returns its requestId', async () => {
    const { response, emitClientEvent } = await spawn([consoleCard(1, 'worker:lead-acme')])
    expect(response.ok).toBe(true)
    const result = (
      response as {
        result: { requestId: string; worktreeId: string; role: string; delivered: boolean }
      }
    ).result
    expect(result.worktreeId).toBe(WT)
    expect(result.role).toBe('worker:lead-acme')
    expect(result.delivered).toBe(true)
    expect(emitClientEvent).toHaveBeenCalledTimes(1)
    expect(emitClientEvent).toHaveBeenCalledWith({
      type: 'boardSpawnConsole',
      requestId: result.requestId,
      worktreeId: WT,
      agent: 'codex',
      title: 'W1 · task-1',
      prompt: 'Do the thing',
      role: 'worker:lead-acme',
      leadId: 'lead-acme',
      taskId: 'task-1'
    })
  })

  it('refuses the 5th worker for one lead', async () => {
    const cards = Array.from({ length: MAX_WORKERS_PER_LEAD }, (_, i) =>
      consoleCard(i, 'worker:lead-acme')
    )
    const { response, emitClientEvent } = await spawn(cards)
    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('worker_cap_reached')
    expect(emitClientEvent).not.toHaveBeenCalled()
  })

  it('refuses the 7th worker overall even when this lead is under its own cap', async () => {
    const cards = [
      ...Array.from({ length: 3 }, (_, i) => consoleCard(i, 'worker:lead-acme')),
      ...Array.from({ length: MAX_WORKERS_TOTAL - 3 }, (_, i) => consoleCard(10 + i, 'worker:lead-b'))
    ]
    const { response, emitClientEvent } = await spawn(cards)
    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('worker_cap_reached')
    expect(emitClientEvent).not.toHaveBeenCalled()
  })

  it('does not count lead consoles or other roles toward the worker caps', async () => {
    const cards = [
      ...Array.from({ length: 3 }, (_, i) => consoleCard(i, 'worker:lead-acme')),
      consoleCard(20, 'lead:lead-acme'),
      consoleCard(21, 'lead:lead-b'),
      consoleCard(22, 'review'),
      consoleCard(23, null)
    ]
    const { response } = await spawn(cards)
    expect(response.ok).toBe(true)
  })

  it('always allows a lead console, even at the worker cap', async () => {
    const cards = Array.from({ length: MAX_WORKERS_TOTAL }, (_, i) =>
      consoleCard(i, `worker:lead-${i % 2}`)
    )
    const { response, emitClientEvent } = await spawn(cards, {
      role: 'lead',
      agent: 'hermes',
      prompt: undefined,
      commandOverride: 'hermes -p lead-acme chat --tui'
    })
    expect(response.ok).toBe(true)
    expect(emitClientEvent.mock.calls[0][0]).toMatchObject({
      role: 'lead:lead-acme',
      commandOverride: 'hermes -p lead-acme chat --tui'
    })
    expect(emitClientEvent.mock.calls[0][0]).not.toHaveProperty('prompt')
  })

  it('refuses an unknown agent, a bad role, and a bad lead id', async () => {
    for (const bad of [
      { agent: 'bash' },
      { role: 'manager' },
      { leadId: 'Lead Acme; rm -rf' },
      { title: '   ' }
    ]) {
      const { response, emitClientEvent } = await spawn([], bad)
      expect(response.ok, JSON.stringify(bad)).toBe(false)
      expect(emitClientEvent).not.toHaveBeenCalled()
    }
  })

  it('accepts a full worker:<lead> role string from in-process callers', async () => {
    const { response, emitClientEvent } = await spawn([], { role: 'worker:lead-acme' })
    expect(response.ok).toBe(true)
    expect(emitClientEvent.mock.calls[0][0]).toMatchObject({ role: 'worker:lead-acme' })
  })

  it('reads promptFile in main and caps its size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-consoles-'))
    const ok = join(dir, 'brief.md')
    writeFileSync(ok, '# Brief\nDo it.\n')
    const big = join(dir, 'big.md')
    writeFileSync(big, 'x'.repeat(MAX_BOARD_CONSOLE_PROMPT_BYTES + 1))

    const good = await spawn([], { prompt: undefined, promptFile: ok })
    expect(good.response.ok).toBe(true)
    expect(good.emitClientEvent.mock.calls[0][0]).toMatchObject({ prompt: '# Brief\nDo it.\n' })

    const tooBig = await spawn([], { prompt: undefined, promptFile: big })
    expect(tooBig.response.ok).toBe(false)
    expect(JSON.stringify(tooBig.response)).toContain('exceeds')

    const notFile = await spawn([], { prompt: undefined, promptFile: dir })
    expect(notFile.response.ok).toBe(false)

    const relative = await spawn([], { prompt: undefined, promptFile: 'brief.md' })
    expect(relative.response.ok).toBe(false)

    const both = await spawn([], { promptFile: ok })
    expect(both.response.ok).toBe(false)
  })

  it('reports delivered:false when the runtime has no receiver, and forwards replaceStaleCardIds', async () => {
    const { runtime, emitClientEvent } = makeRuntime([], false)
    const result = await spawnBoardConsole(runtime, {
      ...baseSpawn,
      agent: 'hermes',
      role: 'lead',
      prompt: undefined,
      replaceStaleCardIds: ['dead-1']
    })
    expect(result.delivered).toBe(false)
    expect(emitClientEvent.mock.calls[0][0]).toMatchObject({
      role: 'lead:lead-acme',
      replaceStaleCardIds: ['dead-1']
    })
  })

  it('fails when the worktree selector does not resolve', async () => {
    const { response, emitClientEvent } = await spawn([], { worktree: 'id:missing' })
    expect(response.ok).toBe(false)
    expect(emitClientEvent).not.toHaveBeenCalled()
  })
})

describe('DobiusRuntimeService.notifyBoardSpawnConsole', () => {
  const event: RuntimeBoardSpawnConsoleEvent = {
    type: 'boardSpawnConsole',
    requestId: 'req-x',
    worktreeId: WT,
    agent: 'hermes',
    title: 'Lead · lead-acme',
    role: 'lead:lead-acme',
    leadId: 'lead-acme'
  }

  it('is not delivered while no window is attached and no client listens', () => {
    const runtime = new DobiusRuntimeService()
    expect(runtime.notifyBoardSpawnConsole(event)).toEqual({ delivered: false })
  })

  it('sends through the window notifier and the client-event stream once a window is attached', () => {
    const runtime = new DobiusRuntimeService()
    const boardSpawnConsole = vi.fn()
    runtime.setNotifier({ boardSpawnConsole } as never)
    const seen: RuntimeBoardSpawnConsoleEvent[] = []
    const unsubscribe = runtime.onClientEvent((e) => {
      if (e.type === 'boardSpawnConsole') {
        seen.push(e)
      }
    })
    expect(runtime.notifyBoardSpawnConsole(event)).toEqual({ delivered: true })
    expect(boardSpawnConsole).toHaveBeenCalledWith(event)
    expect(seen).toEqual([event])
    unsubscribe()
    runtime.setNotifier(null)
    expect(runtime.notifyBoardSpawnConsole(event)).toEqual({ delivered: false })
  })
})

describe('board.listConsoles', () => {
  it('lists console cards with id, tabId, title and role', async () => {
    const { runtime } = makeRuntime([
      consoleCard(1, 'worker:lead-acme'),
      consoleCard(2, null),
      { id: 'n1', kind: 'note', text: 'hi' }
    ])
    const dispatcher = new RpcDispatcher({ runtime, methods: BOARD_CONSOLE_METHODS })
    const response = await dispatcher.dispatch(
      makeRequest('board.listConsoles', { worktree: `id:${WT}` })
    )
    expect(response).toMatchObject({
      ok: true,
      result: [
        { id: 'c1', tabId: 'tab-1', title: 'Console 1', role: 'worker:lead-acme' },
        { id: 'c2', tabId: 'tab-2', title: 'Console 2', role: null }
      ]
    })
  })
})

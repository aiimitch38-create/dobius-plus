import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../../../vertex/vertex-task-store', () => ({ vertexTaskStore: {} }))

const { leadConsoles } = await import('./leads')

const WT = 'wt-1'

function card(id: string, tabId: string, role: string) {
  return { id, kind: 'console', tabId, title: id, role, x: 0, y: 0 }
}

type AgentStatus = {
  isRunningAgent: boolean
  status: 'working' | 'permission' | 'idle' | null
}

function runtimeWith(
  cards: unknown[],
  terminals: { tabId: string; handle: string; connected: boolean }[],
  agentStatus: Record<string, AgentStatus> = {}
) {
  const listTerminals = vi.fn(async () => ({ terminals }))
  const getTerminalAgentStatus = vi.fn(async (handle: string) => ({
    handle,
    ...(agentStatus[handle] ?? { isRunningAgent: true, status: 'idle' as const })
  }))
  return {
    runtime: {
      getUIState: () => ({ boardsByWorktree: { [WT]: { cards, groups: [] } } }),
      listTerminals,
      getTerminalAgentStatus
    } as never,
    listTerminals,
    getTerminalAgentStatus
  }
}

describe('leadConsoles', () => {
  it('splits lead cards into agent consoles and stale card ids', async () => {
    const { runtime } = runtimeWith(
      [
        card('live', 'tab-live', 'lead:lead-acme'),
        card('dead', 'tab-dead', 'lead:lead-acme'),
        card('gone', 'tab-gone', 'lead:lead-acme'),
        card('worker', 'tab-worker', 'worker:lead-acme'),
        card('other', 'tab-other', 'lead:lead-b')
      ],
      [
        { tabId: 'tab-live', handle: 'terminal:live', connected: true },
        { tabId: 'tab-dead', handle: 'terminal:dead', connected: false },
        { tabId: 'tab-worker', handle: 'terminal:worker', connected: true },
        { tabId: 'tab-other', handle: 'terminal:other', connected: true }
      ]
    )
    expect(await leadConsoles(runtime, WT, 'lead-acme')).toEqual({
      consoles: [{ handle: 'terminal:live', agent: 'idle' }],
      staleCardIds: ['dead', 'gone']
    })
  })

  it('treats a connected lead terminal at a bare shell as stale, and a working agent as busy', async () => {
    const { runtime, getTerminalAgentStatus } = runtimeWith(
      [
        card('shell', 'tab-shell', 'lead:lead-acme'),
        card('busy', 'tab-busy', 'lead:lead-acme'),
        card('dialog', 'tab-dialog', 'lead:lead-acme'),
        card('idle', 'tab-idle', 'lead:lead-acme')
      ],
      [
        { tabId: 'tab-shell', handle: 'terminal:shell', connected: true },
        { tabId: 'tab-busy', handle: 'terminal:busy', connected: true },
        { tabId: 'tab-dialog', handle: 'terminal:dialog', connected: true },
        { tabId: 'tab-idle', handle: 'terminal:idle', connected: true }
      ],
      {
        'terminal:shell': { isRunningAgent: false, status: null },
        'terminal:busy': { isRunningAgent: true, status: 'working' },
        'terminal:dialog': { isRunningAgent: true, status: 'permission' },
        'terminal:idle': { isRunningAgent: true, status: null }
      }
    )
    expect(await leadConsoles(runtime, WT, 'lead-acme')).toEqual({
      consoles: [
        { handle: 'terminal:shell', agent: 'shell' },
        { handle: 'terminal:busy', agent: 'busy' },
        { handle: 'terminal:dialog', agent: 'busy' },
        { handle: 'terminal:idle', agent: 'idle' }
      ],
      staleCardIds: ['shell']
    })
    expect(getTerminalAgentStatus).toHaveBeenCalledTimes(4)
  })

  it('does not list terminals when the Board has no lead card', async () => {
    const { runtime, listTerminals } = runtimeWith([card('w', 'tab-w', 'worker:lead-acme')], [])
    expect(await leadConsoles(runtime, WT, 'lead-acme')).toEqual({ consoles: [], staleCardIds: [] })
    expect(listTerminals).not.toHaveBeenCalled()
  })
})

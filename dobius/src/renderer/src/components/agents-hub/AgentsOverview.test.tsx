// @vitest-environment happy-dom

/* BUILD-010: an unreadable Kanban board makes vertexTasks.list() reject. The
 * overview must say so and keep the last tasks it had, not show "Nothing open". */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { AgentsOverview } from './AgentsOverview'

const task = {
  id: 't1',
  title: 'Ship it',
  status: 'todo',
  childTaskIds: [],
  dependencies: []
}

function mountWith(
  list: () => Promise<unknown>,
  agents: unknown[] = [],
  runs: unknown[] = []
): void {
  Object.assign(window, {
    api: {
      vertexTasks: { list },
      agents: { list: async () => agents, listRuns: async () => runs }
    }
  })
  render(<AgentsOverview />)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'api')
})

describe('AgentsOverview board load failure', () => {
  it('shows a load error instead of an empty board', async () => {
    mountWith(() => Promise.reject(new Error('read-only')))
    expect(await screen.findByText('Board could not be loaded')).toBeTruthy()
    expect(screen.queryByText('Nothing open')).toBeNull()
  })

  it('keeps the previous tasks when a later load fails', async () => {
    vi.useFakeTimers()
    let fail = false
    mountWith(() => (fail ? Promise.reject(new Error('read-only')) : Promise.resolve([task])))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Ship it')).toBeTruthy()

    fail = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByText('Board could not be loaded')).toBeTruthy()
    expect(screen.getByText('Ship it')).toBeTruthy()
  })
})

describe('AgentsOverview crew running count (BUILD-041, #99)', () => {
  it('shows two running runs of one agent as one running agent and two runs', async () => {
    const agent = { id: 'a1', name: 'Scout', description: 'Scouts', model: 'm' }
    const running = (id: string) => ({
      id,
      agentId: 'a1',
      prompt: 'p',
      startedAt: Date.now(),
      status: 'running'
    })
    mountWith(async () => [], [agent], [running('r1'), running('r2')])
    expect(await screen.findByText('1 agents · 1 running · 2 runs active')).toBeTruthy()
    expect(screen.queryByText('1 agents · 2 running')).toBeNull()
  })
})

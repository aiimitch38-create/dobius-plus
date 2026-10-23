import { describe, expect, it } from 'vitest'
import type { BoardCard, BoardGroup } from '@/store/slices/board'
import {
  missionMapCanPause,
  missionMapFilterCounts,
  missionMapFilterOf,
  missionMapVisibleNodeIds
} from './mission-map-filter'
import {
  COMMAND_CENTER_NODE_ID,
  consoleNodeId,
  groupNodeId,
  layoutMissionMap,
  orchestratorNodeId
} from './mission-map-layout'

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const consoleCard = (id: string): BoardCard => ({
  ...base,
  id,
  title: id,
  kind: 'console',
  tabId: `tab-${id}`,
  agentKind: 'claude'
})
const orchestrator = (id: string, wiredCardIds: string[]): BoardCard => ({
  ...base,
  id,
  title: id,
  kind: 'orchestrator',
  name: id,
  wiredCardIds
})
const group = (id: string, cardIds: string[]): BoardGroup => ({
  id,
  name: id,
  color: 'blue',
  cardIds
})

describe('missionMapFilterOf', () => {
  it('folds live states into triage buckets', () => {
    expect(missionMapFilterOf('working')).toBe('working')
    expect(missionMapFilterOf('waiting')).toBe('waiting')
    expect(missionMapFilterOf('idle')).toBe('idle')
    expect(missionMapFilterOf('paused')).toBe('idle')
    expect(missionMapFilterOf('shell')).toBe('done')
    expect(missionMapFilterOf('done')).toBe('done')
    expect(missionMapFilterOf('gone')).toBe('done')
  })
})

describe('missionMapFilterCounts', () => {
  it('counts every console under All and its bucket', () => {
    expect(
      missionMapFilterCounts({ a: 'working', b: 'waiting', c: 'paused', d: 'gone', e: 'working' })
    ).toEqual({ all: 5, working: 2, waiting: 1, idle: 1, done: 1 })
  })
})

describe('missionMapVisibleNodeIds', () => {
  // o1 → g1 (c1, c2); o2 → c3 (ungrouped); c4 unwired.
  const layout = layoutMissionMap(
    [
      orchestrator('o1', ['c1']),
      orchestrator('o2', ['c3']),
      consoleCard('c1'),
      consoleCard('c2'),
      consoleCard('c3'),
      consoleCard('c4')
    ],
    [group('g1', ['c1', 'c2'])]
  )
  const statuses = {
    [consoleNodeId('c1')]: 'idle',
    [consoleNodeId('c2')]: 'waiting',
    [consoleNodeId('c3')]: 'working'
  } as const

  it('shows everything under All', () => {
    expect(missionMapVisibleNodeIds(layout.nodes, layout.edges, statuses, 'all').size).toBe(
      layout.nodes.length
    )
  })

  it('lights a match, its group and the orchestrator wired to that group', () => {
    const visible = missionMapVisibleNodeIds(layout.nodes, layout.edges, statuses, 'waiting')
    expect([...visible].sort()).toEqual(
      [
        consoleNodeId('c2'),
        groupNodeId('g1'),
        orchestratorNodeId('o1'),
        COMMAND_CENTER_NODE_ID
      ].sort()
    )
  })

  it('lights an orchestrator wired straight to a matching console', () => {
    const visible = missionMapVisibleNodeIds(layout.nodes, layout.edges, statuses, 'working')
    expect([...visible].sort()).toEqual(
      [consoleNodeId('c3'), orchestratorNodeId('o2'), COMMAND_CENTER_NODE_ID].sort()
    )
  })

  it('dims the command center when no console matches', () => {
    const visible = missionMapVisibleNodeIds(layout.nodes, layout.edges, statuses, 'done')
    expect(visible.size).toBe(0)
  })

  it('treats a console without a status yet as idle', () => {
    const visible = missionMapVisibleNodeIds(layout.nodes, layout.edges, statuses, 'idle')
    expect(visible.has(consoleNodeId('c4'))).toBe(true)
    expect(visible.has(consoleNodeId('c1'))).toBe(true)
    expect(visible.has(consoleNodeId('c3'))).toBe(false)
  })
})

describe('missionMapCanPause', () => {
  it('allows pausing only while an agent holds the terminal', () => {
    expect(missionMapCanPause('working')).toBe(true)
    expect(missionMapCanPause('waiting')).toBe(true)
    expect(missionMapCanPause('idle')).toBe(true)
    expect(missionMapCanPause('paused')).toBe(false)
    expect(missionMapCanPause('shell')).toBe(false)
    expect(missionMapCanPause('gone')).toBe(false)
  })
})

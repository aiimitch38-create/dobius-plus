import { describe, expect, it } from 'vitest'
import type { BoardCard, BoardGroup } from '@/store/slices/board'
import {
  MISSION_MAP_NODE_W,
  consoleNodeId,
  groupNodeId,
  layoutMissionMap,
  missionMapEdgePath,
  missionMapNodeCardIds,
  orchestratorNodeId
} from './mission-map-layout'

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const console = (id: string, title = id): BoardCard => ({
  ...base,
  id,
  title,
  kind: 'console',
  tabId: `tab-${id}`,
  agentKind: 'claude'
})
const orchestrator = (id: string, wiredCardIds: string[]): BoardCard => ({
  ...base,
  id,
  title: id,
  kind: 'orchestrator',
  name: `Orch ${id}`,
  wiredCardIds
})
const group = (id: string, cardIds: string[]): BoardGroup => ({
  id,
  name: `Group ${id}`,
  color: 'blue',
  cardIds
})

describe('layoutMissionMap', () => {
  it('returns an empty layout with no nodes or edges', () => {
    const layout = layoutMissionMap([], [])
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
    expect(layout.ungroupedBucketY).toBeNull()
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('places orchestrators, groups and consoles in three increasing columns', () => {
    const layout = layoutMissionMap(
      [orchestrator('o1', ['c1']), console('c1'), console('c2')],
      [group('g1', ['c1'])]
    )
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    const o = byId.get(orchestratorNodeId('o1'))!
    const g = byId.get(groupNodeId('g1'))!
    const c1 = byId.get(consoleNodeId('c1'))!
    const c2 = byId.get(consoleNodeId('c2'))!
    expect(o.x).toBeLessThan(g.x)
    expect(g.x).toBeLessThan(c1.x)
    expect(c1.x).toBe(c2.x)
    expect(c1.y).toBeLessThan(c2.y)
    expect(layout.width).toBeGreaterThanOrEqual(c1.x + MISSION_MAP_NODE_W)
  })

  it('ignores non-console cards and only draws groups that hold consoles', () => {
    const note: BoardCard = {
      ...base,
      id: 'n1',
      title: 'note',
      kind: 'note',
      text: '',
      color: 'pink'
    }
    const layout = layoutMissionMap([note, console('c1')], [group('g-empty', ['n1'])])
    expect(layout.nodes.map((n) => n.id)).toEqual([consoleNodeId('c1')])
  })

  it('wires an orchestrator to the console group when the console is grouped, else to the console', () => {
    const layout = layoutMissionMap(
      [orchestrator('o1', ['c1', 'c2', 'missing']), console('c1'), console('c2')],
      [group('g1', ['c1'])]
    )
    expect(layout.edges).toEqual([
      {
        id: `${orchestratorNodeId('o1')}->${groupNodeId('g1')}`,
        from: orchestratorNodeId('o1'),
        to: groupNodeId('g1'),
        kind: 'wire'
      },
      {
        id: `${orchestratorNodeId('o1')}->${consoleNodeId('c2')}`,
        from: orchestratorNodeId('o1'),
        to: consoleNodeId('c2'),
        kind: 'wire'
      },
      {
        id: `${groupNodeId('g1')}->${consoleNodeId('c1')}`,
        from: groupNodeId('g1'),
        to: consoleNodeId('c1'),
        kind: 'member'
      }
    ])
  })

  it('dedupes wires to the same group and keeps one group per console', () => {
    const layout = layoutMissionMap(
      [orchestrator('o1', ['c1', 'c2']), console('c1'), console('c2')],
      [group('g1', ['c1', 'c2']), group('g2', ['c2'])]
    )
    const wires = layout.edges.filter((e) => e.kind === 'wire')
    expect(wires).toHaveLength(1)
    expect(layout.nodes.filter((n) => n.kind === 'group')).toHaveLength(1)
    const c2 = layout.nodes.find((n) => n.id === consoleNodeId('c2'))
    expect(c2?.kind === 'console' && c2.groupId).toBe('g1')
  })

  it('puts ungrouped consoles in a bucket below grouped ones', () => {
    const layout = layoutMissionMap([console('c1'), console('c2')], [group('g1', ['c2'])])
    const grouped = layout.nodes.find((n) => n.id === consoleNodeId('c2'))!
    const loose = layout.nodes.find((n) => n.id === consoleNodeId('c1'))!
    expect(grouped.y).toBeLessThan(loose.y)
    expect(layout.ungroupedBucketY).toBe(loose.y)
    expect(layout.height).toBeGreaterThan(loose.y)
  })

  it('draws an edge path between node edges', () => {
    const path = missionMapEdgePath({ x: 0, y: 0 }, { x: 300, y: 100 })
    expect(path.startsWith(`M ${MISSION_MAP_NODE_W} `)).toBe(true)
    expect(path.endsWith(' 300 122')).toBe(true)
  })
})

describe('missionMapNodeCardIds', () => {
  it('maps consoles and orchestrators to their card, groups to their members', () => {
    const cards = [console('a'), console('b'), orchestrator('o', ['a'])]
    const groups = [group('g', ['a', 'b'])]
    const { nodes } = layoutMissionMap(cards, groups)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    expect(missionMapNodeCardIds(byId.get(consoleNodeId('a'))!, groups)).toEqual(['a'])
    expect(missionMapNodeCardIds(byId.get(orchestratorNodeId('o'))!, groups)).toEqual(['o'])
    expect(missionMapNodeCardIds(byId.get(groupNodeId('g'))!, groups)).toEqual(['a', 'b'])
    expect(missionMapNodeCardIds(byId.get(groupNodeId('g'))!, [])).toEqual([])
  })
})
